// #5519 — kontakten for U23 team- og Junior team-siderne.
//
// Tre fejlklasser daekkes:
//   1) SELVE GATEN: off/beta/on + fail-safe. En fejl her ville vise siderne
//      foer ejeren har givet visuelt go.
//   2) WIRINGEN: GET /api/display-flags laeser flaget SERVER-side mod viewerens
//      beta-status og svarer med en bar boolean, ogsaa ved fejl; GET
//      /api/youth-squads er gatet paa samme flag (409 naar slukket).
//   3) MIGRATIONEN: raekken oprettes som off og overskriver aldrig et stadie
//      ejeren allerede har flyttet.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey, findStageFlag } from "./stageFlagCatalog.js";
import { YOUTH_SQUAD_PAGES_FLAG_KEY, isYouthSquadPagesEnabled } from "./youthSquadPagesFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const migration = readFileSync(
  resolve(__dirname, "../../database/2026-09-24-5519-youth-squad-pages-flag.sql"),
  "utf8",
);

// Fake app_config-klient: `value === undefined` = raekken findes ikke.
function fakeSupabase(value) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }),
        }),
      }),
    }),
  };
}

function routeBody(path) {
  const start = apiSource.indexOf(`router.get("${path}"`);
  assert.ok(start >= 0, `ruten ${path} findes ikke`);
  return apiSource.slice(start, apiSource.indexOf("\n});", start));
}

test("#5519: noeglen er youth_squad_pages og staar i STAGE_FLAGS", () => {
  assert.equal(YOUTH_SQUAD_PAGES_FLAG_KEY, "youth_squad_pages");
  assert.equal(isStageFlagKey(YOUTH_SQUAD_PAGES_FLAG_KEY), true);
  assert.equal(findStageFlag(YOUTH_SQUAD_PAGES_FLAG_KEY).area, "squad");
});

test("#5519 stadie beta: KUN beta-testere ser siderne", async () => {
  const supabase = fakeSupabase("beta");
  assert.equal(await isYouthSquadPagesEnabled(supabase, { isBetaTester: false }), false);
  assert.equal(await isYouthSquadPagesEnabled(supabase, { isBetaTester: true }), true);
});

test("#5519 stadie on/off: on gaelder alle, off gaelder ingen", async () => {
  assert.equal(await isYouthSquadPagesEnabled(fakeSupabase("on")), true);
  assert.equal(await isYouthSquadPagesEnabled(fakeSupabase("off"), { isBetaTester: true }), false);
});

test("#5519 fail-safe: manglende raekke eller ukendt vaerdi → false (dagens visning)", async () => {
  assert.equal(await isYouthSquadPagesEnabled(fakeSupabase(undefined), { isBetaTester: true }), false);
  assert.equal(await isYouthSquadPagesEnabled(fakeSupabase("maybe"), { isBetaTester: true }), false);
});

test("#5519 migration: raekken oprettes som off og overskriver aldrig et flyttet stadie", () => {
  assert.match(migration, /'youth_squad_pages',\s*'"off"'::jsonb/);
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
});

test("#5519 wiring: /api/display-flags svarer youth_squad_pages mod beta-status, fail-safe false", () => {
  const body = routeBody("/display-flags");
  assert.match(body, /isViewerBetaTester\(req\)/);
  assert.match(body, /isYouthSquadPagesEnabled\(supabase, \{ isBetaTester \}\)/);
  assert.match(body, /youth_squad_pages: youthSquadPages/);
  assert.match(body, /youth_squad_pages: false/);
});

test("#5519 wiring: /api/youth-squads er gatet paa flaget og bruger effectiveSquad-grupperingen", () => {
  const body = routeBody("/youth-squads");
  assert.match(body, /isYouthSquadPagesEnabled\(supabase, \{ isBetaTester \}\)/);
  assert.match(body, /status\(409\)/);
  assert.match(body, /youth_squad_pages_disabled/);
  // Truppen afgoeres af den delte, rene funktion — ikke af et inline filter.
  assert.match(body, /buildYouthSquadsPayload\(/);
  assert.match(body, /YOUTH_SQUAD_ROSTER_COLUMNS/);
  assert.match(body, /\.eq\("team_id", req\.team\.id\)/);
  assert.match(body, /\.eq\("is_retired", false\)/);
});
