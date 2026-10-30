import config from '../config.js';
import { recordClickEvents } from '../plugins/metrics.js';

/**
 * Event pipeline.
 *
 * Critical events use the transactional outbox (written by the API and
 * relayed by the worker). Click analytics are best-effort: they are buffered
 * in memory and written to Redis Streams in batches so a 10k RPS redirect
 * path does not issue one round trip per click.
 */

const STREAM_KEY = config.queue.streamKey;
const DEAD_LETTER_KEY = config.queue.deadLetterKey;

const buffer = [];
// Hard cap protects the process if Redis is slow for a long period.
const HARD_CAP = config.clickBuffer.maxBatch * 20;

let flushTimer = null;
let flushingPromise = null;

function streamFields(eventType, payload) {
  return [
    'event_type', eventType,
    'payload', JSON.stringify(payload),
    'timestamp', String(Date.now()),
  ];
}

/**
 * Publish a single event. Used for low-volume events.
 */
export async function publishEvent(redis, logger, eventType, payload) {
  try {
    await redis.xadd(STREAM_KEY, '*', ...streamFields(eventType, payload));
  } catch (err) {
    logger?.warn({ err: err.message, eventType }, 'Failed to publish event to stream');
  }
}

/**
 * Queue a click event in memory. Flushed every CLICK_BUFFER_FLUSH_MS or when
 * the batch fills up. Never awaited by the redirect handler.
 */
export function enqueueClickEvent(redis, logger, shortCode, meta = {}) {
  const ready = !redis || !redis.status || redis.status === 'ready';
  if (!ready) {
    recordClickEvents('dropped');
    return;
  }

  if (buffer.length >= HARD_CAP) {
    buffer.shift();
    recordClickEvents('dropped');
  }

  buffer.push({
    shortCode,
    originalUrl: meta.originalUrl,
    clickedAt: meta.clickedAt || new Date().toISOString(),
    referrer: meta.referrer || 'direct',
    device: meta.device || 'unknown',
    country: meta.country || null,
    requestId: meta.requestId || null,
  });
  recordClickEvents('queued');

  if (buffer.length >= config.clickBuffer.maxBatch) {
    flushClickBuffer(redis, logger).catch(() => {});
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushClickBuffer(redis, logger).catch(() => {});
    }, config.clickBuffer.flushIntervalMs);
    flushTimer.unref?.();
  }
}

async function writeBatch(redis, batch) {
  if (typeof redis.pipeline === 'function') {
    const pipeline = redis.pipeline();
    for (const event of batch) {
      pipeline.xadd(STREAM_KEY, '*', ...streamFields('link_clicked', event));
    }
    await pipeline.exec();
    return;
  }

  await Promise.all(
    batch.map((event) => redis.xadd(STREAM_KEY, '*', ...streamFields('link_clicked', event))),
  );
}

export async function flushClickBuffer(redis, logger) {
  if (flushingPromise) return flushingPromise;
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, config.clickBuffer.maxBatch);
  flushingPromise = writeBatch(redis, batch)
    .then(() => {
      recordClickEvents('published', batch.length);
    })
    .catch((err) => {
      recordClickEvents('failed', batch.length);
      logger?.warn({ err: err.message, count: batch.length }, 'Failed to flush click events');
      // Put events back (bounded) so a transient Redis blip does not lose them.
      const room = Math.max(0, HARD_CAP - buffer.length);
      if (room > 0) buffer.unshift(...batch.slice(-room));
    })
    .finally(() => {
      flushingPromise = null;
      if (buffer.length > 0 && !flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushClickBuffer(redis, logger).catch(() => {});
        }, config.clickBuffer.flushIntervalMs);
        flushTimer.unref?.();
      }
    });

  return flushingPromise;
}

export async function closeClickBuffer(redis, logger) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushClickBuffer(redis, logger).catch(() => {});
}

export async function ensureConsumerGroup(redis, logger) {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, config.queue.consumerGroup, '0', 'MKSTREAM');
    logger?.info({ stream: STREAM_KEY, group: config.queue.consumerGroup }, 'Consumer group created');
  } catch (err) {
    if (err.message?.includes('BUSYGROUP')) {
      logger?.debug('Consumer group already exists');
    } else {
      throw err;
    }
  }
}

export async function readEvents(redis) {
  return redis.xreadgroup(
    'GROUP', config.queue.consumerGroup, config.queue.consumerName,
    'COUNT', config.queue.batchSize,
    'BLOCK', config.queue.blockMs,
    'STREAMS', STREAM_KEY,
    '>',
  );
}

/**
 * Reclaim messages delivered to a crashed worker and never acked.
 * Returns the reclaimed message array so the caller can process them.
 */
export async function claimStaleEvents(redis, logger) {
  if (typeof redis.xautoclaim !== 'function') return [];

  try {
    const result = await redis.xautoclaim(
      STREAM_KEY,
      config.queue.consumerGroup,
      config.queue.consumerName,
      config.queue.claimIdleMs,
      '0-0',
      'COUNT', config.queue.batchSize,
    );
    // ioredis returns [nextId, messages, deletedIds]
    const messages = result?.[1] || [];
    if (messages.length > 0) {
      logger?.info({ count: messages.length }, 'Reclaimed stale stream messages');
    }
    return messages;
  } catch (err) {
    logger?.warn({ err: err.message }, 'XAUTOCLAIM failed');
    return [];
  }
}

export async function acknowledgeEvent(redis, messageId) {
  await redis.xack(STREAM_KEY, config.queue.consumerGroup, messageId);
}

export async function deadLetterEvent(redis, logger, messageId, fields, reason) {
  try {
    await redis.xadd(
      DEAD_LETTER_KEY, '*',
      'original_id', String(messageId),
      'reason', String(reason || 'unknown'),
      'fields', JSON.stringify(fields),
      'timestamp', String(Date.now()),
    );
    await acknowledgeEvent(redis, messageId);
    logger?.error({ messageId, reason }, 'Event routed to dead-letter stream');
  } catch (err) {
    logger?.error({ err: err.message, messageId }, 'Failed to dead-letter event');
  }
}
