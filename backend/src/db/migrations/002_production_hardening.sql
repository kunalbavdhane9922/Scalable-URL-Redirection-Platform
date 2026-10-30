-- Production hardening: denormalized click counters, analytics breakdown,
-- outbox claims, and indexes for dashboard queries.

-- Hot counters on the URL row so listing does not aggregate analytics.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS click_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;

-- Outbox rows are claimed atomically by the relay (SKIP LOCKED).
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Backfill the counter from existing aggregates (idempotent).
UPDATE urls u
SET click_count = COALESCE(c.total, 0)
FROM (
  SELECT short_code, SUM(click_count)::BIGINT AS total
  FROM click_analytics
  GROUP BY short_code
) AS c
WHERE u.short_code = c.short_code;

-- Referrer / device / country dimensions per link per day.
CREATE TABLE IF NOT EXISTS click_breakdown (
  id          BIGSERIAL PRIMARY KEY,
  short_code  VARCHAR(32) NOT NULL,
  click_date  DATE NOT NULL,
  dimension   VARCHAR(20) NOT NULL,
  value       VARCHAR(120) NOT NULL,
  count       BIGINT NOT NULL DEFAULT 0,
  UNIQUE (short_code, click_date, dimension, value)
);

CREATE INDEX IF NOT EXISTS idx_click_breakdown_code
  ON click_breakdown (short_code, dimension);

-- Listing and dashboard indexes.
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_urls_status_created ON urls (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_urls_click_count ON urls (click_count DESC);
CREATE INDEX IF NOT EXISTS idx_click_analytics_date ON click_analytics (click_date DESC);

-- Search by destination URL without a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_urls_original_url_trgm
  ON urls USING gin (original_url gin_trgm_ops);

-- Efficient outbox claim polling.
CREATE INDEX IF NOT EXISTS idx_outbox_claimable
  ON outbox (created_at)
  WHERE published_at IS NULL;

-- Efficient expiry cleanup.
CREATE INDEX IF NOT EXISTS idx_urls_expires_active
  ON urls (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;
