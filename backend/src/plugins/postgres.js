import fp from 'fastify-plugin';
import pg from 'pg';
import config from '../config.js';

/**
 * PostgreSQL connection pool plugin.
 *
 * Per document §5.2:
 *  - "Use a properly sized connection pool and reuse connections
 *     instead of opening a new connection per request."
 *  - Pool sizing should be tuned based on instance count and load testing.
 *
 * Per document §9.3:
 *  - "Reuse pooled connections; never create a new database connection per redirect."
 *  - "Watch query rate, query latency, pool wait time, pool saturation."
 */
async function postgresPlugin(fastify) {
  const pool = new pg.Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    min: config.pg.min,
    max: config.pg.max,
    idleTimeoutMillis: config.pg.idleTimeoutMillis,
    connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
  });

  // Monitor pool errors — do not let unhandled pool errors crash the process
  pool.on('error', (err) => {
    fastify.log.error({ err }, 'PostgreSQL pool background error');
  });

  // Decorate fastify with the pool for use in routes/services
  fastify.decorate('pg', pool);

  // Graceful shutdown: drain pool connections
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing PostgreSQL connection pool');
    await pool.end();
  });
}

export default fp(postgresPlugin, {
  name: 'postgres',
});
