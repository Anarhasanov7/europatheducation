// Poll all recent posts for new comments and auto-reply
// Called by pg_cron every 10 minutes

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const SOCIAL_COMMENTS_URL = `${SUPABASE_URL}/functions/v1/social-comments`;

Deno.serve(async (req: Request) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Get all posts published in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts } = await sb
    .from('threads_scheduled_posts')
    .select('id, threads_post_id, fb_post_id, ig_media_id')
    .gte('published_at', sevenDaysAgo)
    .in('status', ['published', 'partial']);

  if (!posts || posts.length === 0) {
    console.log('No recent posts to check');
    return new Response(JSON.stringify({ checked: 0 }), { status: 200 });
  }

  console.log(`Checking ${posts.length} recent posts for comments`);

  let checked = 0;
  const results: any[] = [];

  for (const post of posts) {
    // Check Threads
    if (post.threads_post_id) {
      try {
        const res = await fetch(SOCIAL_COMMENTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: post.id, platform: 'threads' }),
        });
        const data = await res.json();
        results.push({ post_id: post.id, platform: 'threads', comments: data.comments?.length || 0 });
        checked++;
      } catch (e) {
        console.error(`Error checking Threads for post ${post.id}:`, e);
      }
    }

    // Check Facebook
    if (post.fb_post_id) {
      try {
        const res = await fetch(SOCIAL_COMMENTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: post.id, platform: 'facebook' }),
        });
        const data = await res.json();
        results.push({ post_id: post.id, platform: 'facebook', comments: data.comments?.length || 0 });
        checked++;
      } catch (e) {
        console.error(`Error checking Facebook for post ${post.id}:`, e);
      }
    }

    // Check Instagram
    if (post.ig_media_id) {
      try {
        const res = await fetch(SOCIAL_COMMENTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: post.id, platform: 'instagram' }),
        });
        const data = await res.json();
        results.push({ post_id: post.id, platform: 'instagram', comments: data.comments?.length || 0 });
        checked++;
      } catch (e) {
        console.error(`Error checking Instagram for post ${post.id}:`, e);
      }
    }
  }

  console.log(`Comment poll complete: ${checked} checks, ${results.length} results`);

  return new Response(JSON.stringify({ checked, results }), { status: 200 });
});
