/**
 * Percentile and latency statistical helper for load testing and metrics (§15.2).
 */
export function computePercentiles(latencies) {
  if (!latencies || latencies.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.floor((pct / 100) * sorted.length)];
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0].toFixed(2),
    p50: p(50).toFixed(2),
    p90: p(90).toFixed(2),
    p95: p(95).toFixed(2),
    p99: p(99).toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2),
    avg: (sum / sorted.length).toFixed(2),
  };
}
