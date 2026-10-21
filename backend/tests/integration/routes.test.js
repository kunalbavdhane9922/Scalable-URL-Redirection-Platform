import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { buildServer } from '../../src/server.js';
import { createMockPgPool, createMockRedis } from '../fixtures/mock-db.js';
import { l1Clear, l1Get } from '../../src/cache/lru-cache.js';

describe('HTTP Routes & Redirection Platform Integration Tests', () => {
  let app;
  let mockPg;
  let mockRedis;

  beforeEach(async () => {
    l1Clear();
    mockPg = createMockPgPool();
    mockRedis = createMockRedis();

    app = await buildServer({
      logger: false,
      pg: mockPg,
      redis: mockRedis,
      skipRateLimit: true, // test route logic without rate limit noise
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Health Checks (Appendix A & §9.5)', () => {
    it('GET /health returns 200 with status and dependency checks', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('healthy');
      expect(body.checks.database).toBe('healthy');
      expect(body.checks.redis).toBe('healthy');
      expect(typeof body.uptime).toBe('number');
    });

    it('GET /health/metrics returns internal cache, pool, and process stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/metrics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.cache.l1).toBeDefined();
      expect(body.pgPool).toBeDefined();
      expect(body.process.memoryUsage).toBeDefined();
    });
  });

  describe('URL Shortening — POST /api/shorten (§7 Flow)', () => {
    it('successfully shortens a valid URL and populates L1 and Redis', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: {
          url: 'https://developer.mozilla.org/en-US/docs/Web',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.shortCode).toBeDefined();
      expect(body.shortUrl).toContain(body.shortCode);
      expect(body.originalUrl).toBe('https://developer.mozilla.org/en-US/docs/Web');
      expect(body.status).toBe('active');

      // Verifies L1 cache warming (§7 step 7)
      expect(l1Get(body.shortCode)).toBe('https://developer.mozilla.org/en-US/docs/Web');

      // Verifies transactional outbox record creation (§7 step 8)
      expect(mockPg._outbox.length).toBe(1);
      expect(mockPg._outbox[0].event_type).toBe('link_created');
      expect(mockPg._outbox[0].payload.shortCode).toBe(body.shortCode);
    });

    it('rejects invalid schemes with 400 Bad Request (§13)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: {
          url: 'javascript:alert(document.cookie)',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects missing or malformed URLs with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: {
          url: 'not-a-valid-url',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('supports optional future expiration date', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const response = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: {
          url: 'https://example.com/expiring',
          expiresAt: future,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.expiresAt).toBe(future);
    });
  });

  describe('URL Redirection — GET /:code (§8 Flow & Critical Path)', () => {
    it('redirects with 302 Found and explicit Cache-Control headers', async () => {
      // 1. Create a link
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://fast-redirect.target.com' },
      });
      const { shortCode } = JSON.parse(createRes.payload);

      // 2. Perform redirect
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/${shortCode}`,
      });

      // §8.1: "Use 302 by default for editable links"
      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toBe('https://fast-redirect.target.com/');
      // §8.1: "Set explicit cache headers"
      expect(redirectRes.headers['cache-control']).toBe('private, no-cache, no-store, must-revalidate');
    });

    it('serves hot link directly from L1 LRU cache without hitting DB (§8 step 4)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://l1-test.com' },
      });
      const { shortCode } = JSON.parse(createRes.payload);

      // Spy on DB queries
      const querySpy = jest.spyOn(mockPg, 'query');

      // Request short code — L1 was warmed
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/${shortCode}`,
      });

      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toBe('https://l1-test.com/');
      // DB query was NOT called because L1 served the request!
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('falls back to PostgreSQL on L1 & L2 miss and repopulates caches (§8 steps 5-7)', async () => {
      // Create link directly in DB (simulating write on another instance)
      const code = 'dbMiss99';
      mockPg._urls.set(code, {
        id: 99,
        short_code: code,
        original_url: 'https://direct-db.com',
        status: 'active',
        created_at: new Date().toISOString(),
        expires_at: null,
      });

      // Clear L1 and Redis
      l1Clear();
      mockRedis._store.clear();

      // Request short code
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/${code}`,
      });

      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toBe('https://direct-db.com');

      // L1 and Redis are now repopulated!
      expect(l1Get(code)).toBe('https://direct-db.com');
      expect(mockRedis._store.has(`url:${code}`)).toBe(true);
    });

    it('returns 404 for unknown codes and applies negative caching (§8 step 8 & §9.4)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/unknownCode',
      });

      expect(response.statusCode).toBe(404);

      // Negative cache is populated in Redis and L1
      expect(mockRedis._store.has('url:neg:unknownCode')).toBe(true);

      // Subsequent request hits negative cache
      const secondRes = await app.inject({
        method: 'GET',
        url: '/unknownCode',
      });
      expect(secondRes.statusCode).toBe(404);
    });

    it('returns 410 Gone for disabled links (§8 step 8)', async () => {
      mockPg._urls.set('disabled1', {
        id: 101,
        short_code: 'disabled1',
        original_url: 'https://disabled.com',
        status: 'disabled',
        created_at: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/disabled1',
      });

      expect(response.statusCode).toBe(410);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Gone');
    });

    it('returns 410 Gone for expired links (§8 step 8 & §10 step 6)', async () => {
      mockPg._urls.set('expired1', {
        id: 102,
        short_code: 'expired1',
        original_url: 'https://expired.com',
        status: 'active',
        created_at: new Date(Date.now() - 100000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(), // expired
      });

      const response = await app.inject({
        method: 'GET',
        url: '/expired1',
      });

      expect(response.statusCode).toBe(410);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Gone');
    });

    it('rejects malformed code cheaply with 404 (§8 step 3)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/bad;code!@#',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Link Lifecycle & Cache Invalidation (§10)', () => {
    it('PATCH /api/links/:code updates destination and invalidates cache', async () => {
      // 1. Create a link
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://original-site.com' },
      });
      const { shortCode } = JSON.parse(createRes.payload);

      // Verify L1 is warmed with original URL
      expect(l1Get(shortCode)).toBe('https://original-site.com/');

      // 2. Update the destination URL
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/links/${shortCode}`,
        payload: { url: 'https://updated-destination.com' },
      });

      expect(patchRes.statusCode).toBe(200);
      const patchBody = JSON.parse(patchRes.payload);
      expect(patchBody.originalUrl).toBe('https://updated-destination.com/');

      // 3. Outbox recorded link_updated (§10 step 5)
      const updateOutbox = mockPg._outbox.find(o => o.event_type === 'link_updated');
      expect(updateOutbox).toBeDefined();

      // 4. Pub/Sub invalidation was published (§10 step 3)
      expect(mockRedis._published.some(p => p.channel === 'url_shortener:cache_invalidation')).toBe(true);

      // 5. Subsequent redirect delivers updated URL
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/${shortCode}`,
      });
      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toBe('https://updated-destination.com/');
    });

    it('DELETE /api/links/:code disables link and evicts cache', async () => {
      // 1. Create link
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://to-delete.com' },
      });
      const { shortCode } = JSON.parse(createRes.payload);

      // 2. Delete/disable link
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/links/${shortCode}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      // 3. Status in DB is updated to disabled
      expect(mockPg._urls.get(shortCode).status).toBe('disabled');

      // 4. Outbox recorded link_disabled (§10 step 5)
      const disableOutbox = mockPg._outbox.find(o => o.event_type === 'link_disabled');
      expect(disableOutbox).toBeDefined();

      // 5. Subsequent redirect responds with 410 Gone
      const redirectRes = await app.inject({
        method: 'GET',
        url: `/${shortCode}`,
      });
      expect(redirectRes.statusCode).toBe(410);
    });

    it('GET /api/links lists all created links', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://site1.com' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://site2.com' },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/links?limit=10',
      });

      expect(listRes.statusCode).toBe(200);
      const list = JSON.parse(listRes.payload);
      expect(list.length).toBe(2);
      expect(list[0].short_code).toBeDefined();
      expect(list[0].click_count).toBeDefined();
    });

    it('GET /api/links/:code retrieves detailed link metadata', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://detailed.com' },
      });
      const { shortCode } = JSON.parse(createRes.payload);

      const detailsRes = await app.inject({
        method: 'GET',
        url: `/api/links/${shortCode}`,
      });

      expect(detailsRes.statusCode).toBe(200);
      const details = JSON.parse(detailsRes.payload);
      expect(details.shortCode).toBe(shortCode);
      expect(details.originalUrl).toBe('https://detailed.com/');
      expect(details.status).toBe('active');
      expect(details.clickCount).toBe(0);
    });
  });
});
