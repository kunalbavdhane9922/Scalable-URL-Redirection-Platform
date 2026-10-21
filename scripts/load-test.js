#!/usr/bin/env node

/**
 * Performance Verification & Load Testing Tool.
 *
 * Implements the load-test scenarios defined in document §15 & §15.1:
 *  1. Warm-cache steady state: repeat realistic popular short codes and test sustained throughput.
 *  2. Zipf-like/hot-key traffic: small number of very popular links and many less-popular links.
 *  3. Invalid-code traffic: test negative caching and abuse protection.
 *
 * Records (§15.2):
 *  - Achieved RPS, request failures, timeout rate.
 *  - p50, p90, p95, p99, min, max, mean latency.
 *  - Status code breakdown (302 redirects, 404 not found, 429 rate limited, 500 errors).
 */

const BASE_URL = process.env.TARGET_URL || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 50;
const DURATION_SECONDS = parseInt(process.env.DURATION_SECONDS, 10) || 10;

import { computePercentiles } from '../backend/src/utils/percentiles.js';

async function createTestLink(targetUrl) {
  try {
    const res = await fetch(`${BASE_URL}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    const data = await res.json();
    return data.shortCode;
  } catch (err) {
    console.error('Failed to create test link:', err.message);
    return null;
  }
}

async function runScenario({ name, getUrl, durationSec, concurrency }) {
  console.log(`\n======================================================`);
  console.log(` Scenario: ${name}`);
  console.log(` Concurrency: ${concurrency} | Duration: ${durationSec}s | Target: ${BASE_URL}`);
  console.log(`======================================================`);

  const latencies = [];
  const statusCounts = {};
  let errors = 0;
  let totalRequests = 0;

  const startTime = Date.now();
  const endTime = startTime + durationSec * 1000;

  async function worker() {
    while (Date.now() < endTime) {
      const url = getUrl();
      const reqStart = performance.now();
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'manual', // do not follow 302, measure the redirect hop itself!
        });
        const reqDuration = performance.now() - reqStart;
        latencies.push(reqDuration);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch (err) {
        errors++;
      }
      totalRequests++;
    }
  }

  // Launch workers
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const actualDuration = (Date.now() - startTime) / 1000;
  const rps = (totalRequests / actualDuration).toFixed(2);
  const stats = computePercentiles(latencies);

  console.log(`\nResults:`);
  console.log(`  Total Requests:  ${totalRequests}`);
  console.log(`  Actual Duration: ${actualDuration.toFixed(2)}s`);
  console.log(`  Achieved RPS:    ${rps} req/sec`);
  console.log(`  Failures/Errors: ${errors}`);
  console.log(`  Status Breakdown:`, statusCounts);
  console.log(`\nLatency Percentiles (ms):`);
  console.log(`  Min: ${stats.min} ms | Avg: ${stats.avg} ms`);
  console.log(`  p50: ${stats.p50} ms | p90: ${stats.p90} ms`);
  console.log(`  p95: ${stats.p95} ms | p99: ${stats.p99} ms | Max: ${stats.max} ms`);

  const p95MeetsTarget = parseFloat(stats.p95) < 50;
  const p99MeetsTarget = parseFloat(stats.p99) < 100;
  console.log(`\nSLO Evaluation:`);
  console.log(`  p95 < 50ms:  ${p95MeetsTarget ? '✓ PASS' : '✗ FAIL'} (${stats.p95} ms)`);
  console.log(`  p99 < 100ms: ${p99MeetsTarget ? '✓ PASS' : '✗ FAIL'} (${stats.p99} ms)`);

  return { rps, stats, statusCounts, errors };
}

async function main() {
  console.log('Preparing load test fixtures...');

  // Setup sample short codes
  const hotCodes = [];
  for (let i = 0; i < 5; i++) {
    const code = await createTestLink(`https://example.com/hot/${i}`);
    if (code) hotCodes.push(code);
  }

  const coldCodes = [];
  for (let i = 0; i < 20; i++) {
    const code = await createTestLink(`https://example.com/cold/${i}`);
    if (code) coldCodes.push(code);
  }

  if (hotCodes.length === 0) {
    console.error('Target server not accessible at', BASE_URL);
    process.exit(1);
  }

  // 1. Warm-cache Steady State (popular keys)
  await runScenario({
    name: '1. Warm-Cache Steady State (L1/L2 hits)',
    getUrl: () => `${BASE_URL}/${hotCodes[Math.floor(Math.random() * hotCodes.length)]}`,
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  });

  // 2. Zipf-like Distribution (80% hot, 20% long tail)
  const allCodes = [...hotCodes, ...coldCodes];
  await runScenario({
    name: '2. Zipf-like Traffic (80% hot keys, 20% tail)',
    getUrl: () => {
      const isHot = Math.random() < 0.8;
      const pool = isHot ? hotCodes : coldCodes;
      return `${BASE_URL}/${pool[Math.floor(Math.random() * pool.length)]}`;
    },
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  });

  // 3. Invalid-Code Traffic (Negative Caching test)
  await runScenario({
    name: '3. Invalid-Code Traffic (Negative Caching Verification)',
    getUrl: () => `${BASE_URL}/invalid_${Math.floor(Math.random() * 10)}`,
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  });

  console.log('\nAll load-test scenarios completed.');
}

if (process.argv[1] && process.argv[1].endsWith('load-test.js')) {
  main().catch(console.error);
}

export { runScenario, computePercentiles };
