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

// Auto-reply templates
const AUTO_REPLIES = {
  threads: {
    default: '👋 Спасибо за комментарий! Напиши в ДМ «ИТАЛИЯ» — отправлю список программ со стипендией 🎓',
    question: '👋 Хороший вопрос! Прямо сейчас занят, но скоро отвечу. Или напиши в ДМ — отправлю подробности 📩',
  },
  facebook: {
    default: '👋 Спасибо за комментарий! Есть вопросы? Напишите в ДМ — помогу с поступлением в Италию 🇮🇹',
  },
  instagram: {
    default: '👋 Спасибо! Напишите в ДМ «ИТАЛИЯ» — отправлю список программ со стипендией 🎓',
  },
};

// Detect if comment is a question
function isQuestion(text: string): boolean {
  const q = text.toLowerCase();
  return q.includes('?') || q.includes('как') || q.includes('сколько') || q.includes('нужен') || q.includes('можно ли');
}

// Send reply to Threads
async function replyToThreads(commentId: string, text: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${THREADS_API}/${commentId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text,
        reply_to_id: commentId,
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Threads reply error:', data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Threads reply fetch error:', e);
    return false;
  }
}

// Send reply to Facebook
async function replyToFacebook(commentId: string, text: string, pageToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${FB_API}/${commentId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Facebook reply error:', data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Facebook reply fetch error:', e);
    return false;
  }
}

// Send reply to Instagram
async function replyToInstagram(commentId: string, text: string, pageToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${FB_API}/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Instagram reply error:', data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Instagram reply fetch error:', e);
    return false;
  }
}

async function getThreadsToken(sb: any): Promise<string> {
  const { data } = await sb.from('social_tokens').select('token_value').eq('token_name', 'META_THREADS_ACCESS_TOKEN').single();
  return data?.token_value || THREADS_TOKEN_ENV;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok for GET */ }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const THREADS_TOKEN = await getThreadsToken(sb);
  const postId = body.post_id;
  const platform = body.platform; // 'threads', 'facebook', 'instagram'

  if (!postId || !platform) {
    return new Response(JSON.stringify({ error: 'post_id and platform required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get the post
  const { data: post } = await sb.from('threads_scheduled_posts')
    .select('*').eq('id', postId).single();

  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let comments: any[] = [];

  if (platform === 'threads' && post.threads_post_id) {
    try {
      const res = await fetch(`${THREADS_API}/${post.threads_post_id}/replies?fields=id,text,username,timestamp,permalink&access_token=${THREADS_TOKEN}`);
      const data = await res.json();
      if (!data.error && data.data) {
        comments = data.data.map((c: any) => ({
          comment_id: c.id, author_name: c.username || '', author_username: c.username || '',
          comment_text: c.text || '', timestamp: c.timestamp, platform: 'threads',
        }));
      }
    } catch (e) { /* skip */ }
  } else if (platform === 'facebook' && post.fb_post_id) {
    try {
      const res = await fetch(`${FB_API}/${post.fb_post_id}/comments?fields=id,message,from,created_time&access_token=${PAGE_TOKEN}`);
      const data = await res.json();
      if (!data.error && data.data) {
        comments = data.data.map((c: any) => ({
          comment_id: c.id, author_name: c.from?.name || '', author_username: c.from?.username || c.from?.id || '',
          comment_text: c.message || '', timestamp: c.created_time, platform: 'facebook',
        }));
      }
    } catch (e) { /* skip */ }
  } else if (platform === 'instagram' && post.ig_media_id) {
    try {
      const res = await fetch(`${FB_API}/${post.ig_media_id}/comments?fields=id,text,from,timestamp,username&access_token=${PAGE_TOKEN}`);
      const data = await res.json();
      if (!data.error && data.data) {
        comments = data.data.map((c: any) => ({
          comment_id: c.id, author_name: c.username || c.from?.name || '', author_username: c.username || '',
          comment_text: c.text || '', timestamp: c.timestamp, platform: 'instagram',
        }));
      }
    } catch (e) { /* skip */ }
  }

  // Store comments in DB (upsert — track which ones we've seen)
  // Also track which are NEW (not in DB before)
  const { data: existingComments } = await sb.from('social_comments')
    .select('comment_id').eq('post_id', postId).eq('platform', platform);
  const existingIds = new Set(existingComments?.map(c => c.comment_id) || []);

  for (const c of comments) {
    const isNew = !existingIds.has(c.comment_id);
    await sb.from('social_comments').upsert({
      post_id: postId,
      platform: c.platform,
      comment_id: c.comment_id,
      author_name: c.author_name,
      author_username: c.author_username,
      comment_text: c.comment_text,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'platform,comment_id', ignoreDuplicates: false }).select();

    // Auto-reply only to NEW comments
    if (isNew) {
      console.log(`New comment detected: ${c.comment_id}`);

      // Choose reply template
      let replyText = AUTO_REPLIES[platform as keyof typeof AUTO_REPLIES]?.default || AUTO_REPLIES.threads.default;
      if (isQuestion(c.comment_text)) {
        replyText = AUTO_REPLIES.threads.question;
      }

      let success = false;

      // Send reply based on platform
      if (platform === 'threads') {
        success = await replyToThreads(c.comment_id, replyText, THREADS_TOKEN);
      } else if (platform === 'facebook') {
        success = await replyToFacebook(c.comment_id, replyText, PAGE_TOKEN);
      } else if (platform === 'instagram') {
        success = await replyToInstagram(c.comment_id, replyText, PAGE_TOKEN);
      }

      // Update DB with reply status
      if (success) {
        await sb.from('social_comments').update({
          replied: true,
          reply_text: replyText,
          replied_at: new Date().toISOString(),
          is_auto_reply: true,
        }).eq('comment_id', c.comment_id).eq('platform', platform);
        console.log(`Auto-replied to comment ${c.comment_id}`);
      }
    }
  }

  // Get reply status from DB
  const { data: dbComments } = await sb.from('social_comments')
    .select('*').eq('post_id', postId).eq('platform', platform);
  const replyMap: Record<string, any> = {};
  if (dbComments) {
    for (const dc of dbComments) {
      replyMap[dc.comment_id] = dc;
    }
  }

  // Merge: add reply info to each comment
  comments = comments.map(c => ({
    ...c,
    replied: replyMap[c.comment_id]?.replied || false,
    reply_text: replyMap[c.comment_id]?.reply_text || null,
    is_auto_reply: replyMap[c.comment_id]?.is_auto_reply || false,
  }));

  return new Response(JSON.stringify({ comments }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
