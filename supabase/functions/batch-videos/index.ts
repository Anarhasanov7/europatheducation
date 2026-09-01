import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── 54 real Italy photos (uploaded to gallery) ───
const REAL_PHOTOS: string[] = Array.from({ length: 54 }, (_, i) =>
  `https://europatheducation.eu/images/gallery/full/italy_real_${String(i + 1).padStart(2, '0')}.jpg`
);

// ─── Script variation system ───
// Each topic has multiple script variants with different phrasing
// This allows generating many unique videos on the same topic

interface ScriptVariant {
  text: string;
  caption: string;
}

const TOPIC_VARIANTS: Record<string, ScriptVariant[]> = {
  'италия': [
    {
      text: 'Хотите учиться в Италии? Это проще, чем вы думаете. Топовые университеты, низкая стоимость обучения, стипендии DSU. Диплом ЕС признаётся во всём мире. EuroPath Education поможет вам на каждом шаге.',
      caption: '🇮🇹 Преимущества обучения в Италии\n\nТоповые университеты • Низкая стоимость • Стипендии DSU • Диплом ЕС\n\n📍 Подавайте заявку: europatheducation.eu\n\n#studyinitaly #education #italy',
    },
    {
      text: 'Италия — идеальное место для учёбы. Доступные университеты, богатая культура, вкусная еда. Стипендии покрывают обучение и проживание. EuroPath Education — ваш путь к европейскому диплому.',
      caption: '🇮🇹 Почему стоит выбрать Италию?\n\nДоступное образование • Богатая культура • Стипендии\n\n📍 Начните: europatheducation.eu\n\n#studyinitaly #italy #euroeducation',
    },
    {
      text: 'Обучение в Италии открывает двери в Европу. Качественное образование, международное окружение, возможность путешествовать по Шенгену. EuroPath Education сделает ваш переезд лёгким.',
      caption: '🇮🇹 Учёба в Италии — ваш старт в Европе\n\nКачество • Международная среда • Шенген\n\n📍 Заявка: europatheducation.eu\n\n#studyabroad #italy #education',
    },
    {
      text: 'Итальянские университеты входят в топ-500 мировых вузов. Поступление без сложных экзаменов. Низкие цены, высокий уровень. EuroPath Education поможет с документами и поступлением.',
      caption: '🎓 Топовые университеты Италии\n\nТоп-500 мира • Без сложных экзаменов • Доступные цены\n\n📍 Заявка: europatheducation.eu\n\n#university #italy #admission',
    },
    {
      text: 'Думаете об учёбе за границей? Рассмотрите Италию. Тёплый климат, дружелюбные люди, доступное образование. Виды на жительство для студентов. EuroPath Education — ваш надёжный партнёр.',
      caption: '🇮🇹 Учёба за границей? Выбирайте Италию!\n\nТёплый климат • Доступное образование • ВНЖ\n\n📍 Подавайте заявку: europatheducation.eu\n\n#studyinitaly #abroad #education',
    },
    {
      text: 'Италия ждёт иностранных студентов. Поступайте в топовые вузы, получайте стипендии, наслаждайтесь итальянской культурой. EuroPath Education сопровождает вас от заявки до диплома.',
      caption: '🇮🇹 Италия ждёт вас!\n\nТоповые вузы • Стипендии • Итальянская культура\n\n📍 Начните: europatheducation.eu\n\n#studyinitaly #scholarship #italy',
    },
    {
      text: 'Почему всё больше студентов выбирают Италию? Доступные цены, качественное образование, европейский диплом. Возможность работать во время учёбы. EuroPath Education поможет вам поступить.',
      caption: '🇮🇹 Студенты выбирают Италию\n\nДоступные цены • Европейский диплом • Работа\n\n📍 Заявка: europatheducation.eu\n\n#studyinitaly #students #europe',
    },
    {
      text: 'Образование в Италии — инвестиция в будущее. Международно признанный диплом, опыт жизни в Европе, новые друзья со всего мира. EuroPath Education — ваш проводник в итальянское образование.',
      caption: '🎓 Инвестируйте в будущее с Италией\n\nПризнанный диплом • Опыт в Европе • Друзья\n\n📍 Начните: europatheducation.eu\n\n#education #italy #future',
    },
  ],
  'стипендия': [
    {
      text: 'Стипендии DSU в Италии — ваш шанс учиться бесплатно. Покрывают обучение, проживание и питание. Доступны всем иностранным студентам. EuroPath Education поможет с оформлением.',
      caption: '💰 Стипендии DSU в Италии\n\nБесплатное обучение • Проживание • Питание\n\n📍 Заявка: europatheducation.eu\n\n#scholarship #DSU #studyinitaly',
    },
    {
      text: 'Учиться бесплатно в Италии? Да, это реально. Региональные стипендии DSU покрывают все расходы. Не упустите свой шанс. EuroPath Education оформит документы за вас.',
      caption: '💰 Бесплатное обучение в Италии!\n\nСтипендии DSU покрывают всё\n\n📍 Подавайте заявку: europatheducation.eu\n\n#scholarship #freeeducation #italy',
    },
    {
      text: 'Стипендии для иностранных студентов в Италии. DSU, региональные гранты, университетские стипендии. Полное или частичное покрытие. EuroPath Education подберёт лучший вариант для вас.',
      caption: '💰 Стипендии для иностранцев в Италии\n\nDSU • Гранты • Университетские программы\n\n📍 Заявка: europatheducation.eu\n\n#scholarship #italy #grants',
    },
    {
      text: 'Не можете позволить учёбу за границей? В Италии есть стипендии DSU для иностранных студентов. Они покрывают обучение, общежитие и стипендию на жизнь. EuroPath Education поможет получить.',
      caption: '💰 Стипендии DSU — ваш шанс!\n\nОбучение + общежитие + стипендия\n\n📍 Начните: europatheducation.eu\n\n#DSU #scholarship #studyinitaly',
    },
    {
      text: 'Бесплатное образование в Италии — не миф. Стипендия DSU доступна каждому иностранному студенту. Подавайте заявку и учитесь бесплатно. EuroPath Education — ваш помощник.',
      caption: '🎓 Бесплатное образование в Италии\n\nСтипендия DSU для каждого\n\n📍 Заявка: europatheducation.eu\n\n#freeeducation #italy #scholarship',
    },
  ],
  'вид на жительство': [
    {
      text: 'Вид на жительство в Италии через обучение. ВНЖ на весь период учёбы, путешествия по Шенгену, право на работу. EuroPath Education — ваш путь к европейскому ВНЖ.',
      caption: '📄 ВНЖ в Италии через учёбу\n\nШенген • Работа 20ч/неделю • Продление\n\n📍 Начните: europatheducation.eu\n\n#residencepermit #italy #study',
    },
    {
      text: 'Студенческий ВНЖ Италии — ваши возможности. Путешествуйте по Европе, работайте 20 часов в неделю, продлевайте после выпуска. EuroPath Education поможет с оформлением.',
      caption: '📄 Студенческий ВНЖ Италии\n\nПутешествия • Работа • Продление\n\n📍 Заявка: europatheducation.eu\n\n#residencepermit #studyinitaly #europe',
    },
    {
      text: 'Хотите жить в Европе? Учёба в Италии — самый простой путь. Студенческий ВНЖ, свободное перемещение по Шенгену, возможность работы. EuroPath Education сделает всё легко.',
      caption: '🇮🇹 Жизнь в Европе через учёбу\n\nВНЖ • Шенген • Работа\n\n📍 Начните: europatheducation.eu\n\n#residencepermit #europe #italy',
    },
    {
      text: 'ВНЖ Италии для студентов: просто, быстро, надёжно. Получите вид на жительство на весь срок обучения. Свобода путешествий, право на работу. EuroPath Education — ваш надёжный партнёр.',
      caption: '📄 ВНЖ для студентов Италии\n\nПросто • Быстро • Надёжно\n\n📍 Заявка: europatheducation.eu\n\n#residencepermit #italy #students',
    },
  ],
  'поступление': [
    {
      text: 'Поступление в итальянские университеты без сложных экзаменов. Простая процедура, документы на русском признаются. Два потока в год. EuroPath Education оформит всё за вас.',
      caption: '🎓 Поступление в Италию без экзаменов\n\nПростая процедура • 2 потока • Документы под ключ\n\n📍 Заявка: europatheducation.eu\n\n#admission #italy #university',
    },
    {
      text: 'Как поступить в итальянский вуз? Подготовьте документы, подайте заявку, получите приглашение. EuroPath Education сделает процесс поступления простым и понятным.',
      caption: '🎓 Как поступить в Италию?\n\nДокументы • Заявка • Приглашение\n\n📍 Начните: europatheducation.eu\n\n#admission #studyinitaly #howto',
    },
    {
      text: 'Поступление в Италию стало проще. Не нужны сложные экзамены, достаточно аттестата. Зачисление два раза в год — осень и весна. EuroPath Education поможет на каждом этапе.',
      caption: '🎓 Поступление в Италию — это просто\n\nБез экзаменов • 2 потока в год\n\n📍 Заявка: europatheducation.eu\n\n#admission #italy #easy',
    },
    {
      text: 'Итальянские университеты принимают иностранных студентов без вступительных экзаменов. Нужны только документы об образовании. EuroPath Education оформит всё под ключ.',
      caption: '🎓 Италия без вступительных экзаменов\n\nТолько документы об образовании\n\n📍 Начните: europatheducation.eu\n\n#admission #italy #documents',
    },
  ],
  'работа': [
    {
      text: 'Работа во время учёбы в Италии. Студенты могут работать 20 часов в неделю. Минимальная зарплата 9 евро в час. Стажировки в международных компаниях. EuroPath Education — ваш старт.',
      caption: '💼 Работа во время учёбы в Италии\n\n20ч/неделю • 9€/час • Стажировки\n\n📍 Заявка: europatheducation.eu\n\n#workandstudy #italy #students',
    },
    {
      text: 'Совмещайте учёбу и работу в Италии. Право на 20 часов в неделю, оплачиваемые стажировки, опыт работы в ЕС. EuroPath Education поможет начать вашу карьеру в Европе.',
      caption: '💼 Учёба + Работа в Италии\n\n20ч/неделю • Стажировки • Опыт в ЕС\n\n📍 Начните: europatheducation.eu\n\n#workandstudy #career #italy',
    },
    {
      text: 'Студенческая работа в Италии — реальность. Работайте в кафе, магазинах, офисах. Минимум 9 евро в час. Накопите опыт и деньги для жизни. EuroPath Education поможет с переездом.',
      caption: '💼 Студенческая работа в Италии\n\n9€/час • Кафе • Офисы • Магазины\n\n📍 Заявка: europatheducation.eu\n\n#workandstudy #italy #students',
    },
    {
      text: 'Опыт работы в Европе уже во время учёбы. Италия даёт студентам право работать 20 часов в неделю. Стажировки в международных компаниях. EuroPath Education — ваш путь в Европу.',
      caption: '💼 Опыт работы в ЕС во время учёбы\n\n20ч/неделю • Международные компании\n\n📍 Начните: europatheducation.eu\n\n#workandstudy #europe #internship',
    },
  ],
};

// Default variants (used when topic doesn't match any specific category)
const DEFAULT_VARIANTS: ScriptVariant[] = TOPIC_VARIANTS['италия'];

function getVariants(topic: string): ScriptVariant[] {
  const lower = topic.toLowerCase();
  if (lower.includes('стипен') || lower.includes('scholar') || lower.includes('бесплат')) return TOPIC_VARIANTS['стипендия'];
  if (lower.includes('виз') || lower.includes('permit') || lower.includes('жител') || lower.includes('внж')) return TOPIC_VARIANTS['вид на жительство'];
  if (lower.includes('поступ') || lower.includes('admiss') || lower.includes('универс')) return TOPIC_VARIANTS['поступление'];
  if (lower.includes('работ') || lower.includes('work') || lower.includes('job')) return TOPIC_VARIANTS['работа'];
  return TOPIC_VARIANTS['италия'] || DEFAULT_VARIANTS;
}

// ─── Shuffle array (Fisher-Yates) ───
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Pick N unique items from array ───
function pickRandom<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// ─── ElevenLabs TTS ───
async function generateVoiceover(text: string): Promise<{ audioBuffer: ArrayBuffer; contentType: string }> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) throw new Error('ElevenLabs API key not configured');

  const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah — natural female

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
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs error: ${resp.status} ${errText}`);
  }

  return { audioBuffer: await resp.arrayBuffer(), contentType: 'audio/mpeg' };
}

// ─── Upload to Supabase Storage ───
async function uploadToStorage(buffer: ArrayBuffer, bucket: string, fileName: string, contentType: string, supabase: any): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(fileName, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload error: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── Shotstack render ───
const SHOTSTACK_BASE = 'https://api.shotstack.io/edit/v1/render';

async function renderWithShotstack(images: string[], voiceoverUrl: string, apiKey: string): Promise<string> {
  const imgDuration = 3.5;
  const effects = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  const imageClips = images.map((url, i) => ({
    asset: { type: 'image', src: url },
    start: i * imgDuration,
    length: imgDuration,
    effect: effects[i % effects.length],
    transition: { in: 'fade', out: 'fade' },
  }));

  const renderBody = {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: imageClips },
        { clips: [{ asset: { type: 'audio', src: voiceoverUrl, volume: 1.0 }, start: 0, length: 'auto' }] },
      ],
    },
    output: { format: 'mp4', resolution: 'sd', size: { width: 1080, height: 1920 } },
  };

  const renderRes = await fetch(SHOTSTACK_BASE, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(renderBody),
  });
  const renderData = await renderRes.json();

  if (!renderData.success) throw new Error(`Shotstack render failed: ${renderData.message || JSON.stringify(renderData)}`);

  const renderId = renderData.response.id;

  // Poll for completion (max ~3 minutes)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(`${SHOTSTACK_BASE}/${renderId}`, { headers: { 'x-api-key': apiKey } });
    const statusData = await statusRes.json();
    const status = statusData.response?.status;
    if (status === 'done') return statusData.response?.url;
    if (status === 'failed') throw new Error(`Render failed: ${statusData.response?.error || 'unknown'}`);
  }

  throw new Error('Render timeout');
}

// ─── Schedule reel post ───
async function scheduleReelPost(videoUrl: string, caption: string, supabase: any, scheduledOffset: number): Promise<any> {
  const { data: maxData } = await supabase
    .from('threads_scheduled_posts')
    .select('post_number')
    .order('post_number', { ascending: false })
    .limit(1);
  const nextPostNumber = (maxData[0]?.post_number || 0) + 1;

  const { data, error } = await supabase
    .from('threads_scheduled_posts')
    .insert({
      post_number: nextPostNumber,
      text: caption,
      image_url: videoUrl,
      scheduled_utc: new Date(Date.now() + scheduledOffset).toISOString(),
      status: 'pending',
      post_type: 'reel',
      platforms_status: { threads: 'pending', facebook: 'pending', instagram: 'pending' },
    })
    .select();

  if (error) throw new Error(`Failed to schedule post: ${error.message}`);
  return data;
}

// ─── Main handler ───
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const shotstackKey = Deno.env.get('SHOTSTACK_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!shotstackKey) return new Response(JSON.stringify({ error: 'Shotstack API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!supabaseUrl || !supabaseServiceKey) return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { topic, count = 5, schedule = true } = body;

    if (!topic || typeof topic !== 'string') {
      return new Response(JSON.stringify({ error: 'Topic is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const numVideos = Math.min(Math.max(parseInt(count) || 5, 1), 10); // 1-10 videos

    // Get script variants for this topic
    const variants = getVariants(topic);
    // Shuffle variants and pick N unique ones
    const selectedVariants = pickRandom(variants, Math.min(numVideos, variants.length));
    // If we need more videos than variants, cycle through with different image sets
    while (selectedVariants.length < numVideos) {
      selectedVariants.push(variants[selectedVariants.length % variants.length]);
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < numVideos; i++) {
      const variant = selectedVariants[i];
      const progress = `[${i + 1}/${numVideos}]`;

      try {
        console.log(`${progress} Generating video for topic: ${topic}`);

        // Pick 3-4 random real photos for this video
        const numImages = 3 + Math.floor(Math.random() * 2); // 3 or 4 images
        const selectedImages = pickRandom(REAL_PHOTOS, numImages);

        // 1. Generate voiceover
        console.log(`${progress} Generating voiceover...`);
        const { audioBuffer, contentType } = await generateVoiceover(variant.text);

        // 2. Upload voiceover
        const audioFileName = `voiceover_batch_${Date.now()}_${i}.mp3`;
        const voiceoverUrl = await uploadToStorage(audioBuffer, 'social-uploads', audioFileName, contentType, supabase);

        // 3. Render video
        console.log(`${progress} Rendering video with Shotstack...`);
        const videoUrl = await renderWithShotstack(selectedImages, voiceoverUrl, shotstackKey);

        // 4. Download and store video
        const videoResp = await fetch(videoUrl);
        const videoBuffer = await videoResp.arrayBuffer();
        const videoFileName = `reel_batch_${Date.now()}_${i}.mp4`;
        const storedVideoUrl = await uploadToStorage(videoBuffer, 'social-uploads', videoFileName, 'video/mp4', supabase);

        // 5. Schedule post (spread throughout the day — every 2-3 hours)
        let post: any = null;
        if (schedule !== false) {
          const scheduledOffset = (i + 1) * 2 * 3600000; // 2 hours apart
          post = await scheduleReelPost(storedVideoUrl, variant.caption, supabase, scheduledOffset);
        }

        results.push({
          index: i + 1,
          success: true,
          videoUrl: storedVideoUrl,
          script: variant.text,
          caption: variant.caption,
          postId: post?.[0]?.id,
          imagesUsed: numImages,
        });

        console.log(`${progress} Done! Video: ${storedVideoUrl}`);
      } catch (err) {
        console.error(`${progress} Error:`, err);
        errors.push({ index: i + 1, error: err.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      topic,
      totalRequested: numVideos,
      totalGenerated: results.length,
      totalFailed: errors.length,
      results,
      errors,
      message: `Generated ${results.length}/${numVideos} videos${schedule !== false ? ' and scheduled them' : ''}`,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('batch-videos error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
