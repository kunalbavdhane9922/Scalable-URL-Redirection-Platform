import { isValidCodeFormat, isActiveAndUnexpired } from '../utils/validation.js';
import {
  getFromL1,
  isNegativelyCachedL1,
  getFromL2,
  populateL2AndL1,
  setNegativeCache,
  singleFlight,
} from '../services/cache-service.js';
import { findByShortCode } from '../services/url-service.js';
import { enqueueClickEvent } from '../services/queue-service.js';

/**
 * GET /:code — URL Redirection Flow
 *
 * This is the redirect critical path. Per document §9.2:
 *  - "Perform code validation, lookup, minimal eligibility checks,
 *     and the redirect response."
 *  - "Do not synchronously update analytics counters or run unrelated
 *     queries on every redirect."
 *  - "Avoid expensive synchronous logging on the success path."
 *
 * The implementation follows the pseudocode in Appendix B and the
 * flow described in §8 steps 1-9 precisely.
 *
 * Lookup order (§9.1): L1 → Redis (L2) → PostgreSQL
 */
export default async function redirectRoutes(fastify) {
  fastify.get('/:code', {
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
      // Per §8.1: "Use 302 by default for editable links"
      response: {
        302: { type: 'null', description: 'Redirect to original URL' },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        410: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;

    // Step 3 (§8): "Validate the code's format and reject malformed input cheaply."
    if (!isValidCodeFormat(code)) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Invalid short code',
      });
    }

    // Check L1 negative cache first (§9.4)
    if (isNegativelyCachedL1(code)) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Short URL not found',
      });
    }

    // Step 4 (§8): "Check the instance-local bounded L1 LRU cache."
    const l1Result = getFromL1(code);
    if (l1Result) {
      // Fire-and-forget click event (§8 step 9)
      enqueueClickEvent(fastify.redis, fastify.log, code, l1Result.url);
      reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      return reply.redirect(l1Result.url, 302);
    }

    // Step 5 (§8): "On an L1 miss, query shared Redis (L2)."
    const l2Result = await getFromL2(fastify.redis, fastify.isRedisAvailable, code);
    if (l2Result) {
      if (l2Result.source === 'l2-negative') {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Short URL not found',
        });
      }
      enqueueClickEvent(fastify.redis, fastify.log, code, l2Result.url);
      reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      return reply.redirect(l2Result.url, 302);
    }

    // Steps 6-8 (§8): PostgreSQL lookup with single-flight coalescing
    // Per §9.4: "let one lookup refresh a missing key while concurrent
    // requests await the same result"
    const mapping = await singleFlight(code, () => findByShortCode(fastify.pg, code));

    // Step 8 (§8): "If the code is missing, disabled, or expired, return
    // the appropriate not-found/gone response."
    if (!mapping) {
      // §9.4: "cache nonexistent codes briefly to prevent repeated database reads"
      await setNegativeCache(fastify.redis, fastify.isRedisAvailable, code);
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Short URL not found',
      });
    }

    if (!isActiveAndUnexpired(mapping)) {
      // Link exists but is disabled or expired -> 410 Gone (§8 step 8)
      await setNegativeCache(fastify.redis, fastify.isRedisAvailable, code);
      const isExpired = mapping.status === 'expired' || (mapping.expires_at && new Date(mapping.expires_at) <= new Date());
      return reply.code(410).send({
        statusCode: 410,
        error: 'Gone',
        message: isExpired ? 'Short URL has expired' : 'Short URL has been disabled',
      });
    }

    // Step 7 (§8): "populate Redis and L1 according to the cache policy"
    await populateL2AndL1(
      fastify.redis,
      fastify.isRedisAvailable,
      code,
      mapping.original_url,
    );

    // Step 9 (§8): Fire-and-forget click analytics
    enqueueClickEvent(fastify.redis, fastify.log, code, mapping.original_url);

    // Return 302 redirect (§8.1)
    reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    return reply.redirect(mapping.original_url, 302);
  });
}
