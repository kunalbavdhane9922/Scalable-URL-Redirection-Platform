/**
 * Parameterized SQL queries.
 *
 * Per document §5.2:
 *  - "Use parameterized queries; never build SQL by concatenating user input."
 *  - "A redirect cache miss should execute an indexed lookup, not a table scan."
 *
 * Every query uses $N-style placeholders and the `short_code` unique index.
 */

export const queries = {
  /**
   * Insert a new URL mapping. Relies on UNIQUE constraint on short_code
   * for collision protection (document §6: "The database unique constraint
   * must decide the winner").
   */
  insertUrl: `
    INSERT INTO urls (short_code, original_url, status, expires_at, owner_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, short_code, original_url, status, created_at, expires_at
  `,

  /**
   * Indexed lookup by short_code for redirect resolution.
   * Returns only fields needed for redirect eligibility check and response.
   */
  findByShortCode: `
    SELECT id, short_code, original_url, status, expires_at, updated_at
    FROM urls
    WHERE short_code = $1
  `,

  /**
   * Update a link's destination URL and metadata.
   * Per document §10: lifecycle updates must be persisted before cache invalidation.
   */
  updateUrl: `
    UPDATE urls
    SET original_url = $2,
        updated_at = NOW()
    WHERE short_code = $1 AND status = 'active'
    RETURNING id, short_code, original_url, status, updated_at
  `,

  /**
   * Disable/soft-delete a link by changing its status.
   * Per document §10: "Persist the link update or disabled/deleted state in PostgreSQL."
   */
  disableUrl: `
    UPDATE urls
    SET status = $2,
        updated_at = NOW()
    WHERE short_code = $1 AND status = 'active'
    RETURNING id, short_code, status, updated_at
  `,

  /**
   * Insert an outbox event within the same transaction as the data change.
   * Per document §7 step 8 and §11.1: "Use a transactional outbox for
   * critical events that must not be lost between a database commit
   * and queue publication."
   */
  insertOutboxEvent: `
    INSERT INTO outbox (event_type, payload)
    VALUES ($1, $2)
    RETURNING id
  `,

  /**
   * Fetch unpublished outbox events for the relay to process.
   * Limited batch size to prevent overwhelming the queue.
   */
  fetchUnpublishedOutboxEvents: `
    SELECT id, event_type, payload, created_at, retries
    FROM outbox
    WHERE published_at IS NULL
    ORDER BY created_at ASC
    LIMIT $1
  `,

  /**
   * Mark an outbox event as published.
   */
  markOutboxPublished: `
    UPDATE outbox
    SET published_at = NOW()
    WHERE id = $1
  `,

  /**
   * Increment retry count for a failed outbox publish.
   */
  incrementOutboxRetry: `
    UPDATE outbox
    SET retries = retries + 1
    WHERE id = $1
  `,

  /**
   * Find expired active links for the cleanup worker.
   */
  findExpiredLinks: `
    SELECT id, short_code
    FROM urls
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    LIMIT $1
  `,

  /**
   * Batch-disable expired links.
   */
  expireLinks: `
    UPDATE urls
    SET status = 'expired',
        updated_at = NOW()
    WHERE id = ANY($1::bigint[])
    RETURNING short_code
  `,

  /**
   * List recent URLs with total click counts.
   */
  listUrls: `
    SELECT 
      u.id, 
      u.short_code, 
      u.original_url, 
      u.status, 
      u.created_at, 
      u.updated_at, 
      u.expires_at,
      COALESCE(SUM(ca.click_count), 0)::BIGINT AS click_count
    FROM urls u
    LEFT JOIN click_analytics ca ON u.short_code = ca.short_code
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT $1
  `,

  /**
   * Find a single URL with total click count.
   */
  findUrlWithAnalytics: `
    SELECT 
      u.id, 
      u.short_code, 
      u.original_url, 
      u.status, 
      u.created_at, 
      u.updated_at, 
      u.expires_at,
      COALESCE(SUM(ca.click_count), 0)::BIGINT AS click_count
    FROM urls u
    LEFT JOIN click_analytics ca ON u.short_code = ca.short_code
    WHERE u.short_code = $1
    GROUP BY u.id
  `,

  /**
   * Find daily click breakdown for a specific short code.
   */
  findDailyClicks: `
    SELECT click_date, click_count
    FROM click_analytics
    WHERE short_code = $1
    ORDER BY click_date DESC
    LIMIT 30
  `,
};
