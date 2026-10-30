import config from '../config.js';
import {
  registerUser,
  authenticatePassword,
  createSession,
  getSessionUser,
  destroySession,
  issueAuthToken,
  verifyEmailToken,
  resetPassword,
  upsertOAuthUser,
  findUserByEmail,
  findUserById,
  publicUser,
} from '../services/auth-service.js';
import {
  buildAuthorizationUrl,
  exchangeCode,
  enabledProviders,
  isProviderEnabled,
  OAUTH_PROVIDERS,
} from '../services/oauth-service.js';
import { sendMail, verificationEmail, resetEmail } from '../services/mailer.js';
import { signPayload, verifyPayload, serializeCookie, clearCookie } from '../utils/cookies.js';
import { randomToken } from '../utils/passwords.js';
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
} from '../plugins/auth.js';
import { UnauthorizedError, ValidationError, ForbiddenError } from '../utils/errors.js';
import { authQueries } from '../db/auth-queries.js';

const authRateLimit = {
  rateLimit: {
    max: config.rateLimit.auth.max,
    timeWindow: config.rateLimit.auth.timeWindow,
  },
};

const OAUTH_COOKIE = 'shortly_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/oauth';

function cookieSecurity(request) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

export default async function authRoutes(fastify) {
  /** Which sign-in methods the UI should offer. */
  fastify.get('/api/auth/providers', { config: { rateLimit: false } }, async () => ({
    providers: enabledProviders(),
    devLogin: Boolean(config.auth.devLogin && !config.isProduction),
    password: true,
    requireEmailVerification: config.auth.requireEmailVerification,
  }));

  fastify.get('/api/auth/me', { config: { rateLimit: false } }, async (request, reply) => {
    const token = getSessionToken(request);
    if (!token) throw new UnauthorizedError('Not signed in');
    const user = await getSessionUser(fastify.pg, token);
    if (!user) throw new UnauthorizedError('Session expired');
    return reply.send({ user });
  });

  fastify.post('/api/auth/register', {
    config: authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', maxLength: 254 },
          password: { type: 'string', maxLength: 200 },
          name: { type: 'string', maxLength: 80 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, password, name } = request.body;
    const row = await registerUser(fastify.pg, { email, password, name });

    // When verification is required, hold the session until the address is
    // confirmed; password login enforces the same rule.
    const requiresVerification = config.auth.requireEmailVerification && !row.email_verified;
    if (!requiresVerification) {
      const { token, expiresAt } = await createSession(fastify.pg, row.id, cookieSecurity(request));
      setSessionCookie(reply, token, expiresAt);
    }

    let verificationSent = false;
    if (!row.email_verified) {
      try {
        const verifyToken = await issueAuthToken(fastify.pg, row.id, 'verify_email');
        const message = verificationEmail(
          row.name,
          `${config.appUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`,
        );
        const result = await sendMail(request.log, { to: row.email, ...message });
        verificationSent = result.sent;
      } catch (err) {
        request.log.warn({ err: err.message }, 'Failed to send verification email');
      }
    }

    return reply.code(201).send({
      user: publicUser(row),
      verificationSent,
      requiresVerification,
    });
  });

  fastify.post('/api/auth/login', {
    config: authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', maxLength: 254 },
          password: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;
    const row = await authenticatePassword(fastify.pg, email, password);
    const { token, expiresAt } = await createSession(fastify.pg, row.id, cookieSecurity(request));
    setSessionCookie(reply, token, expiresAt);
    return reply.send({ user: publicUser(row) });
  });

  fastify.post('/api/auth/logout', { config: { rateLimit: false } }, async (request, reply) => {
    const token = getSessionToken(request);
    if (token) await destroySession(fastify.pg, token).catch(() => {});
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  fastify.post('/api/auth/verify-email', {
    config: authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', maxLength: 200 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const user = await verifyEmailToken(fastify.pg, request.body.token);
    return reply.send({ user: publicUser(user) });
  });

  fastify.post('/api/auth/resend-verification', {
    config: authRateLimit,
    preHandler: fastify.requireAuth,
  }, async (request, reply) => {
    if (!request.auth.user) throw new ValidationError('Sign in to resend verification');
    const user = request.auth.user;
    if (user.emailVerified) return reply.send({ alreadyVerified: true });

    const token = await issueAuthToken(fastify.pg, user.id, 'verify_email');
    const message = verificationEmail(user.name, `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`);
    const result = await sendMail(request.log, { to: user.email, ...message });
    return reply.send({ verificationSent: result.sent });
  });

  fastify.post('/api/auth/forgot-password', {
    config: authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', maxLength: 254 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const user = await findUserByEmail(fastify.pg, request.body.email);
    if (user) {
      try {
        const token = await issueAuthToken(fastify.pg, user.id, 'reset_password');
        const message = resetEmail(user.name, `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`);
        await sendMail(request.log, { to: user.email, ...message });
      } catch (err) {
        request.log.warn({ err: err.message }, 'Failed to send password reset email');
      }
    }
    // Always identical response: no account enumeration.
    return reply.code(202).send({ accepted: true });
  });

  fastify.post('/api/auth/reset-password', {
    config: authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', maxLength: 200 },
          password: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    await resetPassword(fastify.pg, request.body.token, request.body.password);
    return reply.send({ reset: true });
  });

  // ─── OAuth ───────────────────────────────────────────────────────
  fastify.get('/api/auth/oauth/:provider', async (request, reply) => {
    const { provider } = request.params;
    if (!OAUTH_PROVIDERS.includes(provider) || !isProviderEnabled(provider)) {
      throw new ValidationError('This sign-in provider is not configured');
    }

    const state = signPayload({
      provider,
      nonce: randomToken(16),
      exp: Date.now() + 10 * 60 * 1000,
    });

    const url = buildAuthorizationUrl(provider, state);
    reply.header('Set-Cookie', serializeCookie(OAUTH_COOKIE, state, {
      path: OAUTH_COOKIE_PATH,
      maxAge: 600,
    }));
    return reply.redirect(url, 302);
  });

  fastify.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const { provider } = request.params;
    const { code, state, error } = request.query;

    const fail = (reason) => {
      reply.header('Set-Cookie', clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH }));
      return reply.redirect(`${config.appUrl}/login?error=${encodeURIComponent(reason)}`, 302);
    };

    const cookies = request.headers.cookie || '';
    const rawState = cookies
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${OAUTH_COOKIE}=`))
      ?.slice(OAUTH_COOKIE.length + 1);
    const stored = rawState ? verifyPayload(decodeURIComponent(rawState)) : null;
    const cookieState = rawState ? decodeURIComponent(rawState) : null;

    if (error) return fail('access_denied');
    // The state cookie is the signed payload; matching it to the echoed state
    // binds this callback to the browser that started the flow.
    if (!stored || stored.provider !== provider || cookieState !== state || stored.exp < Date.now()) {
      return fail('invalid_state');
    }
    if (!code) return fail('missing_code');

    try {
      const profile = await exchangeCode(provider, String(code));
      const user = await upsertOAuthUser(fastify.pg, profile);
      const { token, expiresAt } = await createSession(fastify.pg, user.id, cookieSecurity(request));

      reply.header('Set-Cookie', [
        serializeCookie(config.auth.sessionCookieName, token, {
          maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
          expires: expiresAt,
        }),
        clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH }),
      ]);
      return reply.redirect(`${config.appUrl}/dashboard?welcome=1`, 302);
    } catch (err) {
      request.log.error({ err: err.message, provider }, 'OAuth sign-in failed');
      return fail('oauth_failed');
    }
  });

  // ─── Development sign-in ─────────────────────────────────────────
  fastify.get('/api/auth/dev-login', {
    config: authRateLimit,
  }, async (request, reply) => {
    if (!config.auth.devLogin || config.isProduction) {
      throw new ForbiddenError('Development sign-in is disabled');
    }

    const email = String(request.query?.email || 'dev@shortly.local').trim().toLowerCase();
    if (!email.includes('@')) throw new ValidationError('A valid email is required');

    let user = await findUserByEmail(fastify.pg, email);
    if (!user) {
      user = await registerUser(fastify.pg, {
        email,
        password: `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        name: 'Dev User',
      });
      await fastify.pg.query(authQueries.markEmailVerified, [user.id]);
      user = await findUserById(fastify.pg, user.id);
    }

    const { token, expiresAt } = await createSession(fastify.pg, user.id, cookieSecurity(request));
    setSessionCookie(reply, token, expiresAt);
    return reply.redirect(`${config.appUrl}/dashboard`, 302);
  });
}
