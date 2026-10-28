// psi-check.mjs — verify PageSpeed Insights audits on the live site.
// Usage: node psi-check.mjs <mode>   mode: render-blocking | image-delivery | cache-ttl | report
// Caches the PSI API response for 10 minutes so multiple checks share one run.

import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const URL_ = 'https://europatheducation.eu/';
const CACHE = '/tmp/psi-result.json';
const MODE = process.argv[2] || 'report';
const TTL_MS = 10 * 60 * 1000;

function apiKey() {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY;
  try {
    return execSync(`${process.env.HOME}/.config/devin/skills/secrets-vault/vault.sh get pagespeed-api-key`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

async function getResult() {
  if (existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < TTL_MS) {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const key = apiKey();
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(URL_)}&strategy=mobile&category=performance${key ? `&key=${key}` : ''}`;
  console.log('PSI API call for', URL_, '(may take ~60s)');
  const r = await fetch(api);
  if (!r.ok) { console.error('PSI API HTTP', r.status); process.exit(2); }
  const json = await r.json();
  if (json.error) { console.error('PSI API error:', JSON.stringify(json.error).slice(0, 300)); process.exit(2); }
  writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

// Sum wasted bytes across an insight's items (Lighthouse 13 shape).
function wastedBytes(audit) {
  const items = audit?.details?.items || [];
  let total = 0;
  const walk = (arr) => arr.forEach(i => {
    if (typeof i.wastedBytes === 'number') total += i.wastedBytes;
    if (Array.isArray(i.items)) walk(i.items);
    if (i.children && typeof i.children === 'object') Object.values(i.children).forEach(c => walk([c]));
  });
  walk(items);
  return total;
}

const res = await getResult();
const audits = res.lighthouseResult?.audits || {};
const perf = res.lighthouseResult?.categories?.performance?.score;

if (MODE === 'report') {
  console.log('Performance score:', Math.round((perf ?? 0) * 100));
  for (const m of ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'cumulative-layout-shift'])
    console.log(' ', m, '=', audits[m]?.displayValue);
  for (const id of ['render-blocking-insight', 'image-delivery-insight', 'cache-insight', 'network-dependency-tree-insight', 'unsized-images', 'font-display-insight']) {
    const a = audits[id];
    console.log(`${id}: score=${a?.score} wasted=${Math.round(wastedBytes(a) / 1024)}KiB`);
  }
  process.exit(0);
}

if (MODE === 'render-blocking') {
  const rb = audits['render-blocking-insight'];
  const items = rb?.details?.items || [];
  console.log('render-blocking-insight score:', rb?.score, 'items:', items.length);
  items.forEach(i => console.log('   -', (i.url || '').slice(0, 110)));
  if (rb?.score === 1) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL'); process.exit(1);
}

if (MODE === 'image-delivery') {
  const a = audits['image-delivery-insight'];
  const total = wastedBytes(a);
  console.log('image-delivery-insight score:', a?.score, 'wasted:', Math.round(total / 1024), 'KiB (limit 400)');
  if (total < 400 * 1024) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL'); process.exit(1);
}

if (MODE === 'cache-ttl') {
  const a = audits['cache-insight'];
  const total = wastedBytes(a);
  console.log('cache-insight score:', a?.score, 'wasted:', Math.round(total / 1024), 'KiB (limit 250)');
  if (total < 250 * 1024) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL'); process.exit(1);
}

console.error('unknown mode', MODE);
process.exit(2);
