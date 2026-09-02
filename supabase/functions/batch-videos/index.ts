import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Photo categories (54 real Pexels photos) ───
// Photos 1-12: Universities, 13-26: Rome, 27-35: Milan, 36-49: Streets/lifestyle, 50: Pisa, 51-54: Students
const PHOTO_CATEGORIES: Record<string, string[]> = {
  universities: Array.from({ length: 12 }, (_, i) => photoUrl(i + 1)),
  rome:         Array.from({ length: 14 }, (_, i) => photoUrl(i + 13)),
  milan:        Array.from({ length: 9 },  (_, i) => photoUrl(i + 27)),
  streets:      Array.from({ length: 14 }, (_, i) => photoUrl(i + 36)),
  landmarks:    [photoUrl(50)],
  students:     Array.from({ length: 4 },  (_, i) => photoUrl(i + 51)),
};

function photoUrl(n: number): string {
  return `https://europatheducation.eu/images/gallery/full/italy_real_${String(n).padStart(2, '0')}.jpg`;
}

// All photos for random fallback
const ALL_PHOTOS: string[] = Object.values(PHOTO_CATEGORIES).flat();

// ─── Script system: surprising facts style ───
// Each variant has: script text, caption, image categories to use, and text overlays for each image
interface ScriptVariant {
  text: string;
  caption: string;
  imageCategories: string[];  // which photo categories match this script
  overlays: string[];         // text shown on each image (HTML)
}

const TOPIC_VARIANTS: Record<string, ScriptVariant[]> = {
  'италия': [
    {
      text: 'Знаете ли вы, что год обучения в итальянском университете стоит около тысячи евро? Это дешевле, чем многие частные вузы дома. При этом диплом признаётся во всей Европе. А стипендия DSU покрывает и обучение, и проживание. Не миф. Реальность.',
      caption: '🇮🇹 Знаете ли вы?\n\nОбучение в Италии — от 1000€/год\nДиплом признаётся в 47 странах\nСтипендия DSU покрывает всё\n\n📍 europatheducation.eu\n\n#studyinitaly #facts #italy',
      imageCategories: ['universities', 'students'],
      overlays: ['1000€ / год', '47 стран', 'Стипендия DSU', 'Диплом ЕС'],
    },
    {
      text: 'Болонский университет — старейший в мире. Он основан в 1088 году. Старше Оксфорда. Старше Кембриджа. И сегодня он принимает иностранных студентов без сложных экзаменов. Достаточно аттестата и языкового сертификата.',
      caption: '� Старейший университет мира\n\nБолонский — основан в 1088 году\nСтарше Оксфорда и Кембриджа\nПоступление без экзаменов\n\n📍 europatheducation.eu\n\n#bologna #university #history',
      imageCategories: ['universities', 'streets'],
      overlays: ['1088 год', 'Старше Оксфорда', 'Без экзаменов', 'Болонья'],
    },
    {
      text: 'В Италии студенты могут работать двадцать часов в неделю. Минимальная зарплата — девять евро в час. Это семьсот двадцать евро в месяц. Достаточно, чтобы покрыть аренду и еду. И при этом — учёба в одном из красивейших мест мира.',
      caption: '💼 Работа во время учёбы\n\n20 часов/неделю • 9€/час\n720€/месяц — аренда + еда\n\n📍 europatheducation.eu\n\n#workandstudy #italy #students',
      imageCategories: ['streets', 'students'],
      overlays: ['20 ч/неделю', '9€ / час', '720€ / месяц', 'Учёба + работа'],
    },
    {
      text: 'Итальянский студенческий ВНЖ даёт право путешествовать по двадцати семи странам Шенгена. Без виз. Париж на выходные? Берлин на концерт? Барселона на море? Всё это доступно с одним документом.',
      caption: '📄 ВНЖ Италии = 27 стран\n\nШенген без виз\nПариж • Берлин • Барселона\n\n📍 europatheducation.eu\n\n#schengen #residencepermit #italy',
      imageCategories: ['rome', 'milan', 'streets'],
      overlays: ['27 стран', 'Без виз', 'Шенген', 'Свобода'],
    },
    {
      text: 'В Италии девяносто семь университетов. Сорок один из них входит в мировой топ-500. Поступление без сложных экзаменов. Стоимость — от нуля до трёх тысяч евро в год. И при этом — бесплатная медицина для студентов. Задумайтесь.',
      caption: '� Факты об Италии\n\n97 университетов\n41 в топ-500 мира\nОт 0€ до 3000€/год\nБесплатная медицина\n\n📍 europatheducation.eu\n\n#facts #studyinitaly #top500',
      imageCategories: ['universities', 'students'],
      overlays: ['97 вузов', '41 в топ-500', '0–3000€/год', 'Бесплатная медицина'],
    },
    {
      text: 'Диплом итальянского университета признаётся в сорока семи странах. Это все страны Болонской системы. Включая США, Канаду, Великобританию. Один диплом — весь мир открыт. И стоит это в разы дешевле, чем учёба в Америке.',
      caption: '� Диплом Италии = мир\n\nПризнаётся в 47 странах\nСША • Канада • Великобритания\n\n📍 europatheducation.eu\n\n#diploma #bologna #world',
      imageCategories: ['universities', 'landmarks'],
      overlays: ['47 стран', 'Болонская система', 'США • Канада • UK', 'Один диплом'],
    },
    {
      text: 'Италия — единственная страна в Европе, где иностранцы могут получить высшее образование на английском языке за тысячу евро в год. Не за двадцать тысяч, как в Великобритании. Не за пятнадцать, как в Голландии. За тысячу. Подумайте об этом.',
      caption: '🇮🇹 Только в Италии\n\nОбразование на английском\n1000€/год — не 20000€\n\n📍 europatheducation.eu\n\n#english #italy #affordable',
      imageCategories: ['universities', 'milan'],
      overlays: ['1000€ / год', 'На английском', 'Не 20000€', 'Только Италия'],
    },
    {
      text: 'Италия ждёт иностранных студентов. Тёплый климат, Средиземное море, богатейшая культура. Но главное — доступное образование мирового уровня. Четыре из пяти студентов-иностранцев рекомендуют учёбу в Италии своим друзьям. Цифры говорят сами.',
      caption: '🇮� 4 из 5 рекомендуют\n\nТёплый климат • Мировое образование\n80% студентов рекомендуют\n\n📍 europatheducation.eu\n\n#studyinitaly #recommend #italy',
      imageCategories: ['streets', 'rome', 'milan'],
      overlays: ['4 из 5', '80% рекомендуют', 'Средиземное море', 'Мировой уровень'],
    },
  ],

  'стипендия': [
    {
      text: 'Стипендия DSU покрывает не только обучение. Она даёт место в общежитии. Бесплатное питание в столовой. И ежемесячные деньги на жизнь. Около семи тысяч евро в год. Полностью. Для каждого иностранного студента.',
      caption: '💰 Стипендия DSU\n\nОбучение + общежитие + питание\n7000€/год на руки\nДля каждого иностранца\n\n📍 europatheducation.eu\n\n#DSU #scholarship #free',
      imageCategories: ['universities', 'students'],
      overlays: ['Полное покрытие', 'Общежитие', 'Питание', '7000€/год'],
    },
    {
      text: 'Знаете ли вы, что в Италии можно учиться бесплатно? Не частично, а полностью. Стипендия DSU покрывает обучение, жильё и даёт стипендию. Единственное условие — справка о доходах семьи. И всё.',
      caption: '💰 Бесплатное обучение в Италии\n\nСтипендия DSU — полное покрытие\nТолько справка о доходах\n\n📍 europatheducation.eu\n\n#free #scholarship #DSU',
      imageCategories: ['universities', 'students'],
      overlays: ['Бесплатно', 'DSU', 'Жильё + стипендия', 'Просто'],
    },
    {
      text: 'В Италии существует пять типов стипендий для иностранцев. DSU — самая щедрая. Региональные гранты. Университетские скидки. Программы Erasmus. И правительственные стипендии. Выбор больше, чем вы думаете.',
      caption: '💰 5 типов стипендий\n\nDSU • Региональные • Erasmus\nУниверситетские • Правительственные\n\n📍 europatheducation.eu\n\n#scholarship #grants #italy',
      imageCategories: ['universities', 'rome'],
      overlays: ['5 типов', 'DSU', 'Erasmus', 'Выбор есть'],
    },
    {
      text: 'Стипендия DSU — это не кредит. Его не нужно возвращать. Это подарок от итальянского государства. Семь тысяч евро в год. Обучение, жильё, еда. Безвозмездно. Просто потому что вы решили учиться в Италии.',
      caption: '💰 DSU — не кредит!\n\nНе нужно возвращать\n7000€/год — подарок\n\n📍 europatheducation.eu\n\n#scholarship #gift #italy',
      imageCategories: ['universities', 'students'],
      overlays: ['Не кредит!', '7000€/год', 'Безвозмездно', 'Подарок'],
    },
    {
      text: 'Не верите, что можно учиться бесплатно? Каждый год тысячи иностранных студентов получают стипендию DSU в Италии. Полное покрытие. Общежитие. Питание. Стипендия на руки. Это не реклама. Это статистика.',
      caption: '💰 Тысячи получают DSU\n\nКаждый год • Полное покрытие\nЭто статистика, не реклама\n\n📍 europatheducation.eu\n\n#DSU #statistics #free',
      imageCategories: ['students', 'universities'],
      overlays: ['Тысячи', 'Каждый год', 'Статистика', 'Не реклама'],
    },
  ],

  'вид на жительство': [
    {
      text: 'Студенческий ВНЖ Италии открывает двадцать семь стран без виз. Шенген. Без границ. Париж, Берлин, Амстердам — на выходные. Без вопросов на границе. Один документ — весь континент.',
      caption: '📄 ВНЖ = 27 стран\n\nШенген без виз\nПариж • Берлин • Амстердам\n\n📍 europatheducation.eu\n\n#schengen #residencepermit',
      imageCategories: ['rome', 'milan', 'streets'],
      overlays: ['27 стран', 'Без виз', 'Шенген', 'Весь континент'],
    },
    {
      text: 'ВНЖ Италии для студентов продлевается автоматически. Закончили первый курс? Продление. Второй? Продление. Выпускник? Можно остаться на год для поиска работы. Италия не выгоняет своих студентов.',
      caption: '📄 ВНЖ продлевается автоматически\n\nКаждый год • Без проблем\n+1 год после выпуска\n\n📍 europatheducation.eu\n\n#residencepermit #italy #stay',
      imageCategories: ['universities', 'students'],
      overlays: ['Автопродление', 'Каждый год', '+1 год', 'Не выгоняют'],
    },
    {
      text: 'Хотите жить в Европе? Учёба в Италии — самый простой путь. Студенческий ВНЖ, свободное перемещение по Шенгену, право на работу. Через пять лет — постоянный вид на жительство. Через десять — гражданство.',
      caption: '🇮🇹 Путь к гражданству ЕС\n\nВНЖ → ПМЖ (5 лет) → Гражданство (10 лет)\n\n📍 europatheducation.eu\n\n#citizenship #europe #italy',
      imageCategories: ['rome', 'milan', 'landmarks'],
      overlays: ['ВНЖ', 'ПМЖ — 5 лет', 'Гражданство — 10 лет', 'ЕС'],
    },
    {
      text: 'Итальянский ВНЖ для студентов — это не просто бумажка. Это право на бесплатную медицину. Это банковский счёт. Это аренда квартиры. Это скидки на транспорт. Это жизнь в Европе на законных основаниях.',
      caption: '📄 ВНЖ — это возможности\n\nБесплатная медицина\nСчёт • Квартира • Скидки\n\n📍 europatheducation.eu\n\n#residencepermit #benefits',
      imageCategories: ['streets', 'rome'],
      overlays: ['Медицина', 'Банк', 'Квартира', 'Скидки'],
    },
  ],

  'поступление': [
    {
      text: 'Поступление в итальянский университет не требует ЕГЭ. Не требует SAT. Не требует сложных экзаменов. Нужен аттестат, языковой сертификат и мотивационное письмо. Всё. Двери открыты.',
      caption: '🎓 Поступление без ЕГЭ\n\nАттестат + Язык + Мотивация\nБез сложных экзаменов\n\n📍 europatheducation.eu\n\n#admission #noexam #italy',
      imageCategories: ['universities', 'students'],
      overlays: ['Без ЕГЭ', 'Без SAT', 'Аттестат + Язык', 'Двери открыты'],
    },
    {
      text: 'В Италии два потока поступления в год. Осенний — сентябрь. Весенний — февраль. Не успели осенью? Поступайте весной. Никакого давления. Никаких пропущенных лет.',
      caption: '🎓 2 потока в год\n\nСентябрь • Февраль\nНе успели — весной\n\n📍 europatheducation.eu\n\n#admission #twointakes #italy',
      imageCategories: ['universities', 'rome'],
      overlays: ['2 потока', 'Сентябрь', 'Февраль', 'Без давления'],
    },
    {
      text: 'Итальянские университеты принимают иностранцев на основе конкурса документов. Ваш аттестат конвертируется в итальянские баллы. Высокий средний балл? Высокие шансы. Никаких репетиторов. Никаких подготовительных курсов.',
      caption: '🎓 Конкурс документов\n\nАттестат → Баллы\nВысокий средний = высокие шансы\n\n📍 europatheducation.eu\n\n#admission #documents #easy',
      imageCategories: ['universities', 'students'],
      overlays: ['Конкурс документов', 'Аттестат → Баллы', 'Без репетиторов', 'Честно'],
    },
    {
      text: 'Можно поступить в итальянский университет на английском. Без знания итальянского. Более пятисот программ на английском языке. Бакалавриат и магистратура. Бизнес, инженерия, дизайн, мода.',
      caption: '🎓 На английском!\n\n500+ программ\nБез итальянского\nБизнес • Инженерия • Дизайн\n\n📍 europatheducation.eu\n\n#english #admission #italy',
      imageCategories: ['milan', 'universities'],
      overlays: ['На английском', '500+ программ', 'Без итальянского', 'Бизнес • Дизайн'],
    },
  ],

  'работа': [
    {
      text: 'Студент в Италии может зарабатывать семьсот двадцать евро в месяц. Двадцать часов в неделю, девять евро в час. Это покрывает аренду комнаты и еду. Учёба, которая окупает себя.',
      caption: '💼 720€/месяц\n\n20ч/неделю • 9€/час\nАренда + еда\n\n📍 europatheducation.eu\n\n#workandstudy #italy',
      imageCategories: ['streets', 'students'],
      overlays: ['720€/мес', '20 ч/неделю', '9€/час', 'Окупает себя'],
    },
    {
      text: 'После выпуска итальянский университет даёт год на поиск работы. ВНЖ продлевается автоматически. Нашли работу? Получаете рабочий ВНЖ. Не нашли? Возвращаетесь с европейским дипломом. Выигрыш в любом случае.',
      caption: '💼 +1 год после выпуска\n\nВНЖ продлевается\nРабочий ВНЖ или диплом\n\n📍 europatheducation.eu\n\n#jobsearch #italy #aftergrad',
      imageCategories: ['students', 'universities'],
      overlays: ['+1 год', 'ВНЖ продлевается', 'Рабочий ВНЖ', 'Выигрыш'],
    },
    {
      text: 'Стажировки в итальянских компаниях — это не просто работа. Это опыт в международной среде. Это резюме, которое открывает двери. Gucci, Ferrari, Armani, Barilla — все ищут стажёров. И многие остаются.',
      caption: '💼 Стажировки в Италии\n\nGucci • Ferrari • Armani\nМеждународный опыт\n\n📍 europatheducation.eu\n\n#internship #italy #brands',
      imageCategories: ['milan', 'streets'],
      overlays: ['Стажировки', 'Gucci • Ferrari', 'Armani', 'Остаются'],
    },
    {
      text: 'Минимальная зарплата в Италии — девять евро в час. Студент работает двадцать часов. Это триста шестьдесят евро в две недели. Жильё в студенческом общежитии — двести евро. Еда — сто пятьдесят. Математика простая.',
      caption: '💼 Математика студента\n\n9€/час → 360€/2 недели\nОбщежитие 200€ • Еда 150€\n\n📍 europatheducation.eu\n\n#math #workandstudy #italy',
      imageCategories: ['streets', 'students'],
      overlays: ['9€/час', '360€/2 нед', 'Жильё 200€', 'Еда 150€'],
    },
  ],
};

function getVariants(topic: string): ScriptVariant[] {
  const lower = topic.toLowerCase();
  if (lower.includes('стипен') || lower.includes('scholar') || lower.includes('бесплат')) return TOPIC_VARIANTS['стипендия'];
  if (lower.includes('виз') || lower.includes('permit') || lower.includes('жител') || lower.includes('внж')) return TOPIC_VARIANTS['вид на жительство'];
  if (lower.includes('поступ') || lower.includes('admiss') || lower.includes('универс')) return TOPIC_VARIANTS['поступление'];
  if (lower.includes('работ') || lower.includes('work') || lower.includes('job')) return TOPIC_VARIANTS['работа'];
  return TOPIC_VARIANTS['италия'];
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

function pickRandom<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// ─── Pick images matching the script's categories ───
function pickImagesForScript(variant: ScriptVariant, count: number): string[] {
  const matching: string[] = [];
  for (const cat of variant.imageCategories) {
    matching.push(...(PHOTO_CATEGORIES[cat] || []));
  }
  // If not enough matching photos, fill from all
  const pool = matching.length >= count ? matching : [...matching, ...ALL_PHOTOS];
  return pickRandom(pool, count);
}

// ─── ElevenLabs TTS (improved: more energetic, conversational) ───
async function generateVoiceover(text: string): Promise<{ audioBuffer: ArrayBuffer; contentType: string }> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) throw new Error('ElevenLabs API key not configured');

  // Charlie — deep, confident, energetic male voice (great for surprising facts)
  const voiceId = 'IKne3meq5aSn9XLyUdCD'; // Charlie

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
        stability: 0.35,        // lower = more variable/expressive
        similarity_boost: 0.80, // higher = more consistent voice
        style: 0.45,            // higher = more stylized/animated delivery
        use_speaker_boost: true,
      },
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

// ─── Shotstack render with text overlays ───
const SHOTSTACK_BASE = 'https://api.shotstack.io/edit/v1/render';

async function renderWithShotstack(images: string[], overlays: string[], voiceoverUrl: string, apiKey: string): Promise<string> {
  const imgDuration = 3.5;
  const effects = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  // Track 1: Image clips
  const imageClips = images.map((url, i) => ({
    asset: { type: 'image', src: url },
    start: i * imgDuration,
    length: imgDuration,
    effect: effects[i % effects.length],
    transition: { in: 'fade', out: 'fade' },
  }));

  // Track 2: Text overlays (HTML assets) — semi-transparent background + bold white text
  const textClips = overlays.slice(0, images.length).map((text, i) => ({
    asset: {
      type: 'html',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><div style="background:rgba(0,0,0,0.65);padding:12px 24px;border-radius:8px;border-left:4px solid #f59e0b;"><p style="margin:0;color:#ffffff;font-family:'Montserrat ExtraBold';font-size:42px;font-weight:800;letter-spacing:1px;">${text}</p></div></div>`,
      css: "p { margin: 0; }",
      width: 1080,
      height: 200,
    },
    start: i * imgDuration + 0.3,  // slight delay after image appears
    length: imgDuration - 0.6,     // end slightly before image transitions
    position: 'bottom',
    offset: { x: 0, y: 0.15 },
    transition: { in: 'slideUp', out: 'fade' },
  }));

  // Track 3: Voiceover audio
  const tracks: any[] = [
    { clips: imageClips },
    { clips: textClips },
    { clips: [{ asset: { type: 'audio', src: voiceoverUrl, volume: 1.0 }, start: 0, length: 'auto' }] },
  ];

  const renderBody = {
    timeline: {
      background: '#000000',
      tracks,
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

    const numVideos = Math.min(Math.max(parseInt(count) || 5, 1), 10);

    const variants = getVariants(topic);
    const selectedVariants = pickRandom(variants, Math.min(numVideos, variants.length));
    while (selectedVariants.length < numVideos) {
      selectedVariants.push(variants[selectedVariants.length % variants.length]);
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < numVideos; i++) {
      const variant = selectedVariants[i];
      const progress = `[${i + 1}/${numVideos}]`;

      try {
        // Pick 3-4 images matching the script's content categories
        const numImages = 3 + Math.floor(Math.random() * 2);
        const selectedImages = pickImagesForScript(variant, numImages);

        // 1. Generate voiceover
        console.log(`${progress} Generating voiceover...`);
        const { audioBuffer, contentType } = await generateVoiceover(variant.text);

        // 2. Upload voiceover
        const audioFileName = `voiceover_batch_${Date.now()}_${i}.mp3`;
        const voiceoverUrl = await uploadToStorage(audioBuffer, 'social-uploads', audioFileName, contentType, supabase);

        // 3. Render video with text overlays
        console.log(`${progress} Rendering video with text overlays...`);
        const videoUrl = await renderWithShotstack(selectedImages, variant.overlays, voiceoverUrl, shotstackKey);

        // 4. Download and store video
        const videoResp = await fetch(videoUrl);
        const videoBuffer = await videoResp.arrayBuffer();
        const videoFileName = `reel_batch_${Date.now()}_${i}.mp4`;
        const storedVideoUrl = await uploadToStorage(videoBuffer, 'social-uploads', videoFileName, 'video/mp4', supabase);

        // 5. Schedule post
        let post: any = null;
        if (schedule !== false) {
          const scheduledOffset = (i + 1) * 2 * 3600000;
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
          overlays: variant.overlays,
        });

        console.log(`${progress} Done!`);
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
