import fp from 'fastify-plugin';
import client from 'prom-client';
import config from '../config.js';
import { l1Stats } from '../cache/lru-cache.js';

/**
 * Prometheus observability.
 *
 * Metrics are module-level singletons so that building the server several
 * times (tests, hot reload) never double-registers a metric.
 */

export const register = new client.Registry();
register.setDefaultLabels({ service: 'url-shortener-api' });

let defaultMetricsCollected = false;
if (!defaultMetricsCollected) {
  client.collectDefaultMetrics({ register, prefix: 'urlshortener_' });
  defaultMetricsCollected = true;
}

const LATENCY_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export const httpDuration = new client.Histogram({
  name: 'urlshortener_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: LATENCY_BUCKETS,
  registers: [register],
});

export const httpRequests = new client.Counter({
  name: 'urlshortener_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const cacheEvents = new client.Counter({
  name: 'urlshortener_cache_events_total',
  help: 'Cache lookups by layer and result',
  labelNames: ['layer', 'result'],
  registers: [register],
});

export const clickEvents = new client.Counter({
  name: 'urlshortener_click_events_total',
  help: 'Click events accepted into the async pipeline',
  labelNames: ['result'],
  registers: [register],
});

export const rateLimitHits = new client.Counter({
  name: 'urlshortener_rate_limit_hits_total',
  help: 'Requests rejected by rate limiting',
  registers: [register],
});

export const dbErrors = new client.Counter({
  name: 'urlshortener_db_errors_total',
  help: 'Database errors observed by the API',
  labelNames: ['operation'],
  registers: [register],
});

export const circuitState = new client.Gauge({
  name: 'urlshortener_db_circuit_open',
  help: '1 when the database circuit breaker is open',
  registers: [register],
});

export const pgPoolGauge = new client.Gauge({
  name: 'urlshortener_pg_pool_connections',
  help: 'PostgreSQL pool connections by state',
  labelNames: ['state'],
  registers: [register],
});

export const l1Gauge = new client.Gauge({
  name: 'urlshortener_l1_cache_entries',
  help: 'In-process L1 cache entries by kind',
  labelNames: ['kind'],
  registers: [register],
});

export function recordCacheEvent(layer, result) {
  cacheEvents.inc({ layer, result });
}

export function recordClickEvents(result, count = 1) {
  clickEvents.inc({ result }, count);
}

export function recordRateLimitHit() {
  rateLimitHits.inc();
}

export function recordDbError(operation) {
  dbErrors.inc({ operation });
}

async function metricsPlugin(fastify) {
  fastify.decorate('metrics', { register });

  fastify.addHook('onRequest', async (request) => {
    request.metricsStart = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (!request.metricsStart) return;
    const route = request.routeOptions?.url || request.routerPath || 'unmatched';
    const seconds = Number(process.hrtime.bigint() - request.metricsStart) / 1e9;
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    httpDuration.observe(labels, seconds);
    httpRequests.inc(labels);
  });

  // Periodically publish pool / cache gauges. unref() keeps tests from hanging.
  const timer = setInterval(() => {
    try {
      const pool = fastify.pg;
      if (pool) {
        pgPoolGauge.set({ state: 'total' }, pool.totalCount || 0);
        pgPoolGauge.set({ state: 'idle' }, pool.idleCount || 0);
        pgPoolGauge.set({ state: 'waiting' }, pool.waitingCount || 0);
      }
      const cache = l1Stats();
      l1Gauge.set({ kind: 'positive' }, cache.positive.size);
      l1Gauge.set({ kind: 'negative' }, cache.negative.size);
      l1Gauge.set({ kind: 'gone' }, cache.gone.size);
    } catch {
      // Metrics must never crash the server.
    }
  }, 5000);
  timer.unref?.();

  fastify.addHook('onClose', async () => {
    clearInterval(timer);
  });
}

/**
 * Serve Prometheus exposition. Protected unless METRICS_PUBLIC=true or the
 * caller presents the configured METRICS_TOKEN (header or bearer token).
 * Nginx additionally blocks /metrics on public hostnames.
 */
export async function metricsRoute(fastify) {
  fastify.get('/metrics', { config: { rateLimit: false } }, async (request, reply) => {
    if (!config.metricsPublic) {
      const headerToken = request.headers['x-metrics-token'];
      const bearer = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const supplied = headerToken || bearer;
      if (!config.metricsToken || supplied !== config.metricsToken) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' });
      }
    }

    reply.type(register.contentType);
    return register.metrics();
  });
}

export default fp(metricsPlugin, { name: 'metrics' });
