import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const THREADS_CLIENT_ID = '4280706285480169';
const THREADS_CLIENT_SECRET = Deno.env.get('THREADS_CLIENT_SECRET') || 'be9e8e8ee544c0f2546a3123bdc0e2cb';
const THREADS_REDIRECT = 'https://europatheducation.eu/threads-callback.html';

const META_APP_ID = '959105600544977';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') || 'bc08d26d0f929d3ea4daa44ac0759d8e';
const META_REDIRECT = 'https://europatheducation.eu/threads-callback.html';

const FB_API = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { code, type, action } = body;

    // List current tokens
    if (action === 'list') {
      const { data: tokens } = await sb.from('social_tokens').select('token_name, token_value').order('token_name');
      return new Response(JSON.stringify({ tokens: tokens || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!code || !type) {
      return new Response(JSON.stringify({ error: 'Missing code or type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'threads') {
      // Exchange Threads code for token
      const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: THREADS_CLIENT_ID,
          client_secret: THREADS_CLIENT_SECRET,
          grant_type: 'authorization_code',
          redirect_uri: THREADS_REDIRECT,
          code,
        }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return new Response(JSON.stringify({ error: tokenData.error.message || 'Threads token exchange failed' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let accessToken = tokenData.access_token;
      const userId = tokenData.user_id;

      // Exchange for long-lived token
      const longLivedRes = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_CLIENT_SECRET}&access_token=${accessToken}`);
      const longLivedData = await longLivedRes.json();
      if (longLivedData.access_token) {
        accessToken = longLivedData.access_token;
      }

      // Store in DB
      await sb.from('social_tokens').upsert({
        token_name: 'META_THREADS_ACCESS_TOKEN_2',
        token_value: accessToken,
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'token_name' });

      // Also store the user ID
      await sb.from('social_tokens').upsert({
        token_name: 'META_THREADS_USER_ID_2',
        token_value: String(userId),
      }, { onConflict: 'token_name' });

      return new Response(JSON.stringify({
        success: true,
        threads_user_id: userId,
        message: 'Threads @europath_education token stored successfully',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'meta') {
      // Exchange Facebook code for user token
      const tokenRes = await fetch(`${FB_API}/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          redirect_uri: META_REDIRECT,
          code,
        }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return new Response(JSON.stringify({ error: tokenData.error.message || 'Meta token exchange failed' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userToken = tokenData.access_token;

      // Get long-lived user token
      const longLivedRes = await fetch(`${FB_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${userToken}`);
      const longLivedData = await longLivedRes.json();
      const longToken = longLivedData.access_token || userToken;

      // List all pages
      const pagesRes = await fetch(`${FB_API}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=50&access_token=${longToken}`);
      const pagesData = await pagesRes.json();

      const pages = (pagesData.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token,
        instagram_business_account: p.instagram_business_account,
      }));

      // Get IG details for each page with IG account
      const igAccounts = [];
      for (const page of pages) {
        if (page.instagram_business_account?.id) {
          try {
            const igRes = await fetch(`${FB_API}/${page.instagram_business_account.id}?fields=id,username,followers_count,profile_picture_url&access_token=${page.access_token}`);
            const igData = await igRes.json();
            igAccounts.push({
              id: igData.id,
              username: igData.username,
              followers_count: igData.followers_count,
              page_id: page.id,
              page_name: page.name,
            });
          } catch (e) { /* skip */ }
        }
      }

      // Store all page tokens and IG IDs in DB
      for (const page of pages) {
        await sb.from('social_tokens').upsert({
          token_name: `FB_PAGE_TOKEN_${page.id}`,
          token_value: page.access_token,
        }, { onConflict: 'token_name' });

        // Also store under standard name for the EuroPath page
        if (page.id === '104201397963733') {
          await sb.from('social_tokens').upsert({
            token_name: 'META_PAGE_ACCESS_TOKEN',
            token_value: page.access_token,
            notes: 'EuroPath Education FB Page token (with messaging perms)',
          }, { onConflict: 'token_name' });
        }

        if (page.instagram_business_account?.id) {
          await sb.from('social_tokens').upsert({
            token_name: `IG_BUSINESS_ID_${page.id}`,
            token_value: page.instagram_business_account.id,
          }, { onConflict: 'token_name' });

          // Also store under standard name for the EuroPath page
          if (page.id === '104201397963733') {
            await sb.from('social_tokens').upsert({
              token_name: 'META_IG_BUSINESS_ID',
              token_value: page.instagram_business_account.id,
            }, { onConflict: 'token_name' });
          }
        }
      }

      // Store the long-lived user token for discovery
      await sb.from('social_tokens').upsert({
        token_name: 'META_USER_LONG_TOKEN',
        token_value: longToken,
      }, { onConflict: 'token_name' });

      return new Response(JSON.stringify({
        success: true,
        pages: pages.map(p => ({ id: p.id, name: p.name, instagram_business_account: p.instagram_business_account })),
        ig_accounts: igAccounts,
        message: `Found ${pages.length} pages, ${igAccounts.length} IG accounts`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown type' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
