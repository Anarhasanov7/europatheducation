import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FB_API = 'https://graph.facebook.com/v21.0';
const THREADS_API = 'https://graph.threads.net/v1.0';

async function getSecrets(): Promise<Record<string, string>> {
  // Read from Deno env (set as Supabase secrets)
  return {
    page_id: Deno.env.get('META_PAGE_ID') || '',
    page_token: Deno.env.get('META_PAGE_ACCESS_TOKEN') || '',
    ig_business_id: Deno.env.get('META_IG_BUSINESS_ID') || '',
    threads_user_id: Deno.env.get('META_THREADS_USER_ID') || '',
    threads_token: Deno.env.get('META_THREADS_ACCESS_TOKEN') || '',
  };
}

/** Post to Facebook Page */
async function postToFacebook(caption: string, imageUrl: string | null, secrets: Record<string, string>): Promise<{ success: boolean; post_id?: string; error?: string }> {
  if (!secrets.page_id || !secrets.page_token) {
    return { success: false, error: 'Facebook not configured (missing page_id or page_token)' };
  }
  try {
    if (imageUrl) {
      // Photo post
      const res = await fetch(`${FB_API}/${secrets.page_id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: imageUrl,
          caption: caption,
          access_token: secrets.page_token,
        }),
      });
      const data = await res.json();
      if (data.error) return { success: false, error: data.error.message };
      return { success: true, post_id: data.post_id || data.id };
    } else {
      // Text-only post
      const res = await fetch(`${FB_API}/${secrets.page_id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: caption,
          access_token: secrets.page_token,
        }),
      });
      const data = await res.json();
      if (data.error) return { success: false, error: data.error.message };
      return { success: true, post_id: data.id };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Post to Instagram (Business/Creator account) — requires image */
async function postToInstagram(caption: string, imageUrl: string, secrets: Record<string, string>): Promise<{ success: boolean; post_id?: string; error?: string }> {
  if (!secrets.ig_business_id || !secrets.page_token) {
    return { success: false, error: 'Instagram not configured (missing ig_business_id or page_token)' };
  }
  if (!imageUrl) {
    return { success: false, error: 'Instagram requires an image URL' };
  }
  try {
    // Step 1: Create media container
    const createRes = await fetch(`${FB_API}/${secrets.ig_business_id}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption,
        access_token: secrets.page_token,
      }),
    });
    const createData = await createRes.json();
    if (createData.error) return { success: false, error: createData.error.message };
    const containerId = createData.id;

    // Step 2: Publish the container
    const publishRes = await fetch(`${FB_API}/${secrets.ig_business_id}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: secrets.page_token,
      }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) return { success: false, error: publishData.error.message };
    return { success: true, post_id: publishData.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Post to Threads — supports text-only and image posts */
async function postToThreads(caption: string, imageUrl: string | null, secrets: Record<string, string>): Promise<{ success: boolean; post_id?: string; error?: string }> {
  if (!secrets.threads_user_id || !secrets.threads_token) {
    return { success: false, error: 'Threads not configured (missing threads_user_id or threads_token)' };
  }
  try {
    // Step 1: Create container
    let body: Record<string, string> = {
      access_token: secrets.threads_token,
    };

    if (imageUrl) {
      body.media_type = 'IMAGE';
      body.image_url = imageUrl;
      body.text = caption.slice(0, 500); // Threads text limit with image
    } else {
      body.media_type = 'TEXT';
      body.text = caption;
    }

    const createRes = await fetch(`${THREADS_API}/${secrets.threads_user_id}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json();
    if (createData.error) return { success: false, error: createData.error.message };
    const containerId = createData.id;

    // Step 2: Publish
    const publishRes = await fetch(`${THREADS_API}/${containerId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: secrets.threads_token }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) return { success: false, error: publishData.error.message };
    return { success: true, post_id: publishData.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { fetched_news_id, caption_ru, image_url, platforms } = await req.json();

    if (!caption_ru) return new Response(JSON.stringify({ success: false, error: 'Missing caption_ru' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!platforms) return new Response(JSON.stringify({ success: false, error: 'Missing platforms' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const secrets = await getSecrets();
    const results: Record<string, any> = {};
    const postIds: Record<string, string> = {};

    // Publish to each selected platform
    if (platforms.facebook) {
      results.facebook = await postToFacebook(caption_ru, image_url, secrets);
      if (results.facebook.post_id) postIds.fb_post_id = results.facebook.post_id;
    }
    if (platforms.instagram) {
      results.instagram = await postToInstagram(caption_ru, image_url || '', secrets);
      if (results.instagram.post_id) postIds.ig_media_id = results.instagram.post_id;
    }
    if (platforms.threads) {
      results.threads = await postToThreads(caption_ru, image_url, secrets);
      if (results.threads.post_id) postIds.threads_post_id = results.threads.post_id;
    }

    // Determine overall status
    const allResults = Object.values(results);
    const successCount = allResults.filter((r: any) => r.success).length;
    const totalPlatforms = allResults.length;
    let status = 'failed';
    if (successCount === totalPlatforms) status = 'published';
    else if (successCount > 0) status = 'partial';

    // Store in social_posts table
    const { error: insErr } = await sb.from('social_posts').insert({
      fetched_news_id: fetched_news_id || null,
      caption_ru,
      image_url: image_url || null,
      platforms,
      status,
      fb_post_id: postIds.fb_post_id || null,
      ig_media_id: postIds.ig_media_id || null,
      threads_post_id: postIds.threads_post_id || null,
      error_message: status !== 'published' ? JSON.stringify(results) : null,
      posted_at: status !== 'failed' ? new Date().toISOString() : null,
    });

    if (insErr) console.error('Failed to store social_post:', insErr.message);

    // Update fetched_news status
    if (fetched_news_id && status !== 'failed') {
      await sb.from('fetched_news').update({ status: 'posted' }).eq('id', fetched_news_id);
    }

    return new Response(JSON.stringify({
      success: status === 'published',
      status,
      results,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
