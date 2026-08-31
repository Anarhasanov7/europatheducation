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
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    const hasImage = !!post.image_url;

    // === THREADS ===
    try {
      const threadsBody: any = { text: post.text, access_token: THREADS_TOKEN };
      if (hasImage) {
        threadsBody.media_type = 'IMAGE';
        threadsBody.image_url = post.image_url;
      } else {
        threadsBody.media_type = 'TEXT';
      }
      const createRes = await fetch(`${THREADS_API}/${THREADS_USER_ID}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(threadsBody),
      });
      const createData = await createRes.json();
      if (createData.error) {
        platformResults.threads = { success: false, error: createData.error.message };
      } else {
        // Wait for processing (3s for text, 10s for images)
        await new Promise(r => setTimeout(r, hasImage ? 10000 : 3000));
        const publishRes = await fetch(`${THREADS_API}/${THREADS_USER_ID}/threads_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: createData.id, access_token: THREADS_TOKEN }),
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

    // === FACEBOOK PAGE ===
    try {
      const fbBody: any = { message: post.text, access_token: PAGE_TOKEN };
      if (hasImage) {
        // Post with photo
        const fbRes = await fetch(`${FB_API}/${PAGE_ID}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: post.image_url, caption: post.text, access_token: PAGE_TOKEN }),
        });
        const fbData = await fbRes.json();
        if (fbData.error) {
          platformResults.facebook = { success: false, error: fbData.error.message };
        } else {
          // Get the post ID (not the photo ID)
          const postIdRes = await fetch(`${FB_API}/${fbData.id}?fields=post_id&access_token=${PAGE_TOKEN}`);
          const postIdData = await postIdRes.json();
          const fbPostId = postIdData.post_id || fbData.id;
          platformResults.facebook = { success: true, post_id: fbPostId };
          postIds.fb_post_id = fbPostId;
        }
      } else {
        // Text-only post
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
      }
    } catch (err) {
      platformResults.facebook = { success: false, error: String(err) };
    }

    // === INSTAGRAM (image + caption) ===
    if (hasImage) {
      try {
        const igCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: post.image_url, caption: post.text, access_token: PAGE_TOKEN }),
        });
        const igCreateData = await igCreateRes.json();
        if (igCreateData.error) {
          platformResults.instagram = { success: false, error: igCreateData.error.message };
        } else {
          // Wait for processing
          await new Promise(r => setTimeout(r, 5000));
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
      platformResults.instagram = { success: false, error: 'No image — Instagram requires an image' };
    }

    // Determine overall status
    const allResults = Object.values(platformResults);
    const successCount = allResults.filter((r: any) => r.success).length;
    let status = 'failed';
    if (successCount === allResults.length) status = 'published';
    else if (successCount > 0) status = 'partial';

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

    // Delete uploaded file from storage after publishing (cleanup)
    if (post.image_url && post.image_url.includes('social-uploads')) {
      try {
        // Extract file path from URL
        const urlObj = new URL(post.image_url);
        const pathParts = urlObj.pathname.split('/social-uploads/');
        if (pathParts.length > 1) {
          const filePath = pathParts[1];
          await sb.storage.from('social-uploads').remove([filePath]);
        }
      } catch (e) { /* best effort cleanup */ }
      // Clear image_url from DB since file is deleted
      await sb.from('threads_scheduled_posts')
        .update({ image_url: null })
        .eq('id', post.id);
    }

    results.push({ post_number: post.post_number, status, platformResults });

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
