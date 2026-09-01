// EuroPath Education — anonymous pageview beacon
// Sends {path, referrer} to the track-pageview edge function. No personal data stored.
(function () {
  try {
    var EDGE_URL = 'https://glfizcgayqecnvtfihgy.supabase.co/functions/v1/track-pageview';
    var payload = JSON.stringify({
      path: location.pathname + location.search,
      referrer: document.referrer || null
    });
    // sendBeacon is reliable on page unload; fallback to fetch.
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(EDGE_URL, blob);
    } else {
      fetch(EDGE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function(){});
    }
  } catch (e) { /* analytics must never break the page */ }
})();
