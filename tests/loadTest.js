#!/usr/bin/env node
/**
 * Load test — fires 100 HTTP requests against /api/test
 *
 * Usage:
 *   node tests/loadTest.js
 *   node tests/loadTest.js --url http://localhost:3000 --user alice --concurrency 10
 *
 * Options:
 *   --url          Base URL             (default: http://localhost:3000)
 *   --user         x-user-id header     (default: load-test-user)
 *   --total        Total requests        (default: 100)
 *   --concurrency  Parallel requests     (default: 5)
 *   --endpoint     Path to hit           (default: /api/test)
 */

import http from 'http';
import https from 'https';
import { parseArgs } from 'util';

// ── CLI args ──────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    url:         { type: 'string',  default: 'http://localhost:3000' },
    user:        { type: 'string',  default: 'load-test-user' },
    total:       { type: 'string',  default: '100' },
    concurrency: { type: 'string',  default: '5' },
    endpoint:    { type: 'string',  default: '/api/test' },
  },
  strict: false,
});

const BASE_URL    = args.url;
const USER_ID     = args.user;
const TOTAL       = parseInt(args.total, 10);
const CONCURRENCY = parseInt(args.concurrency, 10);
const ENDPOINT    = args.endpoint;

// ── HTTP helper ───────────────────────────────────────────────────────────────
function makeRequest(url, userId) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib       = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'GET',
      headers:  {
        'x-user-id':   userId,
        'Content-Type': 'application/json',
      },
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({
          status:       res.statusCode,
          headers:      res.headers,
          body,
          retryAfter:   res.headers['retry-after'] || null,
          tokensLeft:   res.headers['x-ratelimit-remaining'] || null,
        })
      );
    });

    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });

    req.end();
  });
}

// ── Run in batches ────────────────────────────────────────────────────────────
async function runBatch(indices) {
  return Promise.all(
    indices.map((i) => makeRequest(`${BASE_URL}${ENDPOINT}`, USER_ID).then((r) => ({ i, ...r })))
  );
}

async function main() {
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│          Distributed Rate Limiter — Load Test         │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log(`Target      : ${BASE_URL}${ENDPOINT}`);
  console.log(`User ID     : ${USER_ID}`);
  console.log(`Total reqs  : ${TOTAL}`);
  console.log(`Concurrency : ${CONCURRENCY}`);
  console.log('──────────────────────────────────────────────────────');

  const counters = { allowed: 0, throttled: 0, error: 0 };
  const startTime = Date.now();

  let sent = 0;
  while (sent < TOTAL) {
    const batchSize = Math.min(CONCURRENCY, TOTAL - sent);
    const indices   = Array.from({ length: batchSize }, (_, k) => sent + k + 1);
    const results   = await runBatch(indices);

    for (const r of results) {
      if (r.status === 200) {
        counters.allowed++;
        process.stdout.write(`  [${String(r.i).padStart(3)}] ✅ 200  tokens-left=${r.tokensLeft ?? '?'}\n`);
      } else if (r.status === 429) {
        counters.throttled++;
        process.stdout.write(`  [${String(r.i).padStart(3)}] 🚫 429  retry-after=${r.retryAfter}s\n`);
      } else {
        counters.error++;
        process.stdout.write(`  [${String(r.i).padStart(3)}] ❌ ${r.status || 'ERR'}  ${r.error || ''}\n`);
      }
    }

    sent += batchSize;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('──────────────────────────────────────────────────────');
  console.log(`✅  Allowed   : ${counters.allowed}`);
  console.log(`🚫  Throttled : ${counters.throttled}`);
  console.log(`❌  Errors    : ${counters.error}`);
  console.log(`⏱   Duration  : ${elapsed}s`);
  console.log(`📊  RPS       : ${(TOTAL / parseFloat(elapsed)).toFixed(1)}`);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
