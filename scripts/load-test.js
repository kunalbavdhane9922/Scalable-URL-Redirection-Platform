#!/usr/bin/env node

/**
 * Performance verification & load testing tool.
 *
 * Scenarios:
 *  1. Warm-cache steady state — repeated popular codes (L1/L2 hits).
 *  2. Zipf-like traffic — 80% hot keys, 20% long tail.
 *  3. Invalid-code traffic — negative caching and 404 path.
 *
 * Reports achieved RPS, failures, status breakdown, and latency percentiles.
 * Results are also written to validation/load-test-<timestamp>.json.
 *
 * Usage:
 *   TARGET_URL=http://localhost:8080 CONCURRENCY=100 DURATION_SECONDS=20 \
 *     node scripts/load-test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.TARGET_URL || 'http://localhost:8080').replace(/\/$/, '');
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 50;
const DURATION_SECONDS = parseInt(process.env.DURATION_SECONDS, 10) || 10;
const HOT_COUNT = parseInt(process.env.HOT_COUNT, 10) || 5;
const COLD_COUNT = parseInt(process.env.COLD_COUNT, 10) || 20;
const API_KEY = process.env.ADMIN_API_KEY || '';
const RUN_ID = Date.now().toString(36).slice(-6);

import { computePercentiles } from '../backend/src/utils/percentiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTestLink(targetUrl, alias) {
  try {
    const res = await fetch(`${BASE_URL}/api/shorten`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ url: targetUrl, ...(alias ? { customAlias: alias } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`  create ${res.status}: ${data.message || 'unknown error'}`);
      return null;
    }
    return data.shortCode;
  } catch (err) {
    console.error('  create failed:', err.message);
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
        const res = await fetch(url, { method: 'GET', redirect: 'manual' });
        latencies.push(performance.now() - reqStart);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      } catch {
        errors++;
      }
      totalRequests++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const actualDuration = (Date.now() - startTime) / 1000;
  const rps = totalRequests / actualDuration;
  const stats = computePercentiles(latencies);

  console.log(`\nResults:`);
  console.log(`  Total Requests:  ${totalRequests}`);
  console.log(`  Actual Duration: ${actualDuration.toFixed(2)}s`);
  console.log(`  Achieved RPS:    ${rps.toFixed(2)} req/sec`);
  console.log(`  Failures/Errors: ${errors}`);
  console.log(`  Status Breakdown:`, statusCounts);
  console.log(`\nLatency Percentiles (ms):`);
  console.log(`  Min: ${stats.min} ms | Avg: ${stats.avg} ms`);
  console.log(`  p50: ${stats.p50} ms | p90: ${stats.p90} ms`);
  console.log(`  p95: ${stats.p95} ms | p99: ${stats.p99} ms | Max: ${stats.max} ms`);

  const p95MeetsTarget = parseFloat(stats.p95) < 50;
  const p99MeetsTarget = parseFloat(stats.p99) < 100;
  console.log(`\nSLO Evaluation:`);
  console.log(`  p95 < 50ms:  ${p95MeetsTarget ? 'PASS' : 'FAIL'} (${stats.p95} ms)`);
  console.log(`  p99 < 100ms: ${p99MeetsTarget ? 'PASS' : 'FAIL'} (${stats.p99} ms)`);

  return {
    name,
    concurrency,
    durationSec: actualDuration,
    totalRequests,
    rps: Number(rps.toFixed(2)),
    errors,
    statusCounts,
    latencyMs: stats,
    slo: { p95Under50: p95MeetsTarget, p99Under100: p99MeetsTarget },
  };
}

async function warmup(codes) {
  console.log('Warming caches...');
  await Promise.all(
    codes.flatMap((code) =>
      Array.from({ length: 10 }, () =>
        fetch(`${BASE_URL}/${code}`, { redirect: 'manual' }).catch(() => null),
      ),
    ),
  );
}

async function main() {
  console.log(`Preparing fixtures against ${BASE_URL} ...`);

  const hotCodes = [];
  for (let i = 0; i < HOT_COUNT; i += 1) {
    const code = await createTestLink(
      `https://example.com/hot/${i}`,
      `lt${RUN_ID}h${i}`,
    );
    if (code) hotCodes.push(code);
  }

  const coldCodes = [];
  for (let i = 0; i < COLD_COUNT; i += 1) {
    const code = await createTestLink(
      `https://example.com/cold/${i}`,
      `lt${RUN_ID}c${i}`,
    );
    if (code) coldCodes.push(code);
  }

  if (hotCodes.length === 0) {
    console.error('Target server not accessible or rate-limited at', BASE_URL);
    process.exit(1);
  }

  await warmup(hotCodes);

  const results = [];
  results.push(await runScenario({
    name: '1. Warm-cache steady state (L1/L2 hits)',
    getUrl: () => `${BASE_URL}/${hotCodes[Math.floor(Math.random() * hotCodes.length)]}`,
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  }));

  results.push(await runScenario({
    name: '2. Zipf-like traffic (80% hot, 20% tail)',
    getUrl: () => {
      const pool = Math.random() < 0.8 ? hotCodes : coldCodes;
      return `${BASE_URL}/${pool[Math.floor(Math.random() * pool.length)]}`;
    },
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  }));

  results.push(await runScenario({
    name: '3. Invalid-code traffic (negative caching)',
    getUrl: () => `${BASE_URL}/missing${RUN_ID}${Math.floor(Math.random() * 1000)}`,
    durationSec: DURATION_SECONDS,
    concurrency: CONCURRENCY,
  }));

  const outDir = path.join(__dirname, '..', 'validation');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `load-test-${RUN_ID}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    target: BASE_URL,
    concurrency: CONCURRENCY,
    durationSeconds: DURATION_SECONDS,
    results,
  }, null, 2));

  console.log(`\nAll scenarios completed. Results written to ${outFile}`);
}

if (process.argv[1] && process.argv[1].endsWith('load-test.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { runScenario, computePercentiles };
