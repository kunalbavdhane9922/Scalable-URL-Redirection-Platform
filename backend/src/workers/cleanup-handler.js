import { queries } from '../db/queries.js';
import { invalidateL2, setGoneCache } from '../services/cache-service.js';
import { publishInvalidation } from '../cache/invalidation.js';

/**
 * Expired link cleanup handler.
 *
 * Per document Table 7:
 *  - Workload: Expiry cleanup
 *  - Events: link_expired / cleanup_due
 *  - Action: "Clean up eligible records or derived data."
 *
 * Per document §10 step 6:
 *  - "For expired links, check expires_at at the authoritative lookup
 *     and use TTL/cleanup as optimization."
 *
 * This worker periodically finds expired links and disables them,
 * invalidating their cache entries.
 */

const CLEANUP_BATCH_SIZE = 100;

/**
 * Run one cleanup pass: find and disable expired links.
 *
 * @param {import('pg').Pool} pgPool
 * @param {import('ioredis').Redis} redis
 * @param {Function} isRedisAvailable
 * @param {import('pino').Logger} logger
 * @returns {Promise<number>} Number of expired links cleaned up
 */
export async function cleanupExpiredLinks(pgPool, redis, isRedisAvailable, logger) {
  const expired = await pgPool.query(queries.findExpiredLinks, [CLEANUP_BATCH_SIZE]);

  if (expired.rows.length === 0) {
    return 0;
  }

  const ids = expired.rows.map(r => r.id);
  const result = await pgPool.query(queries.expireLinks, [ids]);

  // Invalidate cache entries for expired links and mark them gone so the
  // redirect path can answer 410 without a database round trip.
  for (const row of result.rows) {
    try {
      await invalidateL2(redis, row.short_code);
      setGoneCache(redis, isRedisAvailable, row.short_code, 'expired');
      if (isRedisAvailable()) {
        await publishInvalidation(redis, row.short_code, 'expire');
      }
    } catch (err) {
      logger.warn({ err: err.message, shortCode: row.short_code }, 'Failed to invalidate expired link cache');
    }
  }

  logger.info({ count: result.rows.length }, 'Expired links cleaned up');
  return result.rows.length;
}
