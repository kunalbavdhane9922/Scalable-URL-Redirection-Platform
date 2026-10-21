import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleClickEvent } from '../../src/workers/analytics-handler.js';
import { cleanupExpiredLinks } from '../../src/workers/cleanup-handler.js';
import { handleLifecycleEvent } from '../../src/workers/lifecycle-handler.js';
import { createMockPgPool, createMockRedis } from '../fixtures/mock-db.js';
import { l1Clear } from '../../src/cache/lru-cache.js';

describe('Background Workers & Asynchronous Handlers (§11 & Table 7)', () => {
  let mockPg;
  let mockRedis;
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(() => {
    l1Clear();
    mockPg = createMockPgPool();
    mockRedis = createMockRedis();
  });

  describe('Click Analytics Worker (Table 7: link_clicked)', () => {
    it('processes click event and records in analytics storage idempotently', async () => {
      let upsertExecuted = false;
      const customPg = {
        query: jest.fn().mockImplementation(async (sql, params) => {
          if (sql.includes('INSERT INTO click_analytics')) {
            upsertExecuted = true;
            return { rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      await handleClickEvent(customPg, mockLogger, {
        shortCode: 'clickMe',
        clickedAt: new Date().toISOString(),
      });

      expect(upsertExecuted).toBe(true);
      expect(customPg.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (short_code, click_date)'),
        expect.any(Array),
      );
    });

    it('propagates error when query fails so worker can retry with backoff (§11.1)', async () => {
      const failingPg = {
        query: jest.fn().mockRejectedValue(new Error('Connection lost')),
      };

      await expect(
        handleClickEvent(failingPg, mockLogger, {
          shortCode: 'retryCode',
          clickedAt: new Date().toISOString(),
        })
      ).rejects.toThrow('Connection lost');
    });
  });

  describe('Expiry Cleanup Worker (Table 7 & §10 step 6)', () => {
    it('identifies expired links, disables them, and evicts cache entries', async () => {
      // Setup expired links in DB
      mockPg._urls.set('exp1', {
        id: 1,
        short_code: 'exp1',
        status: 'active',
        expires_at: new Date(Date.now() - 5000).toISOString(), // expired
      });
      mockPg._urls.set('active1', {
        id: 2,
        short_code: 'active1',
        status: 'active',
        expires_at: new Date(Date.now() + 50000).toISOString(), // not expired
      });

      // Populate Redis
      await mockRedis.set('url:exp1', 'https://exp.com');

      const isRedisAvailable = () => true;
      const cleanedCount = await cleanupExpiredLinks(mockPg, mockRedis, isRedisAvailable, mockLogger);

      expect(cleanedCount).toBe(1);
      expect(mockPg._urls.get('exp1').status).toBe('expired');
      expect(mockPg._urls.get('active1').status).toBe('active');

      // Redis cache was evicted
      expect(mockRedis._store.has('url:exp1')).toBe(false);

      // Invalidation was published to Pub/Sub
      expect(mockRedis._published.some(p => p.channel === 'url_shortener:cache_invalidation')).toBe(true);
    });

    it('returns 0 when no links are due for expiration', async () => {
      mockPg._urls.set('act1', {
        id: 10,
        short_code: 'act1',
        status: 'active',
        expires_at: null, // permanent
      });

      const count = await cleanupExpiredLinks(mockPg, mockRedis, () => true, mockLogger);
      expect(count).toBe(0);
    });
  });

  describe('Lifecycle Handler (Table 7: link_created / link_updated / link_disabled)', () => {
    it('handles lifecycle events idempotently and logs audit records', async () => {
      await expect(
        handleLifecycleEvent(mockPg, mockLogger, 'link_created', { shortCode: 'auditCode' })
      ).resolves.not.toThrow();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'link_created', shortCode: 'auditCode' }),
        expect.any(String),
      );
    });
  });
});
