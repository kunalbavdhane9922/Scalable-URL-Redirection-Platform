import { describe, it, expect } from '@jest/globals';
import { computePercentiles } from '../../src/utils/percentiles.js';

describe('Load Test Analytics & Percentile Calculations (§15)', () => {
  it('computes exact percentiles correctly', () => {
    // 100 values from 1 to 100
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computePercentiles(latencies);

    expect(stats.min).toBe('1.00');
    expect(stats.p50).toBe('51.00');
    expect(stats.p90).toBe('91.00');
    expect(stats.p95).toBe('96.00');
    expect(stats.p99).toBe('100.00');
    expect(stats.max).toBe('100.00');
    expect(stats.avg).toBe('50.50');
  });

  it('handles empty latencies gracefully', () => {
    const stats = computePercentiles([]);
    expect(stats.p50).toBe(0);
    expect(stats.avg).toBe(0);
  });
});
