/**
 * Lifecycle event handler.
 *
 * Per document Table 7:
 *  - Workload: Link lifecycle
 *  - Events: link_created / link_updated / link_disabled
 *  - Action: "Update downstream indexes, audit trails, or integrations."
 *
 * Per §11.1: Workers must be idempotent.
 */

/**
 * Handle a link lifecycle event.
 * @param {import('pg').Pool} pgPool
 * @param {import('pino').Logger} logger
 * @param {string} eventType
 * @param {object} payload
 */
export async function handleLifecycleEvent(pgPool, logger, eventType, payload) {
  const { shortCode } = payload;

  // Log lifecycle events for audit trail
  logger.info({ eventType, shortCode, payload }, 'Lifecycle event processed');

  // Additional integrations (webhooks, external systems) can be added here
  // as product requirements evolve.
}
