// First-touch attribution på marketing-sitet (#5310).
//
// Siden 14/9 serverer marketing-sitet forsiden (/) og informationssiderne på
// cyclingzone.org via frontend-rewrites/middleware, altså SAMME origin og samme
// localStorage som SPA'en. SPA'ens captureFirstTouch() (frontend/src/lib/
// attribution.js) kørte først på /login, efter klikket, hvor UTM'erne og den
// eksterne referrer var væk. Derfor skriver marketing-siderne nu selv
// first-touch-rækken, i PRÆCIS samme nøgle og format, og SPA'en overskriver den
// ikke (første besøg vinder).
//
// Samtykke: samme data og samme grundlag som attribution.js (legitim interesse,
// uden for analytics-gaten, intet persisteres før signup).
//
// #5304 blocking fix (25/9): forsiden (/) og informationssiderne er PRÆCIS de
// sider betalte annoncer lander på, og fordi denne fil skriver first-touch-
// rækken FØRST (før SPA'ens captureFirstTouch kan nå det) og "første besøg
// vinder", var click-id-fangsten i frontend/src/lib/attribution.js reelt
// uvirksom for et besøg på cyclingzone.org/?fbclid=... — click-id'et gik tabt
// permanent, fordi SPA'en aldrig fik lov at overskrive. Denne fil fanger nu de
// samme fbclid/gclid/ttclid/msclkid-nøgler, i samme format, så pariteten med
// frontend/src/lib/attribution.js (attribution.test.ts:83) holder.

export const ATTRIBUTION_STORAGE_KEY = "cz_attribution_v1"; // gitleaks:allow — localStorage-nøglenavn, ikke en secret
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export const CLICK_ID_KEYS = ["fbclid", "gclid", "ttclid", "msclkid"] as const;

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type FirstTouchContext = {
  search: string;
  referrer: string;
  path: string;
  origin: string;
  storage: StorageLike;
  now: () => string;
};

// Skriver first-touch-rækken, men KUN hvis nøglen mangler. Samme regler som
// buildFirstTouchRecord i frontend/src/lib/attribution.js: en same-origin
// referrer er vores egen side og gemmes aldrig som kanal; står der utm_* i dens
// query, udledes de derfra. UTM på den aktuelle URL vinder altid.
//
// SELVSTÆNDIG MED VILJE: funktionen serialiseres med toString() til et inline
// <script> i root-layoutene (FIRST_TOUCH_SCRIPT nedenfor), så den kører under
// HTML-parsingen, før brugeren kan nå at klikke. Den må derfor IKKE referere
// til noget uden for sin egen krop (ingen modul-konstanter, ingen imports) og
// må ikke bruge syntaks en transpiler sænker med hjælpefunktioner (object
// spread, async). Uden argumenter læser den den rigtige browser-kontekst.
export function captureFirstTouch(ctx?: Partial<FirstTouchContext>): void {
  try {
    const c = ctx || {};
    const storage = c.storage || window.localStorage;
    const storageKey = "cz_attribution_v1"; // gitleaks:allow — localStorage-nøglenavn
    if (storage.getItem(storageKey)) return;
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    // #5304: samme click-id-nøgler som frontend/src/lib/attribution.js. Duplikeret
    // (ikke importeret fra den modul-level CLICK_ID_KEYS-konstant ovenfor) fordi
    // funktionen SELVSTÆNDIG MED VILJE — se kommentaren nedenfor.
    const clickIdKeys = ["fbclid", "gclid", "ttclid", "msclkid"];
    const search = c.search !== undefined ? c.search : window.location.search;
    const referrer = c.referrer !== undefined ? c.referrer : document.referrer;
    const path = c.path !== undefined ? c.path : window.location.pathname;
    const origin = c.origin !== undefined ? c.origin : window.location.origin;
    const firstSeenAt = c.now ? c.now() : new Date().toISOString();

    const params = new URLSearchParams(search || "");
    let utmParams = params;
    let externalReferrer = referrer ? String(referrer) : "";
    if (externalReferrer && origin) {
      let refUrl: URL | null = null;
      try {
        refUrl = new URL(externalReferrer);
      } catch {
        refUrl = null;
      }
      if (refUrl && refUrl.origin === origin) {
        externalReferrer = "";
        // #5304: fald tilbage til referrerens query hvis ENTEN utm ELLER
        // click-id mangler på den aktuelle URL — samme genfindings-regel som
        // frontend/src/lib/attribution.js.
        if (!keys.concat(clickIdKeys).some((k) => params.get(k))) utmParams = refUrl.searchParams;
      }
    }
    const record: Record<string, string | null> = { first_seen_at: firstSeenAt };
    for (const k of keys) {
      const v = utmParams.get(k);
      record[k] = v ? v.slice(0, 200) : null;
    }
    for (const k of clickIdKeys) {
      const v = utmParams.get(k);
      record[k] = v ? v.slice(0, 200) : null;
    }
    // #5304: samme paid-candidate-markering som frontend/src/lib/attribution.js
    // — et click-id uden utm_source er en KANDIDAT, ikke bevis for betalt trafik.
    record.source_hint = !record.utm_source && clickIdKeys.some((k) => record[k]) ? "paid-candidate" : null;
    record.referrer = externalReferrer ? externalReferrer.slice(0, 500) : null;
    record.landing_path = path ? String(path).slice(0, 200) : null;
    storage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // localStorage blokeret (privat vindue o.l.): attribution er best-effort.
  }
}

// Inline-scriptet root-layoutene lægger forrest i <body>.
export const FIRST_TOUCH_SCRIPT = `(${captureFirstTouch.toString()})();`;

// Bærer de tilladte utm_*-parametre fra marketing-sidens URL videre til et
// app-link (/login, /login?mode=signup), så også SPA'en ser kampagnen, hvis
// localStorage er blokeret eller brugeren klikker før scriptet har kørt.
// Eksisterende parametre på linket overskrives aldrig; alt andet i search
// (fx fbclid) følger ikke med.
export function withUtm(href: string, search: string): string {
  const incoming = new URLSearchParams(search || "");
  if (!UTM_KEYS.some((k) => incoming.get(k))) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href; // relativt eller ugyldigt link: rør det ikke
  }
  for (const k of UTM_KEYS) {
    const v = incoming.get(k);
    if (v && !url.searchParams.has(k)) url.searchParams.set(k, v.slice(0, 200));
  }
  return url.toString();
}
