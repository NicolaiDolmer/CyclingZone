// Letvægts window.fetch-interceptor til Vercel preview-deploys (VITE_PREVIEW_MOCK).
// Genbruger de delte matchers (samme datakilde som Playwright-fixtures). Ingen
// service worker, ingen ny dep. Mutationer → optimistisk OK. Realtime (WS) urørt.
//
// Interceptoren må ALDRIG kaste: enhver umatchet route eller fejl falder tilbage
// til den ægte fetch, så Vite-assets/HMR/WS stadig virker. Bag VITE_PREVIEW_MOCK-
// guarden i main.jsx ⇒ prod tree-shaker hele preview/-mappen væk.
import { parseTable, wantsObject, restRows, restObject, apiResponse } from "./mockHandlers.js";
import { clubMockRoute } from "./clubMock.js";
import { plannerMockRoute } from "./plannerMock.js";
import { scoutingMockRoute } from "./scoutingMock.js";
import { TEST_USER } from "./seedData.js";

// Læs Accept-headeren robust: init.headers kan være en Headers-instans, et plain
// objekt, eller helt fraværende (når input er et Request-objekt med egne headers).
function readAccept(input, init) {
  const h = init && init.headers;
  if (h) {
    if (typeof Headers !== "undefined" && h instanceof Headers) return h.get("accept") || "";
    if (typeof h.get === "function") return h.get("accept") || "";
    return h.accept || h.Accept || "";
  }
  // Fald tilbage til Request-objektets headers (fetch(new Request(url, {headers}))).
  if (input && typeof input !== "string" && input.headers && typeof input.headers.get === "function") {
    return input.headers.get("accept") || "";
  }
  return "";
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      // PostgREST-stil Content-Range så supabase-js' count-parsing ikke crasher.
      "content-range": `0-${Math.max(count - 1, 0)}/${count}`,
      ...extraHeaders,
    },
  });
}

export function installPreviewMock() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = (
      (init && init.method) ||
      (typeof input !== "string" && input && input.method) ||
      "GET"
    ).toUpperCase();
    const accept = readAccept(input, init);

    try {
      // Supabase Auth.
      if (/\/auth\/v1\/token/.test(url)) {
        return jsonResponse({
          access_token: "preview-token",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "preview-refresh",
          user: TEST_USER,
        });
      }
      if (/\/auth\/v1\/user/.test(url)) return jsonResponse(TEST_USER);
      // Catch-all for øvrige Supabase-auth-kald (signup, logout, recover, …) så
      // de bliver inde i mocken — ellers falder fx sign-out igennem til ægte
      // fetch mod sentinel-URL'en og fejler i preview.
      if (/\/auth\/v1\//.test(url)) return jsonResponse({ message: "ok" });

      // Supabase REST (PostgREST).
      if (/\/rest\/v1\//.test(url)) {
        if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
          // Optimistisk mutation: ét objekt eller tomt array afhængig af Prefer/Accept.
          return jsonResponse(wantsObject(accept) ? {} : []);
        }
        const table = parseTable(url);
        return jsonResponse(wantsObject(accept) ? restObject(table, url) : restRows(table, url));
      }

      // Statefuld Klub-mock (#1441 A3): rout /api/club/* + /api/staff/* (#2450
      // personale-oversigt, samme mock-modul) FØR den generiske /api/-blok, så
      // køb/ansæt/fyr muterer in-memory-state og gennemklikket er ægte.
      if (/\/api\/(club|staff)\//.test(url)) {
        const u = new URL(url, window.location.origin);
        let body = null;
        if (method !== "GET" && init && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
        const res = clubMockRoute(method, u.pathname, u.search, body);
        if (res) return jsonResponse(res.body, res.status);
      }

      // Statefuld Season Planner-mock (#1834-test-flow): rout /api/peak-plans* FØR
      // den generiske /api/-blok, så sæt/om-målret/fjern/auto-plan muterer state og
      // gennemklikket er ægte (samme mønster som clubMock).
      if (/\/api\/peak-plans/.test(url)) {
        const u = new URL(url, window.location.origin);
        let body = null;
        if (method !== "GET" && init && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
        const res = plannerMockRoute(method, u.pathname, u.search, body);
        if (res) return jsonResponse(res.body, res.status);
      }

      // Statefuld Scouting-central-mock (#2244/#2644): rout /api/scouting/* +
      // POST /api/riders/names FØR de generiske /api-blokke, så start/annullér
      // muterer state og gennemklikket er ægte. Returnerer null for uhåndterede
      // paths (fx /api/scouting/estimates) → falder videre som før.
      if (/\/api\/(scouting\/|riders\/names)/.test(url)) {
        const u = new URL(url, window.location.origin);
        let body = null;
        if (method !== "GET" && init && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
        const res = scoutingMockRoute(method, u.pathname, body);
        if (res) return jsonResponse(res.body, res.status);
      }

      // Express-API (/api/...).
      if (/\/api\//.test(url)) {
        if (method !== "GET") return jsonResponse({ ok: true });
        const pathname = new URL(url, window.location.origin).pathname;
        return jsonResponse(apiResponse(pathname));
      }
    } catch (err) {
      // Aldrig kaste fra interceptoren — fald tilbage til ægte fetch.
      console.warn("[preview-mock] umatchet/fejlet request, falder tilbage:", url, err);
    }

    // Alt andet (Vite-assets, HMR, WebSocket-upgrades) → ægte fetch.
    return realFetch(input, init);
  };

  console.info("[preview-mock] aktiv — seed-data serveres lokalt, prod røres ikke.");
}
