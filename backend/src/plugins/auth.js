import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import config from '../config.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { parseCookies, serializeCookie, clearCookie } from '../utils/cookies.js';
import { getSessionUser } from '../services/auth-service.js';

/**
 * Authentication and authorization.
 *
 * - Browser users authenticate with an opaque session cookie.
 * - Operators/automation may use the admin API key, which grants global scope.
 * - Anonymous visitors can still create links and follow redirects.
 */

function extractKey(request) {
  const authorization = request.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  return bearer || request.headers['x-api-key'] || '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function getSessionToken(request) {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[config.auth.sessionCookieName] || null;
}

export function setSessionCookie(reply, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.header('Set-Cookie', serializeCookie(config.auth.sessionCookieName, token, {
    maxAge,
    expires: expiresAt,
  }));
}

export function clearSessionCookie(reply) {
  reply.header('Set-Cookie', clearCookie(config.auth.sessionCookieName));
}

async function authPlugin(fastify) {
  fastify.decorateRequest('auth', null);

  fastify.decorate('isAuthorized', (key) => {
    if (!key || !config.adminApiKey) return false;
    return safeEqual(key, config.adminApiKey);
  });

  // Reject cross-site state-changing requests that carry a browser Origin.
  // SameSite=Lax is the primary control; this is defence in depth.
  const allowedOrigins = new Set([
    config.baseUrl,
    config.appUrl,
    ...config.cors.origins,
  ]);

  fastify.addHook('onRequest', async (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return; // CLI/API clients and same-origin navigations omit it
    if (!allowedOrigins.has(origin)) {
      throw new ForbiddenError('Request origin is not allowed');
    }
  });

  /**
   * Resolve the signed-in user without failing (used by public creation).
   * Admin API keys are deliberately ignored here.
   */
  fastify.decorate('getOptionalUser', async (request) => {
    const token = getSessionToken(request);
    if (!token) return null;
    return getSessionUser(fastify.pg, token).catch(() => null);
  });

  /**
   * Require a session or the admin API key. Populates request.auth with
   * { user, isAdmin }. Users are scoped to their own links; the key is global.
   */
  fastify.decorate('requireAuth', async (request) => {
    const token = getSessionToken(request);
    if (token) {
      const user = await getSessionUser(fastify.pg, token).catch(() => null);
      if (user) {
        request.auth = { user, isAdmin: false };
        return;
      }
    }

    const key = extractKey(request);
    if (!key) throw new UnauthorizedError('Sign in or provide an API key for this endpoint');
    if (!fastify.isAuthorized(key)) throw new ForbiddenError('Invalid API key');
    request.auth = { user: null, isAdmin: true };
  });

  /**
   * Backwards-compatible operator authentication. Retained for scripts and
   * tests that use the admin key directly.
   */
  fastify.decorate('requireApiKey', async (request) => {
    const key = extractKey(request);
    if (!key) throw new UnauthorizedError('API key required for this endpoint');
    if (!fastify.isAuthorized(key)) throw new ForbiddenError('Invalid API key');
    request.isAdmin = true;
    request.auth = { user: null, isAdmin: true };
  });

  fastify.decorate('hasApiKey', (request) => Boolean(extractKey(request)));
}

export default fp(authPlugin, { name: 'auth' });
