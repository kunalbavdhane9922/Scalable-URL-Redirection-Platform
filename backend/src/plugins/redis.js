import fp from 'fastify-plugin';
import Redis from 'ioredis';
import config from '../config.js';

/**
 * Redis plugin — provides both a command client and a dedicated
 * subscriber connection for Pub/Sub cache invalidation.
 *
 * Per document §9.1:
 *  - "L2 is shared Redis."
 *  - "Pub/Sub messages are not durable" — bounded TTLs are the fallback.
 *
 * Per document §12 (Table 8):
 *  - "Redis unavailable → Fall back to PostgreSQL where safe; use circuit
 *     breaking, timeouts, and controlled concurrency to protect the database."
 */
async function redisPlugin(fastify) {
  const redisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    connectTimeout: config.redis.connectTimeout,
    commandTimeout: config.redis.commandTimeout,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      // Exponential backoff, cap at 3 seconds
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
    lazyConnect: true,
    enableReadyCheck: true,
  };

  // Primary command client
  const redis = new Redis(redisOptions);

  // Dedicated subscriber for Pub/Sub invalidation (§10 step 3)
  // A separate connection is required because a subscribed connection
  // cannot issue regular commands.
  const redisSub = new Redis(redisOptions);

  let redisAvailable = false;

  redis.on('ready', () => {
    redisAvailable = true;
    fastify.log.info('Redis command client connected');
  });

  redis.on('error', (err) => {
    redisAvailable = false;
    fastify.log.error({ err: err.message }, 'Redis command client error');
  });

  redis.on('close', () => {
    redisAvailable = false;
  });

  redisSub.on('ready', () => {
    fastify.log.info('Redis subscriber client connected');
  });

  redisSub.on('error', (err) => {
    fastify.log.error({ err: err.message }, 'Redis subscriber client error');
  });

  // Connect both clients
  try {
    await redis.connect();
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Redis command client failed to connect on startup — will retry');
  }

  try {
    await redisSub.connect();
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Redis subscriber client failed to connect on startup — will retry');
  }

  // Expose availability check for fallback logic
  fastify.decorate('redis', redis);
  fastify.decorate('redisSub', redisSub);
  fastify.decorate('isRedisAvailable', () => redisAvailable);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connections');
    await redisSub.quit().catch(() => {});
    await redis.quit().catch(() => {});
  });
}

export default fp(redisPlugin, {
  name: 'redis',
});
