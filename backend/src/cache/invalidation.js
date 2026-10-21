import { l1Evict } from './lru-cache.js';

/**
 * Cache invalidation listener using Redis Pub/Sub.
 *
 * Per document §10 steps 3-4:
 *  - "Publish an invalidation message through Redis Pub/Sub so application
 *     instances can evict their local L1 entry."
 *  - "Because Pub/Sub does not retain messages for disconnected subscribers,
 *     every L1 cache must have a bounded TTL."
 *
 * This module subscribes to a dedicated invalidation channel and evicts
 * L1 entries when notified. The bounded TTL on L1 entries ensures that
 * even if a Pub/Sub message is missed, stale data has a limited lifetime.
 */

const INVALIDATION_CHANNEL = 'url_shortener:cache_invalidation';

/**
 * Subscribe to cache invalidation messages.
 * @param {import('ioredis').Redis} redisSub - Dedicated subscriber connection
 * @param {import('pino').Logger} logger
 */
export function setupInvalidationListener(redisSub, logger) {
  redisSub.subscribe(INVALIDATION_CHANNEL, (err) => {
    if (err) {
      logger.error({ err }, 'Failed to subscribe to invalidation channel');
      return;
    }
    logger.info({ channel: INVALIDATION_CHANNEL }, 'Subscribed to cache invalidation channel');
  });

  redisSub.on('message', (channel, message) => {
    if (channel !== INVALIDATION_CHANNEL) return;

    try {
      const { shortCode, action } = JSON.parse(message);
      if (shortCode) {
        l1Evict(shortCode);
        logger.debug({ shortCode, action }, 'L1 cache entry evicted via invalidation');
      }
    } catch (err) {
      logger.warn({ err, message }, 'Failed to parse invalidation message');
    }
  });
}

/**
 * Publish an invalidation message to all instances.
 * @param {import('ioredis').Redis} redis - Command client
 * @param {string} shortCode - The code to invalidate
 * @param {string} action - The lifecycle action (update, disable, delete, expire)
 */
export async function publishInvalidation(redis, shortCode, action) {
  const message = JSON.stringify({ shortCode, action, timestamp: Date.now() });
  await redis.publish(INVALIDATION_CHANNEL, message);
}
