import config from '../config.js';
import { recordCacheEvent } from '../plugins/metrics.js';
import {
  l1Get,
  l1Set,
  l1SetNegative,
  l1IsNegativelyCached,
  l1SetGone,
  l1GetGone,
  l1Evict,
  l1Stats,
} from '../cache/lru-cache.js';

/**
 * Cache orchestration — L1 (in-memory LRU) + L2 (shared Redis).
 *
 * Lookup order: L1 → Redis → PostgreSQL.
 * Redis writes are best-effort and never block the redirect response; L1 is
 * updated synchronously so the current instance benefits immediately.
 */

const inflightRequests = new Map();

const REDIS_PREFIX = 'url:';
const REDIS_NEGATIVE_PREFIX = 'url:neg:';
const REDIS_GONE_PREFIX = 'url:gone:';

function addJitter(baseTtl, jitterPercent = config.l2Cache.ttlJitterPercent) {
  const jitter = baseTtl * (jitterPercent / 100);
  return Math.max(1, Math.round(baseTtl + (Math.random() * 2 - 1) * jitter));
}

export function getFromL1(code) {
  const url = l1Get(code);
  if (url) {
    recordCacheEvent('l1', 'hit');
    return { url, source: 'l1' };
  }
  recordCacheEvent('l1', 'miss');
  return null;
}

export function isNegativelyCachedL1(code) {
  return l1IsNegativelyCached(code);
}

export function getGoneFromL1(code) {
  return l1GetGone(code);
}

/**
 * Attempt to get a URL (or a known-gone / known-missing marker) from Redis.
 * Returns one of:
 *   { url, source: 'l2' }
 *   { gone: 'disabled'|'expired', source: 'l2-gone' }
 *   { url: null, source: 'l2-negative' }
 *   null on miss / Redis failure
 */
export async function getFromL2(redis, isRedisAvailable, code) {
  if (!isRedisAvailable()) {
    recordCacheEvent('l2', 'unavailable');
    return null;
  }

  try {
    const [gone, negative, url] = await redis.mget(
      `${REDIS_GONE_PREFIX}${code}`,
      `${REDIS_NEGATIVE_PREFIX}${code}`,
      `${REDIS_PREFIX}${code}`,
    );

    if (gone) {
      recordCacheEvent('l2', 'hit');
      l1SetGone(code, gone);
      return { gone, source: 'l2-gone' };
    }

    if (negative) {
      recordCacheEvent('l2', 'hit');
      l1SetNegative(code);
      return { url: null, source: 'l2-negative' };
    }

    if (url) {
      recordCacheEvent('l2', 'hit');
      l1Set(code, url, addJitter(config.l1Cache.defaultTtlMs));
      return { url, source: 'l2' };
    }

    recordCacheEvent('l2', 'miss');
  } catch {
    recordCacheEvent('l2', 'error');
    // §12: fall back to PostgreSQL when the cache is unavailable.
    return null;
  }

  return null;
}

/**
 * Populate L1 synchronously and L2 best-effort (fire-and-forget).
 */
export function populateL2AndL1(redis, isRedisAvailable, code, url) {
  l1Set(code, url, addJitter(config.l1Cache.defaultTtlMs));

  if (isRedisAvailable()) {
    const l2Ttl = addJitter(config.l2Cache.defaultTtlSeconds);
    redis
      .pipeline()
      .setex(`${REDIS_PREFIX}${code}`, l2Ttl, url)
      .del(`${REDIS_NEGATIVE_PREFIX}${code}`, `${REDIS_GONE_PREFIX}${code}`)
      .exec()
      .catch(() => recordCacheEvent('l2', 'write-error'));
  }
}

/**
 * Cache a code as nonexistent (404).
 */
export function setNegativeCache(redis, isRedisAvailable, code) {
  l1SetNegative(code);

  if (isRedisAvailable()) {
    const ttl = addJitter(config.l2Cache.negativeTtlSeconds);
    redis
      .setex(`${REDIS_NEGATIVE_PREFIX}${code}`, ttl, '1')
      .catch(() => recordCacheEvent('l2', 'write-error'));
  }
}

/**
 * Cache a code as gone (410) while preserving the reason on later hits.
 */
export function setGoneCache(redis, isRedisAvailable, code, reason) {
  l1SetGone(code, reason);

  if (isRedisAvailable()) {
    const ttl = addJitter(config.l2Cache.negativeTtlSeconds);
    redis
      .setex(`${REDIS_GONE_PREFIX}${code}`, ttl, reason)
      .catch(() => recordCacheEvent('l2', 'write-error'));
  }
}

export async function invalidateL2(redis, code) {
  try {
    await redis.del(
      `${REDIS_PREFIX}${code}`,
      `${REDIS_NEGATIVE_PREFIX}${code}`,
      `${REDIS_GONE_PREFIX}${code}`,
    );
  } catch {
    // Best-effort; bounded TTL is the fallback.
  }
  l1Evict(code);
}

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

export function getCacheStats() {
  return {
    l1: l1Stats(),
    inflightRequests: inflightRequests.size,
  };
}
