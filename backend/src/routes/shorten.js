import config from '../config.js';
import { createShortUrl } from '../services/url-service.js';
import { ValidationError } from '../utils/errors.js';

/**
 * POST /api/shorten — URL Creation Flow
 *
 * Per document §7 and Appendix A:
 *  - "Validate and persist a long URL, create a short code."
 *  - "201 Created (or 200 by API convention) with short URL and optional metadata."
 *
 * Per document §6.1:
 *  - "Rate-limit URL creation"
 *
 * Per document §13:
 *  - "Avoid exposing internal database errors or stack traces to clients."
 *  - "Do not fetch user-submitted URLs from the server as part of ordinary
 *     shortening; doing so can introduce SSRF risk."
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
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: 'object',
          properties: {
            shortCode: { type: 'string' },
            shortUrl: { type: 'string' },
            originalUrl: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
            expiresAt: { type: 'string', nullable: true },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { url, expiresAt } = request.body;

    const result = await createShortUrl(
      fastify.pg,
      fastify.redis,
      fastify.isRedisAvailable,
      fastify.log,
      url,
      { expiresAt: expiresAt || null },
    );

    return reply.code(201).send(result);
  });
}
