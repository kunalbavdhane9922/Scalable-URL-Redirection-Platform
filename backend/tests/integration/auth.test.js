import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { buildServer } from '../../src/server.js';
import { createMockPgPool, createMockRedis } from '../fixtures/mock-db.js';
import { l1Clear } from '../../src/cache/lru-cache.js';
import config from '../../src/config.js';
import { signPayload } from '../../src/utils/cookies.js';

const COOKIE = config.auth.sessionCookieName;

function sessionFrom(response) {
  const header = response.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(raw || '');
  return match ? decodeURIComponent(match[1]) : null;
}

function cookieHeader(token) {
  return { cookie: `${COOKIE}=${token}` };
}

async function register(app, email, password = 'correct-horse-battery') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, name: email.split('@')[0] },
  });
  return { response, token: sessionFrom(response) };
}

describe('Accounts, sessions, and link ownership', () => {
  let app;
  let mockPg;

  beforeEach(async () => {
    l1Clear();
    mockPg = createMockPgPool();
    app = await buildServer({
      logger: false,
      pg: mockPg,
      redis: createMockRedis(),
      skipRateLimit: true,
      skipUnderPressure: true,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports available sign-in methods', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.password).toBe(true);
    expect(body.devLogin).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('registers a user, sets an HttpOnly session cookie, and returns /me', async () => {
    const { response, token } = await register(app, 'alice@example.com');

    expect(response.statusCode).toBe(201);
    expect(token).toBeTruthy();
    const setCookie = response.headers['set-cookie'];
    expect(String(setCookie)).toMatch(/HttpOnly/);
    expect(String(setCookie)).toMatch(/SameSite=Lax/);

    const body = JSON.parse(response.payload);
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.emailVerified).toBe(false);
    expect(body.user.password_hash).toBeUndefined();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(token),
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).user.email).toBe('alice@example.com');
  });

  it('normalises email casing and rejects duplicate accounts', async () => {
    await register(app, 'Bob@Example.com ');
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@example.com', password: 'another-long-password' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects weak passwords and wrong credentials', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'weak@example.com', password: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    await register(app, 'carol@example.com', 'correct-horse-battery');
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'carol@example.com', password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'whatever-long-enough' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(JSON.parse(unknown.payload).message).toBe('Invalid email or password');
  });

  it('logs in, logs out, and invalidates the session', async () => {
    await register(app, 'dave@example.com', 'correct-horse-battery');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'dave@example.com', password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const token = sessionFrom(login);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: cookieHeader(token),
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(token),
    });
    expect(me.statusCode).toBe(401);
  });

  it('scopes link listing and management to the owner', async () => {
    const alice = await register(app, 'alice@example.com');
    const bob = await register(app, 'bob@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/shorten',
      headers: cookieHeader(alice.token),
      payload: { url: 'https://example.com/alice', customAlias: 'alice-link' },
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.parse(created.payload).owned).toBe(true);
    expect(mockPg._urls.get('alice-link').user_id).toBe(1);

    const aliceList = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: cookieHeader(alice.token),
    });
    expect(JSON.parse(aliceList.payload).pagination.total).toBe(1);

    const bobList = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: cookieHeader(bob.token),
    });
    expect(JSON.parse(bobList.payload).pagination.total).toBe(0);

    const bobRead = await app.inject({
      method: 'GET',
      url: '/api/links/alice-link',
      headers: cookieHeader(bob.token),
    });
    expect(bobRead.statusCode).toBe(404);

    const bobPatch = await app.inject({
      method: 'PATCH',
      url: '/api/links/alice-link',
      headers: cookieHeader(bob.token),
      payload: { url: 'https://evil.example.com' },
    });
    expect(bobPatch.statusCode).toBe(404);

    const bobDelete = await app.inject({
      method: 'DELETE',
      url: '/api/links/alice-link',
      headers: cookieHeader(bob.token),
    });
    expect(bobDelete.statusCode).toBe(404);

    const alicePatch = await app.inject({
      method: 'PATCH',
      url: '/api/links/alice-link',
      headers: cookieHeader(alice.token),
      payload: { url: 'https://example.com/alice-updated' },
    });
    expect(alicePatch.statusCode).toBe(200);
    expect(JSON.parse(alicePatch.payload).originalUrl).toBe('https://example.com/alice-updated');

    const aliceDelete = await app.inject({
      method: 'DELETE',
      url: '/api/links/alice-link',
      headers: cookieHeader(alice.token),
    });
    expect(aliceDelete.statusCode).toBe(204);
  });

  it('leaves anonymous links unowned and invisible to accounts', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/shorten',
      payload: { url: 'https://example.com/anonymous' },
    });
    expect(anonymous.statusCode).toBe(201);
    expect(JSON.parse(anonymous.payload).owned).toBe(false);
    expect(mockPg._urls.get(JSON.parse(anonymous.payload).shortCode).user_id).toBeNull();

    const user = await register(app, 'erin@example.com');
    const list = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: cookieHeader(user.token),
    });
    expect(JSON.parse(list.payload).pagination.total).toBe(0);
  });

  it('keeps the admin API key as global operator scope', async () => {
    const user = await register(app, 'frank@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/shorten',
      headers: cookieHeader(user.token),
      payload: { url: 'https://example.com/frank', customAlias: 'frank-link' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/shorten',
      payload: { url: 'https://example.com/anon', customAlias: 'anon-link' },
    });

    const adminList = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: { authorization: 'Bearer dev-admin-key' },
    });
    expect(JSON.parse(adminList.payload).pagination.total).toBe(2);

    const adminStats = await app.inject({
      method: 'GET',
      url: '/api/stats',
      headers: { authorization: 'Bearer dev-admin-key' },
    });
    expect(JSON.parse(adminStats.payload).totalLinks).toBe(2);
  });

  it('updates and clears expiration without changing the destination', async () => {
    const user = await register(app, 'gina@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/shorten',
      headers: cookieHeader(user.token),
      payload: {
        url: 'https://example.com/expiring',
        customAlias: 'expiring-link',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    const extended = await app.inject({
      method: 'PATCH',
      url: '/api/links/expiring-link',
      headers: cookieHeader(user.token),
      payload: { expiresAt: new Date(Date.now() + 172800000).toISOString() },
    });
    expect(extended.statusCode).toBe(200);
    const extendedBody = JSON.parse(extended.payload);
    expect(extendedBody.expiresAt).toBeTruthy();
    expect(extendedBody.originalUrl).toBe('https://example.com/expiring');

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/links/expiring-link',
      headers: cookieHeader(user.token),
      payload: { expiresAt: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(JSON.parse(cleared.payload).expiresAt).toBeNull();
  });

  it('rejects cross-origin state-changing requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example.com' },
      payload: { email: 'x@example.com', password: 'long-enough-password' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('supports the development sign-in provider outside production', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login?email=dev@example.com',
    });
    expect(response.statusCode).toBe(302);
    const token = sessionFrom(response);
    expect(token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(token),
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).user.email).toBe('dev@example.com');

    const list = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: cookieHeader(token),
    });
    expect(list.statusCode).toBe(200);
  });

  it('withholds the session for unverified registrations when verification is required', async () => {
    const previous = config.auth.requireEmailVerification;
    config.auth.requireEmailVerification = true;
    try {
      const { response, token } = await register(app, 'gated@example.com');
      expect(response.statusCode).toBe(201);
      expect(token).toBeNull();
      expect(JSON.parse(response.payload).requiresVerification).toBe(true);

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'gated@example.com', password: 'correct-horse-battery' },
      });
      expect(login.statusCode).toBe(401);
    } finally {
      config.auth.requireEmailVerification = previous;
    }
  });

  it('rejects management without a session or key', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/links' });
    expect(list.statusCode).toBe(401);

    const badKey = await app.inject({
      method: 'GET',
      url: '/api/links',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(badKey.statusCode).toBe(403);
  });

  it('does not start OAuth when the provider is unconfigured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/oauth/google' });
    expect(response.statusCode).toBe(400);
  });

  it('validates the signed OAuth state cookie before exchanging a code', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/google/callback?code=abc',
    });
    expect(missing.statusCode).toBe(302);
    expect(missing.headers.location).toContain('error=invalid_state');

    const state = signPayload({ provider: 'google', nonce: 'nonce-1', exp: Date.now() + 60000 });
    const signed = await app.inject({
      method: 'GET',
      url: `/api/auth/oauth/google/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie: `shortly_oauth=${encodeURIComponent(state)}` },
    });
    expect(signed.statusCode).toBe(302);
    expect(signed.headers.location).toContain('error=missing_code');

    // A valid cookie with a mismatched echoed state is rejected (CSRF check).
    const mismatched = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/google/callback?code=abc&state=other',
      headers: { cookie: `shortly_oauth=${encodeURIComponent(state)}` },
    });
    expect(mismatched.statusCode).toBe(302);
    expect(mismatched.headers.location).toContain('error=invalid_state');

    const expiredState = signPayload({ provider: 'google', nonce: 'nonce-2', exp: Date.now() - 1000 });
    const expired = await app.inject({
      method: 'GET',
      url: `/api/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(expiredState)}`,
      headers: { cookie: `shortly_oauth=${encodeURIComponent(expiredState)}` },
    });
    expect(expired.statusCode).toBe(302);
    expect(expired.headers.location).toContain('error=invalid_state');
  });
});
