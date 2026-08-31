import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN_ENV = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '';

const THREADS_API = 'https://graph.threads.net/v1.0';
const FB_API = 'https://graph.facebook.com/v21.0';

async function getThreadsToken(sb: any): Promise<string> {
  const { data } = await sb.from('social_tokens').select('token_value').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();
  return data?.token_value || THREADS_TOKEN_ENV;
}

// Default auto-reply templates (rotated to avoid being flagged as spam)
const AUTO_REPLIES = [
  "Thank you! 🙏 Follow for more content about studying in Italy.",
  "Thanks for your comment! DM us the word ITALY for more info 🇮🇹",
  "Grazie! 🙏 Write us in DM for a free consultation.",
  "Thank you! 🙏 We help students get into Italian universities with scholarships.",
  "Thanks! 🙏 Follow @study.with.anar for daily stories about studying in Italy.",
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const THREADS_TOKEN = await getThreadsToken(sb);

  // Get all posts with auto_reply_enabled = true
  const { data: posts, error } = await sb.from('threads_scheduled_posts')
    .select('id, post_number, threads_post_id, fb_post_id, ig_media_id, auto_reply_enabled')
    .eq('auto_reply_enabled', true)
    .in('status', ['published', 'partial']);

  if (error || !posts || posts.length === 0) {
    return new Response(JSON.stringify({ message: 'No posts with auto-reply enabled', replied: 0 }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let totalReplied = 0;
  const results: any[] = [];

  for (const post of posts) {
    // Fetch comments from each platform and auto-reply to unreplied ones
    const platforms: Array<{ name: string; mediaId: string | null }> = [
      { name: 'threads', mediaId: post.threads_post_id },
      { name: 'facebook', mediaId: post.fb_post_id },
      { name: 'instagram', mediaId: post.ig_media_id },
    ];

    for (const { name: platform, mediaId } of platforms) {
      if (!mediaId) continue;

      let comments: any[] = [];

      // Fetch comments
      if (platform === 'threads') {
        try {
          const res = await fetch(`${THREADS_API}/${mediaId}/replies?fields=id,text,username,timestamp&access_token=${THREADS_TOKEN}`);
          const data = await res.json();
          if (!data.error && data.data) {
            comments = data.data.map((c: any) => ({ comment_id: c.id, text: c.text, username: c.username }));
          }
        } catch (e) { /* skip */ }
      } else if (platform === 'facebook') {
        try {
          const res = await fetch(`${FB_API}/${mediaId}/comments?fields=id,message,from&access_token=${PAGE_TOKEN}`);
          const data = await res.json();
          if (!data.error && data.data) {
            comments = data.data.map((c: any) => ({ comment_id: c.id, text: c.message, username: c.from?.name || '' }));
          }
        } catch (e) { /* skip */ }
      } else if (platform === 'instagram') {
        try {
          const res = await fetch(`${FB_API}/${mediaId}/comments?fields=id,text,username&access_token=${PAGE_TOKEN}`);
          const data = await res.json();
          if (!data.error && data.data) {
            comments = data.data.map((c: any) => ({ comment_id: c.id, text: c.text, username: c.username || '' }));
          }
        } catch (e) { /* skip */ }
      }

      // Check which comments are already replied
      for (const comment of comments) {
        const { data: existing } = await sb.from('social_comments')
          .select('replied').eq('platform', platform).eq('comment_id', comment.comment_id).single();

        if (existing?.replied) continue; // Already replied

        // Pick a random auto-reply template
        const replyText = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];

        // Post the reply
        let replyId: string | null = null;
        let replyError: string | null = null;

        if (platform === 'threads') {
          try {
            const res = await fetch(`${THREADS_API}/${mediaId}/replies`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: replyText, access_token: THREADS_TOKEN }),
            });
            const data = await res.json();
            if (data.error) replyError = data.error.message;
            else replyId = data.id;
          } catch (e: any) { replyError = String(e); }
        } else if (platform === 'facebook') {
          try {
            const res = await fetch(`${FB_API}/${comment.comment_id}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: replyText, access_token: PAGE_TOKEN }),
            });
            const data = await res.json();
            if (data.error) replyError = data.error.message;
            else replyId = data.id;
          } catch (e: any) { replyError = String(e); }
        } else if (platform === 'instagram') {
          try {
            const res = await fetch(`${FB_API}/${mediaId}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: replyText, access_token: PAGE_TOKEN }),
            });
            const data = await res.json();
            if (data.error) replyError = data.error.message;
            else replyId = data.id;
          } catch (e: any) { replyError = String(e); }
        }

        // Store in DB
        if (replyId) {
          totalReplied++;
          results.push({ post_number: post.post_number, platform, comment_id: comment.comment_id, reply: replyText, success: true });
        } else {
          results.push({ post_number: post.post_number, platform, comment_id: comment.comment_id, error: replyError, success: false });
        }

        // Upsert comment record (whether reply succeeded or not, to avoid retrying failed ones too fast)
        await sb.from('social_comments').upsert({
          post_id: post.id,
          platform,
          comment_id: comment.comment_id,
          author_name: comment.username,
          comment_text: comment.text,
          reply_text: replyId ? replyText : null,
          replied: replyId !== null,
          replied_at: replyId ? new Date().toISOString() : null,
          is_auto_reply: true,
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'platform,comment_id' });

        // 2s delay between replies to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  return new Response(JSON.stringify({
    message: `Auto-reply completed`,
    replied: totalReplied,
    results,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
