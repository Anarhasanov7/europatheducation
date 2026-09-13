// EuroPath Education — anonymous pageview beacon
// Sends {path, referrer} to the track-pageview edge function. No personal data stored.
(function () {
  try {
    var EDGE_URL = 'https://glfizcgayqecnvtfihgy.supabase.co/functions/v1/track-pageview';
    var payload = JSON.stringify({
      path: location.pathname + location.search,
      referrer: document.referrer || null
    });
    // Use text/plain to avoid CORS preflight (application/json triggers OPTIONS request).
    // Use credentials:'omit' to avoid conflict with wildcard Access-Control-Allow-Origin.
    fetch(EDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, credentials: 'omit', keepalive: true }).catch(function(){});
  } catch (e) { /* analytics must never break the page */ }
})();
