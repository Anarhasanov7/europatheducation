// global-probe — real availability + cache-warming monitor.
// Deployed in N regions; each run makes REAL requests from that region's
// datacenter and reports latency/status back. Identifies itself as a monitor.
const { http } = require('@google-cloud/functions-framework');

const SITE = 'https://europatheducation.eu';
const BEACON = 'https://glfizcgayqecnvtfihgy.supabase.co/functions/v1/track-pageview';
const UA = 'EuroPath-Monitor/1.0 (regional availability check; +https://europatheducation.eu)';

http('probe', async (req, res) => {
  const region = process.env.FUNCTION_REGION || 'unknown';
  const t0 = Date.now();
  let status = 0, cf = '';
  try {
    const r = await fetch(SITE + '/', { headers: { 'user-agent': UA, 'accept-language': 'ru-RU,ru;q=0.9' } });
    status = r.status;
    cf = r.headers.get('cf-cache-status') || r.headers.get('server') || '';
  } catch (e) { /* report below */ }
  const latency = Date.now() - t0;

  // Real pageview beacon — records a genuine request from this region's IP.
  let beacon = 'skip';
  try {
    const b = await fetch(BEACON, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'user-agent': UA }, body: JSON.stringify({ path: '/', referrer: `monitor-${region}` }) });
    beacon = String(b.status);
  } catch { beacon = 'err'; }

  res.json({ region, status, latencyMs: latency, edge: cf, beacon });
});
