import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const openTag = '<' + tag;
  const closeTag = '</' + tag + '>';
  const start = block.indexOf(openTag);
  if (start === -1) return null;
  const contentStart = block.indexOf('>', start);
  if (contentStart === -1) return null;
  const end = block.indexOf(closeTag, contentStart + 1);
  if (end === -1) return null;
  return block.substring(contentStart + 1, end).trim();
}

function extractAttr(block: string, tag: string, attr: string): string | null {
  const openTag = '<' + tag;
  const start = block.indexOf(openTag);
  if (start === -1) return null;
  const tagEnd = block.indexOf('>', start);
  if (tagEnd === -1) return null;
  const tagStr = block.substring(start, tagEnd);
  const attrStr = attr + '="';
  const attrStart = tagStr.indexOf(attrStr);
  if (attrStart === -1) {
    const attrStr2 = attr + "='";
    const attrStart2 = tagStr.indexOf(attrStr2);
    if (attrStart2 === -1) return null;
    const attrEnd = tagStr.indexOf("'", attrStart2 + attrStr2.length);
    if (attrEnd === -1) return null;
    return tagStr.substring(attrStart2 + attrStr2.length, attrEnd);
  }
  const attrEnd = tagStr.indexOf('"', attrStart + attrStr.length);
  if (attrEnd === -1) return null;
  return tagStr.substring(attrStart + attrStr.length, attrEnd);
}

function parseRSS(xml: string): { title: string; link: string; description: string; pubDate: string | null; imageUrl: string | null }[] {
  const items: { title: string; link: string; description: string; pubDate: string | null; imageUrl: string | null }[] = [];

  // Find all <item>...</item> blocks using indexOf (more reliable than regex in edge runtime)
  const blocks: string[] = [];
  let searchPos = 0;
  while (true) {
    const itemStart = xml.indexOf('<item', searchPos);
    if (itemStart === -1) break;
    const itemEnd = xml.indexOf('</item>', itemStart);
    if (itemEnd === -1) break;
    blocks.push(xml.substring(itemStart, itemEnd + 7));
    searchPos = itemEnd + 7;
  }

  // Also find <entry>...</entry> blocks (Atom)
  searchPos = 0;
  while (true) {
    const entryStart = xml.indexOf('<entry', searchPos);
    if (entryStart === -1) break;
    const entryEnd = xml.indexOf('</entry>', entryStart);
    if (entryEnd === -1) break;
    blocks.push(xml.substring(entryStart, entryEnd + 8));
    searchPos = entryEnd + 8;
  }

  for (const block of blocks) {
    let title = extractTag(block, 'title');
    let link = extractTag(block, 'link');
    let description = extractTag(block, 'description') || extractTag(block, 'summary');
    let pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');

    // Atom link might be in href attribute
    if (!link) {
      link = extractAttr(block, 'link', 'href');
    }

    // Image extraction
    let imageUrl: string | null = null;
    const enclosure = extractAttr(block, 'enclosure', 'url');
    if (enclosure) imageUrl = enclosure;
    else {
      const mediaContent = extractAttr(block, 'media:content', 'url');
      if (mediaContent) imageUrl = mediaContent;
      else {
        const mediaThumb = extractAttr(block, 'media:thumbnail', 'url');
        if (mediaThumb) imageUrl = mediaThumb;
        else if (description) {
          const imgStart = description.indexOf('src="');
          if (imgStart !== -1) {
            const imgEnd = description.indexOf('"', imgStart + 5);
            if (imgEnd !== -1) imageUrl = description.substring(imgStart + 5, imgEnd);
          }
        }
      }
    }

    if (!title || !link) continue;
    title = stripHtml(title);
    link = link.trim();
    description = description ? stripHtml(description).slice(0, 500) : '';
    items.push({ title, link, description, pubDate: pubDate ? pubDate.trim() : null, imageUrl });
  }

  return items;
}

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) { console.error(`Feed ${url} returned ${res.status}`); return null; }
    const text = await res.text();
    if (!text || text.length < 50) { console.error(`Feed ${url} returned empty/short response`); return null; }
    return text;
  } catch (err) { console.error(`Feed fetch error for ${url}:`, err); return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const { data: sources, error: srcErr } = await sb.from('news_sources').select('id, name, url').eq('is_active', true);
    if (srcErr) throw srcErr;
    if (!sources || sources.length === 0) return new Response(JSON.stringify({ success: true, message: 'No active sources', inserted: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let totalInserted = 0, totalSkipped = 0;
    const sourceResults: any[] = [];

    for (const source of sources) {
      const xml = await fetchFeed(source.url);
      if (!xml) { sourceResults.push({ name: source.name, fetched: 0, inserted: 0, error: 'fetch failed' }); continue; }
      const items = parseRSS(xml);
      if (items.length === 0) { sourceResults.push({ name: source.name, fetched: 0, inserted: 0, error: 'no items parsed', responseLen: xml.length }); continue; }

      let inserted = 0, skipped = 0;
      for (const item of items.slice(0, 20)) {
        const { data: existing } = await sb.from('fetched_news').select('id').eq('url', item.link).maybeSingle();
        if (existing) { skipped++; continue; }
        const { error: insErr } = await sb.from('fetched_news').insert({
          source_id: source.id, source_name: source.name, title: item.title, summary: item.description,
          url: item.link, image_url: item.imageUrl, published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null, status: 'new',
        });
        if (insErr) { console.error(`Insert error for ${item.link}:`, insErr.message); skipped++; }
        else inserted++;
      }
      totalInserted += inserted; totalSkipped += skipped;
      sourceResults.push({ name: source.name, fetched: items.length, inserted });
    }

    return new Response(JSON.stringify({ success: true, inserted: totalInserted, skipped: totalSkipped, sources: sourceResults }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
