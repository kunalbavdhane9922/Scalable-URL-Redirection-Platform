import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { buildServer } from '../../src/server.js';
import { createMockPgPool, createMockRedis } from '../fixtures/mock-db.js';
import { l1Clear, l1Get } from '../../src/cache/lru-cache.js';

const AUTH = { authorization: 'Bearer dev-admin-key' };

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
        headers: AUTH,
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
        headers: AUTH,
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
        headers: AUTH,
      });

      expect(listRes.statusCode).toBe(200);
      const list = JSON.parse(listRes.payload);
      expect(list.items.length).toBe(2);
      expect(list.pagination.total).toBe(2);
      expect(list.items[0].shortCode).toBeDefined();
      expect(list.items[0].clickCount).toBeDefined();
    });

    it('requires an API key for management endpoints', async () => {
      const missing = await app.inject({ method: 'GET', url: '/api/links' });
      expect(missing.statusCode).toBe(401);

      const wrong = await app.inject({
        method: 'GET',
        url: '/api/links',
        headers: { authorization: 'Bearer wrong-key' },
      });
      expect(wrong.statusCode).toBe(403);
    });

    it('supports custom aliases and rejects duplicates with 409', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://aliased.com', customAlias: 'my-launch' },
      });
      expect(first.statusCode).toBe(201);
      expect(JSON.parse(first.payload).shortCode).toBe('my-launch');

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/shorten',
        payload: { url: 'https://other.com', customAlias: 'my-launch' },
      });
      expect(duplicate.statusCode).toBe(409);
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
        headers: AUTH,
      });

      expect(detailsRes.statusCode).toBe(200);
      const details = JSON.parse(detailsRes.payload);
      expect(details.shortCode).toBe(shortCode);
      expect(details.originalUrl).toBe('https://detailed.com/');
      expect(details.status).toBe('active');
      expect(details.clickCount).toBe(0);
    });
  });

  describe('Operational resilience & statistics (§11.2, §9.5)', () => {
    it('returns 503 with Retry-After and a request id when the database lookup fails', async () => {
      const originalQuery = mockPg.query;
      mockPg.query = jest.fn(async (sql, params) => {
        if (sql.includes('FROM urls') && sql.includes('short_code = $1')) {
          throw new Error('connection refused');
        }
        return originalQuery(sql, params);
      });

      const res = await app.inject({ method: 'GET', url: '/db-down-code' });

      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('2');
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('SERVICE_UNAVAILABLE');
      expect(body.requestId).toBeDefined();
      expect(res.headers['x-request-id']).toBe(body.requestId);
    });

    it('echoes a caller-provided X-Request-Id for trace correlation', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': 'trace-abc-1234' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBe('trace-abc-1234');
    });

    it('serves public landing-page counters without an API key', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/public/stats' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.totalLinks).toBe(0);
      expect(body.totalClicks).toBe(0);
      expect(body.activeLinks).toBe(0);
      expect(typeof body.uptimeSeconds).toBe('number');
    });

    it('protects platform statistics behind the admin API key', async () => {
      const unauth = await app.inject({ method: 'GET', url: '/api/stats' });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({ method: 'GET', url: '/api/stats', headers: AUTH });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.totalLinks).toBeDefined();
      expect(body.clicksSeries).toBeDefined();
      expect(body.topLinks).toBeDefined();
      expect(body.cache.l1).toBeDefined();
      expect(body.cache.l1.positive.size).toBeDefined();
      expect(body.cache.l1.negative.size).toBeDefined();
      expect(body.cache.l1.gone.size).toBeDefined();
    });
  });
});
