// Read Instagram DMs and Threads messages
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '17841459999641713';
const PAGE_ID = Deno.env.get('META_PAGE_ID') || '104201397963733';
const THREADS_TOKEN = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
const THREADS_USER_ID = Deno.env.get('META_THREADS_USER_ID') || '28224434683909206';

const FB_API = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') || 'all';

  // Get page token from DB (fallback to env)
  const { data: pageTokenData } = await sb.from('social_tokens')
    .select('token_value').eq('token_name', 'META_PAGE_ACCESS_TOKEN').single();
  const pageToken = pageTokenData?.token_value || PAGE_TOKEN;

  // Get IG business ID from DB (fallback to env)
  const { data: igIdData } = await sb.from('social_tokens')
    .select('token_value').eq('token_name', 'META_IG_BUSINESS_ID').single();
  const igBusinessId = igIdData?.token_value || IG_BUSINESS_ID;

  // Get Threads token from DB (fallback to env)
  const { data: threadsTokenData } = await sb.from('social_tokens')
    .select('token_value').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();
  const threadsToken = threadsTokenData?.token_value || THREADS_TOKEN;

  const results: any = {};

  // === INSTAGRAM DMs ===
  if (platform === 'all' || platform === 'instagram') {
    try {
      // Get conversations for the IG business account
      const convRes = await fetch(
        `${FB_API}/${igBusinessId}/conversations?platform=instagram&fields=id,participants,messages{from,message,created_time}&limit=20&access_token=${pageToken}`
      );
      const convData = await convRes.json();

      if (convData.error) {
        results.instagram = { error: convData.error.message };
      } else {
        results.instagram = convData.data || [];
      }
    } catch (e) {
      results.instagram = { error: String(e) };
    }
  }

  // === FACEBOOK PAGE DMs ===
  if (platform === 'all' || platform === 'facebook') {
    try {
      const convRes = await fetch(
        `${FB_API}/${PAGE_ID}/conversations?fields=id,participants,messages{from,message,created_time}&limit=20&access_token=${pageToken}`
      );
      const convData = await convRes.json();

      if (convData.error) {
        results.facebook = { error: convData.error.message };
      } else {
        results.facebook = convData.data || [];
      }
    } catch (e) {
      results.facebook = { error: String(e) };
    }
  }

  // === THREADS REPLIES (not DMs - Threads API doesn't support DMs) ===
  if (platform === 'all' || platform === 'threads') {
    try {
      // Get replies to our posts (these are public, not DMs)
      const repliesRes = await fetch(
        `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads?fields=id,text,timestamp,replies{id,text,username,timestamp}&limit=10&access_token=${threadsToken}`
      );
      const repliesData = await repliesRes.json();

      if (repliesData.error) {
        results.threads = { error: repliesData.error.message };
      } else {
        // Extract all replies
        const allReplies: any[] = [];
        for (const post of repliesData.data || []) {
          if (post.replies?.data) {
            for (const reply of post.replies.data) {
              allReplies.push({
                post_id: post.id,
                post_text: post.text?.substring(0, 80),
                reply_id: reply.id,
                reply_text: reply.text,
                username: reply.username,
                timestamp: reply.timestamp,
              });
            }
          }
        }
        results.threads = allReplies;
      }
    } catch (e) {
      results.threads = { error: String(e) };
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
