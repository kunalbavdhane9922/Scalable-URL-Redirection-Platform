import { isValidCodeFormat } from '../utils/validation.js';
import {
  updateLink,
  disableLink,
  listUrls,
  getUrlWithAnalytics,
  getPlatformStats,
  getPublicStats,
} from '../services/url-service.js';
import { getCacheStats } from '../services/cache-service.js';
import { NotFoundError } from '../utils/errors.js';
import config from '../config.js';

const manageRateLimit = {
  rateLimit: {
    max: config.rateLimit.manage.max,
    timeWindow: config.rateLimit.manage.timeWindow,
  },
};

/**
 * Link management, analytics, and dashboard statistics.
 *
 * Signed-in users manage only their own links. The admin API key retains
 * global (operator) scope. /api/public/stats is unauthenticated.
 */
export default async function linksRoutes(fastify) {
  const scopeOf = (request) => (
    request.auth?.isAdmin ? null : request.auth.user.id
  );

  fastify.get('/api/links', {
    config: manageRateLimit,
    preHandler: fastify.requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          q: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['active', 'disabled', 'expired'] },
        },
      },
    },
  }, async (request, reply) => {
    const { page, limit, q, status } = request.query;
    const result = await listUrls(fastify.pg, {
      page,
      limit,
      search: q,
      status,
      userId: scopeOf(request),
    });
    return reply.send(result);
  });

  fastify.get('/api/links/:code', {
    config: manageRateLimit,
    preHandler: fastify.requireAuth,
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 32 },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;
    if (!isValidCodeFormat(code)) throw new NotFoundError('Link not found');

    const details = await getUrlWithAnalytics(fastify.pg, code);
    if (!details) throw new NotFoundError('Link not found');
    if (!request.auth.isAdmin && details.userId !== String(request.auth.user.id)) {
      throw new NotFoundError('Link not found');
    }

    return reply.send(details);
  });

  fastify.patch('/api/links/:code', {
    config: manageRateLimit,
    preHandler: fastify.requireAuth,
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 32 },
        },
      },
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          url: { type: 'string' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;
    if (!isValidCodeFormat(code)) throw new NotFoundError('Link not found');

    const changes = {
      userId: scopeOf(request),
    };
    if (Object.prototype.hasOwnProperty.call(request.body, 'url')) changes.url = request.body.url;
    if (Object.prototype.hasOwnProperty.call(request.body, 'expiresAt')) {
      changes.expiresAt = request.body.expiresAt;
    }

    const result = await updateLink(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      code,
      changes,
    );

    if (!result) throw new NotFoundError('Link not found or not active');

    return reply.code(200).send({
      shortCode: result.short_code,
      originalUrl: result.original_url,
      status: result.status,
      expiresAt: result.expires_at,
      updatedAt: result.updated_at,
    });
  });

  fastify.delete('/api/links/:code', {
    config: manageRateLimit,
    preHandler: fastify.requireAuth,
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 32 },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;
    if (!isValidCodeFormat(code)) throw new NotFoundError('Link not found');

    const result = await disableLink(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      code,
      { userId: scopeOf(request) },
    );

    if (!result) throw new NotFoundError('Link not found or already disabled');

    return reply.code(204).send();
  });

  /**
   * Dashboard statistics (protected, scoped to the caller).
   */
  fastify.get('/api/stats', {
    config: manageRateLimit,
    preHandler: fastify.requireAuth,
  }, async (request, reply) => {
    const stats = await getPlatformStats(fastify.pg, scopeOf(request));
    return reply.send({
      ...stats,
      cache: getCacheStats(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /**
   * Non-sensitive counters for the public landing page.
   */
  fastify.get('/api/public/stats', {
    config: { rateLimit: { max: 120, timeWindow: 60000 } },
  }, async (request, reply) => {
    const stats = await getPublicStats(fastify.pg);
    return reply.send({
      ...stats,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
}
