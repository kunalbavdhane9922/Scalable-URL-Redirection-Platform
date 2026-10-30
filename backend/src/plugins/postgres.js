import fp from 'fastify-plugin';
import pg from 'pg';
import config from '../config.js';

/**
 * PostgreSQL connection pool with bounded query timeouts.
 *
 * `statement_timeout` guarantees a runaway query cannot pin a connection,
 * and `query_timeout` rejects on the client side if the server never responds.
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
    query_timeout: config.pg.queryTimeoutMs,
    statement_timeout: config.pg.statementTimeoutMs,
    application_name: 'url-shortener-api',
    options: `-c idle_in_transaction_session_timeout=${config.pg.statementTimeoutMs * 2}`,
  });

  pool.on('error', (err) => {
    fastify.log.error({ err: err.message }, 'PostgreSQL pool background error');
  });

  fastify.decorate('pg', pool);

  fastify.addHook('onReady', async () => {
    try {
      await pool.query('SELECT 1');
      fastify.log.info({ max: config.pg.max }, 'PostgreSQL pool ready');
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PostgreSQL not reachable at startup');
    }
  });

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing PostgreSQL connection pool');
    await pool.end().catch(() => {});
  });
}

export default fp(postgresPlugin, { name: 'postgres' });
