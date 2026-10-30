import { isValidCodeFormat, referrerHost, deviceFromUserAgent } from '../utils/validation.js';
import {
  getFromL1,
  isNegativelyCachedL1,
  getGoneFromL1,
  getFromL2,
  populateL2AndL1,
  setNegativeCache,
  setGoneCache,
  singleFlight,
} from '../services/cache-service.js';
import { findByShortCode } from '../services/url-service.js';
import { enqueueClickEvent } from '../services/queue-service.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { recordDbError, circuitState } from '../plugins/metrics.js';

const REDIRECT_CACHE_HEADERS = 'private, no-cache, no-store, must-revalidate';

const goneResponse = (reply, reason) => {
  const expired = reason === 'expired';
  return reply.code(410).send({
    statusCode: 410,
    error: 'Gone',
    message: expired ? 'Short URL has expired' : 'Short URL has been disabled',
  });
};

const notFoundResponse = (reply) =>
  reply.code(404).send({
    statusCode: 404,
    error: 'Not Found',
    message: 'Short URL not found',
  });

/**
 * GET /:code — redirect critical path.
 *
 * Order: L1 → Redis → PostgreSQL, with a circuit breaker protecting the
 * database and click analytics queued asynchronously.
 */
export default async function redirectRoutes(fastify) {
  const dbBreaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownMs: 5000,
    onStateChange: (state) => circuitState.set(state === 'open' ? 1 : 0),
  });

  const queueClick = (request, code, url) => {
    enqueueClickEvent(fastify.redis, fastify.log, code, {
      originalUrl: url,
      referrer: referrerHost(request.headers.referer || request.headers.referrer),
      device: deviceFromUserAgent(request.headers['user-agent']),
      country: request.headers['cf-ipcountry'] || null,
      requestId: request.id,
    });
  };

  fastify.get('/:code', {
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

    if (!isValidCodeFormat(code)) return notFoundResponse(reply);

    const l1Gone = getGoneFromL1(code);
    if (l1Gone) return goneResponse(reply, l1Gone);

    if (isNegativelyCachedL1(code)) return notFoundResponse(reply);

    const l1Result = getFromL1(code);
    if (l1Result) {
      queueClick(request, code, l1Result.url);
      reply.header('Cache-Control', REDIRECT_CACHE_HEADERS);
      reply.header('X-Robots-Tag', 'noindex');
      return reply.redirect(l1Result.url, 302);
    }

    const l2Result = await getFromL2(fastify.redis, fastify.isRedisAvailable, code);
    if (l2Result) {
      if (l2Result.source === 'l2-gone') return goneResponse(reply, l2Result.gone);
      if (l2Result.source === 'l2-negative') return notFoundResponse(reply);
      queueClick(request, code, l2Result.url);
      reply.header('Cache-Control', REDIRECT_CACHE_HEADERS);
      reply.header('X-Robots-Tag', 'noindex');
      return reply.redirect(l2Result.url, 302);
    }

    let mapping;
    try {
      mapping = await dbBreaker.execute(() =>
        singleFlight(code, () => findByShortCode(fastify.pg, code)),
      );
    } catch (err) {
      recordDbError('redirect_lookup');
      fastify.log.error({ err: err.message, code }, 'Redirect database lookup failed');
      reply.header('Retry-After', '2');
      throw new ServiceUnavailableError('Service temporarily unavailable, please retry');
    }

    if (!mapping) {
      setNegativeCache(fastify.redis, fastify.isRedisAvailable, code);
      return notFoundResponse(reply);
    }

    const isExpired = mapping.expires_at && new Date(mapping.expires_at) <= new Date();
    if (mapping.status !== 'active' || isExpired) {
      const reason = isExpired ? 'expired' : 'disabled';
      setGoneCache(fastify.redis, fastify.isRedisAvailable, code, reason);
      return goneResponse(reply, reason);
    }

    populateL2AndL1(fastify.redis, fastify.isRedisAvailable, code, mapping.original_url);
    queueClick(request, code, mapping.original_url);

    reply.header('Cache-Control', REDIRECT_CACHE_HEADERS);
    reply.header('X-Robots-Tag', 'noindex');
    return reply.redirect(mapping.original_url, 302);
  });
}
