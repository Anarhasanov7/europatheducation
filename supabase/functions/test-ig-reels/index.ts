import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FB_API = 'https://graph.facebook.com/v21.0';
const IG_BUSINESS_ID = Deno.env.get('META_IG_BUSINESS_ID') || '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';

Deno.serve(async (_req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (_req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const result: any = { ig_business_id: IG_BUSINESS_ID };
  const videoUrl = 'https://europatheducation.eu/images/slideshow-videos/slideshow_5_steps_italy_feed.mp4';

  // Create IG Reels container
  const createRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: '5 шагов, чтобы учиться в Италии бесплатно 🇮🇹',
      access_token: PAGE_TOKEN,
    }),
  });
  const createData = await createRes.json();
  result.create = createData;

  if (createData.id) {
    // Poll status — ONLY query 'status' field, nothing else
    result.polling = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`${FB_API}/${createData.id}?fields=status&access_token=${PAGE_TOKEN}`);
      const statusData = await statusRes.json();
      result.polling.push({ attempt: i + 1, time_sec: (i + 1) * 5, status: statusData.status, raw: statusData });
      if (statusData.status === 'FINISHED') {
        const pubRes = await fetch(`${FB_API}/${IG_BUSINESS_ID}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: createData.id, access_token: PAGE_TOKEN }),
        });
        const pubData = await pubRes.json();
        result.publish = pubData;
        break;
      } else if (statusData.status === 'ERROR') {
        result.error = 'Processing failed';
        break;
      }
    }
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
