import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Simple SHA-256 hash via Web Crypto
async function hash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Free geo-IP lookup (ip-api.com, 45 req/min, non-commercial). Falls back to null.
async function geoLookup(ip: string): Promise<string | null> {
  if (!ip || ip === 'unknown' || ip.startsWith('10.') || ip.startsWith('192.168.') ||
      ip.startsWith('172.') || ip === '127.0.0.1' || ip === '::1') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://ip-api.com/json/${ip}?fields=countryCode`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j.countryCode || null;
  } catch { return null; }
}

function detectDevice(ua: string): string {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ua = req.headers.get('user-agent') || '';
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

  let body: any = {};
  try { body = await req.json(); } catch { /* empty beacon is fine */ }

  const path = (body.path || '/').toString().slice(0, 500);
  const referrer = body.referrer ? body.referrer.toString().slice(0, 500) : null;

  // Daily-rotating visitor hash: same visitor (IP+UA) on the same day = same hash.
  // No personal data stored; hash cannot be reversed to recover IP.
  const day = new Date().toISOString().slice(0, 10);
  const visitorHash = await hash(`${clientIP}|${ua}|${day}`);

  const country = await geoLookup(clientIP);
  const device = detectDevice(ua);

  const { error } = await sb.from('page_views').insert({
    path,
    referrer,
    country,
    device,
    visitor_hash: visitorHash,
  });

  if (error) console.error('page_views insert error:', error.message);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
