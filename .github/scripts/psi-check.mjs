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

function savingsBytes(audit) {
  return audit?.details?.overallSavingsBytes || audit?.numericValue || 0;
}

const res = await getResult();
const audits = res.lighthouseResult?.audits || {};
const perf = res.lighthouseResult?.categories?.performance?.score;

if (MODE === 'report') {
  console.log('Performance score:', Math.round((perf ?? 0) * 100));
  const rb = audits['render-blocking-resources'];
  console.log('render-blocking-resources: score', rb?.score, 'items', rb?.details?.items?.length ?? 0);
  (rb?.details?.items || []).forEach(i => console.log('   -', i.url?.slice(0, 110)));
  const ttl = audits['uses-long-cache-ttl'];
  console.log('uses-long-cache-ttl: score', ttl?.score, 'savings', Math.round((savingsBytes(ttl) || 0) / 1024), 'KiB');
  for (const [id, a] of Object.entries(audits)) {
    const s = savingsBytes(a);
    if (/image|webp|responsive|optimized/i.test(id) && s > 0)
      console.log(`${id}: savings ${Math.round(s / 1024)} KiB`);
  }
  process.exit(0);
}

if (MODE === 'render-blocking') {
  const rb = audits['render-blocking-resources'];
  const items = rb?.details?.items || [];
  console.log('render-blocking items:', items.length);
  items.forEach(i => console.log('   -', i.url?.slice(0, 110)));
  if ((rb?.score === 1 || items.length === 0) && rb) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL score=' + rb?.score); process.exit(1);
}

if (MODE === 'image-delivery') {
  let total = 0;
  for (const [id, a] of Object.entries(audits)) {
    const s = savingsBytes(a);
    if (/image|webp|responsive|optimized/i.test(id) && s > 0) {
      total += s;
      console.log(`${id}: ${Math.round(s / 1024)} KiB`);
    }
  }
  console.log('total image-delivery savings:', Math.round(total / 1024), 'KiB (limit 400)');
  if (total < 400 * 1024) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL'); process.exit(1);
}

if (MODE === 'cache-ttl') {
  const ttl = audits['uses-long-cache-ttl'];
  const s = savingsBytes(ttl);
  console.log('cache-ttl flagged savings:', Math.round(s / 1024), 'KiB (limit 250)');
  (ttl?.details?.items || []).slice(0, 15).forEach(i => console.log('   -', i.url?.slice(0, 100), Math.round((i.totalBytes || 0) / 1024) + 'KiB', 'TTL', i.cacheLifetimeMs ? Math.round(i.cacheLifetimeMs / 3600000) + 'h' : '?'));
  if (s < 250 * 1024) { console.log('PSI-PASS'); process.exit(0); }
  console.log('PSI-FAIL'); process.exit(1);
}

console.error('unknown mode', MODE);
process.exit(2);
