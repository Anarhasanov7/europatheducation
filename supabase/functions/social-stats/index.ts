import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN_ENV = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '';

const THREADS_API = 'https://graph.threads.net/v1.0';
const FB_API = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

async function getThreadsToken(sb: any): Promise<string> {
  const { data } = await sb.from('social_tokens').select('token_value').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();
  return data?.token_value || THREADS_TOKEN_ENV;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const THREADS_TOKEN = await getThreadsToken(sb);

  // Get all published posts with their platform IDs
  const { data: posts, error } = await sb.from('threads_scheduled_posts')
    .select('id, post_number, threads_post_id, fb_post_id, ig_media_id, status')
    .in('status', ['published', 'partial']);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!posts || posts.length === 0) {
    return new Response(JSON.stringify({ stats: [] }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stats: Record<number, any> = {};

  for (const post of posts) {
    stats[post.post_number] = { post_number: post.post_number, threads: null, facebook: null, instagram: null };

    // Threads insights
    if (post.threads_post_id) {
      try {
        const res = await fetch(`${THREADS_API}/${post.threads_post_id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${THREADS_TOKEN}`);
        const data = await res.json();
        if (!data.error && data.data) {
          const m: Record<string, number> = {};
          for (const item of data.data) {
            m[item.name] = item.values?.[0]?.value || 0;
          }
          stats[post.post_number].threads = { likes: m.likes || 0, replies: m.replies || 0, reposts: m.reposts || 0, quotes: m.quotes || 0, views: m.views || 0 };
        }
      } catch (e) { /* skip */ }
    }

    // Facebook insights
    if (post.fb_post_id) {
      try {
        const res = await fetch(`${FB_API}/${post.fb_post_id}/insights?metric=post_reactions_by_type_total,post_comments,post_shares&access_token=${PAGE_TOKEN}`);
        const data = await res.json();
        if (!data.error && data.data) {
          const m: Record<string, any> = {};
          for (const item of data.data) {
            if (item.name === 'post_reactions_by_type_total') {
              let total = 0;
              for (const v of item.values || []) { total += v.value?.like || 0; total += v.value?.love || 0; total += v.value?.wow || 0; total += v.value?.haha || 0; total += v.value?.sad || 0; total += v.value?.angry || 0; }
              m.reactions = total;
            } else if (item.values?.[0]?.value !== undefined) {
              m[item.name] = item.values[0].value;
            }
          }
          stats[post.post_number].facebook = { likes: m.reactions || 0, comments: m.post_comments || 0, shares: m.post_shares || 0 };
        }
      } catch (e) { /* skip */ }
      // Also try the simpler fields
      if (!stats[post.post_number].facebook) {
        try {
          const res = await fetch(`${FB_API}/${post.fb_post_id}?fields=created_time,message,comments.summary(true),reactions.summary(true),shares&access_token=${PAGE_TOKEN}`);
          const data = await res.json();
          if (!data.error) {
            stats[post.post_number].facebook = {
              likes: data.reactions?.summary?.total_count || 0,
              comments: data.comments?.summary?.total_count || 0,
              shares: data.shares?.count || 0,
            };
          }
        } catch (e) { /* skip */ }
      }
    }

    // Instagram insights
    if (post.ig_media_id) {
      try {
        const res = await fetch(`${FB_API}/${post.ig_media_id}?fields=like_count,comments_count,timestamp&access_token=${PAGE_TOKEN}`);
        const data = await res.json();
        if (!data.error) {
          stats[post.post_number].instagram = { likes: data.like_count || 0, comments: data.comments_count || 0 };
        }
      } catch (e) { /* skip */ }
    }
  }

  // Cache stats in DB
  for (const [num, s] of Object.entries(stats)) {
    await sb.from('threads_scheduled_posts')
      .update({ stats_cache: s, stats_updated_at: new Date().toISOString() })
      .eq('post_number', parseInt(num));
  }

  return new Response(JSON.stringify({ stats: Object.values(stats) }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
