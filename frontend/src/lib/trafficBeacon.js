// Anonym, storage-less, cookieless engagement-beacon (#2040) — KUN public-sider.
// Ingen id/cookie/storage på enheden; serveren dedup'er via visit_hash. Engaged =
// ≥2 pageviews i denne page-session ELLER interaktion efter ≥10s.
//
// import.meta.env tilgås optional-chained så modulet kan importeres i node --test
// (hvor import.meta.env er undefined) — kun den rene makeEngagementTracker testes.
const API = import.meta.env?.VITE_API_URL;
const ENABLED = Boolean(import.meta.env?.PROD) && Boolean(API);

// Ren tærskel-maskine: kalder onEngaged ÉN gang når engagement-tærsklen krydses.
export function makeEngagementTracker(onEngaged) {
  let pageviews = 0;
  let engaged = false;
  function fire() {
    if (!engaged) {
      engaged = true;
      onEngaged();
    }
  }
  return {
    pageview() {
      pageviews += 1;
      if (pageviews >= 2) fire();
    },
    // `elapsed` = ms siden page-load (injiceres af wrapperen / i test).
    interaction(elapsed) {
      if (elapsed >= 10_000) fire();
    },
  };
}

function deviceType() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

// Tynd send — fire-and-forget. Må aldrig kaste.
export function sendBeacon(event, path) {
  if (!ENABLED) return;
  try {
    const body = JSON.stringify({ event, path, deviceType: deviceType() });
    const url = `${API}/api/collect`;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else if (typeof fetch === "function") {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* telemetry må aldrig kaste */
  }
}
