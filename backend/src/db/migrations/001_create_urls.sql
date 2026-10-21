-- URL mapping table (document §5.1)
-- Per §5.2: "Create a UNIQUE constraint or unique index on short_code."

CREATE TABLE IF NOT EXISTS urls (
  id            BIGSERIAL     PRIMARY KEY,
  short_code    VARCHAR(20)   NOT NULL,
  original_url  TEXT          NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  owner_id      VARCHAR(255)
);

-- Unique index on short_code for collision protection and fast indexed lookups.
-- Per §5.2: "A redirect cache miss should execute an indexed lookup, not a table scan."
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_short_code ON urls (short_code);

-- Index for expiry cleanup worker
CREATE INDEX IF NOT EXISTS idx_urls_expires_at ON urls (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

-- Transactional outbox for critical events (document §7 step 8, §10 step 5, §11.1)
-- "Write an outbox record in the same database transaction and publish it
--  asynchronously from an outbox relay."
CREATE TABLE IF NOT EXISTS outbox (
  id            BIGSERIAL     PRIMARY KEY,
  event_type    VARCHAR(100)  NOT NULL,
  payload       JSONB         NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  retries       INT           NOT NULL DEFAULT 0
);

-- Index to efficiently poll unpublished outbox events
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON outbox (created_at)
  WHERE published_at IS NULL;

-- Click analytics table for the analytics worker (document Table 7)
-- Aggregates click counts by short_code and date.
CREATE TABLE IF NOT EXISTS click_analytics (
  id            BIGSERIAL     PRIMARY KEY,
  short_code    VARCHAR(20)   NOT NULL,
  click_date    DATE          NOT NULL,
  click_count   BIGINT        NOT NULL DEFAULT 0,
  UNIQUE (short_code, click_date)
);

CREATE INDEX IF NOT EXISTS idx_click_analytics_code ON click_analytics (short_code);
