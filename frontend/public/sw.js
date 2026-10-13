/* Cycling Zone service worker (#6584, spor 1).
 *
 * KONTRAKT: denne worker serverer ALDRIG app-kode. Ingen HTML, ingen JS, ingen
 * CSS og intet API-svar kommer nogensinde fra en SW-cache. Det er hele den
 * sikre opdateringsstrategi, og den er valgt med vilje frem for "precache
 * app-skallen" (Workbox-standarden):
 *
 *   - En precachet app-skal ER en gammel app. Efter et deploy ville spilleren
 *     koere forrige frontend mod en backend der allerede er migreret, indtil
 *     den nye worker aktiverer. Det er praecis den fejlklasse lag 1-3 i
 *     chunk-forsvaret findes for at undgaa (#4595, #5033, #5159).
 *   - Opdateringer af selve APPEN ejes derfor af det eksisterende lag:
 *     version.json + releaseWatch.js + "New version ready"-banneret
 *     (ReleaseUpdateBanner). Den worker her konkurrerer ikke med det; den
 *     goer intet der kunne holde en gammel version i live.
 *   - Hashede assets (/assets/*) gaar uroert gennem browserens HTTP-cache,
 *     som allerede er `immutable` (scripts/check-cdn-cache-headers.mjs).
 *     chunk-selfheal.js' `cache: "reload"`-refetch rammer dermed stadig
 *     netvaerket, fordi workeren slet ikke svarer paa subresources.
 *
 * Hvad den goer:
 *   1. Navigationer: netvaerk foerst (med navigation preload, saa workerens
 *      opstart ikke koster tid). Fejler netvaerket, vises en aerlig offline-
 *      side i stedet for browserens dinosaur. Den side viser ingen tal.
 *   2. Versionerede caches: kun offline-siden caches, under et navn med
 *      SW_VERSION. activate sletter alt andet med vores praefiks.
 *   3. Ny worker-version: aktiverer med det samme (skipWaiting + claim).
 *      Det er sikkert NETOP fordi workeren ikke serverer app-kode: en ny
 *      worker aendrer kun offline-siden og navigationsruten, aldrig hvilken
 *      app-version spilleren koerer.
 *
 * Push (spor 2, #6590): push- og notificationclick-handlerne nederst. De viser
 * kun den tekst backenden sendte og caches intet; kontrakten ovenfor gaelder.
 *
 * Bump SW_VERSION naar offline-siden eller fetch-logikken aendres.
 */
"use strict";

const SW_VERSION = "2026-10-13.1";
const CACHE_PREFIX = "cz-sw-";
const OFFLINE_CACHE = `${CACHE_PREFIX}offline-${SW_VERSION}`;
// Kun en cache-noegle: ingen rute hedder dette, workeren slaar den selv op.
const OFFLINE_URL = "/__cz-offline";

// Copy efter docs/TONE_OF_VOICE.md: jeg-stemme, sentence case, ingen em-dash.
// EN foerst; DA naar browserens sprog er dansk. Ingen tal paa siden med vilje:
// bud, penge og resultater maa aldrig vises forældede uden markering.
const OFFLINE_COPY = {
  en: {
    lang: "en",
    title: "You're offline",
    body: "Bids, money and results need a live connection, so I don't show old numbers here. The page reloads by itself when you're back online.",
    action: "Try again",
  },
  da: {
    lang: "da",
    title: "Du er offline",
    body: "Bud, penge og resultater kræver forbindelse, så jeg viser ikke gamle tal her. Siden genindlæser selv, når du er online igen.",
    action: "Prøv igen",
  },
};

function offlineHtml(copy) {
  // Farver = tokens fra src/index.css (--bg-body, --text-1, --text-2, hairline).
  // Selvstaendig side: ingen fonte, ingen scripts udefra, ingen app-kode.
  return `<!doctype html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0e0f15">
<title>${copy.title} · Cycling Zone</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f2ec; --card: #fcfbf7; --t1: #14161e; --t2: #55576a; --line: rgba(20,22,30,.12); }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e0f15; --card: #161824; --t1: #f2f1ec; --t2: #a3a5b5; --line: rgba(242,241,236,.12); } }
  html, body { margin: 0; background: var(--bg); color: var(--t1); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  .card { max-width: 420px; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 5px; padding: 20px; box-sizing: border-box; }
  img { display: block; width: 32px; height: 32px; margin-bottom: 12px; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 700; }
  p { margin: 0 0 16px; color: var(--t2); }
  button { font: inherit; font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 5px; border: 1px solid var(--line); background: transparent; color: var(--t1); cursor: pointer; }
</style>
</head>
<body>
<main>
  <div class="card" role="status" aria-live="polite">
    <img src="/favicon.svg" alt="">
    <h1>${copy.title}</h1>
    <p>${copy.body}</p>
    <button type="button" onclick="location.reload()">${copy.action}</button>
  </div>
</main>
<script>addEventListener("online", function () { location.reload(); });</script>
</body>
</html>`;
}

function pickCopy(request) {
  const accept = (request && request.headers && request.headers.get("accept-language")) || "";
  return /^da\b/i.test(accept.trim()) ? OFFLINE_COPY.da : OFFLINE_COPY.en;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // Begge sprog caches; favicon'et er det eneste aktiv offline-siden bruger.
      await cache.put(`${OFFLINE_URL}?lang=en`, new Response(offlineHtml(OFFLINE_COPY.en), { headers: { "Content-Type": "text/html; charset=utf-8" } }));
      await cache.put(`${OFFLINE_URL}?lang=da`, new Response(offlineHtml(OFFLINE_COPY.da), { headers: { "Content-Type": "text/html; charset=utf-8" } }));
      try {
        await cache.add(new Request("/favicon.svg", { cache: "reload" }));
      } catch {
        // Uden favicon er offline-siden stadig fuldt brugbar.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== OFFLINE_CACHE).map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Ikke kritisk: navigationer gaar saa bare via fetch() nedenfor.
        }
      }
      await self.clients.claim();
    })(),
  );
});

async function offlineResponse(request) {
  const copy = pickCopy(request);
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(`${OFFLINE_URL}?lang=${copy.lang}`);
  if (cached) return cached;
  return new Response(offlineHtml(copy), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Kun top-level navigationer. Alt andet (assets, API, Supabase, analytics)
  // haandteres ikke af workeren og gaar direkte til netvaerk/HTTP-cache.
  if (request.mode !== "navigate" || request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        return offlineResponse(request);
      }
    })(),
  );
});

// ── Push (#6590) ────────────────────────────────────────────────────────────
// Payload (backend/lib/pushService.js): { title, body, tag, url, unread }.
// Samme tag pr. kategori: en ny besked erstatter den gamle i stedet for at
// stable sig. Kun stier paa vores eget domaene aabnes.
function safePath(url) {
  try {
    const parsed = new URL(url || "/notifications", self.location.origin);
    return parsed.origin === self.location.origin ? parsed.pathname + parsed.search : "/notifications";
  } catch {
    return "/notifications";
  }
}

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Cycling Zone";
  const tasks = [
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : "cz",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/monochrome-512.png",
      data: { url: safePath(data.url) },
    }),
  ];
  if (typeof data.unread === "number" && "setAppBadge" in self.navigator) {
    tasks.push((data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(path).catch(() => {});
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
