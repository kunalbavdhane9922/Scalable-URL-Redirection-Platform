import { describe, it, expect } from '@jest/globals';
import { createShortCode, MAX_RETRIES } from '../../src/services/code-generator.js';
import config from '../../src/config.js';

describe('Short Code Generator (§6 & §6.1)', () => {
  it('generates a string of configured length', () => {
    const code = createShortCode();
    expect(typeof code).toBe('string');
    expect(code.length).toBe(config.shortCode.length);
  });

  it('uses only URL-safe alphanumeric characters [A-Za-z0-9]', () => {
    for (let i = 0; i < 50; i++) {
      const code = createShortCode();
      expect(/^[A-Za-z0-9]+$/.test(code)).toBe(true);
    }
  });

  it('generates pseudo-random collision-resistant codes', () => {
    const generated = new Set();
    const count = 1000;
    for (let i = 0; i < count; i++) {
      generated.add(createShortCode());
    }
    // With 62^7 combinations, 1000 codes should have 0 collisions
    expect(generated.size).toBe(count);
  });

  it('exports MAX_RETRIES according to configuration', () => {
    expect(MAX_RETRIES).toBe(config.shortCode.maxRetries);
    expect(MAX_RETRIES).toBeGreaterThan(0);
  });
});
