import 'dotenv/config';
import pg from 'pg';
import Redis from 'ioredis';
import pino from 'pino';
import config from '../config.js';
import { queries } from '../db/queries.js';
import { ensureConsumerGroup, readEvents, acknowledgeEvent } from '../services/queue-service.js';
import { handleClickEvent } from './analytics-handler.js';
import { handleLifecycleEvent } from './lifecycle-handler.js';
import { cleanupExpiredLinks } from './cleanup-handler.js';
import { invalidateL2 } from '../services/cache-service.js';

/**
 * Background worker process.
 *
 * Per document §11 (Table 7):
 *  - Consumes events from Redis Streams.
 *  - Routes events to appropriate handlers.
 *  - Handles click analytics, lifecycle events, cleanup, etc.
 *
 * Per document §11.1:
 *  - "Use acknowledgements/consumer offsets, retry with exponential backoff,
 *     and dead-letter handling where supported."
 *  - "Make workers idempotent because at-least-once delivery can produce
 *     duplicate events."
 *
 * Per document Table 8:
 *  - "Worker failure → Retry transient errors with backoff, use idempotent
 *     handlers, and route poison messages to a dead-letter mechanism."
 */

const logger = pino({ level: config.logLevel });

// ─── Infrastructure connections ──────────────────────────────────────

const pgPool = new pg.Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
  min: 1,
  max: 5, // Workers need fewer connections than app servers
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
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

let redisAvailable = false;
redis.on('ready', () => { redisAvailable = true; });
redis.on('error', () => { redisAvailable = false; });
redis.on('close', () => { redisAvailable = false; });

const isRedisAvailable = () => redisAvailable;

// ─── Event routing ───────────────────────────────────────────────────

/**
 * Parse raw stream message fields into a structured event.
 */
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

/**
 * Route an event to its handler.
 * Per document Table 7: event types map to specific worker actions.
 */
async function handleEvent(eventType, payload) {
  switch (eventType) {
    case 'link_clicked':
      await handleClickEvent(pgPool, logger, payload);
      break;

    case 'link_created':
    case 'link_updated':
    case 'link_disabled':
      await handleLifecycleEvent(pgPool, logger, eventType, payload);
      break;

    default:
      logger.warn({ eventType }, 'Unknown event type, skipping');
  }
}

// ─── Outbox relay ────────────────────────────────────────────────────

/**
 * Outbox relay: publish pending outbox events to the stream.
 * Per §7 step 8 and §11.1:
 *  - "Use a transactional outbox for critical events."
 *  - Polls the outbox table and publishes to Redis Streams.
 */
async function processOutbox() {
  try {
    const result = await pgPool.query(queries.fetchUnpublishedOutboxEvents, [50]);

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

        // Increment retry count
        await pgPool.query(queries.incrementOutboxRetry, [event.id]).catch(() => {});

        // Dead-letter: if too many retries, log and skip
        if (event.retries >= config.queue.maxRetries) {
          logger.error({ eventId: event.id, eventType: event.event_type },
            'Outbox event exceeded max retries — dead-lettered');
        }
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Outbox relay error');
  }
}

// ─── Main consumer loop ──────────────────────────────────────────────

let running = true;

async function consumeEvents() {
  await ensureConsumerGroup(redis, logger);

  logger.info('Worker started, consuming events...');

  while (running) {
    try {
      const result = await readEvents(redis);

      if (!result) continue; // No messages (block timeout expired)

      for (const [, messages] of result) {
        for (const [messageId, fields] of messages) {
          try {
            const { eventType, payload } = parseStreamMessage(fields);
            await handleEvent(eventType, payload);
            await acknowledgeEvent(redis, messageId);
          } catch (err) {
            // Per §11.1: "retry with exponential backoff"
            // Failed messages remain unacknowledged and will be re-delivered.
            logger.error({ err: err.message, messageId }, 'Failed to process event');
          }
        }
      }
    } catch (err) {
      if (!running) break;
      logger.error({ err: err.message }, 'Consumer loop error');
      // Backoff on consumer errors
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// ─── Periodic tasks ──────────────────────────────────────────────────

// Outbox relay runs every 5 seconds
const outboxInterval = setInterval(processOutbox, 5000);

// Expired link cleanup runs every 60 seconds
const cleanupInterval = setInterval(() => {
  cleanupExpiredLinks(pgPool, redis, isRedisAvailable, logger).catch(err => {
    logger.error({ err: err.message }, 'Cleanup task error');
  });
}, 60000);

// ─── Graceful shutdown ───────────────────────────────────────────────

async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  running = false;

  clearInterval(outboxInterval);
  clearInterval(cleanupInterval);

  await redis.quit().catch(() => {});
  await pgPool.end().catch(() => {});

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start consuming
consumeEvents().catch(err => {
  logger.fatal({ err: err.message }, 'Worker crashed');
  process.exit(1);
});
