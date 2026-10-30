import { queries, buildListUrlsQuery } from '../db/queries.js';
import { createShortCode, MAX_RETRIES } from './code-generator.js';
import { populateL2AndL1, invalidateL2 } from './cache-service.js';
import { publishInvalidation } from '../cache/invalidation.js';
import { validateUrl, validateAlias } from '../utils/validation.js';
import { ConflictError, ValidationError, AppError } from '../utils/errors.js';
import config from '../config.js';

/**
 * URL shortening and lifecycle service.
 */

function normalizeExpiry(expiresAt) {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('expiresAt must be a valid ISO-8601 timestamp');
  }
  if (date.getTime() <= Date.now()) {
    throw new ValidationError('expiresAt must be in the future');
  }
  return date.toISOString();
}

/**
 * Create a shortened URL. An optional custom alias is accepted; random codes
 * are retried on unique-constraint collisions, aliases are not.
 */
export async function createShortUrl(pgPool, redis, isRedisAvailable, logger, rawUrl, options = {}) {
  const normalizedUrl = validateUrl(rawUrl);
  const expiresAt = normalizeExpiry(options.expiresAt);
  const ownerId = options.ownerId ? Number(options.ownerId) : null;
  const alias = options.customAlias ? validateAlias(options.customAlias) : null;

  const maxAttempts = alias ? 1 : MAX_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = alias || createShortCode();
    const client = await pgPool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(queries.insertUrl, [
        code,
        normalizedUrl,
        'active',
        expiresAt,
        ownerId,
      ]);

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
      populateL2AndL1(redis, isRedisAvailable, code, normalizedUrl);

      logger.info({ shortCode: code, customAlias: Boolean(alias) }, 'URL shortened');

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

      if (err.code === '23505') {
        if (alias) throw new ConflictError('That custom alias is already taken');
        logger.debug({ attempt, code }, 'Short code collision, retrying');
        continue;
      }

      if (err instanceof AppError) throw err;
      logger.error({ err: err.message }, 'Failed to create short URL');
      throw new AppError('Failed to create short URL', 500);
    } finally {
      client.release();
    }
  }

  logger.error({ retries: MAX_RETRIES }, 'Exhausted short code generation retries');
  throw new ConflictError('Unable to generate a unique short code. Please try again.');
}

/**
 * Update a link's destination and/or expiration. PostgreSQL commits first,
 * then caches are invalidated locally and across instances via Pub/Sub.
 * `userId` scopes the write to its owner; null means operator (global) scope.
 */
export async function updateLink(pgPool, redis, isRedisAvailable, logger, code, changes = {}) {
  const hasUrl = Object.prototype.hasOwnProperty.call(changes, 'url');
  const hasExpiry = Object.prototype.hasOwnProperty.call(changes, 'expiresAt');
  if (!hasUrl && !hasExpiry) {
    throw new ValidationError('Provide a new url and/or expiresAt');
  }

  const normalizedUrl = hasUrl ? validateUrl(changes.url) : null;
  const expiresAt = hasExpiry ? normalizeExpiry(changes.expiresAt) : null;
  const userId = changes.userId || null;

  let text;
  let params;
  if (hasUrl && hasExpiry) {
    text = queries.updateUrlBoth;
    params = [code, normalizedUrl, expiresAt, userId];
  } else if (hasUrl) {
    text = queries.updateUrlDestination;
    params = [code, normalizedUrl, userId];
  } else {
    text = queries.updateUrlExpiry;
    params = [code, expiresAt, userId];
  }

  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(text, params);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(queries.insertOutboxEvent, [
      'link_updated',
      JSON.stringify({
        shortCode: code,
        newUrl: normalizedUrl || result.rows[0].original_url,
        expiresAt: result.rows[0].expires_at || null,
        updatedAt: new Date().toISOString(),
      }),
    ]);

    await client.query('COMMIT');

    await invalidateL2(redis, code);
    if (isRedisAvailable()) {
      await publishInvalidation(redis, code, 'update').catch((err) => {
        logger.warn({ err: err.message, shortCode: code }, 'Failed to publish invalidation');
      });
    }
    if (result.rows[0].original_url) {
      populateL2AndL1(redis, isRedisAvailable, code, result.rows[0].original_url);
    }

    logger.info({ shortCode: code, expiresChanged: hasExpiry }, 'Link updated');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Disable a link (soft delete). Cache eviction is immediate.
 */
export async function disableLink(pgPool, redis, isRedisAvailable, logger, code, { userId = null } = {}) {
  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(queries.disableUrl, [code, 'disabled', userId]);
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

export async function findByShortCode(pgPool, code) {
  const result = await pgPool.query(queries.findByShortCode, [code]);
  return result.rows[0] || null;
}

/**
 * Paginated link listing with optional full-text-ish search and status filter.
 * Returns a stable shape for the dashboard: { items, pagination }.
 */
export async function listUrls(pgPool, { page = 1, limit = 20, search, status, userId = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeSearch = typeof search === 'string' ? search.trim().slice(0, 100) : '';
  const safeStatus = ['active', 'disabled', 'expired'].includes(status) ? status : null;

  const { text, params, limitIndex, offsetIndex } = buildListUrlsQuery({
    search: safeSearch || null,
    status: safeStatus,
    userId: userId ? Number(userId) : null,
  });
  params[limitIndex - 1] = safeLimit;
  params[offsetIndex - 1] = (safePage - 1) * safeLimit;

  const result = await pgPool.query(text, params);
  const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      shortCode: row.short_code,
      shortUrl: `${config.baseUrl}/${row.short_code}`,
      originalUrl: row.original_url,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      clickCount: parseInt(row.click_count, 10) || 0,
      lastClickedAt: row.last_clicked_at,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
    },
  };
}

/**
 * Per-link details plus daily clicks and breakdown dimensions.
 */
export async function getUrlWithAnalytics(pgPool, code) {
  const result = await pgPool.query(queries.findUrlWithAnalytics, [code]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const [daily, breakdown] = await Promise.all([
    pgPool.query(queries.findDailyClicks, [code]),
    pgPool.query(queries.findClickBreakdown, [code]),
  ]);

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
    lastClickedAt: row.last_clicked_at,
    userId: row.user_id ? String(row.user_id) : null,
    dailyClicks: daily.rows,
    breakdown: breakdown.rows.map((item) => ({
      dimension: item.dimension,
      value: item.value,
      count: parseInt(item.count, 10) || 0,
    })),
  };
}

/**
 * Aggregate dashboard statistics. `userId` scopes totals to one account;
 * null aggregates the whole platform (operators and the public page).
 */
export async function getPlatformStats(pgPool, userId = null) {
  const scope = userId ? Number(userId) : null;
  const [totals, series, top] = await Promise.all([
    pgPool.query(queries.totals, [scope]),
    pgPool.query(queries.clicksSeries, [scope]),
    pgPool.query(queries.topLinks, [scope]),
  ]);

  const t = totals.rows[0] || {};
  return {
    totalLinks: parseInt(t.total_links, 10) || 0,
    activeLinks: parseInt(t.active_links, 10) || 0,
    disabledLinks: parseInt(t.disabled_links, 10) || 0,
    expiredLinks: parseInt(t.expired_links, 10) || 0,
    totalClicks: parseInt(t.total_clicks, 10) || 0,
    linksLast24h: parseInt(t.links_last_24h, 10) || 0,
    clicksSeries: series.rows.map((r) => ({
      date: r.click_date,
      clicks: parseInt(r.clicks, 10) || 0,
    })),
    topLinks: top.rows.map((r) => ({
      shortCode: r.short_code,
      originalUrl: r.original_url,
      clickCount: parseInt(r.click_count, 10) || 0,
    })),
  };
}

/**
 * Public, non-sensitive counters for the landing page.
 */
export async function getPublicStats(pgPool) {
  const result = await pgPool.query(queries.totals, [null]);
  const t = result.rows[0] || {};
  return {
    totalLinks: parseInt(t.total_links, 10) || 0,
    totalClicks: parseInt(t.total_clicks, 10) || 0,
    activeLinks: parseInt(t.active_links, 10) || 0,
  };
}
