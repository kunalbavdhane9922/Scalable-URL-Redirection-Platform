import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  singleFlight,
  getFromL1,
  getCacheStats,
} from '../../src/services/cache-service.js';
import { l1Clear, l1Set } from '../../src/cache/lru-cache.js';

describe('Cache Service (§9.1 Two-level caching & §9.4 Stampede Prevention)', () => {
  beforeEach(() => {
    l1Clear();
  });

  describe('Single-Flight / Request Coalescing (§9.4)', () => {
    it('coalesces multiple concurrent fetches for the same code into a single execution', async () => {
      let executionCount = 0;

      const mockDbFetch = async () => {
        executionCount++;
        // Simulate database query latency
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { short_code: 'stampedeKey', original_url: 'https://coalesced.org' };
      };

      // Launch 15 concurrent singleFlight requests for the exact same key
      const results = await Promise.all([
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
        singleFlight('stampedeKey', mockDbFetch),
      ]);

      // All callers receive identical correct result
      for (const res of results) {
        expect(res.original_url).toBe('https://coalesced.org');
      }

      // But the database fetch executed EXACTLY ONCE
      expect(executionCount).toBe(1);

      // In-flight map should be cleaned up after completion
      expect(getCacheStats().inflightRequests).toBe(0);
    });

    it('cleans up in-flight map even if fetcher throws an error', async () => {
      let callCount = 0;
      const failingFetch = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Database connection failed');
      };

      const promises = [
        singleFlight('failingKey', failingFetch),
        singleFlight('failingKey', failingFetch),
      ];

      await expect(Promise.all(promises)).rejects.toThrow('Database connection failed');
      expect(callCount).toBe(1);

      // In-flight map should be 0
      expect(getCacheStats().inflightRequests).toBe(0);
    });

    it('executes again for subsequent requests after previous has completed', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return 'success';
      };

      await singleFlight('k1', mockFetch);
      expect(callCount).toBe(1);

      await singleFlight('k1', mockFetch);
      expect(callCount).toBe(2);
    });
  });

  describe('L1 Integration via Cache Service', () => {
    it('returns null on L1 miss', () => {
      expect(getFromL1('missing')).toBeNull();
    });

    it('returns url and source l1 on hit', () => {
      l1Set('hitCode', 'https://example.com');
      const result = getFromL1('hitCode');
      expect(result).toEqual({ url: 'https://example.com', source: 'l1' });
    });
  });
});
