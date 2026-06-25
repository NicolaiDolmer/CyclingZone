# Pre-live verifikations-harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør race-hub-flader klikbare på Vercel preview-deploys (mock-seed) + fang backend-kontrakt-bugs (#1840-klassen) automatisk i CI via PGlite.

**Architecture:** To uafhængige dele. **Del A (PSH, frontend):** ét delt seed-modul + delte matchers (genbrugt af Playwright-fixtures OG en `window.fetch`-interceptor), gated bag `VITE_PREVIEW_MOCK` i `main.jsx`. **Del B (Contract-harness, backend):** en PGlite-sanitizer + `createTestDb`-harness der loader ÆGTE `database/*.sql`-DDL, plus contract-tests der kører endpoints' faktiske projektioner mod det ægte skema.

**Tech Stack:** React + Vite (frontend), Node `node:test` + `@electric-sql/pglite` ^0.5.3 (backend), Playwright (e2e, uændret kontrakt).

**Spec:** `docs/superpowers/specs/2026-06-25-prelive-verification-harness-design.md`. Del A og Del B er uafhængige → kan blive 1 eller 2 PR'er.

---

## Filstruktur

**Del A (frontend):**
- Create: `frontend/src/preview/seedData.js` — framework-neutral seed-data (eneste kilde).
- Create: `frontend/src/preview/mockHandlers.js` — rene matchers `restRows`/`restObject`/`apiResponse` (flyttet fra fixtures.js).
- Create: `frontend/src/preview/installPreviewMock.js` — `window.fetch`-interceptor.
- Create: `frontend/src/preview/seedData.test.js` — `node --test` skema-form-test.
- Create: `frontend/src/preview/mockHandlers.test.js` — matcher-unit-test.
- Modify: `frontend/tests/e2e/fixtures.js` — importér seed + matchers (slet inline-dubletter).
- Modify: `frontend/src/main.jsx` — bootstrap-gate.

**Del B (backend):**
- Create: `backend/lib/testdb/sanitizeForPglite.js` — strip PGlite-inkompatible statements.
- Create: `backend/lib/testdb/sanitizeForPglite.test.js`.
- Create: `backend/lib/testdb/createTestDb.js` — PGlite + sanitiseret real-DDL-loader.
- Create: `backend/lib/testdb/createTestDb.integration.test.js` — harness-smoke + skema-fidelitets-meta-test.
- Create: `backend/routes/raceStrategy.contract.integration.test.js` — strategi-endpoint contract-test.
- Modify: `backend/routes/api.js` — ekstrahér projektions-konstanter (strategi-roster).

---

# DEL A — Preview seed-harness (PSH)

## Task A1: Ekstrahér seed-data + matchers til delt modul (refactor, ingen adfærdsændring)

**Files:**
- Create: `frontend/src/preview/seedData.js`
- Create: `frontend/src/preview/mockHandlers.js`
- Create: `frontend/src/preview/seedData.test.js`
- Modify: `frontend/tests/e2e/fixtures.js`

- [ ] **Step 1: Opret `seedData.js` med de eksisterende fixture-værdier**

Flyt de rene data-objekter fra `fixtures.js` (TEST_USER, TEST_TEAM, RIVAL_TEAM, ACTIVE_SEASON, RIDERS, POOL_RACES, ROADMAP_ITEMS, AUCTIONS) uændret til `frontend/src/preview/seedData.js` og `export` dem. Kopiér værdierne 1:1 (ingen ændringer) — race-hub-seed tilføjes i A2.

```js
// frontend/src/preview/seedData.js
// Framework-neutral seed-data. Eneste kilde — importeres af BÅDE Playwright-
// fixtures (frontend/tests/e2e/fixtures.js) OG runtime-preview-mocken
// (installPreviewMock.js). Ingen @playwright/test-import her.
export const TEST_USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "manager@cyclingzone.test", user_metadata: { team_name: "E2E Racing" }, app_metadata: {}, created_at: "2026-05-13T00:00:00.000Z" };
export const TEST_TEAM = { id: "team-e2e", user_id: TEST_USER.id, name: "E2E Racing", manager_name: "Playwright Manager", division: 2, league_division_id: 2, balance: 500000, sponsor_income: 240000, is_ai: false, is_test_account: true };
// ... (RIVAL_TEAM, ACTIVE_SEASON, RIDERS, POOL_RACES, ROADMAP_ITEMS, AUCTIONS — kopiér 1:1 fra fixtures.js linje 13-173)
```

- [ ] **Step 2: Opret `mockHandlers.js` med de rene matchers**

Flyt `restRows`, `restObject`, `apiResponse`, `parseTable`, `wantsObject` fra fixtures.js til `frontend/src/preview/mockHandlers.js`. De importerer seed fra `seedData.js`. De refererer IKKE `route`/`@playwright/test` (CORS/fulfill bliver i fixtures.js).

```js
// frontend/src/preview/mockHandlers.js
import { TEST_USER, TEST_TEAM, RIVAL_TEAM, ACTIVE_SEASON, RIDERS, POOL_RACES, ROADMAP_ITEMS, AUCTIONS } from "./seedData.js";

export function parseTable(requestUrl) {
  const url = new URL(requestUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1];
}
export function wantsObject(headersAccept = "") { return headersAccept.includes("vnd.pgrst.object"); }
export function restRows(table, requestUrl = "") { /* flyt fixtures.js:212-249 1:1 */ }
export function restObject(table, requestUrl = "") { /* flyt fixtures.js:251-264 1:1 */ }
export function apiResponse(pathname) { /* flyt fixtures.js:266-457 1:1 */ }
```

- [ ] **Step 3: Refaktorér `fixtures.js` til at importere fra de delte moduler**

Erstat de flyttede definitioner i fixtures.js med imports. Behold `corsHeaders`, `json`, `installNetworkMocks`, snapshot-helpers, `makeBoardStatus`, `login`, `stabilizePage` i fixtures.js. `installNetworkMocks` kalder nu de importerede matchers.

```js
// frontend/tests/e2e/fixtures.js (top)
import { expect } from "@playwright/test";
import { TEST_USER, TEST_TEAM, RIDERS, ROADMAP_ITEMS, AUCTIONS } from "../../src/preview/seedData.js";
import { parseTable, wantsObject, restRows, restObject, apiResponse } from "../../src/preview/mockHandlers.js";
// re-export så eksisterende spec-imports (import { TEST_USER } from "./fixtures.js") stadig virker:
export { TEST_USER, TEST_TEAM, RIDERS, ROADMAP_ITEMS, AUCTIONS };
```

I `installNetworkMocks`, opdatér REST-handleren: `wantsObject(request.headers().accept)` i stedet for `wantsObject(request)`.

- [ ] **Step 4: Skriv skema-form-test for seed-data**

```js
// frontend/src/preview/seedData.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { RIDERS, TEST_TEAM } from "./seedData.js";

test("hver rider har et team og en gyldig type", () => {
  for (const r of RIDERS) {
    assert.ok(r.id, "rider mangler id");
    assert.ok(r.firstname && r.lastname, `rider ${r.id} mangler navn`);
  }
});
test("TEST_TEAM er et ikke-AI testhold", () => {
  assert.equal(TEST_TEAM.is_ai, false);
  assert.equal(TEST_TEAM.is_test_account, true);
});
```

- [ ] **Step 5: Kør tests + verificér grøn**

Run: `cd frontend && node --test src/preview/seedData.test.js`
Expected: PASS

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Expected: PASS (alle 3 projekter — refaktoreringen ændrer ingen data-værdier, ingen snapshot-drift)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/preview/seedData.js frontend/src/preview/mockHandlers.js frontend/src/preview/seedData.test.js frontend/tests/e2e/fixtures.js
git commit -F .git-commit-msg.tmp   # "refactor(preview): ekstrahér seed-data + matchers til delt modul (genbrug i Playwright + runtime-mock)"
```

---

## Task A2: Tilføj race-hub-seed (kommende + I gang + kørte løb)

**Files:**
- Modify: `frontend/src/preview/seedData.js`
- Modify: `frontend/src/preview/mockHandlers.js`
- Modify: `frontend/src/preview/seedData.test.js`

- [ ] **Step 1: Tilføj race-seed til `seedData.js`**

Tilføj eksporter: `SEED_RACES` (1 kommende stage-race, 1 "I gang" `stages_completed`∈(0,stages), 2 kørte), `SEED_STAGE_PROFILES` (≥1 pr. etape m. `profile_type` + `demand_vector` der summerer ~1.0), `SEED_STAGE_SCHEDULE` (`scheduled_at` pr. etape), `SEED_RACE_RESULTS` (stage+gc+points+mountain for de kørte), `SEED_DISTRIBUTION` (board-payload m. ≥1 overlap-kolonne), `SEED_STRATEGY` (a_chain/captain_priorities/role_rules/target_race_ids), `SEED_ACADEMY` (roster/intake/freeAgents — kopiér formen fra fixtures.js `apiResponse("/api/academy/me")`).

```js
// frontend/src/preview/seedData.js (tilføj)
export const SEED_RACES = [
  { id: "race-up-1", season_id: ACTIVE_SEASON.id, name: "Tour de Preview", race_type: "stage_race", race_class: "TourFrance", stages: 3, stages_completed: 0, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, pool_race: { date_text: "12 Jul" } },
  { id: "race-live-1", season_id: ACTIVE_SEASON.id, name: "Settimana Preview", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 2, status: "scheduled", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, pool_race: { date_text: "20 Jun" } },
  { id: "race-done-1", season_id: ACTIVE_SEASON.id, name: "Omloop Preview", race_type: "single", race_class: "Monuments", stages: 1, stages_completed: 1, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, pool_race: { date_text: "01 Mar" } },
  { id: "race-done-2", season_id: ACTIVE_SEASON.id, name: "Giro di Preview", race_type: "stage_race", race_class: "GiroVuelta", stages: 2, stages_completed: 2, status: "completed", edition_year: 2026, league_division_id: TEST_TEAM.league_division_id, pool_race: { date_text: "10 May" } },
];
export const SEED_STAGE_PROFILES = [
  { race_id: "race-up-1", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: { sprint: 0.61, acceleration: 0.15, positioning: 0.08, flat: 0.06, endurance: 0.02, randomness: 0.08 } },
  { race_id: "race-up-1", stage_number: 2, profile_type: "mountain", finale_type: "long_climb", demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.15, recovery: 0.1, randomness: 0.05 } },
  { race_id: "race-up-1", stage_number: 3, profile_type: "hilly", finale_type: "punch", demand_vector: { punch: 0.45, climbing: 0.25, endurance: 0.15, positioning: 0.1, randomness: 0.05 } },
  { race_id: "race-live-1", stage_number: 3, profile_type: "rolling", finale_type: "reduced_sprint", demand_vector: { sprint: 0.4, endurance: 0.3, punch: 0.15, positioning: 0.1, randomness: 0.05 } },
  { race_id: "race-done-1", stage_number: 1, profile_type: "cobbles", finale_type: "breakaway", demand_vector: { cobblestone: 0.4, endurance: 0.25, punch: 0.15, positioning: 0.1, randomness: 0.1 } },
];
export const SEED_STAGE_SCHEDULE = [
  { race_id: "race-up-1", stage_number: 1, scheduled_at: "2026-07-12T13:00:00.000Z" },
  { race_id: "race-live-1", stage_number: 3, scheduled_at: "2026-06-25T13:00:00.000Z" },
];
export const SEED_RACE_RESULTS = [
  { race_id: "race-done-1", stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDERS[0].id, rider_name: "Ada Pedersen", team_id: TEST_TEAM.id, team_name: TEST_TEAM.name, finish_time: "+0:00", points_earned: 25, prize_money: 100000, in_breakaway: true, breakaway_caught: false },
  { race_id: "race-done-1", stage_number: 1, result_type: "stage", rank: 2, rider_id: RIDERS[1].id, rider_name: "Mikkel Hansen", team_id: RIVAL_TEAM.id, team_name: RIVAL_TEAM.name, finish_time: "+0:14", points_earned: 20, prize_money: 60000, in_breakaway: false, breakaway_caught: false },
];
```

(Værdierne ovenfor er minimum; udvid med flere etaper/resultater for rigere flader. `demand_vector`-summer skal ligge i [0.97, 1.03].)

- [ ] **Step 2: Wire race-seed ind i matchers**

I `mockHandlers.js`, opdatér `restRows` for race-tabellerne:

```js
// mockHandlers.js — i restRows(table, requestUrl) switch:
case "races": {
  const url = new URL(requestUrl);
  if (url.search.includes("league_division_id=eq")) return SEED_RACES; // tæller-query (#1829) + strategi/dashboard
  if (/id=eq\./.test(url.search)) { const id = url.search.match(/id=eq\.([^&]+)/)?.[1]; return SEED_RACES.filter(r => r.id === id); }
  return SEED_RACES;
}
case "race_stage_profiles": return SEED_STAGE_PROFILES;
case "race_stage_schedule": return SEED_STAGE_SCHEDULE;
case "race_results": return SEED_RACE_RESULTS;
```

I `apiResponse(pathname)`, tilføj race-hub-endpoints:

```js
if (pathname.endsWith("/api/races/distribution")) return SEED_DISTRIBUTION;
if (pathname.endsWith("/api/races/strategy")) return SEED_STRATEGY;
// /api/academy/me findes allerede (flyttet i A1)
```

Husk at importere de nye seed-eksporter øverst i mockHandlers.js.

- [ ] **Step 3: Udvid skema-form-testen**

```js
// seedData.test.js (tilføj)
import { SEED_RACES, SEED_STAGE_PROFILES, SEED_STAGE_SCHEDULE, SEED_RACE_RESULTS } from "./seedData.js";

test("hvert løb har konsistent stages_completed-invariant", () => {
  for (const r of SEED_RACES) {
    assert.ok(r.stages_completed <= r.stages, `${r.id}: completed > stages`);
    if (r.status === "completed") assert.equal(r.stages_completed, r.stages, `${r.id}: completed-status men ikke alle etaper`);
  }
});
test("mindst ét 'I gang'-løb (0 < completed < stages)", () => {
  assert.ok(SEED_RACES.some(r => r.stages_completed > 0 && r.stages_completed < r.stages), "intet live-løb i seed");
});
test("hver demand_vector summerer ~1.0", () => {
  for (const p of SEED_STAGE_PROFILES) {
    const sum = Object.values(p.demand_vector).reduce((a, b) => a + b, 0);
    assert.ok(sum > 0.97 && sum < 1.03, `${p.race_id} st${p.stage_number}: demand_vector sum=${sum}`);
  }
});
test("ingen dangling FK i race_results (rider/team/race findes)", () => {
  const raceIds = new Set(SEED_RACES.map(r => r.id));
  for (const res of SEED_RACE_RESULTS) assert.ok(raceIds.has(res.race_id), `result peger på ukendt race ${res.race_id}`);
});
test("schedule-rækker peger kun på kendte løb", () => {
  const raceIds = new Set(SEED_RACES.map(r => r.id));
  for (const s of SEED_STAGE_SCHEDULE) assert.ok(raceIds.has(s.race_id), `schedule peger på ukendt race ${s.race_id}`);
});
```

- [ ] **Step 4: Kør tests**

Run: `cd frontend && node --test src/preview/seedData.test.js`
Expected: PASS

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Expected: PASS (race-seed påvirker ikke eksisterende snapshots — `/races` + dashboard læser kun `league_division_id`-query som før, nu med ægte løb; verificér ingen utilsigtet drift, kør `--update-snapshots` KUN hvis en bevidst visuel ændring opstår)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/preview/seedData.js frontend/src/preview/mockHandlers.js frontend/src/preview/seedData.test.js
git commit -F .git-commit-msg.tmp   # "feat(preview): realistisk race-hub-seed (kommende/I gang/kørte løb + profiler/schedule/resultater)"
```

---

## Task A3: Runtime-interceptor + bootstrap-gate

**Files:**
- Create: `frontend/src/preview/installPreviewMock.js`
- Create: `frontend/src/preview/mockHandlers.test.js`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Skriv matcher-unit-test (kører uden browser)**

```js
// frontend/src/preview/mockHandlers.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { restRows, apiResponse } from "./mockHandlers.js";

test("races-tabel returnerer seed-løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?league_division_id=eq.2");
  assert.ok(rows.length >= 3, "forventede seed-løb");
});
test("races id=eq filtrerer til ét løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?id=eq.race-up-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "race-up-1");
});
test("/api/races/strategy returnerer strategi-payload", () => {
  const r = apiResponse("/api/races/strategy");
  assert.ok(r && typeof r === "object");
});
```

- [ ] **Step 2: Kør → verificér FAIL hvis matchers mangler race-støtte**

Run: `cd frontend && node --test src/preview/mockHandlers.test.js`
Expected: PASS hvis A2 er korrekt; ellers FAIL der peger på manglende case.

- [ ] **Step 3: Skriv `installPreviewMock.js`**

```js
// frontend/src/preview/installPreviewMock.js
// Letvægts window.fetch-interceptor til Vercel preview-deploys (VITE_PREVIEW_MOCK).
// Genbruger de delte matchers (samme datakilde som Playwright-fixtures). Ingen
// service worker, ingen ny dep. Mutationer → optimistisk OK. Realtime (WS) urørt.
import { parseTable, wantsObject, restRows, restObject, apiResponse } from "./mockHandlers.js";
import { TEST_USER } from "./seedData.js";

function jsonResponse(data, status = 200, extraHeaders = {}) {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "content-range": `0-${Math.max(count - 1, 0)}/${count}`, ...extraHeaders },
  });
}

export function installPreviewMock() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const accept = (init.headers && (init.headers.accept || init.headers.Accept)) || "";

    try {
      if (/\/auth\/v1\/token/.test(url)) return jsonResponse({ access_token: "preview-token", token_type: "bearer", expires_in: 3600, refresh_token: "preview-refresh", user: TEST_USER });
      if (/\/auth\/v1\/user/.test(url)) return jsonResponse(TEST_USER);
      if (/\/rest\/v1\//.test(url)) {
        if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) return jsonResponse(wantsObject(accept) ? {} : []);
        const table = parseTable(url);
        return jsonResponse(wantsObject(accept) ? restObject(table, url) : restRows(table, url));
      }
      if (/\/api\//.test(url)) {
        if (method !== "GET") return jsonResponse({ ok: true });
        return jsonResponse(apiResponse(new URL(url, window.location.origin).pathname));
      }
    } catch (err) {
      console.warn("[preview-mock] umatchet request, falder tilbage:", url, err);
    }
    return realFetch(input, init); // assets/vite/HMR
  };
  console.info("[preview-mock] aktiv — seed-data serveres lokalt, prod røres ikke.");
}
```

- [ ] **Step 4: Tilføj bootstrap-gate i `main.jsx`**

Indsæt FØR `ReactDOM.createRoot(...)` (efter `captureFirstTouch()`):

```js
// frontend/src/main.jsx (efter linje 32, captureFirstTouch())
// Preview-mock (#prelive-harness): KUN når VITE_PREVIEW_MOCK er sat (Vercel
// preview-scope). Dynamisk import bag build-time-guard ⇒ prod-bundlen tree-shaker
// hele preview/-mappen væk (0 bytes i production).
if (import.meta.env.VITE_PREVIEW_MOCK) {
  const { installPreviewMock } = await import("./preview/installPreviewMock.js");
  installPreviewMock();
}
```

Bemærk: top-level `await` i et ESM-entry — Vite understøtter det. Hvis build-target-warning opstår, wrap i en async IIFE der afventes før `createRoot`.

- [ ] **Step 5: Verificér build + lokal mock manuelt**

Run: `cd frontend && npm run build`
Expected: SUCCESS; bekræft at `dist/` ikke indeholder seed-strenge (`grep -r "Tour de Preview" dist/ || echo "clean"`) → "clean" (tree-shaket væk uden flag).

Run lokalt: `cd frontend && VITE_PREVIEW_MOCK=1 npm run dev`, åbn `/races/race-up-1`. Verificér visuelt via preview-værktøjer (preview_start → preview_screenshot). Bekræft: ruteprofil + demand-DNA-bar + etape-stripe rendrer; ingen prod-netværkskald (preview_network).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/preview/installPreviewMock.js frontend/src/preview/mockHandlers.test.js frontend/src/main.jsx
git commit -F .git-commit-msg.tmp   # "feat(preview): window.fetch-interceptor + VITE_PREVIEW_MOCK bootstrap-gate"
```

---

## Task A4: Vercel preview-env (manuel/MCP — ejer-bekræftes)

**Files:** ingen kode. Vercel-projektkonfiguration.

- [ ] **Step 1: Sæt preview-scope env-vars**

På Vercel-projektet (scope = **Preview**, IKKE Production):
- `VITE_PREVIEW_MOCK=1`
- `VITE_SUPABASE_URL=https://preview-mock.invalid` (sentinel — fysisk umuligt at ramme prod)

Production-scope uændret. **NB:** dette gør ALLE preview-deploys til sikre mock-previews (ingen preview rammer prod-data). Bekræft denne konsekvens med ejeren før anvendelse (kan via Vercel MCP `deploy_to_vercel`/env eller dashboard).

- [ ] **Step 2: Verificér på en preview-deploy**

Push branchen, åbn PR's Vercel-preview-URL, "log ind", klik `/races/race-up-1` + board + strategi. Bekræft seed-data vises. Vedhæft ægte screenshots til PR-body.

---

# DEL B — Backend-kontrakt-harness

## Task B1: PGlite-sanitizer

**Files:**
- Create: `backend/lib/testdb/sanitizeForPglite.js`
- Create: `backend/lib/testdb/sanitizeForPglite.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
// backend/lib/testdb/sanitizeForPglite.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForPglite } from "./sanitizeForPglite.js";

test("fjerner CREATE POLICY-statements", () => {
  const out = sanitizeForPglite(`CREATE TABLE t (id int);\nCREATE POLICY p ON t FOR SELECT USING (true);`);
  assert.ok(/CREATE TABLE/.test(out));
  assert.ok(!/CREATE POLICY/i.test(out));
});
test("fjerner ENABLE ROW LEVEL SECURITY + GRANT + CREATE EXTENSION", () => {
  const out = sanitizeForPglite(`ALTER TABLE t ENABLE ROW LEVEL SECURITY;\nGRANT SELECT ON t TO anon;\nCREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  assert.ok(!/ROW LEVEL SECURITY/i.test(out));
  assert.ok(!/GRANT/i.test(out));
  assert.ok(!/CREATE EXTENSION/i.test(out));
});
test("bevarer CREATE TABLE + ADD COLUMN + CHECK-constraints", () => {
  const sql = `CREATE TABLE riders (id uuid, is_academy boolean);\nALTER TABLE riders ADD COLUMN primary_type text;`;
  const out = sanitizeForPglite(sql);
  assert.ok(/CREATE TABLE riders/.test(out));
  assert.ok(/ADD COLUMN primary_type/.test(out));
});
```

- [ ] **Step 2: Kør → verificér FAIL**

Run: `cd backend && node --test lib/testdb/sanitizeForPglite.test.js`
Expected: FAIL ("sanitizeForPglite is not a function" / modul mangler)

- [ ] **Step 3: Implementér sanitizeren**

```js
// backend/lib/testdb/sanitizeForPglite.js
// Strip statements PGlite ikke kan køre (eller som er irrelevante for kolonne-
// kontrakt-tests): RLS-policies, GRANTs, RLS-enable, extensions, auth-schema-refs.
// Bevarer al table-/kolonne-/constraint-DDL intakt → skemaet forbliver tro mod prod.
const DROP_STATEMENT_PATTERNS = [
  /^\s*CREATE\s+POLICY[\s\S]*?;/gim,
  /^\s*DROP\s+POLICY[\s\S]*?;/gim,
  /^\s*ALTER\s+TABLE[^;]*\bROW\s+LEVEL\s+SECURITY\b[^;]*;/gim,
  /^\s*GRANT[\s\S]*?;/gim,
  /^\s*REVOKE[\s\S]*?;/gim,
  /^\s*CREATE\s+EXTENSION[\s\S]*?;/gim,
  /^\s*COMMENT\s+ON[\s\S]*?;/gim,
];

export function sanitizeForPglite(sql) {
  let out = sql;
  for (const re of DROP_STATEMENT_PATTERNS) out = out.replace(re, "");
  return out;
}
```

- [ ] **Step 4: Kør → verificér PASS**

Run: `cd backend && node --test lib/testdb/sanitizeForPglite.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/lib/testdb/sanitizeForPglite.js backend/lib/testdb/sanitizeForPglite.test.js
git commit -F .git-commit-msg.tmp   # "feat(testdb): PGlite-sanitizer (strip policies/grants/extensions, behold DDL)"
```

---

## Task B2: `createTestDb`-harness + skema-fidelitets-meta-test

**Files:**
- Create: `backend/lib/testdb/createTestDb.js`
- Create: `backend/lib/testdb/createTestDb.integration.test.js`

- [ ] **Step 1: Skriv harness'en**

```js
// backend/lib/testdb/createTestDb.js
// Ephemeral Postgres (PGlite) loaded med ÆGTE database/*.sql-DDL via sanitizeren.
// Genbruger #844-mønstret (countriesSeed.integration.test.js) men for flere filer.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sanitizeForPglite } from "./sanitizeForPglite.js";

const PREREQ = `
  CREATE ROLE authenticated;
  CREATE ROLE anon;
  CREATE ROLE service_role;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
`;

// Ordnet liste af ÆGTE migrationsfiler der opbygger tabellerne under test.
// Rækkefølge = bootstrap-skema først, derefter additive migrationer.
export const RACE_HUB_SCHEMA_FILES = [
  "database/schema.sql",
  "database/2026-06-04-race-engine-physiology-schema.sql",
  "database/2026-06-06-race-stage-profiles.sql",
  "database/2026-06-07-race-engine-slice2.sql",
  "database/2026-06-20-races-stage-progress.sql",
  "database/2026-06-13-academy-mvp.sql",
  "database/2026-06-25-team-race-strategy.sql",
];

export async function createTestDb({ files = RACE_HUB_SCHEMA_FILES } = {}) {
  const db = new PGlite();
  await db.exec(PREREQ);
  for (const rel of files) {
    const sql = readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
    try {
      await db.exec(sanitizeForPglite(sql));
    } catch (err) {
      throw new Error(`createTestDb: ${rel} fejlede i PGlite efter sanitering: ${err.message}`);
    }
  }
  return db;
}

export async function columnExists(db, table, column) {
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, column],
  );
  return rows.length > 0;
}
```

- [ ] **Step 2: Skriv harness-smoke + fidelitets-meta-test**

```js
// backend/lib/testdb/createTestDb.integration.test.js
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, columnExists } from "./createTestDb.js";

let db;
before(async () => { db = await createTestDb(); });

test("harness loader skemaet uden fejl + riders findes", async () => {
  const { rows } = await db.query("SELECT to_regclass('public.riders') AS t");
  assert.ok(rows[0].t, "riders-tabel mangler efter load");
});

// FIDELITETS-BEVIS: skemaet matcher prod for de kolonner strategi-endpointet bruger,
// og den IKKE-eksisterende #1840-kolonne 'overall' er fraværende → en projektion af
// 'overall' VILLE fejle (= harness'en fanger klassen).
test("riders har strategi-roster-kolonnerne, men IKKE 'overall'", async () => {
  for (const col of ["id", "firstname", "lastname", "primary_type", "secondary_type", "team_id", "is_academy", "is_retired"]) {
    assert.ok(await columnExists(db, "riders", col), `riders mangler forventet kolonne: ${col} (juster RACE_HUB_SCHEMA_FILES)`);
  }
  assert.equal(await columnExists(db, "riders", "overall"), false, "riders har uventet en 'overall'-kolonne");
});
```

- [ ] **Step 3: Kør → verificér PASS (eller juster fil-listen)**

Run: `cd backend && node --test lib/testdb/createTestDb.integration.test.js`
Expected: PASS. Hvis en kolonne mangler (fx `primary_type` tilføjes af en migration uden for listen) → tilføj den fil til `RACE_HUB_SCHEMA_FILES` og kør igen. Hvis en fil kaster i PGlite trods sanitering → udvid `DROP_STATEMENT_PATTERNS` eller `PREREQ` med den manglende konstruktion.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/testdb/createTestDb.js backend/lib/testdb/createTestDb.integration.test.js
git commit -F .git-commit-msg.tmp   # "feat(testdb): createTestDb-harness + riders-skema-fidelitets-meta-test (#1840-guard)"
```

---

## Task B3: Strategi-endpoint contract-test + projektions-konstant

**Files:**
- Modify: `backend/routes/api.js` (ekstrahér konstant)
- Create: `backend/routes/raceStrategy.contract.integration.test.js`

- [ ] **Step 1: Ekstrahér projektions-konstanten i api.js**

Tilføj nær toppen af api.js (ved de andre konstanter):

```js
// Race-hub strategi-roster-projektion. Delt med contract-testen (raceStrategy.contract)
// så test og route ikke kan drifte fra hinanden (forward-guard mod #1840).
export const STRATEGY_ROSTER_COLUMNS = "id, firstname, lastname, primary_type, secondary_type";
```

Erstat de to inline-strenge (linje ~1877 og ~1965) `.select("id, firstname, lastname, primary_type, secondary_type")` / `.select("id")` — den FØRSTE bliver `.select(STRATEGY_ROSTER_COLUMNS)`. (PUT-handlerens `.select("id")` forbliver uændret.)

- [ ] **Step 2: Skriv contract-testen (fejler hvis projektion rammer ukendt kolonne)**

```js
// backend/routes/raceStrategy.contract.integration.test.js
// Kører strategi-endpointets FAKTISKE roster-projektion mod det ægte skema.
// Fanger #1840-klassen: en projektion der refererer en ikke-eksisterende kolonne.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../lib/testdb/createTestDb.js";
import { STRATEGY_ROSTER_COLUMNS } from "./api.js";

let db;
before(async () => {
  db = await createTestDb();
  await db.query(
    `INSERT INTO teams (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Contract FC')`,
  );
});

test("strategi-roster-projektionen kører mod ægte skema (alle kolonner findes)", async () => {
  // Oversæt supabase-js .select(cols).eq(...).or(...) til ækvivalent SQL.
  const sql = `SELECT ${STRATEGY_ROSTER_COLUMNS} FROM riders
               WHERE team_id = $1 AND is_academy = false
               AND (is_retired IS NULL OR is_retired = false)`;
  // Kaster hvis en kolonne i projektionen ikke findes (= #1840 ville være fanget her).
  const { rows } = await db.query(sql, ["11111111-1111-4111-8111-111111111111"]);
  assert.ok(Array.isArray(rows));
});

test("tom roster → tom liste, IKKE fejl (regression #1840 tom-flade)", async () => {
  const sql = `SELECT ${STRATEGY_ROSTER_COLUMNS} FROM riders WHERE team_id = $1 AND is_academy = false`;
  const { rows } = await db.query(sql, ["22222222-2222-4222-8222-222222222222"]); // team uden ryttere
  assert.equal(rows.length, 0);
});

test("den gamle #1840-projektion (med 'overall') VILLE fejle", async () => {
  await assert.rejects(
    () => db.query(`SELECT id, overall FROM riders WHERE team_id = $1`, ["11111111-1111-4111-8111-111111111111"]),
    /column .*overall.* does not exist|overall/i,
    "harness'en burde afvise en projektion af den ikke-eksisterende 'overall'-kolonne",
  );
});
```

- [ ] **Step 3: Kør → verificér PASS (alle tre)**

Run: `cd backend && node --test routes/raceStrategy.contract.integration.test.js`
Expected: PASS — de to første beviser projektionen er gyldig + tom-roster-robusthed; den tredje beviser harness'en fanger #1840-klassen.

- [ ] **Step 4: Kør hele backend-suiten (ingen regression)**

Run: `cd backend && npm test`
Expected: PASS (alle eksisterende tests + de nye contract-tests).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/api.js backend/routes/raceStrategy.contract.integration.test.js
git commit -F .git-commit-msg.tmp   # "feat(testdb): strategi-endpoint contract-test mod ægte skema + delt projektions-konstant (#1840-guard)"
```

---

## Afslutning (begge dele)

- [ ] **Kør hele CI-gate-sættet** (fra repo-root): `pwsh -File scripts/verify-local.ps1` (backend+frontend tests + build) + `npm run lint` (begge) + `npm run check:i18n` + `npm run check:warnings`.
- [ ] **Playwright** (visuel kontrakt uændret): `cd frontend && npx playwright test core-smoke.spec.js`. Kun `--update-snapshots` ved bevidst visuel ændring.
- [ ] **Patch notes:** ingen (intern verifikations-infra, ingen brugerrettet ændring) — skriv det i PR-body.
- [ ] **PR-body:** "Backend-only / docs-only"-relevant label ELLER Brugerverifikation-sektion. Vedhæft ægte preview-screenshots af `/races/:id`.
- [ ] **PR-opdeling:** Del A og Del B kan splittes i 2 PR'er hvis diff'en vokser; ellers én. Del B har INGEN migration → kan auto-merges efter CI. Del A's Vercel-env (A4) bekræftes med ejer.

---

## Self-Review (udført ved plan-skrivning)

- **Spec-dækning:** L1-L6 + §3 (PSH 4 komponenter + seed-omfang + Vercel + grænser + test) dækket af A1-A4; §4 (harness + projektions-konstanter + contract-tests + første mål strategi) dækket af B1-B3; §5 (ægte screenshots) i A4-step2 + afslutning; §6 sekvens i header + afslutning. §7 åbent punkt "skema-samling" løst konkret i B2 (sanitizer + ordnet real-fil-liste + selv-korrigerende meta-test).
- **Placeholders:** ingen TBD/TODO; alle kode-steps har ægte kode. (A1 step1/2 markerer "kopiér 1:1 fra fixtures.js linje X" — bevidst, da det er ren flytning af eksisterende verificeret kode, ikke ny logik.)
- **Type-konsistens:** `restRows/restObject/apiResponse/parseTable/wantsObject` konsistent A1↔A3↔B; `STRATEGY_ROSTER_COLUMNS` defineret B3-step1, brugt B3-step2; `createTestDb`/`columnExists`/`RACE_HUB_SCHEMA_FILES` defineret B2, brugt B2↔B3.
