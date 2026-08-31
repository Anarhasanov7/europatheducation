import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
const THREADS_USER_ID = Deno.env.get('META_THREADS_USER_ID') || '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '';

const THREADS_API = 'https://graph.threads.net/v1.0';
const FB_API = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Get pending posts whose scheduled time has passed
  const { data: duePosts, error: fetchErr } = await sb
    .from('threads_scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_utc', new Date().toISOString())
    .order('scheduled_utc', { ascending: true })
    .limit(5);

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!duePosts || duePosts.length === 0) {
    return new Response(JSON.stringify({ message: 'No due posts', published: 0 }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results = [];

  for (const post of duePosts) {
    await sb.from('threads_scheduled_posts')
      .update({ attempts: post.attempts + 1 })
      .eq('id', post.id);

    const platformResults: Record<string, any> = {};
    const postIds: Record<string, string> = {};

    // === THREADS (text only) ===
    try {
      const createRes = await fetch(`${THREADS_API}/${THREADS_USER_ID}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'TEXT', text: post.text, access_token: THREADS_TOKEN }),
      });
      const createData = await createRes.json();
      if (createData.error) {
        platformResults.threads = { success: false, error: createData.error.message };
      } else {
        const publishRes = await fetch(`${THREADS_API}/${createData.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: THREADS_TOKEN }),
        });
        const publishData = await publishRes.json();
        if (publishData.error) {
          platformResults.threads = { success: false, error: publishData.error.message };
        } else {
          platformResults.threads = { success: true, post_id: publishData.id };
          postIds.threads_post_id = publishData.id;
        }
      }
    } catch (err) {
      platformResults.threads = { success: false, error: String(err) };
    }

    // === FACEBOOK PAGE (text only) ===
    try {
      const fbRes = await fetch(`${FB_API}/${PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: post.text, access_token: PAGE_TOKEN }),
      });
      const fbData = await fbRes.json();
      if (fbData.error) {
        platformResults.facebook = { success: false, error: fbData.error.message };
      } else {
        platformResults.facebook = { success: true, post_id: fbData.id };
        postIds.fb_post_id = fbData.id;
      }
    } catch (err) {
      platformResults.facebook = { success: false, error: String(err) };
    }

    // === INSTAGRAM (image + caption) ===
    if (post.image_url) {
      try {
        // Step 1: Create IG media container
        const igCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: post.image_url,
            caption: post.text,
            access_token: PAGE_TOKEN,
          }),
        });
        const igCreateData = await igCreateRes.json();
        if (igCreateData.error) {
          platformResults.instagram = { success: false, error: igCreateData.error.message };
        } else {
          // Step 2: Publish
          const igPublishRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: igCreateData.id, access_token: PAGE_TOKEN }),
          });
          const igPublishData = await igPublishRes.json();
          if (igPublishData.error) {
            platformResults.instagram = { success: false, error: igPublishData.error.message };
          } else {
            platformResults.instagram = { success: true, post_id: igPublishData.id };
            postIds.ig_media_id = igPublishData.id;
          }
        }
      } catch (err) {
        platformResults.instagram = { success: false, error: String(err) };
      }
    } else {
      platformResults.instagram = { success: false, error: 'No image_url — Instagram requires an image' };
    }

    // Determine overall status
    const allResults = Object.values(platformResults);
    const successCount = allResults.filter((r: any) => r.success).length;
    let status = 'failed';
    if (successCount === allResults.length) status = 'published';
    else if (successCount > 0) status = 'partial';

    // Build platforms_status
    const platformsStatus: Record<string, string> = {};
    for (const [platform, result] of Object.entries(platformResults)) {
      platformsStatus[platform] = (result as any).success ? 'published' : 'failed';
    }

    // Update the post
    await sb.from('threads_scheduled_posts')
      .update({
        status,
        threads_post_id: postIds.threads_post_id || null,
        fb_post_id: postIds.fb_post_id || null,
        ig_media_id: postIds.ig_media_id || null,
        platforms_status: platformsStatus,
        error_message: status !== 'published' ? JSON.stringify(platformResults) : null,
        published_at: status !== 'failed' ? new Date().toISOString() : null,
      })
      .eq('id', post.id);

    results.push({ post_number: post.post_number, status, platformResults });

    // 5s delay between posts to avoid rate limits
    await new Promise(r => setTimeout(r, 5000));
  }

  return new Response(JSON.stringify({
    published: results.filter(r => r.status === 'published').length,
    partial: results.filter(r => r.status === 'partial').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
