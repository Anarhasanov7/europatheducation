import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN_ENV = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Read current token from DB (if previously refreshed) or fall back to env
  let currentToken = THREADS_TOKEN_ENV;
  const { data: dbToken } = await sb.from('social_tokens')
    .select('token_value, expires_at').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();

  if (dbToken?.token_value) {
    currentToken = dbToken.token_value;
  }

  if (!currentToken) {
    return new Response(JSON.stringify({
      success: false,
      error: 'No Threads token found in DB or env',
      hint: 'Manual re-authorization required at https://europatheducation.eu/threads-callback.html',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // Refresh the Threads long-lived token
    // Works as long as token is at least 24h old and not expired
    const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${currentToken}`);
    const data = await res.json();

    if (data.error) {
      // Store the error in DB for tracking
      await sb.from('social_tokens').upsert({
        token_name: 'META_THREADS_ACCESS_TOKEN',
        token_value: currentToken, // keep old token
        updated_at: new Date().toISOString(),
        notes: `Refresh failed: ${data.error.message}`,
      }, { onConflict: 'token_name' });

      return new Response(JSON.stringify({
        success: false,
        error: data.error.message,
        error_code: data.error.code,
        hint: 'Token may have expired. Manual re-authorization required at https://europatheducation.eu/threads-callback.html',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const newToken = data.access_token;
    const expiresIn = data.expires_in; // seconds (~60 days = 5184000)
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Store new token in DB
    await sb.from('social_tokens').upsert({
      token_name: 'META_THREADS_ACCESS_TOKEN',
      token_value: newToken,
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
      notes: 'Auto-refreshed',
    }, { onConflict: 'token_name' });

    return new Response(JSON.stringify({
      success: true,
      message: 'Threads token refreshed successfully',
      expires_in_days: Math.round(expiresIn / 86400),
      expires_at: expiresAt,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: String(err),
      hint: 'Manual re-authorization may be required.',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
