import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHOTSTACK_API = 'https://api.shotstack.io/v1/render';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const apiKey = Deno.env.get('SHOTSTACK_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Shotstack API key not configured. Set SHOTSTACK_API_KEY secret.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const { images, text, musicUrl, imgDuration, aspect, action } = body;

    // If action is "poll", just check the status of an existing render
    if (action === 'poll' && body.renderId) {
      const statusRes = await fetch(`${SHOTSTACK_API}/${body.renderId}`, {
        headers: { 'x-api-key': apiKey },
      });
      const statusData = await statusRes.json();
      return new Response(JSON.stringify({
        status: statusData.response?.status,
        url: statusData.response?.url,
        error: statusData.response?.error,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validate input
    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one image is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const duration = imgDuration || 3;
    const dims = aspect === '1:1' ? { width: 1080, height: 1080 }
               : aspect === '16:9' ? { width: 1920, height: 1080 }
               : { width: 1080, height: 1920 }; // default 9:16

    // Build Shotstack timeline
    const effects = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];
    const tracks: any[] = [];

    // Track 1: Image clips with Ken Burns effects + transitions
    const imageClips = images.map((url: string, i: number) => ({
      asset: { type: 'image', src: url },
      start: i * duration,
      length: duration,
      effect: effects[i % effects.length],
      transition: { in: 'fade', out: 'fade' },
    }));
    tracks.push({ clips: imageClips });

    // Track 2: Text overlay (if provided) — appears as a title clip spanning the whole video
    if (text) {
      const totalDuration = images.length * duration;
      tracks.push({
        clips: [{
          asset: {
            type: 'title',
            text: text,
            style: 'minimal',
            color: '#ffffff',
            size: 'large',
            background: 'rgba(0,0,0,0.5)',
            position: 'center',
          },
          start: 0,
          length: totalDuration,
          fit: 'crop',
        }],
      });
    }

    // Track 3: Branding text at bottom
    const totalDuration = images.length * duration;
    tracks.push({
      clips: [{
        asset: {
          type: 'title',
          text: '@study.with.anar  ·  @europath_education',
          style: 'minimal',
          color: '#c9a84c',
          size: 'small',
          position: 'bottom',
        },
        start: 0,
        length: totalDuration,
      }],
    });

    // Build the render request
    const renderBody: any = {
      timeline: {
        background: '#000000',
        tracks,
      },
      output: {
        format: 'mp4',
        resolution: 'sd',
        size: dims,
        aspectRatio: aspect === '1:1' ? '1:1' : aspect === '16:9' ? '16:9' : '9:16',
      },
    };

    // Add soundtrack if music URL provided
    if (musicUrl) {
      renderBody.timeline.soundtrack = {
        src: musicUrl,
        effect: 'fadeInFadeOut',
      };
    }

    // Submit render to Shotstack
    const renderRes = await fetch(SHOTSTACK_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(renderBody),
    });

    const renderData = await renderRes.json();

    if (!renderData.success) {
      return new Response(JSON.stringify({ error: renderData.message || 'Shotstack render failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const renderId = renderData.response.id;

    // Poll for completion (max ~120 seconds)
    let videoUrl = null;
    let status = 'rendering';
    const maxAttempts = 40;
    const pollInterval = 3000; // 3 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, pollInterval));
      const statusRes = await fetch(`${SHOTSTACK_API}/${renderId}`, {
        headers: { 'x-api-key': apiKey },
      });
      const statusData = await statusRes.json();
      status = statusData.response?.status || 'unknown';

      if (status === 'done') {
        videoUrl = statusData.response?.url;
        break;
      } else if (status === 'failed') {
        return new Response(JSON.stringify({ error: statusData.response?.error || 'Render failed', status: 'failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!videoUrl) {
      // Return the render ID so the client can poll later
      return new Response(JSON.stringify({
        renderId,
        status: 'rendering',
        message: 'Video is still rendering. Poll with action=poll and renderId.',
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      url: videoUrl,
      renderId,
      status: 'done',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('generate-video error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
