import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Script templates for common topics (Russian) ───
const SCRIPT_TEMPLATES: Record<string, { text: string; caption: string; images: string[] }> = {
  // Benefits of studying in Italy
  'италия': {
    text: 'Хотите учиться в Италии? Это проще, чем вы думаете. Топовые университеты, низкая стоимость обучения, стипендии DSU для иностранных студентов. Вид на жительство, возможность работать во время учёбы. Диплом ЕС признаётся во всём мире. EuroPath Education поможет вам на каждом шаге. Подавайте заявку сегодня.',
    caption: '🇮🇹 Преимущества обучения в Италии\n\nТоповые университеты • Низкая стоимость • Стипендии DSU • Вид на жительство • Диплом ЕС\n\n📍 Подавайте заявку: europatheducation.eu\n\n#studyinitaly #education #italy #euroeducation',
    images: ['italy_bg_01.jpg', 'italy_bg_05.jpg', 'italy_bg_10.jpg', 'italy_bg_15.jpg', 'italy_bg_20.jpg'],
  },
  // Scholarships
  'стипендия': {
    text: 'Стипендии DSU в Италии — ваш шанс учиться бесплатно. Региональные стипендии покрывают обучение, проживание и питание. Доступны для всех иностранных студентов. Не упустите возможность. EuroPath Education поможет с оформлением документов. Подавайте заявку на europatheducation.eu.',
    caption: '💰 Стипендии DSU в Италии\n\nБесплатное обучение • Проживание • Питание\nДоступно для иностранных студентов!\n\n📍 Заявка: europatheducation.eu\n\n#scholarship #studyinitaly #DSU #education',
    images: ['italy_bg_03.jpg', 'italy_bg_07.jpg', 'italy_bg_12.jpg', 'italy_bg_18.jpg'],
  },
  // Residence permit
  'вид на жительство': {
    text: 'Вид на жительство в Италии через обучение. Получите ВНЖ на весь период учёбы. Возможность путешествовать по Шенгену. Право на работу 20 часов в неделю. Продление после окончания. EuroPath Education — ваш путь к европейскому образованию. Начните на europatheducation.eu.',
    caption: '📄 ВНЖ в Италии через обучение\n\nПутешествия по Шенгену • Работа 20ч/неделю • Продление\n\n📍 Начните: europatheducation.eu\n\n#residencepermit #italy #studyabroad #euroeducation',
    images: ['italy_bg_02.jpg', 'italy_bg_08.jpg', 'italy_bg_14.jpg', 'italy_bg_22.jpg'],
  },
  // Admission / application
  'поступление': {
    text: 'Поступление в итальянские университеты без экзаменов. Простая процедура зачисления. Документы об образовании признаются. Зачисление два раза в год — осень и весна. EuroPath Education оформит все документы за вас. Успейте подать заявку на europatheducation.eu.',
    caption: '🎓 Поступление в Италию без экзаменов\n\nПростая процедура • 2 потока в год • Документы под ключ\n\n📍 Заявка: europatheducation.eu\n\n#admission #italy #university #studyabroad',
    images: ['italy_bg_04.jpg', 'italy_bg_09.jpg', 'italy_bg_16.jpg', 'italy_bg_25.jpg'],
  },
  // Work while studying
  'работа': {
    text: 'Работа во время учёбы в Италии. Студенты имеют право работать 20 часов в неделю. Минимальная зарплата — 9 евро в час. Стажировки в международных компаниях. Опыт работы в ЕС для вашего резюме. EuroPath Education — ваш старт в Европе. Подавайте заявку на europatheducation.eu.',
    caption: '💼 Работа во время учёбы в Италии\n\n20 часов/неделю • 9€/час • Стажировки в ЕС\n\n📍 Заявка: europatheducation.eu\n\n#workandstudy #italy #students #euroeducation',
    images: ['italy_bg_06.jpg', 'italy_bg_11.jpg', 'italy_bg_17.jpg', 'italy_bg_23.jpg'],
  },
  // Generic / default
  'default': {
    text: 'Образование в Италии открывает двери в Европу. Качественное обучение, доступные цены, стипендии для иностранных студентов. EuroPath Education — ваш надёжный партнёр. Полное сопровождение от поступления до ВНЖ. Начните свой путь на europatheducation.eu.',
    caption: '🇮🇹 Образование в Италии с EuroPath Education\n\nПолное сопровождение • Поступление • ВНЖ • Стипендии\n\n📍 Заявка: europatheducation.eu\n\n#studyinitaly #education #euroeducation #italy',
    images: ['italy_bg_01.jpg', 'italy_bg_05.jpg', 'italy_bg_10.jpg', 'italy_bg_15.jpg', 'italy_bg_20.jpg'],
  },
};

function getScriptTemplate(topic: string) {
  const lower = topic.toLowerCase();
  for (const [key, template] of Object.entries(SCRIPT_TEMPLATES)) {
    if (key === 'default') continue;
    if (lower.includes(key) || key.includes(lower)) return template;
  }
  // Try partial matches
  if (lower.includes('стипен') || lower.includes('scholar') || lower.includes('бесплат')) return SCRIPT_TEMPLATES['стипендия'];
  if (lower.includes('виз') || lower.includes('permit') || lower.includes('жител')) return SCRIPT_TEMPLATES['вид на жительство'];
  if (lower.includes('поступ') || lower.includes('admiss') || lower.includes('универс')) return SCRIPT_TEMPLATES['поступление'];
  if (lower.includes('работ') || lower.includes('work') || lower.includes('job')) return SCRIPT_TEMPLATES['работа'];
  if (lower.includes('итал') || lower.includes('ital') || lower.includes('обучен')) return SCRIPT_TEMPLATES['италия'];
  return SCRIPT_TEMPLATES['default'];
}

// ─── ElevenLabs TTS ───
async function generateVoiceover(text: string, apiKey: string): Promise<{ audioBuffer: ArrayBuffer; contentType: string }> {
  const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Default female voice (Bella)
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs error: ${resp.status} ${errText}`);
  }

  const audioBuffer = await resp.arrayBuffer();
  return { audioBuffer, contentType: 'audio/mpeg' };
}

// ─── Upload to Supabase Storage ───
async function uploadToStorage(buffer: ArrayBuffer, path: string, contentType: string, supabaseUrl: string, serviceKey: string): Promise<string> {
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Storage upload error: ${resp.status} ${errText}`);
  }

  // Return public URL
  const pathParts = path.split('/');
  const bucket = pathParts[0];
  const filePath = pathParts.slice(1).join('/');
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
}

// ─── Shotstack render ───
const SHOTSTACK_BASE = Deno.env.get('SHOTSTACK_SANDBOX') === 'false'
  ? 'https://api.shotstack.io/edit/v1/render'
  : 'https://api.shotstack.io/edit/stage/render';

async function renderWithShotstack(images: string[], voiceoverUrl: string, musicUrl: string | null, text: string, apiKey: string): Promise<string> {
  const imgDuration = 3;
  const totalDuration = images.length * imgDuration;
  const effects = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  const tracks: any[] = [];

  // Track 1: Image clips with Ken Burns
  const imageClips = images.map((url, i) => ({
    asset: { type: 'image', src: url },
    start: i * imgDuration,
    length: imgDuration,
    effect: effects[i % effects.length],
    transition: { in: 'fade', out: 'fade' },
  }));
  tracks.push({ clips: imageClips });

  // Track 2: Branding text at bottom
  tracks.push({
    clips: [{
      asset: {
        type: 'title',
        text: 'europatheducation.eu',
        style: 'minimal',
        color: '#c9a84c',
        size: 'small',
        position: 'bottom',
      },
      start: 0,
      length: totalDuration,
    }],
  });

  // Build render body
  const renderBody: any = {
    timeline: {
      background: '#000000',
      tracks,
    },
    output: {
      format: 'mp4',
      resolution: 'sd',
      size: { width: 1080, height: 1920 },
    },
  };

  // Use voiceover as primary soundtrack, music as secondary if provided
  if (voiceoverUrl) {
    renderBody.timeline.soundtrack = {
      src: voiceoverUrl,
      effect: 'fadeInFadeOut',
    };
  }

  // Submit render
  const renderRes = await fetch(SHOTSTACK_BASE, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(renderBody),
  });
  const renderData = await renderRes.json();

  if (!renderData.success) {
    throw new Error(`Shotstack render failed: ${renderData.message || JSON.stringify(renderData)}`);
  }

  const renderId = renderData.response.id;

  // Poll for completion (max ~3 minutes)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(`${SHOTSTACK_BASE}/${renderId}`, {
      headers: { 'x-api-key': apiKey },
    });
    const statusData = await statusRes.json();
    const status = statusData.response?.status;

    if (status === 'done') {
      return statusData.response?.url;
    } else if (status === 'failed') {
      throw new Error(`Render failed: ${statusData.response?.error || 'unknown'}`);
    }
  }

  throw new Error('Render timeout — video still processing after 3 minutes');
}

// ─── Schedule as reel post ───
async function scheduleReelPost(videoUrl: string, caption: string, supabaseUrl: string, serviceKey: string): Promise<any> {
  // Get next post_number
  const maxResp = await fetch(`${supabaseUrl}/rest/v1/threads_scheduled_posts?select=post_number&order=post_number.desc&limit=1`, {
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
    },
  });
  const maxData = await maxResp.json();
  const nextPostNumber = (maxData[0]?.post_number || 0) + 1;

  // Insert into threads_scheduled_posts table
  const resp = await fetch(`${supabaseUrl}/rest/v1/threads_scheduled_posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      post_number: nextPostNumber,
      text: caption,
      image_url: videoUrl,
      scheduled_utc: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      status: 'pending',
      post_type: 'reel',
      platforms_status: { threads: 'pending', facebook: 'pending', instagram: 'pending' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to schedule post: ${resp.status} ${errText}`);
  }

  return await resp.json();
}

// ─── Main handler ───
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const shotstackKey = Deno.env.get('SHOTSTACK_API_KEY');
  const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!shotstackKey) return new Response(JSON.stringify({ error: 'Shotstack API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!elevenLabsKey) return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!supabaseUrl || !supabaseServiceKey) return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
    const { topic, action } = body;

    if (action === 'poll' && body.renderId) {
      // Poll existing Shotstack render
      const statusRes = await fetch(`${SHOTSTACK_BASE}/${body.renderId}`, {
        headers: { 'x-api-key': shotstackKey },
      });
      const statusData = await statusRes.json();
      return new Response(JSON.stringify({
        status: statusData.response?.status,
        url: statusData.response?.url,
        error: statusData.response?.error,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!topic || typeof topic !== 'string') {
      return new Response(JSON.stringify({ error: 'Topic is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 1. Get script template based on topic
    const template = getScriptTemplate(topic);
    const scriptText = template.text;
    const caption = template.caption;
    const imageUrls = template.images.map((img: string) => `https://europatheducation.eu/images/gallery/full/${img}`);

    // 2. Generate Russian voiceover with ElevenLabs
    const { audioBuffer, contentType } = await generateVoiceover(scriptText, elevenLabsKey);

    // 3. Upload voiceover to Supabase storage
    const audioFileName = `voiceover_${Date.now()}.mp3`;
    const audioPath = `social-uploads/${audioFileName}`;
    const voiceoverUrl = await uploadToStorage(audioBuffer, audioPath, contentType, supabaseUrl, supabaseServiceKey);

    // 4. Render video with Shotstack (images + voiceover)
    const videoUrl = await renderWithShotstack(imageUrls, voiceoverUrl, null, scriptText, shotstackKey);

    // 5. Download video and upload to Supabase storage
    const videoResp = await fetch(videoUrl);
    const videoBuffer = await videoResp.arrayBuffer();
    const videoFileName = `reel_${Date.now()}.mp4`;
    const videoPath = `social-uploads/${videoFileName}`;
    const storedVideoUrl = await uploadToStorage(videoBuffer, videoPath, 'video/mp4', supabaseUrl, supabaseServiceKey);

    // 6. Schedule as reel post
    const post = await scheduleReelPost(storedVideoUrl, caption, supabaseUrl, supabaseServiceKey);

    return new Response(JSON.stringify({
      success: true,
      videoUrl: storedVideoUrl,
      script: scriptText,
      caption,
      postId: post[0]?.id,
      scheduledAt: post[0]?.scheduled_at,
      message: 'Video generated and scheduled successfully!',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('auto-video error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
