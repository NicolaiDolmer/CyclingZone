// #5435 — kontakten for rating-visningen "bedste rolle nu" (D-049, model A).
//
// To fejlklasser daekkes:
//   1) SELVE GATEN: off/beta/on + fail-safe. En fejl her ville taende den nye
//      visning foer vaerdiskiftet (ejer 22/9: de skal lande i samme deploy).
//   2) WIRINGEN: at GET /api/display-flags laeser flaget SERVER-side mod
//      viewerens beta-status og svarer med en bar boolean, ogsaa ved fejl.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey, findStageFlag } from "./stageFlagCatalog.js";
import {
  RIDER_BEST_ROLE_DISPLAY_FLAG_KEY,
  isRiderBestRoleDisplayEnabled,
} from "./riderBestRoleDisplayFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const migration = readFileSync(
  resolve(__dirname, "../../database/2026-09-22-5435-rider-best-role-display-flag.sql"),
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

test("#5435: noeglen er rider_best_role_display og staar i STAGE_FLAGS", () => {
  assert.equal(RIDER_BEST_ROLE_DISPLAY_FLAG_KEY, "rider_best_role_display");
  assert.equal(isStageFlagKey(RIDER_BEST_ROLE_DISPLAY_FLAG_KEY), true);
  assert.equal(findStageFlag(RIDER_BEST_ROLE_DISPLAY_FLAG_KEY).area, "squad");
});

test("#5435 stadie beta: KUN beta-testere ser den nye visning", async () => {
  const supabase = fakeSupabase("beta");
  assert.equal(await isRiderBestRoleDisplayEnabled(supabase, { isBetaTester: false }), false);
  assert.equal(await isRiderBestRoleDisplayEnabled(supabase, { isBetaTester: true }), true);
});

test("#5435 stadie on/off: on gaelder alle, off gaelder ingen", async () => {
  assert.equal(await isRiderBestRoleDisplayEnabled(fakeSupabase("on")), true);
  assert.equal(await isRiderBestRoleDisplayEnabled(fakeSupabase("off"), { isBetaTester: true }), false);
});

test("#5435 fail-safe: manglende raekke eller ukendt vaerdi → false (dagens visning)", async () => {
  assert.equal(await isRiderBestRoleDisplayEnabled(fakeSupabase(undefined), { isBetaTester: true }), false);
  assert.equal(await isRiderBestRoleDisplayEnabled(fakeSupabase("maybe"), { isBetaTester: true }), false);
});

test("#5435 migration: raekken oprettes som off og overskriver aldrig et flyttet stadie", () => {
  assert.match(migration, /'rider_best_role_display',\s*'"off"'::jsonb/);
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
});

test("#5435 wiring: GET /api/display-flags evaluerer mod beta-status og har fail-safe ved fejl", () => {
  const start = apiSource.indexOf('router.get("/display-flags"');
  assert.ok(start >= 0, "ruten findes ikke");
  const body = apiSource.slice(start, apiSource.indexOf("\n});", start));
  assert.match(body, /isViewerBetaTester\(req\)/);
  assert.match(body, /isRiderBestRoleDisplayEnabled\(supabase, \{ isBetaTester \}\)/);
  assert.match(body, /rider_best_role_display: false/);
});
