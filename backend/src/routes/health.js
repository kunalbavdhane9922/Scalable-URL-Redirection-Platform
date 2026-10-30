import { getCacheStats } from '../services/cache-service.js';

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      timer.unref?.();
    }),
  ]);
}

async function checkDependencies(fastify) {
  const checks = { database: 'unknown', redis: 'unknown' };

  try {
    await withTimeout(fastify.pg.query('SELECT 1'), 1500);
    checks.database = 'healthy';
  } catch {
    checks.database = 'unhealthy';
  }

  try {
    if (fastify.isRedisAvailable()) {
      await withTimeout(fastify.redis.ping(), 500);
      checks.redis = 'healthy';
    } else {
      checks.redis = 'degraded';
    }
  } catch {
    checks.redis = 'unhealthy';
  }

  return checks;
}

/**
 * Health endpoints.
 *  - /health/live  → process liveness (never touches dependencies)
 *  - /health/ready → readiness for load balancers (DB required, Redis optional)
 *  - /health       → human/UI friendly combined view
 */
export default async function healthRoutes(fastify) {
  fastify.get('/health/live', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    return reply.send({ status: 'alive', uptime: process.uptime() });
  });

  fastify.get('/health/ready', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const checks = await checkDependencies(fastify);
    const healthy = checks.database === 'healthy';
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  fastify.get('/health', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const checks = await checkDependencies(fastify);
    const healthy = checks.database === 'healthy';
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  /**
   * Process-local diagnostics (not globally aggregated).
   */
  fastify.get('/health/metrics', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const pgPool = fastify.pg;
    return reply.send({
      cache: getCacheStats(),
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
