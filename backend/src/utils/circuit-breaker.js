import { ServiceUnavailableError } from './errors.js';

/**
 * Minimal circuit breaker for the database on the redirect hot path.
 *
 * After `failureThreshold` consecutive failures the breaker opens for
 * `cooldownMs`, so a struggling database is not hammered by every request.
 * Open-circuit calls fail fast with 503 instead of piling up.
 */
export class CircuitBreaker {
  constructor({ failureThreshold = 5, cooldownMs = 5000, onStateChange } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.onStateChange = onStateChange;
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }

  get isOpen() {
    if (!this.openedAt) return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      // Cooldown elapsed: allow a single probe (half-open).
      return false;
    }
    return true;
  }

  get state() {
    if (!this.openedAt) return 'closed';
    return this.isOpen ? 'open' : 'half-open';
  }

  recordSuccess() {
    if (this.openedAt) {
      this.openedAt = 0;
      this.failures = 0;
      this.halfOpenInFlight = false;
      this.onStateChange?.('closed');
    } else {
      this.failures = 0;
    }
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold && !this.openedAt) {
      this.openedAt = Date.now();
      this.onStateChange?.('open');
    }
  }

  async execute(fn) {
    if (this.isOpen) {
      throw new ServiceUnavailableError('Database temporarily unavailable, please retry');
    }

    if (this.openedAt && this.halfOpenInFlight) {
      throw new ServiceUnavailableError('Database temporarily unavailable, please retry');
    }

    if (this.openedAt) {
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    } finally {
      this.halfOpenInFlight = false;
    }
  }
}

export default CircuitBreaker;
