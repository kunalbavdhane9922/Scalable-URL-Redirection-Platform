import config from '../config.js';
import {
  l1Get,
  l1Set,
  l1SetNegative,
  l1IsNegativelyCached,
  l1Evict,
  l1Stats,
} from '../cache/lru-cache.js';

/**
 * Cache orchestration service — L1 (in-memory LRU) + L2 (shared Redis).
 *
 * Per document §9.1:
 *  - "The intended lookup order is L1 → Redis → PostgreSQL."
 *  - "Use TTL jitter to avoid large groups of keys expiring simultaneously."
 *
 * Per document §9.4:
 *  - Single-flight/request coalescing for concurrent misses of the same key.
 *  - Negative caching with strict TTL and memory limits.
 *
 * Per document §12 (Table 8):
 *  - "Redis unavailable → Fall back to PostgreSQL where safe"
 */

// Single-flight map: prevents concurrent DB queries for the same code
// Per §9.4: "let one lookup refresh a missing key while concurrent requests
// await the same result"
const inflightRequests = new Map();

// Redis key prefix for URL mappings
const REDIS_PREFIX = 'url:';
// Redis key prefix for negative cache entries
const REDIS_NEGATIVE_PREFIX = 'url:neg:';

/**
 * Apply TTL jitter to prevent cache stampedes.
 * Per §9.1: "Use TTL jitter to avoid large groups of keys expiring simultaneously."
 * Per §9.4: "TTL jitter: vary expiration slightly to spread refreshes."
 *
 * @param {number} baseTtl - Base TTL value
 * @param {number} jitterPercent - Jitter percentage (0-100)
 * @returns {number} Jittered TTL
 */
function addJitter(baseTtl, jitterPercent = config.l2Cache.ttlJitterPercent) {
  const jitter = baseTtl * (jitterPercent / 100);
  return Math.round(baseTtl + (Math.random() * 2 - 1) * jitter);
}

/**
 * Attempt to get a URL from L1 cache.
 * @returns {{ url: string, source: 'l1' } | null}
 */
export function getFromL1(code) {
  const url = l1Get(code);
  if (url) return { url, source: 'l1' };
  return null;
}

/**
 * Check if a code is known-nonexistent in L1 negative cache.
 */
export function isNegativelyCachedL1(code) {
  return l1IsNegativelyCached(code);
}

/**
 * Attempt to get a URL from Redis (L2).
 * Handles Redis unavailability gracefully per §12.
 *
 * @param {import('ioredis').Redis} redis
 * @param {Function} isRedisAvailable
 * @param {string} code
 * @returns {Promise<{ url: string, source: 'l2' } | null>}
 */
export async function getFromL2(redis, isRedisAvailable, code) {
  if (!isRedisAvailable()) return null;

  try {
    // Check negative cache first
    const isNegative = await redis.get(`${REDIS_NEGATIVE_PREFIX}${code}`);
    if (isNegative) return { url: null, source: 'l2-negative' };

    const url = await redis.get(`${REDIS_PREFIX}${code}`);
    if (url) {
      // Populate L1 on L2 hit (§8 step 5)
      const l1Ttl = addJitter(config.l1Cache.defaultTtlMs);
      l1Set(code, url, l1Ttl);
      return { url, source: 'l2' };
    }
  } catch (err) {
    // Redis error — fall through to DB (§12: "Fall back to PostgreSQL where safe")
    // Error is logged by the caller
    return null;
  }

  return null;
}

/**
 * Populate both L2 (Redis) and L1 caches after a successful DB lookup.
 * Per §8 step 7: "populate Redis and L1 according to the cache policy"
 *
 * @param {import('ioredis').Redis} redis
 * @param {Function} isRedisAvailable
 * @param {string} code
 * @param {string} url
 */
export async function populateL2AndL1(redis, isRedisAvailable, code, url) {
  // Populate L1
  const l1Ttl = addJitter(config.l1Cache.defaultTtlMs);
  l1Set(code, url, l1Ttl);

  // Populate L2 (best-effort; Redis failure after DB commit is acceptable per §12)
  if (isRedisAvailable()) {
    try {
      const l2Ttl = addJitter(config.l2Cache.defaultTtlSeconds);
      await redis.setex(`${REDIS_PREFIX}${code}`, l2Ttl, url);
    } catch {
      // Best-effort — subsequent requests will recover through DB fallback
    }
  }
}

/**
 * Cache a code as nonexistent.
 * Per §9.4: "cache nonexistent codes briefly to prevent repeated database reads"
 *
 * @param {import('ioredis').Redis} redis
 * @param {Function} isRedisAvailable
 * @param {string} code
 */
export async function setNegativeCache(redis, isRedisAvailable, code) {
  // L1 negative cache
  l1SetNegative(code);

  // L2 negative cache (best-effort)
  if (isRedisAvailable()) {
    try {
      const ttl = addJitter(config.l2Cache.negativeTtlSeconds);
      await redis.setex(`${REDIS_NEGATIVE_PREFIX}${code}`, ttl, '1');
    } catch {
      // Best-effort
    }
  }
}

/**
 * Invalidate a code from Redis (L2).
 * Per §10 step 2: "Delete or update the relevant Redis key."
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} code
 */
export async function invalidateL2(redis, code) {
  try {
    await redis.del(`${REDIS_PREFIX}${code}`, `${REDIS_NEGATIVE_PREFIX}${code}`);
  } catch {
    // Best-effort; bounded TTL is the fallback
  }
  // Also evict from L1 on this instance
  l1Evict(code);
}

/**
 * Single-flight / request coalescing.
 * Per §9.4: "within one application instance, let one lookup refresh a
 * missing key while concurrent requests await the same result."
 *
 * @param {string} code - The short code
 * @param {Function} fetchFn - Async function that fetches from DB
 * @returns {Promise<*>} The result of fetchFn
 */
export async function singleFlight(code, fetchFn) {
  if (inflightRequests.has(code)) {
    return inflightRequests.get(code);
  }

  const promise = fetchFn().finally(() => {
    inflightRequests.delete(code);
  });

  inflightRequests.set(code, promise);
  return promise;
}

/**
 * Get cache statistics for observability.
 */
export function getCacheStats() {
  return {
    l1: l1Stats(),
    inflightRequests: inflightRequests.size,
  };
}
