// IndexNow submission — pushes all sitemap URLs to Bing/Yandex instantly.
// Key file hosted at site root proves domain ownership. Runs daily + on push.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = 'e4f8a2c91b3d47e6a5f0c8d2b7a93e14';
const HOST = 'europatheducation.eu';
const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
console.log(`Submitting ${urls.length} URLs to IndexNow`);
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
});
console.log('IndexNow response:', r.status);
