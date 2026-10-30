/**
 * Parameterized SQL. Every user-controlled value is bound, never concatenated.
 */

export const queries = {
  insertUrl: `
    INSERT INTO urls (short_code, original_url, status, expires_at, user_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, short_code, original_url, status, created_at, expires_at
  `,

  findByShortCode: `
    SELECT id, short_code, original_url, status, expires_at, updated_at
    FROM urls
    WHERE short_code = $1
  `,

  updateUrlDestination: `
    UPDATE urls
    SET original_url = $2,
        updated_at = NOW()
    WHERE short_code = $1
      AND status = 'active'
      AND ($3::bigint IS NULL OR user_id = $3)
    RETURNING id, short_code, original_url, status, updated_at, expires_at
  `,

  updateUrlExpiry: `
    UPDATE urls
    SET expires_at = $2,
        updated_at = NOW()
    WHERE short_code = $1
      AND status = 'active'
      AND ($3::bigint IS NULL OR user_id = $3)
    RETURNING id, short_code, original_url, status, updated_at, expires_at
  `,

  updateUrlBoth: `
    UPDATE urls
    SET original_url = $2,
        expires_at = $3,
        updated_at = NOW()
    WHERE short_code = $1
      AND status = 'active'
      AND ($4::bigint IS NULL OR user_id = $4)
    RETURNING id, short_code, original_url, status, updated_at, expires_at
  `,

  disableUrl: `
    UPDATE urls
    SET status = $2,
        updated_at = NOW()
    WHERE short_code = $1
      AND status = 'active'
      AND ($3::bigint IS NULL OR user_id = $3)
    RETURNING id, short_code, status, updated_at
  `,

  insertOutboxEvent: `
    INSERT INTO outbox (event_type, payload)
    VALUES ($1, $2)
    RETURNING id
  `,

  /**
   * Claim unclaimed outbox rows atomically. SKIP LOCKED lets several worker
   * replicas relay concurrently without publishing the same event twice.
   */
  claimOutboxEvents: `
    UPDATE outbox o
    SET claimed_at = NOW()
    FROM (
      SELECT id
      FROM outbox
      WHERE published_at IS NULL
        AND (claimed_at IS NULL OR claimed_at < NOW() - make_interval(secs => $2))
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    ) AS batch
    WHERE o.id = batch.id
    RETURNING o.id, o.event_type, o.payload, o.created_at, o.retries
  `,

  markOutboxPublished: `
    UPDATE outbox SET published_at = NOW(), claimed_at = NULL WHERE id = $1
  `,

  releaseOutboxClaim: `
    UPDATE outbox SET claimed_at = NULL, retries = retries + 1 WHERE id = $1
  `,

  findExpiredLinks: `
    SELECT id, short_code
    FROM urls
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    LIMIT $1
  `,

  expireLinks: `
    UPDATE urls
    SET status = 'expired',
        updated_at = NOW()
    WHERE id = ANY($1::bigint[])
    RETURNING short_code
  `,

  findUrlWithAnalytics: `
    SELECT id, short_code, original_url, status, created_at, updated_at,
           expires_at, click_count, last_clicked_at, user_id
    FROM urls
    WHERE short_code = $1
  `,

  findDailyClicks: `
    SELECT click_date, click_count
    FROM click_analytics
    WHERE short_code = $1
    ORDER BY click_date DESC
    LIMIT 30
  `,

  findClickBreakdown: `
    SELECT dimension, value, SUM(count)::BIGINT AS count
    FROM click_breakdown
    WHERE short_code = $1
    GROUP BY dimension, value
    ORDER BY count DESC
    LIMIT 20
  `,

  /** Pass NULL to aggregate the whole platform; a user id to scope to them. */
  totals: `
    SELECT
      COUNT(*)::BIGINT AS total_links,
      COUNT(*) FILTER (WHERE status = 'active')::BIGINT AS active_links,
      COUNT(*) FILTER (WHERE status = 'disabled')::BIGINT AS disabled_links,
      COUNT(*) FILTER (WHERE status = 'expired')::BIGINT AS expired_links,
      COALESCE(SUM(click_count), 0)::BIGINT AS total_clicks,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::BIGINT AS links_last_24h
    FROM urls
    WHERE ($1::bigint IS NULL OR user_id = $1)
  `,

  clicksSeries: `
    SELECT ca.click_date, SUM(ca.click_count)::BIGINT AS clicks
    FROM click_analytics ca
    JOIN urls u ON u.short_code = ca.short_code
    WHERE ca.click_date >= CURRENT_DATE - INTERVAL '13 days'
      AND ($1::bigint IS NULL OR u.user_id = $1)
    GROUP BY ca.click_date
    ORDER BY ca.click_date ASC
  `,

  topLinks: `
    SELECT short_code, original_url, click_count
    FROM urls
    WHERE ($1::bigint IS NULL OR user_id = $1)
    ORDER BY click_count DESC, created_at DESC
    LIMIT 5
  `,

  /** Batched click aggregation from the worker. */
  upsertClickAnalyticsBatch: `
    INSERT INTO click_analytics (short_code, click_date, click_count)
    SELECT * FROM unnest($1::text[], $2::date[], $3::bigint[])
    ON CONFLICT (short_code, click_date)
    DO UPDATE SET click_count = click_analytics.click_count + EXCLUDED.click_count
  `,

  upsertClickBreakdownBatch: `
    INSERT INTO click_breakdown (short_code, click_date, dimension, value, count)
    SELECT * FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::bigint[])
    ON CONFLICT (short_code, click_date, dimension, value)
    DO UPDATE SET count = click_breakdown.count + EXCLUDED.count
  `,

  incrementUrlClickCounts: `
    UPDATE urls u
    SET click_count = u.click_count + v.cnt,
        last_clicked_at = NOW()
    FROM (SELECT unnest($1::text[]) AS short_code, unnest($2::bigint[]) AS cnt) AS v
    WHERE u.short_code = v.short_code
  `,
};

/**
 * Build a filtered, paginated list query with a windowed total count so the
 * dashboard needs a single round trip.
 */
export function buildListUrlsQuery({ search, status, userId }) {
  const conditions = [];
  const params = [];

  if (userId) {
    params.push(userId);
    conditions.push(`u.user_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`u.status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(u.short_code ILIKE $${params.length} OR u.original_url ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(100); // placeholder, replaced by caller-safe limit below
  const limitIndex = params.length;
  params.push(0);
  const offsetIndex = params.length;

  const text = `
    SELECT u.id, u.short_code, u.original_url, u.status, u.created_at,
           u.updated_at, u.expires_at, u.click_count, u.last_clicked_at,
           COUNT(*) OVER()::BIGINT AS total_count
    FROM urls u
    ${where}
    ORDER BY u.created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;

  return { text, params, limitIndex, offsetIndex };
}
