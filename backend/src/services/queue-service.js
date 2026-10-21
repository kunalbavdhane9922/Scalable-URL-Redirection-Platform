import config from '../config.js';

/**
 * Event publishing service using Redis Streams.
 *
 * Per document §11:
 *  - "A queue is not required to resolve a URL."
 *  - "Queue publication must not block the 302 redirect response."
 *
 * Per document §11.1:
 *  - "Choose one queue technology based on requirements."
 *  - Redis Streams is our chosen technology (persistent, supports consumer groups).
 *  - "Use acknowledgements/consumer offsets, retry with exponential backoff."
 *
 * Per document §7 step 8:
 *  - Critical events use the transactional outbox pattern.
 *  - Best-effort events (like click analytics) are published directly.
 */

const STREAM_KEY = config.queue.streamKey;

/**
 * Publish an event to Redis Streams.
 * This is non-blocking and best-effort by design (§11.1).
 * If Redis is unavailable, the failure is logged but does not block the caller.
 *
 * @param {import('ioredis').Redis} redis
 * @param {import('pino').Logger} logger
 * @param {string} eventType - Event type (e.g., 'link_clicked', 'link_created')
 * @param {object} payload - Event data
 */
export async function publishEvent(redis, logger, eventType, payload) {
  try {
    await redis.xadd(
      STREAM_KEY,
      '*', // auto-generate ID
      'event_type', eventType,
      'payload', JSON.stringify(payload),
      'timestamp', Date.now().toString(),
    );
  } catch (err) {
    // Per §11.1: "Queue publication must not block the 302 redirect response"
    // For best-effort events, log and continue.
    logger.warn({ err: err.message, eventType }, 'Failed to publish event to stream');
  }
}

/**
 * Publish a click event asynchronously.
 * Per §8 step 9: "Publish click analytics asynchronously only if analytics
 * are enabled. The redirect response must not wait for analytics processing."
 *
 * This function is fire-and-forget; it does not await the result.
 */
export function enqueueClickEvent(redis, logger, shortCode, originalUrl) {
  // Fire and forget — do not await
  publishEvent(redis, logger, 'link_clicked', {
    shortCode,
    originalUrl,
    clickedAt: new Date().toISOString(),
  }).catch(() => {
    // Already logged inside publishEvent
  });
}

/**
 * Ensure the consumer group exists for the stream.
 * Called once during worker startup.
 */
export async function ensureConsumerGroup(redis, logger) {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, config.queue.consumerGroup, '0', 'MKSTREAM');
    logger.info({ stream: STREAM_KEY, group: config.queue.consumerGroup }, 'Consumer group created');
  } catch (err) {
    // BUSYGROUP means the group already exists — that's fine
    if (err.message?.includes('BUSYGROUP')) {
      logger.debug('Consumer group already exists');
    } else {
      throw err;
    }
  }
}

/**
 * Read events from the stream as a consumer.
 * Used by background workers.
 *
 * @param {import('ioredis').Redis} redis
 * @returns {Promise<Array>} Array of [streamKey, [[id, [field, value, ...]], ...]]
 */
export async function readEvents(redis) {
  const result = await redis.xreadgroup(
    'GROUP', config.queue.consumerGroup, config.queue.consumerName,
    'COUNT', config.queue.batchSize,
    'BLOCK', config.queue.blockMs,
    'STREAMS', STREAM_KEY,
    '>', // only new messages
  );
  return result;
}

/**
 * Acknowledge a processed event.
 * Per §11.1: "Use acknowledgements/consumer offsets."
 */
export async function acknowledgeEvent(redis, messageId) {
  await redis.xack(STREAM_KEY, config.queue.consumerGroup, messageId);
}
