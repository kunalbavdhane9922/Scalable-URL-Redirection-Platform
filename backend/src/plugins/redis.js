import fp from 'fastify-plugin';
import Redis from 'ioredis';
import config from '../config.js';

/**
 * Redis command client + dedicated Pub/Sub subscriber.
 *
 * Auto-pipelining batches concurrent cache reads/writes into fewer round
 * trips under load. The subscriber connection cannot pipeline.
 */
async function redisPlugin(fastify) {
  const baseOptions = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    connectTimeout: config.redis.connectTimeout,
    commandTimeout: config.redis.commandTimeout,
    maxRetriesPerRequest: 2,
    keepAlive: 10000,
    noDelay: true,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
    enableReadyCheck: true,
  };

  const redis = new Redis({ ...baseOptions, enableAutoPipelining: true });
  const redisSub = new Redis(baseOptions);

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

  redis.on('reconnecting', () => {
    fastify.log.warn('Redis command client reconnecting');
  });

  redisSub.on('ready', () => {
    fastify.log.info('Redis subscriber client connected');
  });

  redisSub.on('error', (err) => {
    fastify.log.error({ err: err.message }, 'Redis subscriber client error');
  });

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

  fastify.decorate('redis', redis);
  fastify.decorate('redisSub', redisSub);
  fastify.decorate('isRedisAvailable', () => redisAvailable);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connections');
    await redisSub.quit().catch(() => {});
    await redis.quit().catch(() => {});
  });
}

export default fp(redisPlugin, { name: 'redis' });
