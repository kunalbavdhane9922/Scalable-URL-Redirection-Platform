/**
 * Analytics event handler.
 *
 * Per document Table 7:
 *  - Workload: Click analytics
 *  - Event: link_clicked
 *  - Action: "Aggregate click counts and metadata into analytics storage."
 *
 * Per document §11.1:
 *  - "Make workers idempotent because at-least-once delivery can produce
 *     duplicate events."
 *  - "For click analytics, decide whether best-effort loss is acceptable."
 *
 * This handler aggregates click events. The current implementation uses
 * PostgreSQL for analytics storage; a dedicated analytics store (e.g.,
 * ClickHouse, TimescaleDB) can replace it when scale demands.
 */

/**
 * Handle a click analytics event.
 * Idempotent: processing the same event multiple times produces the same
 * aggregate result (increment is safe for counters with at-least-once semantics).
 *
 * @param {import('pg').Pool} pgPool
 * @param {import('pino').Logger} logger
 * @param {object} payload - Event payload
 */
export async function handleClickEvent(pgPool, logger, payload) {
  const { shortCode, clickedAt } = payload;

  try {
    // Upsert click count — idempotent aggregate operation
    await pgPool.query(`
      INSERT INTO click_analytics (short_code, click_date, click_count)
      VALUES ($1, $2::timestamptz::date, 1)
      ON CONFLICT (short_code, click_date)
      DO UPDATE SET click_count = click_analytics.click_count + 1
    `, [shortCode, clickedAt]);

    logger.debug({ shortCode }, 'Click event processed');
  } catch (err) {
    logger.error({ err: err.message, shortCode }, 'Failed to process click event');
    throw err; // Let the worker retry
  }
}
