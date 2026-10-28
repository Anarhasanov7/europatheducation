# Gates: PageSpeed fixes for europatheducation.eu

OWNS: index.html, fonts/**, letters/thumbs/**, images/universities/**, .github/scripts/auto-news.mjs, .github/scripts/psi-check.mjs, news/**, en/news/**, GATES.md

Scope: eliminate render-blocking requests (external Google Fonts CSS + synchronous scripts), cut image-delivery bytes (letter thumbnails + partner logo resize), address cache lifetimes via Cloudflare, and prove it on the live site with the PageSpeed Insights API.

- [x] G1: no external Google Fonts stylesheet link remains in index.html
  CHECK: sh -c 'test "$(grep -c "fonts.googleapis.com/css2" index.html)" = "0" && echo FONTCSS-GONE'
  EXPECT: FONTCSS-GONE
  EVIDENCE: automatic-evidence=v1; definition-sha256=b26556a5a5a1c775e54e1cd458081fee0e771cd2a90d2db99c1678c9d24a1078; exit=0; EXPECT=matched; output-sha256=0e272b877ab00d3cc8acdbdef6c524a8ee2993dcbe61d8ee5261a2c108f2512e; output-bytes=13; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G2: Inter is self-hosted — variable woff2 files exist under fonts/ (one file per subset covers weights 100-900), index.html declares @font-face with font-display:swap and preloads the critical subsets
  CHECK: sh -c 'N=$(ls fonts/inter-var-*.woff2 2>/dev/null | wc -l | tr -d " "); F=$(grep -c "font-display:swap" index.html); P=$(grep -cE "rel=\"preload\"[^>]*inter-var-" index.html); test "$N" -ge 4 && test "$F" -ge 4 && test "$P" -ge 1 && echo FONTS-SELFHOSTED'
  EXPECT: FONTS-SELFHOSTED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2b7f6a409cc6adf0047b725f13a6422f76649324b4f42ac0bd30a8c663b23c04; exit=0; EXPECT=matched; output-sha256=dd162dbcc0a9f6922ec1a58a54abad1c2ea4a04cb65247a34c58e23716daff04; output-bytes=17; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G3: i18n.js is deferred and chat-kb.js (480KB) is lazy-loaded on first chat open — no sync script blocks main content and the KB is off the critical path entirely
  CHECK: sh -c 'A=$(grep -c "script src=\"i18n.js?v=2\" defer" index.html); B=$(grep -c "src=\"chat-kb.js\"" index.html); C=$(grep -c "__epKbLoaded" index.html); test "$A" = "1" && test "$B" = "0" && test "$C" -ge 2 && echo SCRIPTS-OK'
  EXPECT: SCRIPTS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ef07143547c1d264432b60e36e421d9d09246c77f78c19f62c620b465296ac35; exit=0; EXPECT=matched; output-sha256=0c18a55b327af9647f4667888fa097f9fa0561684e7dccdf41a6eb6bc5f616b7; output-bytes=11; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G4: every letter referenced in index.html has a WebP thumb (<80KB) at /thumbs/ — the /letters/ subtree is hijacked by a Cloudflare Worker (verified via text/plain edge 404s); img tags use thumbs, anchors keep full JPGs
  CHECK: sh -c 'N=$(ls thumbs/letter-*.webp 2>/dev/null | wc -l | tr -d " "); BIG=$(find thumbs -name "*.webp" -size +80k 2>/dev/null | wc -l | tr -d " "); IMGS=$(grep -c "src=\"thumbs/letter-.*\.webp\"" index.html); HREFS=$(grep -c "href=\"letters/letter-.*\.jpg\"" index.html); test "$N" -ge 24 && test "$BIG" = "0" && test "$IMGS" = "24" && test "$HREFS" = "24" && echo THUMBS-OK'
  EXPECT: THUMBS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=09686062eb643e0d2d29ff683d243bebefb13602e52fb42212726d462c95844e; exit=0; EXPECT=matched; output-sha256=e26fd48eadeea9345c88a860923cee3828404a63b107f6fad50521e7c8ed8646; output-bytes=10; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G5: every partner PNG referenced in index.html is <= 35KB after resize
  CHECK: sh -c 'BIG=$(find images/universities -name "*.png" -size +35k 2>/dev/null | wc -l | tr -d " "); test "$BIG" = "0" && echo LOGOS-OK'
  EXPECT: LOGOS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6f9808d855158314b9b1a59bb027afd5f6d898fa27e4ec0b1561b1cec811105; exit=0; EXPECT=matched; output-sha256=2abed3f772f546d0304fd3c4e51c3e448033ed4dede983edad8b469e8f3d03c7; output-bytes=9; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G6: auto-news template no longer injects the Google Fonts stylesheet and no generated news page references it
  CHECK: sh -c 'T=$(grep -c "fonts.googleapis.com/css2?family" .github/scripts/auto-news.mjs); G=$(grep -rl "fonts.googleapis.com/css2?family" news/ en/news/ 2>/dev/null | wc -l | tr -d " "); test "$T" = "0" && test "$G" = "0" && echo NEWSFONTS-CLEAN'
  EXPECT: NEWSFONTS-CLEAN
  EVIDENCE: automatic-evidence=v1; definition-sha256=f3944aa892e9481c123ab69d794eedd2744fd9055ce22ce4b6b129f045ed0b5d; exit=0; EXPECT=matched; output-sha256=56552f1670e64c0b9da6e10aa8fb81c04b34309ed5df6cec7cd0618ca4d3b485; output-bytes=16; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G7: consistency agent still green after edits
  CHECK: node .github/scripts/verify-consistency.mjs
  EXPECT: /0 failed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4ae186cf965348b364726328e2ca49a63c0a556829430b56e20627e6c33ba52c; exit=0; EXPECT=matched; output-sha256=042aa87c2803856acef1b6444995113e76fc859bc4ec7887097fad3627174203; output-bytes=2400; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G8: live PSI mobile — render-blocking-resources audit passes on deployed URL
  CHECK: node .github/scripts/psi-check.mjs render-blocking
  EXPECT: PSI-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=bd11d093a4541aa8495bdd0e05d8128738d5b9051a2792c451a4fdcd73303260; exit=0; EXPECT=matched; output-sha256=4a6855ab62bd9c6453fe31ff137575d9efb2976bb44fab4ca14fb05e31abc771; output-bytes=51; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G9: live PSI mobile — combined image-delivery savings under 400 KiB on deployed URL
  CHECK: node .github/scripts/psi-check.mjs image-delivery
  EXPECT: PSI-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa034bec29a7e4f2e9ec59dbc1c8bae42f0e68e583fe2c71a0579ef32e4b64db; exit=0; EXPECT=matched; output-sha256=7c8bf1af3ed4044dbe73e79f5318f2b42c91437d86efa8106cb81b88a0236d7c; output-bytes=71; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G10: live PSI mobile — efficient-cache-lifetimes flagged bytes under 250 KiB (requires Cloudflare cache rule; ABANDON with handoff if dashboard unreachable)
  CHECK: node .github/scripts/psi-check.mjs cache-ttl
  EXPECT: PSI-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=ca88d3ce00073de44c122f20527e52c1a93f05f2eba6b8f7ea3dd67bb636abb2; exit=0; EXPECT=matched; output-sha256=20207ff2d3d7b64448a67d5c7fd26408470bd9baa5a9dfbf5af7c345d495cd39; output-bytes=62; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] G11: visual non-regression — homepage renders in Inter, letter thumbs load, lightbox opens full image (Playwright screenshot + DOM assertions)
  EVIDENCE: Playwright 2026-10-28 01:38 UTC — document.fonts shows 2 Inter faces loaded, computed font-family "Inter"; all 24/24 thumbs/letter-*.webp complete with naturalWidth>0 after scroll; click opens lv-overlay ("lv-overlay open") loading letters/letter-07.jpg full JPG (naturalWidth>0), no navigation; screenshot g11-verify.png shows Sapienza letter viewer 1/24.
