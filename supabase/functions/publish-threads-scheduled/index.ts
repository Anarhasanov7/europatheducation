import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const THREADS_TOKEN_ENV = Deno.env.get('META_THREADS_ACCESS_TOKEN') || '';
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

// Helper: get Threads token + user ID from DB by token name suffix ('' for primary, '_2' for secondary)
async function getThreadsCreds(sb: any, suffix: string = ''): Promise<{ token: string; userId: string }> {
  const tokenName = `META_THREADS_ACCESS_TOKEN${suffix}`;
  const userIdName = `META_THREADS_USER_ID${suffix}`;
  const { data: t } = await sb.from('social_tokens').select('token_value').eq('token_name', tokenName).single();
  const { data: u } = await sb.from('social_tokens').select('token_value').eq('token_name', userIdName).single();
  const token = t?.token_value || (suffix === '' ? THREADS_TOKEN_ENV : '');
  const userId = u?.token_value || (suffix === '' ? THREADS_USER_ID : '');
  return { token, userId };
}

// Publish to a single Threads account. Returns { success, post_id?, error? }
async function publishToThreads(
  token: string,
  userId: string,
  text: string,
  imageUrl: string | null,
  isVideoMedia: boolean,
  label: string,
): Promise<{ success: boolean; post_id?: string; error?: string }> {
  if (!token || !userId) {
    return { success: false, error: `No ${label} Threads credentials` };
  }
  try {
    const body: any = { text, access_token: token };
    if (imageUrl) {
      if (isVideoMedia) {
        body.media_type = 'VIDEO';
        body.video_url = imageUrl;
      } else {
        body.media_type = 'IMAGE';
        body.image_url = imageUrl;
      }
    } else {
      body.media_type = 'TEXT';
    }
    const createRes = await fetch(`${THREADS_API}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json();
    if (createData.error) {
      return { success: false, error: createData.error.message };
    }
    // Videos need ~30s to process on Threads; images need ~5s; text needs ~3s
    const waitMs = isVideoMedia ? 30000 : (imageUrl ? 5000 : 3000);
    await new Promise(r => setTimeout(r, waitMs));
    const publishRes = await fetch(`${THREADS_API}/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: createData.id, access_token: token }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) {
      return { success: false, error: publishData.error.message };
    }
    return { success: true, post_id: publishData.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Detect if URL is a video based on extension
function isVideo(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
}

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // Load both Threads accounts: primary (@study.with.anar) + secondary (@europath_education)
  const primary = await getThreadsCreds(sb, '');
  const secondary = await getThreadsCreds(sb, '_2');

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
    const hasMedia = !!post.image_url;
    const isVideoMedia = hasMedia && isVideo(post.image_url);
    const postType = post.post_type || 'post'; // 'post', 'reel', 'story'

    // Story image: use dedicated 9:16 version if available, otherwise fall back to main image
    const storyImageUrl = post.story_image_url || post.image_url || '';
    const hasStoryMedia = !!storyImageUrl;

    // Append organization tag + website to text (for all platforms that support captions)
    // @europath_education becomes a tappable mention on Threads & Instagram
    const ORG_TAG = '\n\n@europath_education\n🌐 https://europatheducation.eu';
    const ORG_TAG_LEN = ORG_TAG.length;
    const THREADS_LIMIT = 500;
    const baseText = post.text || '';

    // For Threads: truncate text if needed so text + tag fits in 500 chars
    let threadsText = baseText;
    if (baseText && !baseText.includes('@europath_education')) {
      if (baseText.length + ORG_TAG_LEN > THREADS_LIMIT) {
        threadsText = baseText.substring(0, THREADS_LIMIT - ORG_TAG_LEN - 1) + '…' + ORG_TAG;
      } else {
        threadsText = baseText + ORG_TAG;
      }
    } else if (baseText && !baseText.includes('europatheducation.eu')) {
      threadsText = baseText + '\n\n🌐 https://europatheducation.eu';
    }

    // For Facebook & Instagram: no character limit issue, use full text + tag
    const taggedText = baseText + (baseText && !baseText.includes('@europath_education') ? ORG_TAG : (baseText && !baseText.includes('europatheducation.eu') ? '\n\n🌐 https://europatheducation.eu' : ''));

    // === THREADS (supports: text, image, video — NO stories, NO reels) ===
    // Threads doesn't have stories or reels, so skip for those types
    // Publish to BOTH Threads accounts: @study.with.anar (primary) + @europath_education (secondary)
    if (postType === 'post') {
      // Primary account (@study.with.anar)
      const primaryResult = await publishToThreads(
        primary.token, primary.userId, threadsText, hasMedia ? post.image_url : null, isVideoMedia, 'primary'
      );
      platformResults.threads = primaryResult;
      if (primaryResult.success && primaryResult.post_id) {
        postIds.threads_post_id = primaryResult.post_id;
      }

      // Secondary account (@europath_education) — 2s delay to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
      const secondaryResult = await publishToThreads(
        secondary.token, secondary.userId, threadsText, hasMedia ? post.image_url : null, isVideoMedia, 'secondary'
      );
      platformResults.threads_2 = secondaryResult;
      if (secondaryResult.success && secondaryResult.post_id) {
        postIds.threads_post_id_2 = secondaryResult.post_id;
      }
    } else {
      platformResults.threads = { success: false, error: `Threads doesn't support ${postType}s` };
      platformResults.threads_2 = { success: false, error: `Threads doesn't support ${postType}s` };
    }

    // === FACEBOOK PAGE ===
    // Supports: text post, photo post, video post, photo story, video story
    if (postType === 'story') {
      // Facebook Story
      if (!hasMedia) {
        platformResults.facebook = { success: false, error: 'Stories require media (image or video)' };
      } else {
        try {
          let fbRes;
          if (isVideoMedia) {
            // Video story
            fbRes = await fetch(`${FB_API}/${PAGE_ID}/video_stories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file_url: post.image_url, access_token: PAGE_TOKEN }),
            });
          } else {
            // Photo story
            fbRes = await fetch(`${FB_API}/${PAGE_ID}/photo_stories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photo_url: post.image_url, access_token: PAGE_TOKEN }),
            });
          }
          const fbData = await fbRes.json();
          if (fbData.error) {
            platformResults.facebook = { success: false, error: fbData.error.message };
          } else {
            platformResults.facebook = { success: true, post_id: fbData.id || fbData.story_id };
            postIds.fb_post_id = fbData.id || fbData.story_id;
          }
        } catch (err) {
          platformResults.facebook = { success: false, error: String(err) };
        }
      }
    } else if (postType === 'reel') {
      // Facebook doesn't have a separate "reel" concept via API — post as video
      if (!hasMedia || !isVideoMedia) {
        platformResults.facebook = { success: false, error: 'Reels require a video file' };
      } else {
        try {
          const fbRes = await fetch(`${FB_API}/${PAGE_ID}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_url: post.image_url, description: taggedText, access_token: PAGE_TOKEN }),
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
      }
    } else {
      // Regular post: text, photo, or video
      try {
        if (hasMedia && isVideoMedia) {
          // Video post
          const fbRes = await fetch(`${FB_API}/${PAGE_ID}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_url: post.image_url, description: taggedText, access_token: PAGE_TOKEN }),
          });
          const fbData = await fbRes.json();
          if (fbData.error) {
            platformResults.facebook = { success: false, error: fbData.error.message };
          } else {
            platformResults.facebook = { success: true, post_id: fbData.id };
            postIds.fb_post_id = fbData.id;
          }
        } else if (hasMedia) {
          // Photo post
          const fbRes = await fetch(`${FB_API}/${PAGE_ID}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: post.image_url, caption: taggedText, access_token: PAGE_TOKEN }),
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
            body: JSON.stringify({ message: taggedText, access_token: PAGE_TOKEN }),
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
    }

    // === INSTAGRAM ===
    // Supports: image/video feed post, reel, story
    // Instagram ALWAYS requires media
    if (!hasMedia) {
      platformResults.instagram = { success: false, error: 'Instagram requires media (image or video)' };
    } else if (postType === 'reel') {
      // Instagram Reel — requires video
      if (!isVideoMedia) {
        platformResults.instagram = { success: false, error: 'Reels require a video file' };
      } else {
        try {
          const igCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_type: 'REELS', video_url: post.image_url, caption: taggedText, access_token: PAGE_TOKEN }),
          });
          const igCreateData = await igCreateRes.json();
          if (igCreateData.error) {
            platformResults.instagram = { success: false, error: igCreateData.error.message };
          } else {
            await new Promise(r => setTimeout(r, 10000)); // Reels need more processing time
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
      }
    } else if (postType === 'story') {
      // Instagram Story — no caption
      try {
        const igBody: any = { media_type: 'STORY', access_token: PAGE_TOKEN };
        if (isVideoMedia) {
          igBody.video_url = post.image_url;
        } else {
          igBody.image_url = post.image_url;
        }
        const igCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(igBody),
        });
        const igCreateData = await igCreateRes.json();
        if (igCreateData.error) {
          platformResults.instagram = { success: false, error: igCreateData.error.message };
        } else {
          await new Promise(r => setTimeout(r, 8000));
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
      // Regular Instagram feed post: image or video
      try {
        const igBody: any = { caption: taggedText, access_token: PAGE_TOKEN };
        if (isVideoMedia) {
          igBody.media_type = 'VIDEO';
          igBody.video_url = post.image_url;
        } else {
          igBody.image_url = post.image_url;
        }
        const igCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(igBody),
        });
        const igCreateData = await igCreateRes.json();
        if (igCreateData.error) {
          platformResults.instagram = { success: false, error: igCreateData.error.message };
        } else {
          await new Promise(r => setTimeout(r, isVideoMedia ? 10000 : 5000));
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
    }

    // === ALSO PUBLISH AS STORY (Instagram + Facebook) ===
    // Every post with media also gets published as a 24h story
    // Uses 9:16 story_image_url if available (proper story aspect ratio)
    if (hasStoryMedia && postType !== 'story') {
      const storyIsVideo = storyImageUrl !== post.image_url ? false : isVideoMedia; // story version is always image (padded)

      // Instagram Story (two-step: create container → publish)
      try {
        const igStoryBody: any = { media_type: 'STORIES', access_token: PAGE_TOKEN };
        if (storyIsVideo) {
          igStoryBody.video_url = storyImageUrl;
        } else {
          igStoryBody.image_url = storyImageUrl;
        }
        const igStoryCreateRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(igStoryBody),
        });
        const igStoryCreateData = await igStoryCreateRes.json();
        if (igStoryCreateData.error) {
          platformResults.ig_story = { success: false, error: igStoryCreateData.error.message };
        } else {
          // Wait for processing
          await new Promise(r => setTimeout(r, isVideoMedia ? 12000 : 6000));
          const igStoryPublishRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: igStoryCreateData.id, access_token: PAGE_TOKEN }),
          });
          const igStoryPublishData = await igStoryPublishRes.json();
          if (igStoryPublishData.error) {
            platformResults.ig_story = { success: false, error: igStoryPublishData.error.message };
          } else {
            platformResults.ig_story = { success: true, post_id: igStoryPublishData.id };
          }
        }
      } catch (err) {
        platformResults.ig_story = { success: false, error: String(err) };
      }

      // Facebook Story (two-step: upload unpublished photo → create story with photo_id)
      try {
        if (storyIsVideo) {
          // Video story: upload video first, then publish as story
          const fbVideoUploadRes = await fetch(`${FB_API}/${PAGE_ID}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_url: storyImageUrl, published: false, access_token: PAGE_TOKEN }),
          });
          const fbVideoData = await fbVideoUploadRes.json();
          if (fbVideoData.error) {
            platformResults.fb_story = { success: false, error: fbVideoData.error.message };
          } else {
            await new Promise(r => setTimeout(r, 10000));
            const fbStoryRes = await fetch(`${FB_API}/${PAGE_ID}/video_stories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ video_id: fbVideoData.id, access_token: PAGE_TOKEN }),
            });
            const fbStoryData = await fbStoryRes.json();
            if (fbStoryData.error) {
              platformResults.fb_story = { success: false, error: fbStoryData.error.message };
            } else {
              platformResults.fb_story = { success: true, post_id: fbStoryData.post_id || fbStoryData.id };
            }
          }
        } else {
          // Photo story: Step 1 — upload unpublished photo (use 9:16 story image)
          const fbPhotoUploadRes = await fetch(`${FB_API}/${PAGE_ID}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: storyImageUrl, published: false, access_token: PAGE_TOKEN }),
          });
          const fbPhotoData = await fbPhotoUploadRes.json();
          if (fbPhotoData.error) {
            platformResults.fb_story = { success: false, error: fbPhotoData.error.message };
          } else {
            const photoId = fbPhotoData.id;
            // Step 2 — publish as story using photo_id
            const fbStoryRes = await fetch(`${FB_API}/${PAGE_ID}/photo_stories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photo_id: photoId, access_token: PAGE_TOKEN }),
            });
            const fbStoryData = await fbStoryRes.json();
            if (fbStoryData.error) {
              platformResults.fb_story = { success: false, error: fbStoryData.error.message };
            } else {
              platformResults.fb_story = { success: true, post_id: fbStoryData.post_id || fbStoryData.id };
            }
          }
        }
      } catch (err) {
        platformResults.fb_story = { success: false, error: String(err) };
      }
    }

    // Determine overall status (stories + secondary threads are bonus — don't count toward failure)
    const mainResults = ['threads', 'facebook', 'instagram'].map(k => platformResults[k]).filter(Boolean);
    const successCount = mainResults.filter((r: any) => r.success).length;
    let status = 'failed';
    if (successCount === mainResults.length) status = 'published';
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
        threads_post_id_2: postIds.threads_post_id_2 || null,
        fb_post_id: postIds.fb_post_id || null,
        ig_media_id: postIds.ig_media_id || null,
        platforms_status: platformsStatus,
        error_message: status !== 'published' ? JSON.stringify(platformResults) : null,
        published_at: status !== 'failed' ? new Date().toISOString() : null,
      })
      .eq('id', post.id);

    // Delete uploaded files from storage after publishing (cleanup)
    const filesToDelete = [];
    if (post.image_url && post.image_url.includes('social-uploads')) {
      try {
        const urlObj = new URL(post.image_url);
        const pathParts = urlObj.pathname.split('/social-uploads/');
        if (pathParts.length > 1) filesToDelete.push(pathParts[1]);
      } catch (e) {}
    }
    if (post.story_image_url && post.story_image_url.includes('social-uploads')) {
      try {
        const urlObj = new URL(post.story_image_url);
        const pathParts = urlObj.pathname.split('/social-uploads/');
        if (pathParts.length > 1) filesToDelete.push(pathParts[1]);
      } catch (e) {}
    }
    if (filesToDelete.length > 0) {
      try { await sb.storage.from('social-uploads').remove(filesToDelete); } catch (e) {}
      await sb.from('threads_scheduled_posts')
        .update({ image_url: null, story_image_url: null })
        .eq('id', post.id);
    }

    results.push({ post_number: post.post_number, post_type: postType, status, platformResults });

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
