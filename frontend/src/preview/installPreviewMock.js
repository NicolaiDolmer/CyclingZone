// Letvægts window.fetch-interceptor til Vercel preview-deploys (VITE_PREVIEW_MOCK).
// Genbruger de delte matchers (samme datakilde som Playwright-fixtures). Ingen
// service worker, ingen ny dep. Mutationer → optimistisk OK. Realtime (WS) urørt.
//
// Interceptoren må ALDRIG kaste: enhver umatchet route eller fejl falder tilbage
// til den ægte fetch, så Vite-assets/HMR/WS stadig virker. Bag VITE_PREVIEW_MOCK-
// guarden i main.jsx ⇒ prod tree-shaker hele preview/-mappen væk.
import { parseTable, parseRpc, rpcResponse, wantsObject, restRows, restObject, apiResponse } from "./mockHandlers.js";
import { clubMockRoute } from "./clubMock.js";
import { plannerMockRoute } from "./plannerMock.js";
import { scoutingMockRoute } from "./scoutingMock.js";
import {
  TEST_USER, TEST_TEAM, SEED_ONBOARDING_PROGRESS, SEED_TRAINING, SEED_SCOUT_ESTIMATES,
  SEED_DEV_TRANSITION, ACTIVE_SEASON,
} from "./seedData.js";

// [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — statefuld in-memory
// toggle, samme princip som klubMock/plannerMock: POST flipper den, GET
// spejler den, så et før/efter-screenshot-par kan tages på ægte klik i
// stedet for to statiske payloads.
let previewSeasonSignupSignedUp = false;

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
          // #2863: en RPC med seed-data svares FØR den generiske mutations-linje,
          // ellers ville enhver RPC-drevet flade stå tom på preview.
          const rpcPayload = rpcResponse(parseRpc(url));
          if (rpcPayload !== undefined) return jsonResponse(rpcPayload);
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

      // #2454: potentiale-estimaterne. Preview faldt før igennem til den
      // generiske /api-blok og fik `{ ok: true }` på denne POST, så hver
      // potentiale-celle stod tom — inklusive de ti flader landing 1 lægger om.
      // Samme seed som Playwright-fixturen bruger, så de to mocks ikke kan vise
      // hver sit. Skal stå FØR scouting-central-routeren, som ellers ville
      // returnere null for pathen og lade den falde videre.
      if (method === "POST" && /\/api\/scouting\/estimates$/.test(url)) {
        let ids = [];
        if (init && init.body) { try { ids = JSON.parse(init.body).riderIds ?? []; } catch { ids = []; } }
        const estimates = {};
        for (const id of ids) {
          if (SEED_SCOUT_ESTIMATES[id]) estimates[id] = SEED_SCOUT_ESTIMATES[id];
        }
        return jsonResponse({ teamId: TEST_TEAM.id, maxLevel: 3, estimates });
      }

      // Trin 7-overgangspanelet (#3746/#3803, ejer-design 18/8). Bevidst KUN
      // her og ikke i mockHandlers: Playwright-fixtures deler den fil, og et
      // synligt panel ville flytte dashboard-snapshots (samme lagdeling som
      // onboarding-mocken nedenfor). Dismiss svarer ok uden state — panelet
      // dukker op igen ved reload på preview, hvilket er en FEATURE her: ejeren
      // skal kunne vise det frem flere gange.
      if (method === "GET" && /\/api\/development\/transition$/.test(url)) {
        return jsonResponse(SEED_DEV_TRANSITION);
      }
      if (method === "POST" && /\/api\/development\/transition\/dismiss$/.test(url)) {
        return jsonResponse({ ok: true });
      }

      // Statefuld Scouting-central-mock (#2244/#2644): rout /api/scouting/* +
      // POST /api/riders/names FØR de generiske /api-blokke, så start/annullér
      // muterer state og gennemklikket er ægte. Returnerer null for uhåndterede
      // paths → falder videre som før.
      if (/\/api\/(scouting\/|riders\/names)/.test(url)) {
        const u = new URL(url, window.location.origin);
        let body = null;
        if (method !== "GET" && init && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
        const res = scoutingMockRoute(method, u.pathname, body);
        if (res) return jsonResponse(res.body, res.status);
      }

      // #2819: onboarding-kortet + trænings-fladen. Rout FØR den generiske /api-
      // blok, så preview viser den ÆGTE onboarding-respons (4 trin, "Show me how"
      // klikbar) og en rigtig trænings-roster at hænge tour-ankrene på. Bevidst
      // KUN her og ikke i mockHandlers: Playwright-fixtures deler den fil, og et
      // synligt onboarding-kort ville flytte dashboard-snapshots (samme lagdeling
      // som scouting-mocken ovenfor).
      if (method === "GET" && /\/api\/me\/onboarding-progress$/.test(url)) {
        return jsonResponse(SEED_ONBOARDING_PROGRESS);
      }
      if (method === "GET" && /\/api\/training\/me$/.test(url)) {
        return jsonResponse(SEED_TRAINING);
      }

      // [epic #4592 del 3] "Tilmeld dig næste sæson" (#452) — dashboard-kortet.
      // Bevidst KUN her og ikke i mockHandlers.js (samme lagdeling som
      // onboarding-/dev-transition-mocken lige ovenfor): Playwright-fixtures
      // deler mockHandlers via frontend/tests/e2e/fixtures.js, og et synligt
      // kort her ville flytte de eksisterende dashboard-snapshots. `enabled:
      // true, eligible: true` er et BEVIDST preview-override af den ægte
      // fail-safe off-default (season_signup_enabled i app_config er 'off' i
      // prod), så ejeren kan se og gennemklikke kortet på preview FØR flaget
      // nogensinde flippes (docs' "ejeren skal kunne teste på preview"-regel).
      if (method === "GET" && /\/api\/season\/signup-status$/.test(url)) {
        return jsonResponse({
          enabled: true,
          // Forbliver true efter signup: server-siden nulstiller aldrig
          // eligible ved tilmelding (kun signed_up ændrer sig) — kortets
          // bekræftelses-tilstand skal kunne SES efter klik, ikke forsvinde.
          eligible: true,
          parked: false,
          signed_up: previewSeasonSignupSignedUp,
          next_season_number: ACTIVE_SEASON.number + 1,
        });
      }
      if (method === "POST" && /\/api\/season\/signup$/.test(url)) {
        previewSeasonSignupSignedUp = true;
        return jsonResponse({
          ok: true,
          signed_up: true,
          next_season_signup_at: new Date().toISOString(),
          next_season_number: ACTIVE_SEASON.number + 1,
        });
      }

      // Express-API (/api/...).
      if (/\/api\//.test(url)) {
        if (method !== "GET") return jsonResponse({ ok: true });
        const parsed = new URL(url, window.location.origin);
        return jsonResponse(apiResponse(parsed.pathname, parsed.search));
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
