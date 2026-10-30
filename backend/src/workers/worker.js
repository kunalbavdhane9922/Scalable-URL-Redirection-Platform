import 'dotenv/config';
import { createServer } from 'node:http';
import pg from 'pg';
import Redis from 'ioredis';
import pino from 'pino';
import config from '../config.js';
import { queries } from '../db/queries.js';
import {
  ensureConsumerGroup,
  readEvents,
  acknowledgeEvent,
  claimStaleEvents,
  deadLetterEvent,
} from '../services/queue-service.js';
import { handleClickBatch } from './analytics-handler.js';
import { handleLifecycleEvent } from './lifecycle-handler.js';
import { cleanupExpiredLinks } from './cleanup-handler.js';
import { purgeExpiredAuth } from '../services/auth-service.js';

/**
 * Background worker: outbox relay, click analytics, lifecycle events, and
 * expiry cleanup. Designed for at-least-once delivery with idempotent,
 * batched handlers and a dead-letter stream for poison messages.
 */

const logger = pino({
  level: config.logLevel,
  base: { service: 'url-shortener-worker', pid: process.pid },
});

const pgPool = new pg.Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
  min: 1,
  max: 5,
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
  query_timeout: config.pg.queryTimeoutMs,
  statement_timeout: config.pg.statementTimeoutMs,
  application_name: 'url-shortener-worker',
});

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  connectTimeout: config.redis.connectTimeout,
  commandTimeout: config.redis.commandTimeout,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 3000);
  },
});

/**
 * XREADGROUP BLOCK parks the connection until a message arrives, which would
 * starve the ack/publish commands on the shared client and be killed by its
 * short commandTimeout. Blocking reads therefore get their own connection with
 * a timeout comfortably above the block window.
 */
const redisBlocking = redis.duplicate({
  commandTimeout: config.queue.blockMs + 5000,
  maxRetriesPerRequest: null,
});
redisBlocking.on('error', () => {});

let redisAvailable = false;
redis.on('ready', () => { redisAvailable = true; });
redis.on('error', () => { redisAvailable = false; });
redis.on('close', () => { redisAvailable = false; });

const isRedisAvailable = () => redisAvailable;

/** messageId → handler failures (reset when acked or dead-lettered). */
const attempts = new Map();

function parseStreamMessage(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return {
    eventType: obj.event_type,
    payload: JSON.parse(obj.payload || '{}'),
    timestamp: obj.timestamp,
  };
}

async function failOrDeadLetter(messageId, fields, eventType, err) {
  const count = (attempts.get(messageId) || 0) + 1;
  attempts.set(messageId, count);

  logger.warn({ messageId, eventType, attempt: count, err: err.message }, 'Event handler failed');

  if (count >= config.queue.maxRetries) {
    await deadLetterEvent(redis, logger, messageId, fields, err.message);
    attempts.delete(messageId);
  }
  // Otherwise leave it pending; XAUTOCLAIM re-delivers it after the idle window.
}

async function processMessages(messages) {
  const clicks = [];
  const others = [];

  for (const [messageId, fields] of messages) {
    try {
      const parsed = parseStreamMessage(fields);
      if (parsed.eventType === 'link_clicked') {
        clicks.push({ messageId, fields, payload: parsed.payload });
      } else {
        others.push({ messageId, fields, ...parsed });
      }
    } catch (err) {
      await deadLetterEvent(redis, logger, messageId, fields, `parse error: ${err.message}`);
    }
  }

  if (clicks.length > 0) {
    try {
      await handleClickBatch(pgPool, logger, clicks.map((c) => c.payload));
      for (const click of clicks) {
        await acknowledgeEvent(redis, click.messageId);
        attempts.delete(click.messageId);
      }
    } catch (err) {
      for (const click of clicks) {
        await failOrDeadLetter(click.messageId, click.fields, 'link_clicked', err);
      }
    }
  }

  for (const event of others) {
    try {
      await handleLifecycleEvent(pgPool, logger, event.eventType, event.payload);
      await acknowledgeEvent(redis, event.messageId);
      attempts.delete(event.messageId);
    } catch (err) {
      await failOrDeadLetter(event.messageId, event.fields, event.eventType, err);
    }
  }
}

async function processOutbox() {
  try {
    const result = await pgPool.query(queries.claimOutboxEvents, [50, 60]);

    for (const event of result.rows) {
      try {
        await redis.xadd(
          config.queue.streamKey,
          '*',
          'event_type', event.event_type,
          'payload', JSON.stringify(event.payload),
          'timestamp', new Date(event.created_at).getTime().toString(),
        );
        await pgPool.query(queries.markOutboxPublished, [event.id]);
      } catch (err) {
        logger.error({ err: err.message, eventId: event.id }, 'Failed to publish outbox event');
        await pgPool.query(queries.releaseOutboxClaim, [event.id]).catch(() => {});

        if (event.retries >= config.queue.maxRetries) {
          await pgPool.query(queries.markOutboxPublished, [event.id]).catch(() => {});
          logger.error({ eventId: event.id, eventType: event.event_type },
            'Outbox event exceeded max retries — dead-lettered');
        }
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Outbox relay error');
  }
}

let running = true;
let processing = false;

async function consumeEvents() {
  await ensureConsumerGroup(redis, logger);
  logger.info({ stream: config.queue.streamKey }, 'Worker consuming events');

  while (running) {
    try {
      const result = await readEvents(redisBlocking);
      lastLoopAt = Date.now();
      if (!result) continue;

      for (const [, messages] of result) {
        if (messages.length === 0) continue;
        processing = true;
        await processMessages(messages);
        processing = false;
      }
    } catch (err) {
      processing = false;
      if (!running) break;

      if (String(err.message).includes('NOGROUP')) {
        await ensureConsumerGroup(redis, logger).catch(() => {});
      }

      logger.error({ err: err.message }, 'Consumer loop error');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function reclaimStale() {
  try {
    const messages = await claimStaleEvents(redis, logger);
    if (!messages || messages.length === 0) return;

    processing = true;
    await processMessages(messages);
    processing = false;
  } catch (err) {
    processing = false;
    logger.warn({ err: err.message }, 'Stale message reclaim error');
  }
}

const outboxInterval = setInterval(processOutbox, 5000);
const cleanupInterval = setInterval(() => {
  cleanupExpiredLinks(pgPool, redis, isRedisAvailable, logger).catch((err) => {
    logger.error({ err: err.message }, 'Cleanup task error');
  });
}, 60000);
const authCleanupInterval = setInterval(() => {
  purgeExpiredAuth(pgPool).catch((err) => {
    logger.warn({ err: err.message }, 'Auth token cleanup failed');
  });
}, 60 * 60 * 1000);
const reclaimInterval = setInterval(reclaimStale, 30000);

// ─── Worker health endpoint ─────────────────────────────────────────
const healthPort = parseInt(process.env.WORKER_HEALTH_PORT, 10) || 3001;
let lastLoopAt = Date.now();

const healthServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/health/live') {
    const healthy = Date.now() - lastLoopAt < 30000;
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'alive' : 'stalled',
      redis: redisAvailable ? 'healthy' : 'unavailable',
      lastLoopAt: new Date(lastLoopAt).toISOString(),
    }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// ─── Graceful shutdown ──────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  running = false;

  clearInterval(outboxInterval);
  clearInterval(cleanupInterval);
  clearInterval(authCleanupInterval);
  clearInterval(reclaimInterval);

  healthServer.close();

  const deadline = Date.now() + 8000;
  while (processing && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await redis.quit().catch(() => {});
  redisBlocking.disconnect();
  await pgPool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

healthServer.listen(healthPort, '0.0.0.0', () => {
  logger.info({ port: healthPort }, 'Worker health endpoint listening');
});

consumeEvents().catch((err) => {
  logger.fatal({ err: err.message }, 'Worker crashed');
  process.exit(1);
});
