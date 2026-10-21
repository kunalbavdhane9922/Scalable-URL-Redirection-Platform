import { isValidCodeFormat } from '../utils/validation.js';
import { updateLink, disableLink, listUrls, getUrlWithAnalytics } from '../services/url-service.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Link management and query routes.
 *
 * Per document Appendix A:
 *  - PATCH /api/links/:code — "Update destination or metadata for an owned link."
 *                              200 OK after durable update and invalidation.
 *  - DELETE /api/links/:code — "Disable/delete a managed link."
 *                               204 No Content.
 *
 * Complementary query endpoints to support dashboard link management and analytics:
 *  - GET /api/links — List recent shortened links with click counts.
 *  - GET /api/links/:code — Retrieve detailed metadata and aggregated click analytics.
 */
export default async function linksRoutes(fastify) {
  /**
   * GET /api/links — List recent shortened links
   */
  fastify.get('/api/links', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const limit = request.query.limit || 50;
    const links = await listUrls(fastify.pg, limit);
    return reply.send(links);
  });

  /**
   * GET /api/links/:code — Get link details and click analytics
   */
  fastify.get('/api/links/:code', {
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;

    if (!isValidCodeFormat(code)) {
      throw new NotFoundError('Link not found');
    }

    const details = await getUrlWithAnalytics(fastify.pg, code);
    if (!details) {
      throw new NotFoundError('Link not found');
    }

    return reply.send(details);
  });

  /**
   * PATCH /api/links/:code — Update link destination
   */
  fastify.patch('/api/links/:code', {
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            shortCode: { type: 'string' },
            originalUrl: { type: 'string' },
            status: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;
    const { url } = request.body;

    if (!isValidCodeFormat(code)) {
      throw new NotFoundError('Link not found');
    }

    const result = await updateLink(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      code,
      url,
    );

    if (!result) {
      throw new NotFoundError('Link not found or not active');
    }

    return reply.code(200).send({
      shortCode: result.short_code,
      originalUrl: result.original_url,
      status: result.status,
      updatedAt: result.updated_at,
    });
  });

  /**
   * DELETE /api/links/:code — Disable/delete a link
   */
  fastify.delete('/api/links/:code', {
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;

    if (!isValidCodeFormat(code)) {
      throw new NotFoundError('Link not found');
    }

    const result = await disableLink(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      code,
    );

    if (!result) {
      throw new NotFoundError('Link not found or already disabled');
    }

    return reply.code(204).send();
  });
}
