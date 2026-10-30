import { LRUCache } from 'lru-cache';
import config from '../config.js';

/**
 * Bounded L1 in-memory LRU cache.
 *
 * Per document §9.1:
 *  - "L1 is a bounded in-process LRU cache on each Fastify instance."
 *  - "Bound L1 by entry count or memory budget; select TTLs based on link behavior."
 *  - "Popular keys can be served from L1 without a network round trip."
 *
 * Per document §9.4:
 *  - "Negative caching: cache nonexistent codes briefly to prevent repeated
 *     database reads, with strict TTL and memory limits."
 *  - "Protect negative caching from random, attacker-generated keys through
 *     input validation, rate limits, size bounds, and abuse monitoring."
 *
 * This module provides two separate LRU instances:
 *  1. Positive cache (short_code → original_url)
 *  2. Negative cache (short_code → true, for codes confirmed nonexistent)
 *
 * Separating them prevents attacker-generated keys from evicting real entries.
 */

// Positive cache: maps short_code → original_url
const positiveCache = new LRUCache({
  max: config.l1Cache.maxEntries,
  ttl: config.l1Cache.defaultTtlMs,
  updateAgeOnGet: true,
  updateAgeOnHas: false,
});

// Negative cache: maps short_code → true (code is known-nonexistent)
const negativeCache = new LRUCache({
  max: config.l1Cache.negativeMaxEntries,
  ttl: config.l1Cache.negativeTtlMs,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

// Gone cache: maps short_code → 'disabled' | 'expired' (known-unavailable)
// Kept separate from "not found" so repeated hits return the correct 410.
const goneCache = new LRUCache({
  max: config.l1Cache.negativeMaxEntries,
  ttl: config.l1Cache.negativeTtlMs,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

/**
 * Get a destination URL from L1 cache.
 * Returns the original_url string on hit, or undefined on miss.
 */
export function l1Get(code) {
  return positiveCache.get(code);
}

/**
 * Check if a code is in the negative cache (known nonexistent).
 */
export function l1IsNegativelyCached(code) {
  return negativeCache.has(code);
}

/**
 * Store a code→URL mapping in L1 positive cache.
 * @param {string} code - The short code
 * @param {string} url - The destination URL
 * @param {number} [ttlMs] - Optional custom TTL in milliseconds
 */
export function l1Set(code, url, ttlMs) {
  const options = ttlMs ? { ttl: ttlMs } : undefined;
  positiveCache.set(code, url, options);
}

/**
 * Mark a code as nonexistent in the negative cache.
 * Per §9.4: strict TTL and memory limits.
 */
export function l1SetNegative(code) {
  negativeCache.set(code, true);
}

/**
 * Mark a code as gone (disabled or expired).
 * @param {string} code
 * @param {'disabled'|'expired'} reason
 */
export function l1SetGone(code, reason = 'disabled') {
  goneCache.set(code, reason);
}

/**
 * Check if a code is cached as gone. Returns the reason or undefined.
 */
export function l1GetGone(code) {
  return goneCache.get(code);
}

/**
 * Evict a specific code from both caches.
 * Used during cache invalidation (document §10 step 3).
 */
export function l1Evict(code) {
  positiveCache.delete(code);
  negativeCache.delete(code);
  goneCache.delete(code);
}

/**
 * Clear all L1 entries. Used for testing.
 */
export function l1Clear() {
  positiveCache.clear();
  negativeCache.clear();
  goneCache.clear();
}

/**
 * Cache statistics for observability (document §14, Table 9).
 */
export function l1Stats() {
  return {
    positive: {
      size: positiveCache.size,
      max: positiveCache.max,
    },
    negative: {
      size: negativeCache.size,
      max: negativeCache.max,
    },
    gone: {
      size: goneCache.size,
      max: goneCache.max,
    },
  };
}
