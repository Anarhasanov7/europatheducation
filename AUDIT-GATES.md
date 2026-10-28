# Gates: full website audit + audit agent

OWNS: .github/scripts/site-audit.mjs, .github/workflows/site-audit.yml, sitemap.xml, guides-pdf/index.html, auth-messaging.html, index.html, .github/scripts/auto-news.mjs, news/**, en/news/**, AUDIT-GATES.md

Scope: comprehensive site audit agent in CI, zero critical findings, all real findings fixed.

- [x] A1: site-audit.mjs runs locally with zero critical findings
  CHECK: sh -c 'node .github/scripts/site-audit.mjs 2>&1 | grep -c "0 critical" && echo AUDIT-CLEAN'
  EXPECT: AUDIT-CLEAN
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac97cc8aa35b3d4214469bd460e74758ed0ec78545965b6bf65d6b1691da9fb9; exit=0; EXPECT=matched; output-sha256=aa9c29d8310bded022393779da9b4a66cfac2747ce4094ea513abd8e7e9d7d48; output-bytes=14; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A2: every functional/private page is noindexed (auth, callback, leads, confirm, admin, dashboard, login, portal, ticket, studio, setup)
  CHECK: sh -c 'for f in auth-messaging confirm-consultation connect-facebook connect-ig leads social-auth threads-callback tiktok-callback admin login dashboard social-dashboard portal ticket news-studio setup-meta; do grep -q noindex "$f.html" 2>/dev/null || { echo "MISSING $f"; exit 1; }; done; echo NOINDEX-OK'
  EXPECT: NOINDEX-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e8ff9540c5d036be31dab960ca7fdf6c83ef44bed4084312c22bf1e50430a5eb; exit=0; EXPECT=matched; output-sha256=e19414d9c08a545e23b8ff96d9d8886ceab97e52af4094ce957b3c14e38a3876; output-bytes=11; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A3: no data-URI favicon remains in any html file
  CHECK: sh -c 'test "$(grep -rl "rel=\"icon\" href=\"data:" --include=\"*.html\" . | wc -l | tr -d " ")" = "0" && echo ICONS-CLEAN'
  EXPECT: ICONS-CLEAN
  EVIDENCE: automatic-evidence=v1; definition-sha256=38952b8f643a020e23ba42313902e783fe934f0ffff88f994bda4c3e20dd6f8c; exit=0; EXPECT=matched; output-sha256=8f98c31cf1e6fc68b59b74b63b797d5e2a8f2af4755cddf348097a7ee467da61; output-bytes=12; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A4: sitemap has no dangling URLs and includes terms.html + guides-pdf
  CHECK: sh -c 'grep -q "terms.html" sitemap.xml && grep -q "guides-pdf" sitemap.xml && echo SITEMAP-OK'
  EXPECT: SITEMAP-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=b6360400ff469d8a303ef2d7195e4d63bb1901b9f7290a83c91201738a77a01a; exit=0; EXPECT=matched; output-sha256=b1688d4c1231b5dca5a1cd98fda7ad02c464c0439c016dfd3169fadf442738a3; output-bytes=11; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A5: audit workflow exists and is syntactically committed
  CHECK: sh -c 'test -f .github/workflows/site-audit.yml && grep -q "site-audit.mjs" .github/workflows/site-audit.yml && echo WORKFLOW-OK'
  EXPECT: WORKFLOW-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ee5ca246df178a537abfab2208f03cccf12b3c1f69598fe13c1c3d3615a19cec; exit=0; EXPECT=matched; output-sha256=d2f087179b7db7cdd23dbceb7838e8ba7092191843f9193cc261cd1b8233bd86; output-bytes=12; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A6: consistency agent still green
  CHECK: node .github/scripts/verify-consistency.mjs
  EXPECT: /0 failed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4ae186cf965348b364726328e2ca49a63c0a556829430b56e20627e6c33ba52c; exit=0; EXPECT=matched; output-sha256=042aa87c2803856acef1b6444995113e76fc859bc4ec7887097fad3627174203; output-bytes=2400; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries

- [x] A7: live audit — all key URLs return 200 on the deployed site
  CHECK: sh -c 'sleep 60; node .github/scripts/site-audit.mjs --live 2>&1 | grep -c "0 critical" && echo LIVE-CLEAN'
  EXPECT: LIVE-CLEAN
  EVIDENCE: automatic-evidence=v1; definition-sha256=f73f8fd4287fb136410df7089a776ddb2191d04c1346249da151c47b44e834d3; exit=0; EXPECT=matched; output-sha256=45281b498bceeb59fc52649c52b9e082bf87dbc57732f5fa031009f9235c3f47; output-bytes=13; shell=/bin/sh; cwd=/Users/ricci/europatheducation; path=3c24cdda195d/20 entries
