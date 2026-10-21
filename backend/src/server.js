import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import config from './config.js';

// Plugins
import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';
import rateLimitPlugin from './plugins/rate-limit.js';

// Cache invalidation listener
import { setupInvalidationListener } from './cache/invalidation.js';

// Routes
import healthRoutes from './routes/health.js';
import shortenRoutes from './routes/shorten.js';
import linksRoutes from './routes/links.js';
import uiRoutes from './routes/ui.js';
import redirectRoutes from './routes/redirect.js';

// Error types
import { AppError } from './utils/errors.js';

/**
 * Fastify application server.
 *
 * Per document §4 (Table 4):
 *  - "Low-overhead routing, schema validation support, and configurable
 *     structured logging."
 *
 * Per document §14:
 *  - "Use structured logging and aggregate metrics."
 *  - "Avoid verbose logging for every successful redirect."
 *
 * Per document §16:
 *  - "Keep app instances stateless; local L1 cache is disposable."
 */

async function buildServer(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : {
      level: config.logLevel,
      // Structured logging via pino (built into Fastify)
      // Per §14: structured logs, not verbose per-request logging on success path
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
        res(reply) {
          return {
            statusCode: reply.statusCode,
          };
        },
      },
    },
    // Trust proxy (NGINX sits in front per architecture)
    trustProxy: true,
    // Request timeout
    connectionTimeout: 10000,
    // Disable verbose request logging in production
    disableRequestLogging: config.env === 'production',
    ...opts.fastifyOptions,
  });

  // ─── Security headers ───────────────────────────────────────────
  // Per §13: "Use HTTPS and secure secret/configuration handling."
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API server, not serving HTML
  });

  // ─── CORS ───────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.env === 'production'
      ? config.baseUrl
      : true, // Allow all origins in development
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  // ─── Infrastructure plugins ─────────────────────────────────────
  if (opts.pg) {
    fastify.decorate('pg', opts.pg);
  } else {
    await fastify.register(postgresPlugin);
  }

  if (opts.redis) {
    fastify.decorate('redis', opts.redis);
    fastify.decorate('redisSub', opts.redisSub || opts.redis);
    fastify.decorate('isRedisAvailable', opts.isRedisAvailable || (() => true));
  } else {
    await fastify.register(redisPlugin);
  }

  if (!opts.skipRateLimit) {
    await fastify.register(rateLimitPlugin);
  }

  // ─── Cache invalidation subscriber ──────────────────────────────
  // Per §10 step 3: "Publish an invalidation message through Redis Pub/Sub
  // so application instances can evict their local L1 entry."
  fastify.addHook('onReady', async () => {
    if (fastify.redisSub && typeof fastify.redisSub.subscribe === 'function') {
      setupInvalidationListener(fastify.redisSub, fastify.log);
    }
  });

  // ─── Global error handler ──────────────────────────────────────
  // Per §13: "Avoid exposing internal database errors or stack traces to clients."
  fastify.setErrorHandler((error, request, reply) => {
    // Handle known application errors
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message,
      });
    }

    // Handle Fastify validation errors
    if (error.validation) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: error.message,
      });
    }

    // Handle rate limit errors from @fastify/rate-limit
    if (error.statusCode === 429) {
      return reply.code(429).send({
        statusCode: 429,
        error: 'RATE_LIMIT_EXCEEDED',
        message: error.message,
      });
    }

    // Unknown/internal errors — log but do not expose details
    fastify.log.error({ err: error }, 'Unhandled error');

    return reply.code(500).send({
      statusCode: 500,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  // ─── Routes ─────────────────────────────────────────────────────
  // Health check routes first (no auth required, exempt from rate limiting)
  await fastify.register(healthRoutes);

  // API routes
  await fastify.register(shortenRoutes);
  await fastify.register(linksRoutes);

  // UI routes for serving the frontend dashboard
  await fastify.register(uiRoutes);

  // Redirect route MUST be registered last because /:code is a catch-all param.
  // Per §9.2: "Keep the redirect handler minimal"
  await fastify.register(redirectRoutes);

  return fastify;
}

// ─── Start server ─────────────────────────────────────────────────────

async function start() {
  let server;
  try {
    server = await buildServer();
    await server.listen({ port: config.port, host: config.host });
    server.log.info({ port: config.port, env: config.env }, 'Server started');
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  // ─── Graceful shutdown ────────────────────────────────────────────
  const shutdown = async (signal) => {
    server.log.info({ signal }, 'Graceful shutdown initiated');
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only auto-start when run directly from CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start();
}

export { buildServer };
