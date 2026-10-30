-- Accounts, social sign-in, sessions, and link ownership.

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL    PRIMARY KEY,
  email          TEXT         NOT NULL,
  email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
  name           TEXT,
  avatar_url     TEXT,
  password_hash  TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

-- Emails are stored normalised (lowercase, trimmed) by the application.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id               BIGSERIAL   PRIMARY KEY,
  provider         VARCHAR(32) NOT NULL,
  provider_user_id TEXT        NOT NULL,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts (user_id);

-- Opaque session tokens; only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGSERIAL   PRIMARY KEY,
  token_hash   TEXT        NOT NULL UNIQUE,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           INET,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- Single-use tokens for email verification and password reset.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(24) NOT NULL,
  token_hash TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_kind ON auth_tokens (user_id, kind);

-- Ownership. Existing rows stay NULL (anonymous); legacy owner_id is unused.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_urls_user_created
  ON urls (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- User-scoped dashboard aggregates.
CREATE INDEX IF NOT EXISTS idx_urls_user_status ON urls (user_id, status);
