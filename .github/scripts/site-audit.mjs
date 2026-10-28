// site-audit.mjs — full-site audit agent.
// Usage: node site-audit.mjs [--live]
// Local mode audits repo files; --live also fetches live URLs for status/header checks.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SITE = 'https://europatheducation.eu';
const LIVE = process.argv.includes('--live');
const findings = { critical: [], warning: [], info: [] };
const C = (m, p) => findings.critical.push(p ? `${m} [${p}]` : m);
const W = (m, p) => findings.warning.push(p ? `${m} [${p}]` : m);
const I = (m) => findings.info.push(m);
const read = f => readFileSync(join(ROOT, f), 'utf8');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Collect public pages ──
const skipDirs = new Set(['node_modules', '.git', 'fonts', 'letters', 'thumbs', 'images', 'logos', 'supabase', '.github', 'docs', 'data', 'infra']);
const pages = [];
(function walk(d) {
  for (const f of readdirSync(join(ROOT, d))) {
    const p = join(d, f);
    if (skipDirs.has(p.split('/')[0])) continue;
    const st = statSync(join(ROOT, p));
    if (st.isDirectory()) walk(p);
    else if (f.endsWith('.html')) pages.push(p);
  }
})('');
const privates = pages.filter(p => /admin|dashboard|login|portal|ticket|news-studio|setup-meta|callback|auth|leads|confirm|news\/draft/i.test(p) || /noindex/i.test(read(p)));
const publics = pages.filter(p => !privates.includes(p));
I(`${pages.length} html files: ${publics.length} public, ${privates.length} private`);

// ── Sitemap coverage ──
const sitemap = read('sitemap.xml');
const smUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const smPaths = new Set(smUrls.map(u => new URL(u).pathname));
for (const p of publics) {
  const path = '/' + p.replace(/index\.html$/, '').replace(/\.html$/, '.html').replace(/\/$/, '') || '/';
  const norm = p === 'index.html' ? '/' : '/' + p;
  if (!smPaths.has(norm) && !smPaths.has('/' + p.replace('index.html', '')) && p !== '404.html')
    W(`public page missing from sitemap: ${norm}`, p);
}
for (const u of smPaths) if (u !== '/' && !existsSync(join(ROOT, u.slice(1))) && !existsSync(join(ROOT, u.slice(1) + 'index.html')))
  C(`sitemap URL has no file on disk: ${u}`);

// ── Per-page checks ──
const brokenLinks = new Set();
for (const p of pages) {
  const h = read(p);
  const t = p;
  // head essentials (public pages only)
  if (publics.includes(p)) {
    if (!/<title>[^<]{10,80}<\/title>/.test(h)) W('title missing or outside 10-80 chars', t);
    if (!/name="description"/.test(h)) C('missing meta description', t);
    if (!/rel="canonical"/.test(h) && !/noindex/.test(h)) W('no canonical tag', t);
    if (/data:image\/svg\+xml/.test(h) && /rel="icon"/.test(h)) C('data-URI favicon (uncrawlable)', t);
    // JSON-LD validity
    for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); } catch { C('invalid JSON-LD block', t); }
    }
    // OG essentials
    for (const og of ['og:title', 'og:description', 'og:url'])
      if (!h.includes(`"${og}"`)) W(`missing ${og}`, t);
    // lang attr
    if (!/<html lang="(ru|en)"/.test(h)) I(`html lang attr unusual in ${t}`);
  } else if (!/noindex/i.test(h)) {
    C(`private page missing noindex: ${p}`);
  }
  // banned strings everywhere public
  if (/Alicante|Аликанте/.test(h) && publics.includes(p)) C('contains banned Alicante reference', t);
  if (/edupathJAbot/.test(h)) C('old Telegram bot link', t);
  // images: alt + dims
  for (const m of h.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/alt="[^"]*"/.test(tag)) W(`img missing alt: ${tag.slice(0, 80)}`, t);
    if (!/(width|height)=/.test(tag) && /src="(images|letters|thumbs|logos)\//.test(tag))
      I(`local img without dims: ${tag.slice(0, 90)} [${t}]`);
  }
  // internal links resolve
  for (const m of h.matchAll(/(?:href|src)="(\/[^"#?]*|(?!(https?:|mailto:|tel:|data:|#|javascript:))[a-z0-9_\-./]+\.(?:html|js|css|png|jpg|jpeg|webp|svg|ico|woff2))[^"]*"/gi)) {
    let u = m[1];
    if (u.startsWith('http')) continue;
    if (u.startsWith('/')) u = u.slice(1);
    const target = u.endsWith('/') ? u + 'index.html' : u;
    if (!existsSync(join(ROOT, target)) && !existsSync(join(ROOT, u)))
      brokenLinks.add(`${u}  (referenced in ${t})`);
  }
}
if (brokenLinks.size) [...brokenLinks].slice(0, 15).forEach(b => C(`broken internal ref: ${b}`));

// ── Key files exist ──
for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'robots.txt', 'sitemap.xml', 'i18n.js', 'analytics.js', 'data/offer.json'])
  if (!existsSync(join(ROOT, f))) C(`required file missing: ${f}`);

// ── Live checks ──
if (LIVE) {
  const urls = ['/', '/news/', '/en/news/', '/sitemap.xml', '/favicon.ico', '/terms.html', ...[...smPaths].slice(0, 8)];
  for (const u of urls) {
    try {
      const r = await fetch(SITE + u, { redirect: 'follow' });
      if (r.status !== 200) C(`live ${u} → HTTP ${r.status}`);
      const cc = r.headers.get('cache-control') || '';
      if (u === '/' && !cc) W('homepage has no cache-control');
    } catch (e) { C(`live fetch failed: ${u} (${e.message})`); }
  }
  const r = await fetch(SITE + '/robots.txt');
  if (!(await r.text()).includes('Sitemap:')) C('robots.txt missing Sitemap directive');
  const home = await (await fetch(SITE + '/')).text();
  if (/fonts\.googleapis\.com\/css2/.test(home)) C('live homepage still loads Google Fonts CSS');
  if (!/inter-var/.test(home)) W('live homepage missing variable font');
}

// ── Report ──
console.log(`\n=== SITE AUDIT — ${LIVE ? 'LIVE+LOCAL' : 'LOCAL'} ===`);
console.log(`\nCRITICAL (${findings.critical.length})`);
findings.critical.forEach(f => console.log('  ✗', f));
console.log(`\nWARNING (${findings.warning.length})`);
findings.warning.slice(0, 30).forEach(f => console.log('  !', f));
console.log(`\nINFO (${findings.info.length})`);
findings.info.slice(0, 20).forEach(f => console.log('  i', f));
console.log(`\n=== RESULT: ${findings.critical.length} critical, ${findings.warning.length} warnings, ${findings.info.length} info ===`);
process.exit(findings.critical.length ? 1 : 0);
