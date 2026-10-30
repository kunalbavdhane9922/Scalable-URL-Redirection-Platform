import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import config from '../config.js';
import { recordRateLimitHit } from './metrics.js';

/**
 * Distributed rate limiting backed by Redis.
 *
 * `skipOnError` fails open: if Redis is down, requests are allowed rather than
 * taking the whole service offline. Redirect limits are intentionally high;
 * creation and management limits are stricter.
 */
async function rateLimitPlugin(fastify) {
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimit.redirect.max,
    timeWindow: config.rateLimit.redirect.timeWindow,
    redis: fastify.redis,
    skipOnError: true,
    keyGenerator: (request) => request.ip,
    onExceeded: () => recordRateLimitHit(),
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  dependencies: ['redis', 'metrics'],
});
