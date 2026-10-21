import { queries } from '../db/queries.js';
import { createShortCode, MAX_RETRIES } from './code-generator.js';
import { populateL2AndL1, invalidateL2 } from './cache-service.js';
import { publishInvalidation } from '../cache/invalidation.js';
import { publishEvent } from './queue-service.js';
import { validateUrl, isActiveAndUnexpired } from '../utils/validation.js';
import { ConflictError, AppError } from '../utils/errors.js';
import config from '../config.js';

/**
 * URL shortening and lifecycle management service.
 *
 * Implements the flows described in document §7 (creation) and §10 (lifecycle).
 */

/**
 * Create a shortened URL.
 * Implements the full URL Creation Flow from document §7.
 *
 * Steps:
 *  1. Validate the URL (scheme, length, syntax) [§7 step 3]
 *  2. Generate a candidate short code [§7 step 4]
 *  3. Insert into PostgreSQL with unique constraint [§7 step 5]
 *  4. Populate Redis (L2) on success [§7 step 6]
 *  5. Optionally warm L1 [§7 step 7]
 *  6. Write outbox event in same transaction [§7 step 8]
 *  7. Return short URL after durable persistence [§7 step 9]
 *
 * @param {import('pg').Pool} pgPool
 * @param {import('ioredis').Redis} redis
 * @param {Function} isRedisAvailable
 * @param {import('pino').Logger} logger
 * @param {string} rawUrl - The submitted URL
 * @param {object} [options] - Optional: expiresAt, ownerId
 * @returns {Promise<object>} Created URL mapping
 */
export async function createShortUrl(pgPool, redis, isRedisAvailable, logger, rawUrl, options = {}) {
  // Step 3: Validate URL
  const normalizedUrl = validateUrl(rawUrl);

  const { expiresAt = null, ownerId = null } = options;

  // Steps 4-5: Generate code and insert with retry on collision
  // Per §6: "attempt the insert under the unique constraint, and retry
  //  with a new candidate if the database reports a uniqueness conflict."
  // Per §6.1: "Do not assume that checking Redis before insertion guarantees
  //  uniqueness; the database unique constraint must decide the winner."
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = createShortCode();

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Step 5: Parameterized insert
      const result = await client.query(queries.insertUrl, [
        code,
        normalizedUrl,
        'active',
        expiresAt,
        ownerId,
      ]);

      // Step 8: Transactional outbox — atomic with the insert
      // Per §7 step 8: "write an outbox record in the same database transaction"
      await client.query(queries.insertOutboxEvent, [
        'link_created',
        JSON.stringify({
          shortCode: code,
          originalUrl: normalizedUrl,
          createdAt: new Date().toISOString(),
        }),
      ]);

      await client.query('COMMIT');

      const mapping = result.rows[0];

      // Step 6: Populate Redis (best-effort after commit)
      // Per §7 step 6: "Only after the database commit succeeds"
      await populateL2AndL1(redis, isRedisAvailable, code, normalizedUrl);

      logger.info({ shortCode: code }, 'URL shortened successfully');

      return {
        id: mapping.id,
        shortCode: mapping.short_code,
        shortUrl: `${config.baseUrl}/${mapping.short_code}`,
        originalUrl: mapping.original_url,
        status: mapping.status,
        createdAt: mapping.created_at,
        expiresAt: mapping.expires_at,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      // Per §6: unique constraint violation → retry with new code
      // PostgreSQL error code 23505 = unique_violation
      if (err.code === '23505') {
        logger.debug({ attempt, code }, 'Short code collision, retrying');
        lastError = err;
        continue;
      }

      // Any other error is not a collision — propagate
      throw new AppError('Failed to create short URL', 500);
    } finally {
      client.release();
    }
  }

  // Exhausted all retries
  logger.error({ retries: MAX_RETRIES }, 'Exhausted short code generation retries');
  throw new ConflictError('Unable to generate unique short code. Please try again.');
}

/**
 * Update a link's destination URL.
 * Implements document §10 (Cache Invalidation and Link Lifecycle).
 *
 * Steps:
 *  1. Persist the update in PostgreSQL [§10 step 1]
 *  2. Delete/update the Redis key [§10 step 2]
 *  3. Publish invalidation via Pub/Sub [§10 step 3]
 *  4. Write outbox event atomically [§10 step 5]
 */
export async function updateLink(pgPool, redis, isRedisAvailable, logger, code, newUrl) {
  const normalizedUrl = validateUrl(newUrl);

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(queries.updateUrl, [code, normalizedUrl]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null; // Not found or not active
    }

    // Outbox event for the update
    await client.query(queries.insertOutboxEvent, [
      'link_updated',
      JSON.stringify({
        shortCode: code,
        newUrl: normalizedUrl,
        updatedAt: new Date().toISOString(),
      }),
    ]);

    await client.query('COMMIT');

    // Invalidate caches (best-effort after commit)
    await invalidateL2(redis, code);

    // Broadcast invalidation to all instances
    if (isRedisAvailable()) {
      await publishInvalidation(redis, code, 'update').catch((err) => {
        logger.warn({ err: err.message, shortCode: code }, 'Failed to publish invalidation');
      });
    }

    // Re-populate cache with new URL
    await populateL2AndL1(redis, isRedisAvailable, code, normalizedUrl);

    logger.info({ shortCode: code }, 'Link updated');

    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Disable/delete a link.
 * Per §10 steps 1-5 and Appendix A (DELETE /api/links/:code).
 */
export async function disableLink(pgPool, redis, isRedisAvailable, logger, code) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(queries.disableUrl, [code, 'disabled']);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(queries.insertOutboxEvent, [
      'link_disabled',
      JSON.stringify({
        shortCode: code,
        disabledAt: new Date().toISOString(),
      }),
    ]);

    await client.query('COMMIT');

    // Invalidate caches
    await invalidateL2(redis, code);

    if (isRedisAvailable()) {
      await publishInvalidation(redis, code, 'disable').catch((err) => {
        logger.warn({ err: err.message, shortCode: code }, 'Failed to publish invalidation');
      });
    }

    logger.info({ shortCode: code }, 'Link disabled');

    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up a mapping by short code from PostgreSQL (authoritative source).
 * Per §8 step 6: "perform a parameterized indexed lookup in PostgreSQL.
 * Check whether the link exists, is active, and has not expired."
 */
export async function findByShortCode(pgPool, code) {
  const result = await pgPool.query(queries.findByShortCode, [code]);
  return result.rows[0] || null;
}

/**
 * List recent URLs with total click counts.
 */
export async function listUrls(pgPool, limit = 50) {
  const boundedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const result = await pgPool.query(queries.listUrls, [boundedLimit]);
  return result.rows.map(row => ({
    id: row.id,
    short_code: row.short_code,
    original_url: row.original_url,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    click_count: parseInt(row.click_count, 10) || 0,
  }));
}

/**
 * Fetch URL details and click analytics breakdown.
 */
export async function getUrlWithAnalytics(pgPool, code) {
  const result = await pgPool.query(queries.findUrlWithAnalytics, [code]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const daily = await pgPool.query(queries.findDailyClicks, [code]);

  return {
    id: row.id,
    shortCode: row.short_code,
    shortUrl: `${config.baseUrl}/${row.short_code}`,
    originalUrl: row.original_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    clickCount: parseInt(row.click_count, 10) || 0,
    dailyClicks: daily.rows,
  };
}
