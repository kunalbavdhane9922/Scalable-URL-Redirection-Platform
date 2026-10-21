import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import config from '../config.js';

/**
 * Rate limiting plugin.
 *
 * Per document §6.1: "Rate-limit URL creation"
 * Per document §13: "Apply rate limits to URL creation and potentially
 *  to redirect requests when abuse patterns warrant it."
 *
 * This registers a global rate limiter. Route-specific overrides are
 * applied in individual route definitions using the routeConfig option.
 */
async function rateLimitPlugin(fastify) {
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimit.redirect.max,
    timeWindow: config.rateLimit.redirect.timeWindow,
    allowList: [],
    // Use Redis for distributed rate limiting when available;
    // falls back to in-memory per-instance limiting if Redis is down.
    redis: fastify.redis,
    keyGenerator: (request) => {
      // Use X-Forwarded-For when behind NGINX, fall back to IP
      return request.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || request.ip;
    },
    errorResponseBuilder: (request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      };
    },
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  dependencies: ['redis'],
});
