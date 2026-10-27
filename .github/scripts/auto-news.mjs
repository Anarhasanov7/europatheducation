// Auto-News for EuroPath Education
// Fetches Italian/EU education RSS feeds, scores relevance, dedups,
// translates IT→RU (primary) and IT/EN→EN, rewrites, and publishes
// STATIC HTML pages (real indexable URLs) + regenerates index pages
// and sitemap. Runs daily via GitHub Actions — same engine as GTDIB,
// upgraded to static-site generation for SEO.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://europatheducation.eu';
const MAX_ARTICLES_PER_RUN = 5;
const REGISTRY_PATH = join(ROOT, 'news', 'articles.json');

// ─── Feeds: popular Italian sources + international education ───
const FEEDS = [
  { name: 'Google News IT: Università', lang: 'it', category: 'admission',
    url: 'https://news.google.com/rss/search?q=universit%C3%A0+OR+immatricolazioni+OR+iscrizioni+universit%C3%A0&hl=it&gl=IT&ceid=IT:it' },
  { name: 'Google News IT: Borse di studio', lang: 'it', category: 'scholarship',
    url: 'https://news.google.com/rss/search?q=%22borsa+di+studio%22+OR+%22borse+di+studio%22+OR+DSU+OR+%22diritto+allo+studio%22&hl=it&gl=IT&ceid=IT:it' },
  { name: 'Google News IT: Studenti internazionali', lang: 'it', category: 'visa',
    url: 'https://news.google.com/rss/search?q=%22studenti+internazionali%22+OR+%22studenti+stranieri%22+OR+%22visto+per+studio%22+OR+Universitaly&hl=it&gl=IT&ceid=IT:it' },
  { name: 'Google News IT: Erasmus & mobilità', lang: 'it', category: 'mobility',
    url: 'https://news.google.com/rss/search?q=Erasmus+OR+%22studio+all%27estero%22+OR+%22mobilit%C3%A0+studentesca%22&hl=it&gl=IT&ceid=IT:it' },
  { name: 'Google News IT: Alloggi studenti', lang: 'it', category: 'housing',
    url: 'https://news.google.com/rss/search?q=%22alloggi+studenteschi%22+OR+%22alloggi+per+studenti%22+OR+%22mensa+universitaria%22+OR+%22costo+della+vita%22+studenti&hl=it&gl=IT&ceid=IT:it' },
  { name: 'Corriere: Scuola', lang: 'it', category: 'admission',
    url: 'https://www.corriere.it/rss/scuola.xml' },
  { name: 'The PIE News', lang: 'en', category: 'admission',
    url: 'https://www.thepienews.com/feed/' },
];

// Must have ≥1 of these (Italian education domain)
const MUST_KEYWORDS = [
  'università','universita','university','studenti','studentesse','students',
  'borsa di studio','borse di studio','scholarship','scholarships','grant',
  'immatricolaz','iscrizion','enrol','admission','ammissione','immatricolarsi',
  'laurea','laureati','degree','master','dottorato','phd','doctorate',
  'visto','visa','erasmus','mobilità','mobility','exchange',
  'diritto allo studio','dsu','alloggi','housing','mensa','dormitor',
  'tirocinio','internship','studio all\'estero','study abroad','abroad',
  'lingua italiana','afam','accademia','ranking','qs','politecnico',
  'bando','scadenza','deadline','tassa universitaria','tasse','retta',
  'post-laurea','formazione','corsi di laurea','open day','orientamento',
];

const SKIP_WORDS = [
  'football','futbol','calcio','serie a','serie b','champions league','milan inter',
  'juventus','napoli','roma fc','derby','gossip','grande fratello','sanremo',
  'tragedia','morto','ucciso','killed','murder','omicidio','incidente mortale',
  'guerra','war','missile','bombardamento','airstrike','attentato','terror',
  'elezioni','election','parlamento','senato','scandalo','corruzione','arrest',
  'droga','drug','spaccio','evasione','fraud','meteo','temporale','terremoto',
];

// Fallback images by category (verified Unsplash, no hotlink issues)
const FALLBACK_IMAGES = {
  scholarship: [
    'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=1200&h=675&fit=crop',
  ],
  admission: [
    'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1544531585-9847b68c8c86?w=1200&h=675&fit=crop',
  ],
  visa: [
    'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&h=675&fit=crop',
  ],
  mobility: [
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=1200&h=675&fit=crop',
  ],
  housing: [
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=1200&h=675&fit=crop',
  ],
};

const BAD_IMAGE_HINTS = ['logo','icon','avatar','favicon','placeholder','default','gstatic.com/gnews','googleusercontent.com','lh3.google','pixel','tracker','1x1','spacer','banner','sprite','gnews'];

// ─── Utils ───
function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9а-яё]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,70).replace(/-+$/,'');
}
function isBadImage(u) { if (!u) return true; const x=u.toLowerCase(); return BAD_IMAGE_HINTS.some(b=>x.includes(b)); }
function fmtDateRu(d){ return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}); }
function fmtDateEn(d){ return d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); }
function isoDate(d){ return d.toISOString().slice(0,10); }

// ─── RSS parse (item + entry) ───
function extractTag(block, tag) {
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}
function extractAttr(block, tag, attr) {
  const re = new RegExp('<' + tag + '[^>]*' + attr + '="([^"]+)"', 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}
function parseFeed(xml, feed) {
  const items = [];
  const blocks = [];
  for (const tag of ['item','entry']) {
    const re = new RegExp('<' + tag + '[\\s\\S]*?</' + tag + '>', 'gi');
    let m; while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  }
  for (const block of blocks.slice(0, 15)) {
    const title = stripHtml(extractTag(block,'title')||'');
    let link = extractTag(block,'link') || extractAttr(block,'link','href') || '';
    const rawDesc = extractTag(block,'description')||extractTag(block,'summary')||'';
    const desc = stripHtml(rawDesc).slice(0,900);
    const pubDate = extractTag(block,'pubDate')||extractTag(block,'published')||extractTag(block,'updated')||new Date().toISOString();
    const img = extractAttr(block,'enclosure','url')||extractAttr(block,'media:content','url')||extractAttr(block,'media:thumbnail','url')||'';
    const srcName = stripHtml(extractTag(block,'source')||'') || feed.name;
    const srcUrl = extractAttr(block,'source','url') || '';
    // Google News descriptions embed the real article URL in an <a href>
    let realUrl = '';
    const hrefM = rawDesc.match(/href="([^"]+)"/) || rawDesc.match(/href=&quot;([^&]+)&quot;/);
    if (hrefM && !hrefM[1].includes('news.google.com')) realUrl = hrefM[1];
    if (title && link) items.push({ title, link: link.trim(), realUrl, sourceSiteUrl: srcUrl, description: desc, pubDate, image: img, feedName: srcName, feedLang: feed.lang, category: feed.category });
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EuroPathNewsBot/1.0)' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!res.ok) { console.log(`  ${feed.name}: HTTP ${res.status}`); return []; }
    return parseFeed(await res.text(), feed);
  } catch (e) { console.log(`  ${feed.name}: ${e.message}`); return []; }
}

// ─── Scoring ───
function scoreItem(item) {
  const text = (item.title + ' ' + item.description).toLowerCase();
  for (const kw of SKIP_WORDS) if (text.includes(kw)) return -100;
  let score = 0, hasMust = false;
  for (const kw of MUST_KEYWORDS) if (text.includes(kw)) { hasMust = true; score += 20; }
  if (!hasMust) return -1;
  const age = Date.now() - new Date(item.pubDate).getTime();
  if (age < 864e5) score += 8; else if (age < 1728e5) score += 4; else if (age > 6048e5) score -= 10;
  if (item.image) score += 3;
  return score;
}

// ─── og:image / meta description from article page ───
async function fetchMeta(url, kind) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EuroPathNewsBot/1.0)' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return null;
    const html = await res.text();
    const patterns = kind === 'image'
      ? [/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i, /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i, /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)/i]
      : [/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)/i, /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i];
    for (const re of patterns) { const m = html.match(re); if (m && m[1] && (kind !== 'image' || !isBadImage(m[1]))) return m[1]; }
    return null;
  } catch { return null; }
}

// ─── Translation (MyMemory, same as GTDIB engine) ───
async function translate(text, from, to) {
  if (!text || from === to) return text;
  try {
    const chunks = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    const parts = []; let cur = '';
    for (const c of chunks) { if ((cur + c).length > 450) { parts.push(cur); cur = c; } else cur += c; }
    if (cur) parts.push(cur);
    const out = [];
    for (const p of parts.slice(0, 6)) {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${from}|${to}`);
      const d = await r.json();
      out.push(d?.responseData?.translatedText || p);
      await new Promise(r2 => setTimeout(r2, 400));
    }
    return out.join(' ');
  } catch { return text; }
}

// ─── Category context paragraphs (internal-linking + brand voice) ───
const CONTEXT_RU = {
  scholarship: `Стипендии — главный инструмент бесплатной учёбы в Италии. Региональная стипендия DSU даёт до €7 000 в год, общежитие и питание; подробный разбор — в нашем <a href="/news/regionalnaya-stipendiya-dsu-italiya.html">гайде по DSU</a>.`,
  admission: `Планируете поступление в 2027 году? Старт — предварительная запись на Universitaly и признание документов. Полный календарь: <a href="/news/postuplenie-v-universitet-italii-2027.html">пошаговый план поступления</a>.`,
  visa: `Готовите документы на визу? Смотрите наш чек-лист: <a href="/news/studencheskaya-viza-italiya-tipy-dokumenty.html">студенческая виза типа D — документы и частые ошибки</a>.`,
  mobility: `Программы мобильности вроде Erasmus+ — часть итальянского диплома: обмен на 1–2 семестра по всей Европе и за её пределами уже включён в обучение.`,
  housing: `Сколько реально стоит жизнь студента в Италии? Считали по городам: <a href="/news/stoimost-ucheby-i-zhizni-v-italii.html">бюджет по Милану, Риму, Болонье и другим</a>.`,
};
const CONTEXT_EN = {
  scholarship: `Scholarships are the main route to tuition-free study in Italy. The regional DSU grant is worth up to €7,000/year plus housing and meals — see our <a href="/en/news/">guides section</a> for the full breakdown.`,
  admission: `Planning to apply in 2027? It starts with pre-enrollment on Universitaly and credential recognition — see the step-by-step timeline in our guides.`,
  visa: `Preparing visa documents? Check our checklist on the type-D student visa: required funds, insurance, and common refusal reasons.`,
  mobility: `Mobility programmes like Erasmus+ are built into the Italian degree — a semester or two abroad across Europe and beyond is part of the journey.`,
  housing: `What does student life in Italy actually cost? We calculated it city by city — Milan, Rome, Bologna and smaller university towns.`,
};

// ─── HTML template (matches existing /news design) ───
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}:root{--ink:#080a14;--navy:#0b1e3f;--electric:#3ddfff;--lime:#c6ff3d;--gray:#6b7280;--off:#f4f5f7}body{font-family:'Inter',-apple-system,sans-serif;background:var(--off);color:var(--ink);line-height:1.75}.topbar{background:var(--ink);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:800;font-size:16px}.brand .mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--electric),var(--lime));display:flex;align-items:center;justify-content:center;color:var(--ink);font-weight:900;font-size:16px}.topbar a.home{color:#9ca3af;text-decoration:none;font-size:13px;font-weight:600}.topbar a.cta{background:linear-gradient(135deg,var(--electric),var(--lime));color:var(--ink);padding:8px 18px;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none}article{max-width:780px;margin:0 auto;padding:40px 20px 60px}.crumbs{font-size:13px;color:var(--gray);margin-bottom:20px}.crumbs a{color:#2563eb;text-decoration:none}h1{font-size:clamp(26px,4.5vw,34px);font-weight:900;letter-spacing:-.5px;line-height:1.2;margin-bottom:14px}.meta{font-size:13px;color:var(--gray);margin-bottom:28px}h2{font-size:21px;font-weight:800;margin:32px 0 12px}p{margin-bottom:14px;color:#1f2937}.lead{font-size:17px}.hero{width:100%;border-radius:16px;margin:0 0 28px;aspect-ratio:16/9;object-fit:cover}ul{margin:0 0 16px 22px;color:#1f2937}li{margin-bottom:6px}.cta-box{margin:40px 0;background:linear-gradient(135deg,var(--navy),#16213e);color:#fff;border-radius:20px;padding:32px;text-align:center}.cta-box h2{color:#fff;margin:0 0 10px;font-size:22px}.cta-box p{color:#cbd5e1;margin-bottom:20px}.cta-box a{display:inline-block;background:linear-gradient(135deg,var(--electric),var(--lime));color:var(--ink);padding:14px 32px;border-radius:24px;font-weight:800;text-decoration:none}.related{border-top:1px solid #e5e7eb;padding-top:28px;margin-top:40px}.related h3{font-size:17px;margin-bottom:12px}.related a{display:block;color:#0369a1;text-decoration:none;font-weight:600;padding:6px 0}.src{font-size:13px;color:var(--gray);font-style:italic}footer{text-align:center;color:var(--gray);font-size:12px;padding:32px 20px}footer a{color:var(--gray)}.langlink{color:#9ca3af;font-size:12px;text-decoration:none;border:1px solid #4b5563;padding:3px 10px;border-radius:12px;margin-left:10px}`;
const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%233ddfff'/><stop offset='1' stop-color='%23c6ff3d'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><text x='50' y='72' font-size='62' font-weight='900' text-anchor='middle' fill='%23080a14' font-family='Arial,sans-serif'>E</text></svg>">`;

function articlePage({ lang, title, desc, url, altUrl, altLabel, bodyHtml, image, dateIso, dateLabel, catLabel, homeLabel, newsLabel, newsHref, ctaH, ctaP, ctaBtn, footerText, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — EuroPath Education</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
${FAVICON}
<link rel="alternate" hreflang="${lang === 'ru' ? 'ru' : 'en'}" href="${url}">
<link rel="alternate" hreflang="${lang === 'ru' ? 'en' : 'ru'}" href="${altUrl}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="EuroPath Education">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image || SITE + '/logos/europath-logo-og.jpg'}">
<meta property="og:locale" content="${lang === 'ru' ? 'ru_RU' : 'en_US'}">
<meta property="article:published_time" content="${dateIso}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS}</style>
</head>
<body>
<div class="topbar">
  <a class="brand" href="/"><span class="mark">E</span> EuroPath Education</a>
  <div style="display:flex;gap:16px;align-items:center;">
    <a class="home" href="${newsHref}">← ${newsLabel}</a>
    <a class="langlink" href="${altUrl}">${altLabel}</a>
    <a class="cta" href="/#contact-form">${ctaBtn}</a>
  </div>
</div>
<article>
  <nav class="crumbs"><a href="/">${homeLabel}</a> / <a href="${newsHref}">${newsLabel}</a> / ${esc(catLabel)}</nav>
  ${image ? `<img class="hero" src="${esc(image)}" alt="${esc(title)}" loading="lazy">` : ''}
  <h1>${esc(title)}</h1>
  <p class="meta">${dateLabel} · EuroPath Education · ${esc(catLabel)}</p>
  ${bodyHtml}
  <div class="cta-box">
    <h2>${esc(ctaH)}</h2>
    <p>${esc(ctaP)}</p>
    <a href="/#contact-form">${esc(ctaBtn)}</a>
  </div>
  <div class="related">
    <h3>${lang === 'ru' ? 'Полезные гайды' : 'Useful guides'}</h3>
    <a href="${lang === 'ru' ? '/news/regionalnaya-stipendiya-dsu-italiya.html' : '/news/'}">${lang === 'ru' ? 'Стипендия DSU: до €7 000 в год →' : 'DSU regional scholarship guide →'}</a>
    <a href="${lang === 'ru' ? '/news/postuplenie-v-universitet-italii-2027.html' : '/news/'}">${lang === 'ru' ? 'Пошаговый план поступления 2027–2028 →' : 'Step-by-step admission plan 2027–2028 →'}</a>
    <a href="${lang === 'ru' ? '/news/studencheskaya-viza-italiya-tipy-dokumenty.html' : '/news/'}">${lang === 'ru' ? 'Студенческая виза типа D →' : 'Student visa type-D checklist →'}</a>
  </div>
</article>
<footer>${footerText}</footer>
</body>
</html>`;
}

// ─── Index pages ───
const GUIDES = [
  { file: 'regionalnaya-stipendiya-dsu-italiya.html', tagRu: 'Стипендии', tagEn: 'Scholarships', titleRu: 'Региональная стипендия DSU в Италии: до €7 000 в год, жильё и питание', titleEn: 'DSU regional scholarship in Italy: up to €7,000 a year, housing and meals', descRu: 'Как работает стипендия «diritto allo studio», ISEE parificato, пороги дохода, сроки и документы.', descEn: 'How the diritto allo studio grant works: ISEE parificato, income thresholds, deadlines, documents.' },
  { file: 'postuplenie-v-universitet-italii-2027.html', tagRu: 'Поступление', tagEn: 'Admissions', titleRu: 'Поступление в итальянский университет в 2027–2028: пошаговый план', titleEn: 'Admission to an Italian university in 2027–2028: step-by-step plan', descRu: 'Universitaly, предварительная запись, дедлайны по месяцам — календарь абитуриента.', descEn: 'Universitaly, pre-enrollment, month-by-month deadlines — the applicant calendar.' },
  { file: 'priznanie-diploma-cimea-dichiarazione-di-valore.html', tagRu: 'Документы', tagEn: 'Documents', titleRu: 'Признание аттестата и диплома для Италии: CIMEA и Declaration of Value', titleEn: 'Credential recognition for Italy: CIMEA and Declaration of Value', descRu: 'Два пути признания: консульская DoV или онлайн-сертификат CIMEA. Сроки, стоимость, апостиль.', descEn: 'Two recognition routes: consular DoV or online CIMEA statement. Timelines, cost, apostille.' },
  { file: 'studencheskaya-viza-italiya-tipy-dokumenty.html', tagRu: 'Виза', tagEn: 'Visa', titleRu: 'Студенческая виза в Италию (тип D): документы, финансы, частые ошибки', titleEn: 'Italian student visa (type D): documents, finances, common mistakes', descRu: 'Сколько денег показать, какая страховка, permesso di soggiorno, причины отказов.', descEn: 'Proof of funds, insurance, permesso di soggiorno, refusal reasons — the pre-submission checklist.' },
  { file: 'stoimost-ucheby-i-zhizni-v-italii.html', tagRu: 'Бюджет', tagEn: 'Budget', titleRu: 'Сколько стоит учёба и жизнь студента в Италии: по городам', titleEn: 'Cost of study and student life in Italy, city by city', descRu: 'Плата в госвузах, аренда в Милане/Риме/Болонье, питание, транспорт — и как DSU покрывает расходы.', descEn: 'Public-university fees, rent in Milan/Rome/Bologna, food, transport — and how DSU covers it.' },
];

const CAT_RU = { scholarship:'Стипендии', admission:'Поступление', visa:'Виза', mobility:'Мобильность', housing:'Жильё и бюджет' };
const CAT_EN = { scholarship:'Scholarships', admission:'Admissions', visa:'Visa', mobility:'Mobility', housing:'Housing & budget' };

const INDEX_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}:root{--ink:#080a14;--navy:#0b1e3f;--electric:#3ddfff;--lime:#c6ff3d;--gray:#6b7280;--off:#f4f5f7}body{font-family:'Inter',-apple-system,sans-serif;background:var(--off);color:var(--ink);line-height:1.6}.topbar{background:var(--ink);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:800;font-size:16px}.brand .mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--electric),var(--lime));display:flex;align-items:center;justify-content:center;color:var(--ink);font-weight:900;font-size:16px}.topbar a.home{color:#9ca3af;text-decoration:none;font-size:13px;font-weight:600}.topbar a.cta{background:linear-gradient(135deg,var(--electric),var(--lime));color:var(--ink);padding:8px 18px;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none}.topbar a.langlink{color:#9ca3af;font-size:12px;text-decoration:none;border:1px solid #4b5563;padding:3px 10px;border-radius:12px}.wrap{max-width:860px;margin:0 auto;padding:48px 20px 80px}.crumbs{font-size:13px;color:var(--gray);margin-bottom:20px}.crumbs a{color:#2563eb;text-decoration:none}h1{font-size:clamp(28px,5vw,40px);font-weight:900;letter-spacing:-.5px;margin-bottom:12px}.lead{font-size:17px;color:#374151;margin-bottom:36px;max-width:640px}.sect{font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray);margin:36px 0 16px}.grid{display:grid;gap:20px}.card{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:16px;padding:28px;text-decoration:none;color:inherit;display:block;transition:box-shadow .2s,transform .2s}.card:hover{box-shadow:0 8px 30px rgba(11,30,63,.10);transform:translateY(-2px)}.card .tag{display:inline-block;background:rgba(61,223,255,.15);color:#0369a1;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;padding:4px 10px;border-radius:12px;margin-bottom:12px}.card h2{font-size:20px;font-weight:800;margin-bottom:8px;letter-spacing:-.3px}.card p{font-size:14px;color:#4b5563;margin-bottom:14px}.card .meta{font-size:12px;color:var(--gray)}.card .read{color:#0369a1;font-weight:700;font-size:13px}.ncard{display:flex;gap:18px;background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit}.ncard:hover{box-shadow:0 6px 24px rgba(11,30,63,.10)}.ncard img{width:170px;min-height:110px;object-fit:cover;flex-shrink:0}.ncard .body{padding:16px 18px}.ncard .ntitle{font-size:16px;font-weight:800;margin-bottom:6px;line-height:1.3}.ncard .nmeta{font-size:12px;color:var(--gray)}.cta-box{margin-top:48px;background:linear-gradient(135deg,var(--navy),#16213e);color:#fff;border-radius:20px;padding:36px;text-align:center}.cta-box h2{font-size:24px;margin-bottom:10px}.cta-box p{color:#cbd5e1;margin-bottom:20px;font-size:15px}.cta-box a{display:inline-block;background:linear-gradient(135deg,var(--electric),var(--lime));color:var(--ink);padding:14px 32px;border-radius:24px;font-weight:800;text-decoration:none;font-size:15px}footer{text-align:center;color:var(--gray);font-size:12px;padding:32px 20px}footer a{color:var(--gray)}`;

function indexPage(lang, articles) {
  const ru = lang === 'ru';
  const base = ru ? '/news/' : '/en/news/';
  const guideCards = GUIDES.map(g => `    <a class="card" href="/news/${g.file}">
      <span class="tag">${ru ? g.tagRu : g.tagEn}</span>
      <h2>${ru ? g.titleRu : g.titleEn}</h2>
      <p>${ru ? g.descRu : g.descEn}</p>
      <span class="meta">EuroPath Education · </span><span class="read">${ru ? 'Читать' : 'Read'} →</span>
    </a>`).join('\n');

  const newsCards = articles.map(a => `    <a class="ncard" href="${base}${a.file}">
      ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ''}
      <div class="body">
        <div class="ntitle">${esc(ru ? a.title_ru : a.title_en)}</div>
        <div class="nmeta">${ru ? fmtDateRu(new Date(a.date)) : fmtDateEn(new Date(a.date))} · ${esc(ru ? CAT_RU[a.category]||'Новости' : CAT_EN[a.category]||'News')} · ${esc(a.source_name||'')}</div>
      </div>
    </a>`).join('\n');

  const title = ru ? 'Новости и гайды: учёба в Италии — EuroPath Education' : 'News & guides: studying in Italy — EuroPath Education';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${ru ? 'Гайды и новости EuroPath Education: поступление в итальянские университеты, стипендии DSU, признание дипломов, виза, бюджет.' : 'EuroPath Education guides and news: Italian university admissions, DSU scholarships, credential recognition, visas, costs.'}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${SITE}${base}">
${FAVICON}
<link rel="alternate" hreflang="${lang}" href="${SITE}${base}">
<link rel="alternate" hreflang="${ru ? 'en' : 'ru'}" href="${SITE}${ru ? '/en/news/' : '/news/'}">
<meta property="og:type" content="website"><meta property="og:site_name" content="EuroPath Education">
<meta property="og:title" content="${esc(title)}"><meta property="og:url" content="${SITE}${base}">
<meta property="og:image" content="${SITE}/logos/europath-logo-og.jpg"><meta property="og:locale" content="${ru ? 'ru_RU' : 'en_US'}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"${ru ? 'Новости и гайды EuroPath Education' : 'EuroPath Education News & Guides'}","url":"${SITE}${base}","inLanguage":"${lang}","isPartOf":{"@type":"WebSite","name":"EuroPath Education","url":"${SITE}/"},"publisher":{"@type":"EducationalOrganization","name":"EuroPath Education","url":"${SITE}/","logo":"${SITE}/logos/europath-logo-og.jpg"}}</script>
<style>${INDEX_CSS}</style>
</head>
<body>
<div class="topbar">
  <a class="brand" href="/"><span class="mark">E</span> EuroPath Education</a>
  <div style="display:flex;gap:14px;align-items:center;">
    <a class="home" href="/">${ru ? '← На главную' : '← Home'}</a>
    <a class="langlink" href="${ru ? '/en/news/' : '/news/'}">${ru ? 'EN' : 'RU'}</a>
    <a class="cta" href="/#contact-form">${ru ? 'Консультация' : 'Consultation'}</a>
  </div>
</div>
<div class="wrap">
  <nav class="crumbs"><a href="/">${ru ? 'Главная' : 'Home'}</a> / ${ru ? 'Новости и гайды' : 'News & guides'}</nav>
  <h1>${ru ? 'Учёба в Италии: гайды и новости' : 'Studying in Italy: guides & news'}</h1>
  <p class="lead">${ru ? 'Практические материалы от EuroPath Education — консалтинга по поступлению в Италии. Гайды + ежедневные новости из итальянских источников.' : 'Practical material from EuroPath Education — Italy admissions consulting. Guides plus daily news from Italian sources.'}</p>

  <div class="sect">${ru ? 'Гайды' : 'Guides'}</div>
  <div class="grid">
${guideCards}
  </div>

  <div class="sect">${ru ? 'Новости' : 'Latest news'}</div>
  <div class="grid">
${newsCards || `    <p style="color:var(--gray)">${ru ? 'Новости появятся в ближайшее время.' : 'News items coming soon.'}</p>`}
  </div>

  <div class="cta-box">
    <h2>${ru ? 'Хотите поступить в Италию в 2027 году?' : 'Want to study in Italy in 2027?'}</h2>
    <p>${ru ? 'Бесплатная консультация: оценим профиль, подберём университет, посчитаем стипендию.' : 'Free consultation: we assess your profile, pick a university, calculate your scholarship.'}</p>
    <a href="/#contact-form">${ru ? 'Оставить заявку' : 'Request consultation'}</a>
  </div>
</div>
<footer>© 2026 EuroPath Education — ${ru ? 'консалтинг по поступлению в университеты Италии' : 'Italian university admissions consulting'} · <a href="/">europatheducation.eu</a> · <a href="https://t.me/studywithanar">Telegram</a></footer>
</body>
</html>`;
}

// ─── Sitemap ───
function buildSitemap(articles) {
  const today = isoDate(new Date());
  const urls = [
    { loc: '/', cf: 'weekly', pr: '1.0', lm: today },
    { loc: '/news/', cf: 'daily', pr: '0.9', lm: today },
    { loc: '/en/news/', cf: 'daily', pr: '0.8', lm: today },
    ...GUIDES.map(g => ({ loc: `/news/${g.file}`, cf: 'monthly', pr: '0.8', lm: '2026-10-27' })),
    ...articles.map(a => ({ loc: `/news/${a.file}`, cf: 'monthly', pr: '0.7', lm: a.date })),
    ...articles.map(a => ({ loc: `/en/news/${a.file}`, cf: 'monthly', pr: '0.6', lm: a.date })),
    { loc: '/privacy.html', cf: 'yearly', pr: '0.3', lm: '2026-09-11' },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE}${u.loc}</loc>
    <lastmod>${u.lm}</lastmod>
    <changefreq>${u.cf}</changefreq>
    <priority>${u.pr}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

// ─── Main ───
async function main() {
  console.log('=== EuroPath Auto-News ===');

  const registry = existsSync(REGISTRY_PATH)
    ? JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
    : { articles: [] };
  const articles = registry.articles;
  const existingUrls = new Set(articles.map(a => (a.source_url || '').toLowerCase()));
  const existingTitles = articles.map(a => (a.title_ru || '').toLowerCase() + ' ' + (a.title_en || '').toLowerCase());
  const usedImages = new Set(articles.map(a => (a.image || '').toLowerCase()));

  function isDupTitle(t) {
    const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (!words.length) return false;
    for (const ex of existingTitles) {
      const ew = ex.split(/\s+/).filter(w => w.length > 3);
      if (!ew.length) continue;
      let m = 0;
      for (const w of words) if (ew.some(x => x.includes(w) || w.includes(x))) m++;
      if (m / Math.max(words.length, ew.length) >= 0.5) return true;
    }
    return false;
  }

  // Fetch
  const all = [];
  for (const feed of FEEDS) {
    const items = await fetchFeed(feed);
    console.log(`  ${feed.name}: ${items.length}`);
    all.push(...items);
  }
  console.log(`Total fetched: ${all.length}`);

  // Score + dedup
  const candidates = all
    .filter(i => i.title && i.link)
    .filter(i => !existingUrls.has(i.link.toLowerCase()))
    .filter(i => !isDupTitle(i.title))
    .map(i => ({ i, s: scoreItem(i) }))
    .filter(c => c.s > 0)
    .sort((a, b) => b.s - a.s);
  console.log(`Candidates after scoring/dedup: ${candidates.length}`);

  if (!candidates.length) { console.log('Nothing to publish today.'); return; }

  // Dedup within this run's batch too (same story can arrive via different source URLs)
  const picked = [];
  const batchTitles = [];
  const similar = (a, b) => {
    const wa = a.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const wb = b.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (!wa.length || !wb.length) return false;
    let m = 0;
    for (const w of wa) if (wb.some(x => x.includes(w) || w.includes(x))) m++;
    return m / Math.max(wa.length, wb.length) >= 0.5;
  };
  for (const c of candidates) {
    if (picked.length >= MAX_ARTICLES_PER_RUN) break;
    if (batchTitles.some(t => similar(t, c.i.title))) { console.log(`  [batch-dedup] skipping dup: ${c.i.title.slice(0, 60)}`); continue; }
    batchTitles.push(c.i.title);
    picked.push(c);
  }
  const today = new Date();
  const dateStr = isoDate(today);

  for (const { i: item } of picked) {
    console.log(`\nPublishing: ${item.title.slice(0, 80)}`);
    const cleanTitle = item.title.replace(/\s*-\s*[^-]{3,40}$/, '').trim();

    // Image + fuller description from source page.
    // Google News RSS ships boilerplate ("Copertura completa..."/"Full coverage...")
    // and placeholder images — for those items always resolve the real article page.
    const isGoogleNews = item.link.includes('news.google.com');
    const isBoilerplate = (s) => /full coverage|copertura completa|полный охват|google news/i.test(s || '');
    // For Google News items prefer the real article URL for meta scraping
    const metaTarget = isGoogleNews ? (item.realUrl || item.link) : item.link;

    let image = item.image && !isBadImage(item.image) ? item.image : null;
    if (!image) image = await fetchMeta(metaTarget, 'image');
    if (!image && item.sourceSiteUrl) image = await fetchMeta(item.sourceSiteUrl, 'image');
    if (!image) {
      const pool = FALLBACK_IMAGES[item.category] || FALLBACK_IMAGES.admission;
      image = pool.find(u => !usedImages.has(u.toLowerCase())) || pool[0];
    }

    let longDesc = (!item.description || isBoilerplate(item.description)) ? '' : item.description;
    if (isGoogleNews || !longDesc || longDesc.length < 120) {
      const d = await fetchMeta(metaTarget, 'description');
      if (d && !isBoilerplate(d) && d.length > (longDesc || '').length) longDesc = stripHtml(d);
    }
    if (!longDesc) longDesc = cleanTitle; // last resort: lead = title

    // Translations: RU is primary, EN second
    const srcLang = item.feedLang === 'en' ? 'en' : 'it';
    const titleRu = await translate(cleanTitle, srcLang, 'ru');
    const titleEn = srcLang === 'en' ? cleanTitle : await translate(cleanTitle, srcLang, 'en');
    const descRu = await translate(longDesc || cleanTitle, srcLang, 'ru');
    const descEn = srcLang === 'en' ? (longDesc || cleanTitle) : await translate(longDesc || cleanTitle, srcLang, 'en');

    const slug = `${dateStr}-${slugify(cleanTitle) || 'news'}`;
    const fileName = `${slug}.html`;
    const urlRu = `${SITE}/news/${fileName}`;
    const urlEn = `${SITE}/en/news/${fileName}`;

    const displayUrl = item.realUrl || item.link;
    const bodyRu = `<p class="lead">${esc(descRu)}</p>
<p>${CONTEXT_RU[item.category] || CONTEXT_RU.admission}</p>
<p class="src">Источник: <a href="${esc(displayUrl)}" target="_blank" rel="noopener nofollow">${esc(item.feedName)}</a>. Материал переведён и адаптирован командой EuroPath Education.</p>`;

    const bodyEn = `<p class="lead">${esc(descEn)}</p>
<p>${CONTEXT_EN[item.category] || CONTEXT_EN.admission}</p>
<p class="src">Source: <a href="${esc(displayUrl)}" target="_blank" rel="noopener nofollow">${esc(item.feedName)}</a>. Translated and adapted by the EuroPath Education team.</p>`;

    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: titleRu, description: descRu.slice(0, 200), inLanguage: 'ru',
      datePublished: dateStr, dateModified: dateStr,
      author: { '@type': 'Organization', name: 'EuroPath Education', url: SITE + '/' },
      publisher: { '@type': 'EducationalOrganization', name: 'EuroPath Education', url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/logos/europath-logo-og.jpg' } },
      mainEntityOfPage: urlRu, image,
    };
    const jsonLdEn = { ...jsonLd, headline: titleEn, description: descEn.slice(0, 200), inLanguage: 'en', mainEntityOfPage: urlEn };

    mkdirSync(join(ROOT, 'news'), { recursive: true });
    mkdirSync(join(ROOT, 'en', 'news'), { recursive: true });

    writeFileSync(join(ROOT, 'news', fileName), articlePage({
      lang: 'ru', title: titleRu, desc: descRu.slice(0, 155), url: urlRu, altUrl: urlEn, altLabel: 'EN',
      bodyHtml: bodyRu, image, dateIso: dateStr, dateLabel: fmtDateRu(today),
      catLabel: CAT_RU[item.category] || 'Новости', homeLabel: 'Главная', newsLabel: 'Новости и гайды', newsHref: '/news/',
      ctaH: 'Хотите учиться в Италии?', ctaP: 'Бесплатная консультация — оценим профиль и расскажем о стипендиях.', ctaBtn: 'Консультация',
      footerText: `© 2026 EuroPath Education · <a href="/">europatheducation.eu</a> · <a href="https://t.me/studywithanar">Telegram</a>`,
      jsonLd,
    }));

    writeFileSync(join(ROOT, 'en', 'news', fileName), articlePage({
      lang: 'en', title: titleEn, desc: descEn.slice(0, 155), url: urlEn, altUrl: urlRu, altLabel: 'RU',
      bodyHtml: bodyEn, image, dateIso: dateStr, dateLabel: fmtDateEn(today),
      catLabel: CAT_EN[item.category] || 'News', homeLabel: 'Home', newsLabel: 'News & guides', newsHref: '/en/news/',
      ctaH: 'Want to study in Italy?', ctaP: 'Free consultation — we assess your profile and scholarship options.', ctaBtn: 'Consultation',
      footerText: `© 2026 EuroPath Education · <a href="/">europatheducation.eu</a> · <a href="https://t.me/studywithanar">Telegram</a>`,
      jsonLd: jsonLdEn,
    }));

    articles.unshift({
      slug, file: fileName, date: dateStr, category: item.category,
      title_ru: titleRu, title_en: titleEn,
      source_name: item.feedName, source_url: displayUrl, image,
    });
    usedImages.add((image || '').toLowerCase());
    console.log(`  → /news/${fileName} + /en/news/${fileName}`);
    await new Promise(r => setTimeout(r, 800)); // be nice to MyMemory
  }

  // Cap registry at 400 entries to bound file size
  registry.articles = articles.slice(0, 400);
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));

  // Regenerate index pages + sitemap
  writeFileSync(join(ROOT, 'news', 'index.html'), indexPage('ru', registry.articles));
  writeFileSync(join(ROOT, 'en', 'news', 'index.html'), indexPage('en', registry.articles));
  writeFileSync(join(ROOT, 'sitemap.xml'), buildSitemap(registry.articles));

  console.log(`\nDone. Published ${picked.length} article(s). Registry: ${registry.articles.length} total.`);
}

main().catch(e => { console.error(e); process.exit(1); });
