import 'dotenv/config';

/**
 * Centralized configuration derived from environment variables.
 *
 * Development defaults are safe to run locally. Production requires an
 * explicit ADMIN_API_KEY and strong database/Redis credentials — the process
 * refuses to start otherwise (fail fast beats a silent insecure deploy).
 */

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

const config = {
  env,
  isProduction,
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  /** Public origin used to build short links, e.g. https://go.example.com */
  baseUrl: stripTrailingSlash(process.env.BASE_URL || 'http://localhost:3000'),
  /** Browser app origin, used for CORS and redirects back to the dashboard. */
  appUrl: stripTrailingSlash(process.env.APP_URL || process.env.BASE_URL || 'http://localhost:5173'),

  trustProxy: toBool(process.env.TRUST_PROXY, true),
  bodyLimitBytes: toInt(process.env.BODY_LIMIT_BYTES, 16 * 1024),
  logLevel: process.env.LOG_LEVEL || 'info',
  logPretty: toBool(process.env.LOG_PRETTY, false),

  adminApiKey: process.env.ADMIN_API_KEY || (isProduction ? '' : 'dev-admin-key'),
  metricsToken: process.env.METRICS_TOKEN || '',
  metricsPublic: toBool(process.env.METRICS_PUBLIC, false),

  cors: {
    /** Empty list = reflect origin in development, lock to appUrl/baseUrl in production. */
    origins: toList(process.env.CORS_ORIGINS),
  },

  pg: {
    host: process.env.PGHOST || 'localhost',
    port: toInt(process.env.PGPORT, 5432),
    user: process.env.PGUSER || 'urlshortener',
    password: process.env.PGPASSWORD || 'changeme_pg_password',
    database: process.env.PGDATABASE || 'urlshortener',
    min: toInt(process.env.PG_POOL_MIN, 2),
    max: toInt(process.env.PG_POOL_MAX, 20),
    idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toInt(process.env.PG_CONNECTION_TIMEOUT_MS, 5000),
    statementTimeoutMs: toInt(process.env.PG_STATEMENT_TIMEOUT_MS, 5000),
    queryTimeoutMs: toInt(process.env.PG_QUERY_TIMEOUT_MS, 4000),
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toInt(process.env.REDIS_DB, 0),
    connectTimeout: toInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 5000),
    commandTimeout: toInt(process.env.REDIS_COMMAND_TIMEOUT_MS, 1000),
    maxmemoryHintMb: toInt(process.env.REDIS_MAXMEMORY_HINT_MB, 256),
  },

  l1Cache: {
    maxEntries: toInt(process.env.L1_MAX_ENTRIES, 20000),
    defaultTtlMs: toInt(process.env.L1_DEFAULT_TTL_MS, 60000),
    negativeTtlMs: toInt(process.env.L1_NEGATIVE_TTL_MS, 30000),
    negativeMaxEntries: toInt(process.env.L1_NEGATIVE_MAX_ENTRIES, 10000),
  },

  l2Cache: {
    defaultTtlSeconds: toInt(process.env.L2_DEFAULT_TTL_SECONDS, 3600),
    negativeTtlSeconds: toInt(process.env.L2_NEGATIVE_TTL_SECONDS, 60),
    ttlJitterPercent: toInt(process.env.L2_TTL_JITTER_PERCENT, 10),
  },

  shortCode: {
    length: toInt(process.env.SHORT_CODE_LENGTH, 7),
    maxRetries: toInt(process.env.SHORT_CODE_MAX_RETRIES, 5),
    aliasMinLength: toInt(process.env.ALIAS_MIN_LENGTH, 3),
    aliasMaxLength: toInt(process.env.ALIAS_MAX_LENGTH, 32),
  },

  rateLimit: {
    shorten: {
      max: toInt(process.env.RATE_LIMIT_SHORTEN_MAX, 20),
      timeWindow: toInt(process.env.RATE_LIMIT_SHORTEN_WINDOW_MS, 60000),
    },
    redirect: {
      max: toInt(process.env.RATE_LIMIT_REDIRECT_MAX, 1200),
      timeWindow: toInt(process.env.RATE_LIMIT_REDIRECT_WINDOW_MS, 60000),
    },
    manage: {
      max: toInt(process.env.RATE_LIMIT_MANAGE_MAX, 240),
      timeWindow: toInt(process.env.RATE_LIMIT_MANAGE_WINDOW_MS, 60000),
    },
    auth: {
      max: toInt(process.env.RATE_LIMIT_AUTH_MAX, 20),
      timeWindow: toInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 300000),
    },
  },

  auth: {
    sessionCookieName: process.env.SESSION_COOKIE_NAME || 'shortly_session',
    sessionTtlDays: toInt(process.env.SESSION_TTL_DAYS, 30),
    // Used to sign the short-lived OAuth state cookie.
    sessionSecret: process.env.SESSION_SECRET || (isProduction ? '' : 'dev-session-secret-not-for-production'),
    devLogin: toBool(process.env.AUTH_DEV_LOGIN, !isProduction),
    requireEmailVerification: toBool(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION, false),
    passwordMinLength: toInt(process.env.PASSWORD_MIN_LENGTH, 10),
    callbackBase: stripTrailingSlash(
      process.env.OAUTH_CALLBACK_BASE
        || process.env.BASE_URL
        || 'http://localhost:3000',
    ),
    providers: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      },
    },
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Shortly <no-reply@localhost>',
  },

  validation: {
    maxUrlLength: toInt(process.env.MAX_URL_LENGTH, 2048),
    allowedSchemes: toList(process.env.ALLOWED_SCHEMES || 'http,https'),
  },

  queue: {
    streamKey: process.env.QUEUE_STREAM_KEY || 'url_shortener:events',
    deadLetterKey: process.env.QUEUE_DEAD_LETTER_KEY || 'url_shortener:events:dead',
    consumerGroup: process.env.QUEUE_CONSUMER_GROUP || 'workers',
    consumerName: process.env.QUEUE_CONSUMER_NAME || `worker-${process.pid}`,
    batchSize: toInt(process.env.QUEUE_BATCH_SIZE, 100),
    blockMs: toInt(process.env.QUEUE_BLOCK_MS, 5000),
    maxRetries: toInt(process.env.QUEUE_MAX_RETRIES, 3),
    claimIdleMs: toInt(process.env.QUEUE_CLAIM_IDLE_MS, 60000),
  },

  clickBuffer: {
    maxBatch: toInt(process.env.CLICK_BUFFER_MAX_BATCH, 250),
    flushIntervalMs: toInt(process.env.CLICK_BUFFER_FLUSH_MS, 100),
  },

  /** Fail fast on insecure production configuration. */
  validate() {
    if (!isProduction) return;

    const problems = [];
    if (!config.adminApiKey || config.adminApiKey.length < 24) {
      problems.push('ADMIN_API_KEY must be at least 24 characters');
    }
    if (/changeme|dev-admin-key/i.test(config.adminApiKey)) {
      problems.push('ADMIN_API_KEY still uses a development placeholder');
    }
    if (/changeme/i.test(config.pg.password) || config.pg.password.length < 12) {
      problems.push('PGPASSWORD must be a strong, non-placeholder secret');
    }
    if (config.redis.password && config.redis.password.length < 12) {
      problems.push('REDIS_PASSWORD must be at least 12 characters when set');
    }
    // Public origins must be HTTPS. Loopback HTTP is allowed so the compose
    // stack can be exercised locally without a certificate.
    const isLoopbackHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(config.baseUrl);
    if (!config.baseUrl.startsWith('https://') && !isLoopbackHttp) {
      problems.push('BASE_URL must use https:// in production (http:// is only allowed for localhost)');
    }
    if (config.auth.devLogin) {
      problems.push('AUTH_DEV_LOGIN must be disabled in production');
    }
    if (!config.auth.sessionSecret || config.auth.sessionSecret.length < 32
      || /dev-session-secret/i.test(config.auth.sessionSecret)) {
      problems.push('SESSION_SECRET must be a random string of at least 32 characters');
    }
    if (config.auth.requireEmailVerification && !config.mail.host) {
      problems.push('SMTP_HOST is required when AUTH_REQUIRE_EMAIL_VERIFICATION=true');
    }
    for (const [name, provider] of Object.entries(config.auth.providers)) {
      const hasId = Boolean(provider.clientId);
      const hasSecret = Boolean(provider.clientSecret);
      if (hasId !== hasSecret) {
        problems.push(`${name.toUpperCase()} OAuth requires both client ID and client secret`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`Insecure production configuration:\n - ${problems.join('\n - ')}`);
    }
  },
};

config.validate();

export default config;
