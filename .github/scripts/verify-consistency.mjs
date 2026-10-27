// EuroPath consistency agent — verifies the whole site against data/offer.json
// (the single source of truth mirroring the Service Packages document) plus
// the news-engine invariants. Exits 1 if anything is inconsistent.
// Run: node .github/scripts/verify-consistency.mjs
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const norm = s => s.replace(/ |&nbsp;/g, ' ');
const read = f => existsSync(join(ROOT, f)) ? norm(readFileSync(join(ROOT, f), 'utf8')) : null;

const offer = JSON.parse(readFileSync(join(ROOT, 'data', 'offer.json'), 'utf8'));
const [P1, P2] = offer.packages;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ FAIL: ${label}`); } };

const index = read('index.html') || '';
const terms = read('terms.html') || '';
const registry = existsSync(join(ROOT, 'news', 'articles.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'news', 'articles.json'), 'utf8')).articles : [];
const sitemap = read('sitemap.xml') || '';

console.log('=== Packages & pricing ===');
ok(index.includes('€2 000'), 'index shows €2 000 (Concierge)');
ok(index.includes('€3 000') && index.includes('€2 400'), 'index shows €3 000 → €2 400 (Full)');
ok(index.includes('€900 / €800 / €300'), 'Concierge instalments 900/800/300');
ok(index.includes('€1 000 / €900 / €500'), 'Full instalments 1000/900/500');
ok((index.match(/class="yes"/g) || []).length === 9, `comparison table has 9 Yes cells (got ${(index.match(/class="yes"/g) || []).length})`);
ok((index.match(/class="no"/g) || []).length === 5, `comparison table has 5 No cells (got ${(index.match(/class="no"/g) || []).length})`);
ok((index.match(/class="extra"/g) || []).length === 2, 'in-person accompaniment = extra charge in both');
ok(terms.includes('€2,000') && terms.includes('€2,400'), 'terms.html prices match');
ok(terms.includes('€900') && terms.includes('€800') && terms.includes('€300'), 'terms P1 instalments');
ok(terms.includes('€1,000') && terms.includes('€500'), 'terms P2 instalments');

console.log('=== Structured data ===');
const ldBlocks = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
const lds = [];
for (const b of ldBlocks) { try { lds.push(JSON.parse(b)); } catch (e) { fail++; console.log(`  ✗ FAIL: JSON-LD parse error: ${e.message}`); } }
const faqLd = lds.find(d => d['@type'] === 'FAQPage');
const orgLd = lds.find(d => d['@type'] === 'EducationalOrganization');
ok(!!faqLd, 'FAQPage JSON-LD present');
ok(faqLd && faqLd.mainEntity.length >= 10, `FAQ has ≥10 questions (got ${faqLd?.mainEntity?.length})`);
ok(faqLd && faqLd.mainEntity.every(q => !offer.faq_must_not_contain.some(bad => (q.name + q.acceptedAnswer.text).includes(bad))), 'no forbidden strings in FAQ');
const priceQ = faqLd?.mainEntity.find(q => /пакет|стоит/.test(q.name));
ok(priceQ && priceQ.acceptedAnswer.text.includes('2 000') && priceQ.acceptedAnswer.text.includes('2 400'), 'FAQ pricing answer cites both packages');
const offers = orgLd?.hasOfferCatalog?.itemListElement || [];
ok(offers.length === 2 && +offers[0].price === P1.price && +offers[1].price === P2.price, 'hasOfferCatalog prices 2000/2400');

console.log('=== News engine ===');
ok(index.includes('<!-- AUTO-NEWS:START -->') && index.includes('<!-- AUTO-NEWS:END -->'), 'AUTO-NEWS markers present');
ok((index.match(/class="nf-item"/g) || []).length >= 5, `homepage feed items (got ${(index.match(/class="nf-item"/g) || []).length})`);
ok((index.match(/class="nf-img"/g) || []).length === (index.match(/class="nf-item"/g) || []).length, 'every feed item has a thumbnail');
// Every feed item links to a real article file
const feedHrefs = [...index.matchAll(/class="nf-item" href="\/news\/([^"]+)"/g)].map(m => m[1]);
ok(feedHrefs.every(f => existsSync(join(ROOT, 'news', f))), 'every feed link resolves to a real article');
// Registry ↔ disk: no orphan files, no missing files
const diskNews = readdirSync(join(ROOT, 'news')).filter(f => /^20\d\d-\d\d-\d\d.*\.html$/.test(f));
const regFiles = new Set(registry.map(a => a.file));
const orphans = diskNews.filter(f => !regFiles.has(f));
const missing = registry.filter(a => !diskNews.includes(a.file));
ok(orphans.length === 0, `no orphan news files on disk (${orphans.length})`);
ok(missing.length === 0, `no registry entries missing files (${missing.length})`);
const COUNTRIES = ['Италия', 'Испания', 'Франция', 'Бельгия'];
let badArticles = 0;
for (const a of registry) {
  const ruFile = join(ROOT, 'news', a.file), enFile = join(ROOT, 'en', 'news', a.file);
  if (!existsSync(ruFile) || !existsSync(enFile)) { badArticles++; console.log(`    missing file: ${a.file}`); continue; }
  const ru = readFileSync(ruFile, 'utf8');
  const title = (ru.match(/<title>([^<]+)/) || [])[1] || '';
  if (!COUNTRIES.some(c => title.startsWith(c)) || !title.includes('EuroPath Education')) { badArticles++; console.log(`    bad title SEO: ${title.slice(0, 70)}`); }
  if (!a.image) { badArticles++; console.log(`    no image: ${a.file}`); }
  if (!sitemap.includes(a.file)) { badArticles++; console.log(`    not in sitemap: ${a.file}`); }
  if (!ru.includes('"@type": "Article"') && !ru.includes('"@type":"Article"')) { badArticles++; console.log(`    no Article schema: ${a.file}`); }
  if (!ru.includes('BreadcrumbList')) { badArticles++; console.log(`    no BreadcrumbList: ${a.file}`); }
  if (!ru.includes(`canonical" href="https://europatheducation.eu/news/${a.file}"`)) { badArticles++; console.log(`    bad canonical: ${a.file}`); }
  if (!ru.includes(`hreflang="en"`)) { badArticles++; console.log(`    no EN hreflang: ${a.file}`); }
  if (!ru.includes('og:title')) { badArticles++; console.log(`    no OG tags: ${a.file}`); }
}
ok(badArticles === 0, `all ${registry.length} articles: files, country+EuroPath title, image, sitemap, Article+Breadcrumb schema, canonical, hreflang, OG`);
// Guides exist and are linked
const GUIDE_FILES = ['regionalnaya-stipendiya-dsu-italiya.html','postuplenie-v-universitet-italii-2027.html','priznanie-diploma-cimea-dichiarazione-di-valore.html','studencheskaya-viza-italiya-tipy-dokumenty.html','stoimost-ucheby-i-zhizni-v-italii.html'];
for (const g of GUIDE_FILES) {
  ok(existsSync(join(ROOT, 'news', g)) && sitemap.includes(g), `guide exists + in sitemap: ${g.slice(0, 40)}`);
}
ok(existsSync(join(ROOT, 'news', 'index.html')) && existsSync(join(ROOT, 'en', 'news', 'index.html')), 'news index pages RU + EN exist');
const enNews = existsSync(join(ROOT, 'en', 'news')) ? readdirSync(join(ROOT, 'en', 'news')).filter(f => /^20\d\d-\d\d-\d\d.*\.html$/.test(f)).length : 0;
ok(enNews === diskNews.length, `EN mirrors: ${enNews} EN vs ${diskNews.length} RU`);

console.log('=== Homepage structure ===');
ok(index.includes('data-en="News">Новости') && index.includes('href="#news"'), 'nav → #news renamed');
ok(index.includes('data-en="FAQ">Вопросы') && index.includes('href="#faq"'), 'nav → #faq present');
for (const id of ['mission','why-italy','partners','journey','packages','process','location','reviews','news','faq','contact-form']) {
  ok(index.includes(`id="${id}"`), `section #${id} present`);
}
ok((index.match(/<details class="faq-item">/g) || []).length === (faqLd?.mainEntity?.length || -1), 'FAQ HTML count = FAQPage schema count');
ok((index.match(/<details class="faq-item">[\s\S]*?summary data-en/g) || []).length >= 10, 'FAQ items carry data-en translations');
ok(existsSync(join(ROOT, 'i18n.js')), 'i18n.js (EN toggle) exists');
ok(existsSync(join(ROOT, '.github', 'workflows', 'auto-news.yml')) && existsSync(join(ROOT, '.github', 'workflows', 'consistency.yml')), 'both workflows present');
ok(existsSync(join(ROOT, 'data', 'offer.json')), 'offer.json source of truth exists');

console.log('=== Hygiene ===');
ok(index.includes(offer.telegram), `Telegram link = ${offer.telegram}`);
ok(!/edupathJAbot/.test(index + terms + sitemap), 'no old bot link anywhere');
for (const bad of offer.faq_must_not_contain) ok(!index.includes(bad), `"${bad}" absent from index.html`);
for (const p of ['admin.html', 'dashboard.html', 'login.html']) {
  const f = read(p);
  ok(f && /noindex/.test(f), `${p} is noindexed`);
}
ok(!sitemap.includes('admin.html') && !sitemap.includes('login.html'), 'sitemap excludes private pages');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
