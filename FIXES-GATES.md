# Gates: close remaining audit gaps

OWNS: index.html, chat-kb.js, chat-kb2.js, letters/**, acceptance/**, admin.html, login.html, portal.html, dashboard.html, social-dashboard.html, ticket.html, news-studio.html, setup-meta.html, auth-messaging.html, news/articles.json, .github/scripts/auto-news.mjs, FIXES-GATES.md

Scope: four known gaps — admin OG/canonical, chat-kb weight, /letters/ Worker interception, EN meta quality.

- [x] F1: every public-indexable page has a canonical link (private pages exempt — they're noindexed)
  CHECK: sh -c 'for f in index.html terms.html privacy.html guides-pdf/index.html; do grep -q "rel=\"canonical\"" "$f" || { echo "MISSING $f"; exit 1; }; done; echo CANONICAL-OK'
  EXPECT: CANONICAL-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=347e7ab46f0a5554e455e1b50a8583be7f0e67e1aff9ddc8bb59635d775db999; exit=0; EXPECT=matched; output-sha256=046231c02c79b050f7584b74e687f1e3c6dc4d2173f867330f72a6d235598321; output-bytes=13; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] F2: letter JPGs moved off the Worker-hijacked /letters/ path — all refs updated, files at /acceptance/
  CHECK: sh -c 'ls acceptance/letter-*.jpg | wc -l | tr -d " "; grep -c "acceptance/letter-" index.html; grep -c "href=\"letters/" index.html || true'
  EXPECT: /33\n24\n0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=55b007b619061eaefea6315270ce5d152ab97294d43a2d9f4d12b9caa363ef87; exit=0; EXPECT=matched; output-sha256=79c6df702596fb52dd6d46ecf1e0ffa23c4ed2a70b6c80223dabda84c23884ad; output-bytes=8; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] F3: chat KB split — core file under 260KB, extended part lazy-loads only after first user message
  CHECK: sh -c 'test $(stat -f%z chat-kb.js) -lt 260000 && grep -q "chat-kb2.js" index.html && test -f chat-kb2.js && echo KB-SPLIT'
  EXPECT: KB-SPLIT
  EVIDENCE: automatic-evidence=v1; definition-sha256=ef354df79e7f36a5138bb3f0d0da444293bcdadf2c2cd051438f22295441610a; exit=0; EXPECT=matched; output-sha256=52ef61c3baf6a301b85c7ff6e3f958e2e7dbdf9f188633772dfb43d9165cb41f; output-bytes=9; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] F4: EN article meta descriptions free of untranslated Cyrillic/artifacts
  CHECK: sh -c 'BAD=$(grep -l "name=\"description\" content=\"[^\"]*[А-Яа-я]" en/news/*.html 2>/dev/null | wc -l | tr -d " "); test "$BAD" = "0" && echo EN-CLEAN'
  EXPECT: EN-CLEAN
  EVIDENCE: automatic-evidence=v1; definition-sha256=6f47e4fbb09d47bfa7a3185ff5d3362a6632cc4dcc5c1c9e013e3a2cf16b0584; exit=0; EXPECT=matched; output-sha256=afaa343cf910d3e6795f83ac95ecc0fe02e3499d7f5a4a81f8cfe095cf6fc3ec; output-bytes=9; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] F5: consistency agent green + audit 0 critical
  CHECK: sh -c 'node .github/scripts/verify-consistency.mjs | grep -q "0 failed" && node .github/scripts/site-audit.mjs 2>&1 | grep -q "0 critical" && echo ALL-GREEN'
  EXPECT: ALL-GREEN
  EVIDENCE: automatic-evidence=v1; definition-sha256=8889313a2ff7ea70c2961bdcd677c1fae0da91c74c878d815ad6ee28fa3046c1; exit=0; EXPECT=matched; output-sha256=8cf176ac4dd0f0ed13e86f9cbe33a39713cedeea6462160cca94d91c9df0fd57; output-bytes=10; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries
