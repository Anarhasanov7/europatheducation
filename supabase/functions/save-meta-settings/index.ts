import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { settings } = await req.json();
    if (!settings || typeof settings !== 'object') {
      return new Response(JSON.stringify({ success: false, error: 'Missing settings' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const keys = Object.keys(settings);
    if (keys.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No settings provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    for (const key of keys) {
      const value = settings[key];
      if (value === undefined) continue;
      const { error: upsertErr } = await sb.from('meta_settings')
        .upsert({ setting_key: key, setting_value: String(value) }, { onConflict: 'setting_key' });
      if (upsertErr) throw upsertErr;
    }

    return new Response(JSON.stringify({ success: true, saved: keys }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
