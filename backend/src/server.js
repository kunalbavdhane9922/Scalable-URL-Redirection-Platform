import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import config from './config.js';

import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import metricsPlugin, { metricsRoute } from './plugins/metrics.js';

import { setupInvalidationListener } from './cache/invalidation.js';
import { closeClickBuffer } from './services/queue-service.js';

import healthRoutes from './routes/health.js';
import shortenRoutes from './routes/shorten.js';
import linksRoutes from './routes/links.js';
import redirectRoutes from './routes/redirect.js';
import authRoutes from './routes/auth.js';

import { AppError } from './utils/errors.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

function resolveRequestId(request) {
  const incoming = request.headers['x-request-id'];
  if (typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)) return incoming;
  return randomUUID();
}

function buildCorsOrigin() {
  if (!config.isProduction) return true;
  const allowed = config.cors.origins.length > 0
    ? config.cors.origins
    : [config.appUrl, config.baseUrl];
  return (origin, callback) => {
    // Same-origin requests and server-to-server calls have no Origin header.
    if (!origin) return callback(null, true);
    // Answer without CORS headers instead of throwing: the browser blocks the
    // response, and the auth hook rejects unsafe methods with a clean 403.
    return callback(null, allowed.includes(origin));
  };
}

async function buildServer(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
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
          return { statusCode: reply.statusCode };
        },
      },
    },
    genReqId: resolveRequestId,
    requestIdHeader: 'x-request-id',
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
    routerOptions: { maxParamLength: 64 },
    connectionTimeout: 10000,
    keepAliveTimeout: 72000,
    requestTimeout: 15000,
    logController: new Fastify.LogController({
      requestIdLogLabel: 'reqId',
      disableRequestLogging: config.isProduction,
    }),
    ...opts.fastifyOptions,
  });

  // ─── Security & CORS ─────────────────────────────────────────────
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await fastify.register(cors, {
    origin: buildCorsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id', 'X-Metrics-Token'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 86400,
  });

  // ─── Observability & load shedding ───────────────────────────────
  await fastify.register(metricsPlugin);

  if (!opts.skipUnderPressure) {
    await fastify.register(underPressure, {
      maxEventLoopDelay: 2000,
      maxMemoryUsed: 1.5 * 1024 * 1024 * 1024,
      maxEventLoopUtilization: 0.99,
      retryAfter: 2,
      message: 'Service under heavy load, please retry shortly',
      exposeStatusRoute: false,
    });
  }

  // ─── Infrastructure ─────────────────────────────────────────────
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

  await fastify.register(authPlugin);

  if (!opts.skipRateLimit) {
    await fastify.register(rateLimitPlugin);
  }

  // ─── Cache invalidation subscriber ──────────────────────────────
  fastify.addHook('onReady', async () => {
    if (fastify.redisSub && typeof fastify.redisSub.subscribe === 'function') {
      setupInvalidationListener(fastify.redisSub, fastify.log);
    }
  });

  // ─── Response request ID ────────────────────────────────────────
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });

  // ─── Error handling ─────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      if (error.statusCode === 503) {
        reply.header('Retry-After', '2');
      }
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message,
        requestId,
      });
    }

    if (error.validation) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
      });
    }

    if (error.statusCode === 429) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({
        statusCode: 429,
        error: 'RATE_LIMIT_EXCEEDED',
        message: error.message,
        requestId,
      });
    }

    if (error.statusCode === 503) {
      reply.header('Retry-After', '2');
      return reply.code(503).send({
        statusCode: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: error.message || 'Service temporarily unavailable',
        requestId,
      });
    }

    request.log.error({ err: error, reqId: requestId }, 'Unhandled error');
    return reply.code(500).send({
      statusCode: 500,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Route not found',
      requestId: request.id,
    });
  });

  // ─── Routes ─────────────────────────────────────────────────────
  fastify.get('/', { config: { rateLimit: false } }, async (request, reply) => {
    return reply.send({
      service: 'Scalable URL Redirection Platform',
      status: 'ok',
      docs: '/health',
      version: 2,
    });
  });

  await fastify.register(healthRoutes);
  await fastify.register(metricsRoute);
  await fastify.register(authRoutes);
  await fastify.register(shortenRoutes);
  await fastify.register(linksRoutes);

  // Redirect catch-all must be registered last.
  await fastify.register(redirectRoutes);

  // Flush buffered analytics before the Redis client is closed.
  fastify.addHook('onClose', async () => {
    await closeClickBuffer(fastify.redis, fastify.log);
  });

  return fastify;
}

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

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.log.info({ signal }, 'Graceful shutdown initiated');

    const forceExit = setTimeout(() => {
      server.log.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);
    forceExit.unref?.();

    try {
      await server.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      server.log.error({ err: err.message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    server.log.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    server.log.fatal({ err: err.message }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start();
}

export { buildServer };
