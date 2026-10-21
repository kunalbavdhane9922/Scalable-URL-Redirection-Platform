import 'dotenv/config';

/**
 * Centralized configuration derived from environment variables.
 * All defaults are development-safe; production deployments must
 * override secrets and tune pool/cache sizes via environment.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  pg: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || 'urlshortener',
    password: process.env.PGPASSWORD || 'changeme_pg_password',
    database: process.env.PGDATABASE || 'urlshortener',
    min: parseInt(process.env.PG_POOL_MIN, 10) || 2,
    max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10) || 5000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 5000,
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS, 10) || 2000,
  },

  l1Cache: {
    maxEntries: parseInt(process.env.L1_MAX_ENTRIES, 10) || 10000,
    defaultTtlMs: parseInt(process.env.L1_DEFAULT_TTL_MS, 10) || 60000,
    negativeTtlMs: parseInt(process.env.L1_NEGATIVE_TTL_MS, 10) || 30000,
    negativeMaxEntries: parseInt(process.env.L1_NEGATIVE_MAX_ENTRIES, 10) || 5000,
  },

  l2Cache: {
    defaultTtlSeconds: parseInt(process.env.L2_DEFAULT_TTL_SECONDS, 10) || 3600,
    negativeTtlSeconds: parseInt(process.env.L2_NEGATIVE_TTL_SECONDS, 10) || 60,
    ttlJitterPercent: parseInt(process.env.L2_TTL_JITTER_PERCENT, 10) || 10,
  },

  shortCode: {
    length: parseInt(process.env.SHORT_CODE_LENGTH, 10) || 7,
    maxRetries: parseInt(process.env.SHORT_CODE_MAX_RETRIES, 10) || 5,
  },

  rateLimit: {
    shorten: {
      max: parseInt(process.env.RATE_LIMIT_SHORTEN_MAX, 10) || 10,
      timeWindow: parseInt(process.env.RATE_LIMIT_SHORTEN_WINDOW_MS, 10) || 60000,
    },
    redirect: {
      max: parseInt(process.env.RATE_LIMIT_REDIRECT_MAX, 10) || 100,
      timeWindow: parseInt(process.env.RATE_LIMIT_REDIRECT_WINDOW_MS, 10) || 60000,
    },
  },

  validation: {
    maxUrlLength: parseInt(process.env.MAX_URL_LENGTH, 10) || 2048,
    allowedSchemes: (process.env.ALLOWED_SCHEMES || 'http,https').split(',').map(s => s.trim()),
  },

  queue: {
    streamKey: process.env.QUEUE_STREAM_KEY || 'url_shortener:events',
    consumerGroup: process.env.QUEUE_CONSUMER_GROUP || 'workers',
    consumerName: process.env.QUEUE_CONSUMER_NAME || `worker-${process.pid}`,
    batchSize: parseInt(process.env.QUEUE_BATCH_SIZE, 10) || 10,
    blockMs: parseInt(process.env.QUEUE_BLOCK_MS, 10) || 5000,
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES, 10) || 3,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

export default config;
