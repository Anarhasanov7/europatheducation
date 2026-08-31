import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
const THREADS_USER_ID = Deno.env.get('META_THREADS_USER_ID') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '';

const THREADS_API = 'https://graph.threads.net/v1.0';
const FB_API = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { post_id, platform, comment_id, reply_text, is_auto } = body;

  if (!post_id || !platform || !comment_id || !reply_text) {
    return new Response(JSON.stringify({ error: 'post_id, platform, comment_id, reply_text required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get the post
  const { data: post } = await sb.from('threads_scheduled_posts')
    .select('*').eq('id', post_id).single();

  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let replyId: string | null = null;
  let replyError: string | null = null;

  if (platform === 'threads' && post.threads_post_id) {
    // Threads: reply to the conversation (use the post's media id)
    try {
      const res = await fetch(`${THREADS_API}/${post.threads_post_id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply_text, access_token: THREADS_TOKEN }),
      });
      const data = await res.json();
      if (data.error) replyError = data.error.message;
      else replyId = data.id;
    } catch (e: any) { replyError = String(e); }
  } else if (platform === 'facebook') {
    // Facebook: reply to the comment
    try {
      const res = await fetch(`${FB_API}/${comment_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply_text, access_token: PAGE_TOKEN }),
      });
      const data = await res.json();
      if (data.error) replyError = data.error.message;
      else replyId = data.id;
    } catch (e: any) { replyError = String(e); }
  } else if (platform === 'instagram' && post.ig_media_id) {
    // Instagram: reply as a comment on the media
    try {
      const res = await fetch(`${FB_API}/${post.ig_media_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply_text, access_token: PAGE_TOKEN }),
      });
      const data = await res.json();
      if (data.error) replyError = data.error.message;
      else replyId = data.id;
    } catch (e: any) { replyError = String(e); }
  }

  // Update the comment in DB
  if (replyId) {
    await sb.from('social_comments').upsert({
      post_id, platform, comment_id,
      reply_text, replied: true, replied_at: new Date().toISOString(),
      is_auto_reply: is_auto || false,
    }, { onConflict: 'platform,comment_id' });
  }

  return new Response(JSON.stringify({
    success: replyId !== null,
    reply_id: replyId,
    error: replyError,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
