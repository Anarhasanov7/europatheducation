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

// Helper: get Threads token from DB (refreshed by refresh-threads-token cron) or fall back to env
async function getThreadsToken(sb: any): Promise<string> {
  const { data } = await sb.from('social_tokens').select('token_value').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();
  return data?.token_value || THREADS_TOKEN_ENV;
}

// Detect if URL is a video based on extension
function isVideo(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
}

Deno.serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const THREADS_TOKEN = await getThreadsToken(sb);

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
    if (postType === 'post') {
      try {
        const threadsBody: any = { text: threadsText, access_token: THREADS_TOKEN };
        if (hasMedia) {
          if (isVideoMedia) {
            threadsBody.media_type = 'VIDEO';
            threadsBody.video_url = post.image_url;
          } else {
            threadsBody.media_type = 'IMAGE';
            threadsBody.image_url = post.image_url;
          }
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
          // Wait for processing (3s text, 10s media)
          await new Promise(r => setTimeout(r, hasMedia ? 10000 : 3000));
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
    } else {
      platformResults.threads = { success: false, error: `Threads doesn't support ${postType}s` };
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
    if (hasMedia && postType !== 'story') {
      // Instagram Story (two-step: create container → publish)
      try {
        const igStoryBody: any = { media_type: 'STORIES', access_token: PAGE_TOKEN };
        if (isVideoMedia) {
          igStoryBody.video_url = post.image_url;
        } else {
          igStoryBody.image_url = post.image_url;
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
        if (isVideoMedia) {
          // Video story: upload video first, then publish as story
          const fbVideoUploadRes = await fetch(`${FB_API}/${PAGE_ID}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_url: post.image_url, published: false, access_token: PAGE_TOKEN }),
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
          // Photo story: Step 1 — upload unpublished photo
          const fbPhotoUploadRes = await fetch(`${FB_API}/${PAGE_ID}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: post.image_url, published: false, access_token: PAGE_TOKEN }),
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

    // Determine overall status (stories are bonus — don't count toward failure)
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
        const urlObj = new URL(post.image_url);
        const pathParts = urlObj.pathname.split('/social-uploads/');
        if (pathParts.length > 1) {
          const filePath = pathParts[1];
          await sb.storage.from('social-uploads').remove([filePath]);
        }
      } catch (e) { /* best effort cleanup */ }
      await sb.from('threads_scheduled_posts')
        .update({ image_url: null })
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
