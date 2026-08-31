import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN_ENV = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
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
    await sendEmail(
      '⚠️ Threads Token Refresh FAILED — Action Required',
      `<h2>Threads token refresh failed</h2>
       <p><strong>Error:</strong> No Threads token found in database or environment.</p>
       <p><strong>Action required:</strong> You need to manually re-authorize.</p>
       <p>Go to: <a href="https://europatheducation.eu/threads-callback.html">https://europatheducation.eu/threads-callback.html</a></p>
       <p>This will generate a new token. The system will pick it up automatically.</p>
       <hr><p style="color:#888;font-size:12px">EuroPath Social Media System — automatic notification</p>`
    );
    return new Response(JSON.stringify({
      success: false,
      error: 'No Threads token found in DB or env',
      hint: 'Manual re-authorization required at https://europatheducation.eu/threads-callback.html',
      email_sent: true,
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
        token_value: currentToken,
        updated_at: new Date().toISOString(),
        notes: `Refresh failed: ${data.error.message}`,
      }, { onConflict: 'token_name' });

      // Send failure email
      await sendEmail(
        '⚠️ Threads Token Refresh FAILED — Action Required',
        `<h2>⚠️ Threads token refresh failed</h2>
         <p><strong>Error:</strong> ${data.error.message}</p>
         <p><strong>Error code:</strong> ${data.error.code || 'N/A'}</p>
         <p><strong>Time:</strong> ${new Date().toISOString()}</p>
         <p>This usually means the token has expired and can no longer be refreshed automatically.</p>
         <h3>What you need to do:</h3>
         <ol>
           <li>Go to <a href="https://europatheducation.eu/threads-callback.html">https://europatheducation.eu/threads-callback.html</a></li>
           <li>Log in with your Threads account and authorize the app</li>
           <li>Copy the new access token from the page</li>
           <li>Email it to anar@europatheducation.eu or reply to this email</li>
         </ol>
         <p>Once the new token is set, the system will resume automatically.</p>
         <hr><p style="color:#888;font-size:12px">EuroPath Social Media System — automatic notification</p>`
      );

      return new Response(JSON.stringify({
        success: false,
        error: data.error.message,
        error_code: data.error.code,
        hint: 'Token may have expired. Manual re-authorization required at https://europatheducation.eu/threads-callback.html',
        email_sent: true,
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
    // Send failure email for unexpected errors
    await sendEmail(
      '⚠️ Threads Token Refresh ERROR — Unexpected Error',
      `<h2>⚠️ Threads token refresh encountered an error</h2>
       <p><strong>Error:</strong> ${String(err)}</p>
       <p><strong>Time:</strong> ${new Date().toISOString()}</p>
       <p>If this keeps happening, manual re-authorization may be needed:</p>
       <p><a href="https://europatheducation.eu/threads-callback.html">https://europatheducation.eu/threads-callback.html</a></p>
       <hr><p style="color:#888;font-size:12px">EuroPath Social Media System — automatic notification</p>`
    );

    return new Response(JSON.stringify({
      success: false,
      error: String(err),
      hint: 'Manual re-authorization may be required.',
      email_sent: true,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
