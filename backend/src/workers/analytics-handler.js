import { queries } from '../db/queries.js';

/**
 * Click analytics aggregation.
 *
 * Events are grouped in memory per (short_code, day) and written with three
 * set-based statements per batch. That turns N click events into 3 queries
 * instead of N, which is what keeps the worker viable at high redirect volume.
 */

function dayOf(clickedAt) {
  const date = clickedAt ? new Date(clickedAt) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function buildAggregates(events) {
  const totals = new Map(); // `${code}|${day}` -> [code, day, count]
  const breakdown = new Map(); // `${code}|${day}|dim|value` -> row
  const perUrl = new Map();

  for (const event of events) {
    const shortCode = event.shortCode;
    if (!shortCode) continue;

    const day = dayOf(event.clickedAt);
    const totalKey = `${shortCode}|${day}`;
    const total = totals.get(totalKey);
    if (total) total[2] += 1;
    else totals.set(totalKey, [shortCode, day, 1]);

    const dimensions = [
      ['referrer', event.referrer || 'direct'],
      ['device', event.device || 'unknown'],
    ];
    if (event.country) dimensions.push(['country', event.country]);

    for (const [dimension, value] of dimensions) {
      const key = `${shortCode}|${day}|${dimension}|${value}`;
      const row = breakdown.get(key);
      if (row) row[4] += 1;
      else breakdown.set(key, [shortCode, day, dimension, String(value).slice(0, 120), 1]);
    }

    perUrl.set(shortCode, (perUrl.get(shortCode) || 0) + 1);
  }

  return {
    totals: [...totals.values()],
    breakdown: [...breakdown.values()],
    perUrl: [...perUrl.entries()],
  };
}

async function runBatch(pgPool, statements) {
  const client = typeof pgPool.connect === 'function' ? await pgPool.connect() : pgPool;
  const ownClient = client !== pgPool;

  try {
    if (ownClient) await client.query('BEGIN');
    for (const [sql, params] of statements) {
      await client.query(sql, params);
    }
    if (ownClient) await client.query('COMMIT');
  } catch (err) {
    if (ownClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownClient && client.release) client.release();
  }
}

/**
 * Process a batch of click events atomically.
 */
export async function handleClickBatch(pgPool, logger, events) {
  if (!events || events.length === 0) return;

  const { totals, breakdown, perUrl } = buildAggregates(events);
  if (totals.length === 0) return;

  const statements = [
    [
      queries.upsertClickAnalyticsBatch,
      [
        totals.map((r) => r[0]),
        totals.map((r) => r[1]),
        totals.map((r) => r[2]),
      ],
    ],
  ];

  // PostgreSQL cannot infer the type of an all-NULL unnest array.
  if (breakdown.length > 0) {
    statements.push([
      queries.upsertClickBreakdownBatch,
      [
        breakdown.map((r) => r[0]),
        breakdown.map((r) => r[1]),
        breakdown.map((r) => r[2]),
        breakdown.map((r) => r[3]),
        breakdown.map((r) => r[4]),
      ],
    ]);
  }

  statements.push([
    queries.incrementUrlClickCounts,
    [perUrl.map((r) => r[0]), perUrl.map((r) => r[1])],
  ]);

  await runBatch(pgPool, statements);
  logger?.debug({ events: events.length, groups: totals.length }, 'Click batch aggregated');
}

/**
 * Backwards-compatible single-event entry point.
 */
export async function handleClickEvent(pgPool, logger, payload) {
  return handleClickBatch(pgPool, logger, [payload]);
}
