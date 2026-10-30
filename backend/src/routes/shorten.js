import config from '../config.js';
import { createShortUrl } from '../services/url-service.js';

/**
 * POST /api/shorten — create a short link.
 *
 * Public endpoint, rate limited per IP. An optional customAlias lets the
 * caller choose the code; collisions return 409 instead of silently retrying.
 */
export default async function shortenRoutes(fastify) {
  fastify.post('/api/shorten', {
    config: {
      rateLimit: {
        max: config.rateLimit.shorten.max,
        timeWindow: config.rateLimit.shorten.timeWindow,
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          customAlias: { type: 'string', minLength: 3, maxLength: 32, nullable: true },
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: ['integer', 'string'] },
            shortCode: { type: 'string' },
            shortUrl: { type: 'string' },
            originalUrl: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
            expiresAt: { type: 'string', nullable: true },
            owned: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { url, expiresAt, customAlias } = request.body;

    // Signed-in users own their links; anonymous links stay unowned.
    const user = await fastify.getOptionalUser(request);

    const result = await createShortUrl(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      url,
      {
        expiresAt: expiresAt || null,
        customAlias: customAlias || null,
        ownerId: user?.id || null,
      },
    );

    return reply.code(201).send({ ...result, owned: Boolean(user) });
  });
}
