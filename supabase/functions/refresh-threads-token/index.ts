import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const NOTIFY_EMAIL = 'hasanov.anar.2023@gmail.com';
const FROM_EMAIL = 'noreply@europatheducation.eu';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Send email notification via Resend
async function sendEmail(subject: string, body: string) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        subject,
        html: body,
      }),
    });
  } catch (e) { /* best effort */ }
}

// Refresh a single Threads token by name. Returns { success, error?, expires_at? }
async function refreshOneToken(sb: any, tokenName: string): Promise<{ success: boolean; error?: string; expires_at?: string }> {
  const { data: dbToken } = await sb.from('social_tokens')
    .select('token_value, expires_at').eq('token_name', tokenName).single();

  const currentToken = dbToken?.token_value;
  if (!currentToken) {
    return { success: false, error: `No token found for ${tokenName}` };
  }

  try {
    const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${currentToken}`);
    const data = await res.json();

    if (data.error) {
      await sb.from('social_tokens').upsert({
        token_name: tokenName,
        token_value: currentToken,
        updated_at: new Date().toISOString(),
        notes: `Refresh failed: ${data.error.message}`,
      }, { onConflict: 'token_name' });
      return { success: false, error: data.error.message };
    }

    const newToken = data.access_token;
    const expiresIn = data.expires_in;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await sb.from('social_tokens').upsert({
      token_name: tokenName,
      token_value: newToken,
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
      notes: 'Auto-refreshed',
    }, { onConflict: 'token_name' });

    return { success: true, expires_at: expiresAt };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Refresh both Threads tokens (primary @study.with.anar + secondary @europath_education)
  const tokenNames = ['META_THREADS_ACCESS_TOKEN', 'META_THREADS_ACCESS_TOKEN_2'];
  const results: Record<string, any> = {};
  const failures: string[] = [];

  for (const name of tokenNames) {
    const r = await refreshOneToken(sb, name);
    results[name] = r;
    if (!r.success) failures.push(`${name}: ${r.error}`);
  }

  const allSuccess = failures.length === 0;
  const anySuccess = Object.values(results).some((r: any) => r.success);

  if (!anySuccess) {
    await sendEmail(
      '⚠️ Threads Token Refresh FAILED — Action Required',
      `<h2>Threads token refresh failed</h2>
       <p><strong>Errors:</strong></p><ul>${failures.map(f => `<li>${f}</li>`).join('')}</ul>
       <p><strong>Action required:</strong> You need to manually re-authorize.</p>
       <p>Go to: <a href="https://europatheducation.eu/threads-callback.html">https://europatheducation.eu/threads-callback.html</a></p>
       <hr><p style="color:#888;font-size:12px">EuroPath Social Media System — automatic notification</p>`
    );
  } else if (!allSuccess) {
    await sendEmail(
      '⚠️ One Threads Token Refresh Failed',
      `<h2>One Threads token refresh failed</h2>
       <p><strong>Errors:</strong></p><ul>${failures.map(f => `<li>${f}</li>`).join('')}</ul>
       <p>At least one token was refreshed successfully. The failed token may need manual re-authorization.</p>
       <p>Go to: <a href="https://europatheducation.eu/threads-callback.html">https://europatheducation.eu/threads-callback.html</a></p>
       <hr><p style="color:#888;font-size:12px">EuroPath Social Media System — automatic notification</p>`
    );
  }

  return new Response(JSON.stringify({
    success: allSuccess,
    partial: !allSuccess && anySuccess,
    results,
    email_sent: !allSuccess,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
