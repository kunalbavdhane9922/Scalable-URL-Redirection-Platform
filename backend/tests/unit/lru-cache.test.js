import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  l1Get,
  l1Set,
  l1SetNegative,
  l1IsNegativelyCached,
  l1Evict,
  l1Clear,
  l1Stats,
} from '../../src/cache/lru-cache.js';

describe('Bounded L1 In-Memory LRU Cache (§9.1 & §9.4)', () => {
  beforeEach(() => {
    l1Clear();
  });

  describe('Positive Cache', () => {
    it('sets and retrieves a URL mapping', () => {
      l1Set('code123', 'https://example.com/target');
      expect(l1Get('code123')).toBe('https://example.com/target');
    });

    it('returns undefined on cache miss', () => {
      expect(l1Get('missingCode')).toBeUndefined();
    });

    it('evicts a specific key on l1Evict', () => {
      l1Set('code123', 'https://example.com');
      l1Evict('code123');
      expect(l1Get('code123')).toBeUndefined();
    });

    it('clears all entries on l1Clear', () => {
      l1Set('c1', 'https://1.com');
      l1Set('c2', 'https://2.com');
      l1Clear();
      expect(l1Get('c1')).toBeUndefined();
      expect(l1Get('c2')).toBeUndefined();
    });
  });

  describe('Negative Cache (§9.4)', () => {
    it('records and identifies negatively cached codes', () => {
      expect(l1IsNegativelyCached('fakeCode')).toBe(false);
      l1SetNegative('fakeCode');
      expect(l1IsNegativelyCached('fakeCode')).toBe(true);
    });

    it('isolates negative cache from positive cache', () => {
      l1SetNegative('badCode');
      expect(l1Get('badCode')).toBeUndefined();

      l1Set('goodCode', 'https://good.com');
      expect(l1IsNegativelyCached('goodCode')).toBe(false);
    });

    it('evicts from negative cache on l1Evict', () => {
      l1SetNegative('badCode');
      l1Evict('badCode');
      expect(l1IsNegativelyCached('badCode')).toBe(false);
    });
  });

  describe('l1Stats', () => {
    it('returns size and max capacity for both positive and negative caches', () => {
      l1Set('c1', 'https://example.com');
      l1SetNegative('neg1');

      const stats = l1Stats();
      expect(stats.positive).toBeDefined();
      expect(stats.positive.size).toBe(1);
      expect(stats.positive.max).toBeGreaterThan(0);

      expect(stats.negative).toBeDefined();
      expect(stats.negative.size).toBe(1);
      expect(stats.negative.max).toBeGreaterThan(0);
    });
  });
});
