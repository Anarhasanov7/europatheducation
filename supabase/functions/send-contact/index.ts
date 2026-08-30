import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TO_EMAIL = 'hasanov.anar.2023@gmail.com';
const FROM_EMAIL = 'onboarding@resend.dev';
const MAX_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getResendKey(): Promise<string> {
  const envKey = Deno.env.get('RESEND_API_KEY');
  if (envKey) return envKey;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
    method: 'POST',
    headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_name: 'resend_api_key' })
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

  try {
    // Rate limit: check submissions from this IP in the last hour
    const oneHourAgo = new Date(Date.now() - HOUR_MS).toISOString();
    const { count, error: countErr } = await sb
      .from('contact_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('ip', clientIP)
      .gte('created_at', oneHourAgo);

    if (countErr) {
      console.error('Rate limit check error:', countErr.message);
    } else if (count !== null && count >= MAX_PER_HOUR) {
      return new Response(JSON.stringify({ success: false, message: 'Too many submissions from your IP. Please try again later.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { name, email, phone, whatsapp, telegram, message } = await req.json();

    if (!name || !email || !phone || !message) {
      return new Response(JSON.stringify({ success: false, message: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ success: false, message: 'Invalid email address' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const RESEND_API_KEY = await getResendKey();
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ success: false, message: 'No Resend API key' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const contactRows = [
      `<tr><td style="padding:4px 12px; font-weight:bold;">Name:</td><td style="padding:4px 12px;">${name}</td></tr>`,
      `<tr><td style="padding:4px 12px; font-weight:bold;">Email:</td><td style="padding:4px 12px;">${email}</td></tr>`,
      `<tr><td style="padding:4px 12px; font-weight:bold;">Phone:</td><td style="padding:4px 12px;">${phone}</td></tr>`,
      whatsapp ? `<tr><td style="padding:4px 12px; font-weight:bold;">WhatsApp:</td><td style="padding:4px 12px;">${whatsapp}</td></tr>` : '',
      telegram ? `<tr><td style="padding:4px 12px; font-weight:bold;">Telegram:</td><td style="padding:4px 12px;">${telegram}</td></tr>` : ''
    ].filter(Boolean).join('');

    const html = `
      <h2>New Contact Form Submission</h2>
      <p>Someone submitted the contact form on europatheducation.com</p>
      <table style="border-collapse:collapse;">${contactRows}</table>
      <h3 style="color:#2E86C1;">Message</h3>
      <p style="white-space:pre-wrap; padding:12px; background:#f8f9fa; border-radius:8px;">${message}</p>
      <hr>
      <p style="color:#888; font-size:12px;">Reply directly to this email to respond to ${name} at ${email}</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: TO_EMAIL, subject: `Contact form: ${name}`, html, reply_to: email })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', errText);
      return new Response(JSON.stringify({ success: false, message: 'Email service error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Log the submission for rate limiting
    await sb.from('contact_submissions').insert({ ip: clientIP, email });

    return new Response(JSON.stringify({ success: true, message: 'Email sent' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ success: false, message: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
