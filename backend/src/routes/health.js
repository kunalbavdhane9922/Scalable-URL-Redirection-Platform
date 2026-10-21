import { getCacheStats } from '../services/cache-service.js';

/**
 * GET /health — Liveness/readiness check
 *
 * Per document Appendix A:
 *  - "Liveness/readiness check."
 *  - "Health status without exposing sensitive internals."
 *
 * Per document §9.5:
 *  - "Use health checks and remove unhealthy instances from rotation."
 */
export default async function healthRoutes(fastify) {
  fastify.get('/health', {
    config: {
      // Exempt health checks from rate limiting
      rateLimit: false,
    },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'string' },
                redis: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const checks = {
      database: 'unknown',
      redis: 'unknown',
    };

    // Check PostgreSQL connectivity
    try {
      await fastify.pg.query('SELECT 1');
      checks.database = 'healthy';
    } catch {
      checks.database = 'unhealthy';
    }

    // Check Redis connectivity
    try {
      if (fastify.isRedisAvailable()) {
        await fastify.redis.ping();
        checks.redis = 'healthy';
      } else {
        checks.redis = 'degraded';
      }
    } catch {
      checks.redis = 'unhealthy';
    }

    // Overall status: healthy if DB is up (Redis degraded is acceptable per §12)
    const isHealthy = checks.database === 'healthy';
    const status = isHealthy ? 'healthy' : 'unhealthy';

    const responseCode = isHealthy ? 200 : 503;

    return reply.code(responseCode).send({
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  /**
   * Internal metrics endpoint for observability (§14).
   * Not exposed externally via NGINX.
   */
  fastify.get('/health/metrics', {
    config: {
      rateLimit: false,
    },
  }, async (request, reply) => {
    const cacheStats = getCacheStats();

    const pgPool = fastify.pg;

    return reply.send({
      cache: cacheStats,
      pgPool: {
        totalCount: pgPool.totalCount,
        idleCount: pgPool.idleCount,
        waitingCount: pgPool.waitingCount,
      },
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
    });
  });
}
