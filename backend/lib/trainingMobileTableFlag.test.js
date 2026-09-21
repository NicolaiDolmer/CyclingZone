// #3643 — gaten om traeningssidens nye mobil-visning. Ejer-beslutning 19/9:
// "Jeg vil have det kun live for beta testere i starten".
//
// To fejlklasser daekkes:
//   1) SELVE GATEN: off/beta/on + fail-safe. En fejl her ville vise den nye
//      flade for alle (eller skjule den for beta-testere).
//   2) WIRINGEN: at /api/training/me faktisk laeser flaget SERVER-SIDE og
//      sender en bar boolean, og at klienten normaliserer et manglende felt til
//      false (= den gamle visning). Kildeteksten scannes, samme moenster som
//      apiTrainingMeRaceDay.routes.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey, findStageFlag } from "./stageFlagCatalog.js";
import {
  TRAINING_MOBILE_TABLE_FLAG_KEY,
  isTrainingMobileTableEnabled,
} from "./trainingMobileTableFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

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

test("#3643: noeglen er training_mobile_table og staar i STAGE_FLAGS (ejeren kan flytte den fra admin-fladen)", () => {
  assert.equal(TRAINING_MOBILE_TABLE_FLAG_KEY, "training_mobile_table");
  assert.equal(isStageFlagKey(TRAINING_MOBILE_TABLE_FLAG_KEY), true);
  assert.equal(findStageFlag(TRAINING_MOBILE_TABLE_FLAG_KEY).area, "training");
});

test("#3643 stadie beta: KUN beta-testere faar den nye visning", async () => {
  const supabase = fakeSupabase("beta");
  assert.equal(await isTrainingMobileTableEnabled(supabase, { isBetaTester: false }), false);
  assert.equal(await isTrainingMobileTableEnabled(supabase, { isBetaTester: true }), true);
});

test("#3643 stadie on/off: on gaelder alle, off gaelder ingen — heller ikke beta-testere", async () => {
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase("on")), true);
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase(true)), true);
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase("off"), { isBetaTester: true }), false);
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase(false), { isBetaTester: true }), false);
});

test("#3643 fail-safe: manglende raekke, ukendt vaerdi, fejl eller ingen klient → false (den gamle visning)", async () => {
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase(undefined), { isBetaTester: true }), false);
  assert.equal(await isTrainingMobileTableEnabled(fakeSupabase("vroevl"), { isBetaTester: true }), false);
  assert.equal(await isTrainingMobileTableEnabled(null, { isBetaTester: true }), false);
  const errClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }),
    }),
  };
  assert.equal(await isTrainingMobileTableEnabled(errClient, { isBetaTester: true }), false);
});

test("#3643 wiring: /api/training/me laeser flaget med readFlagStage + evaluateFlagStage(isBetaTester)", () => {
  assert.match(
    apiSource,
    /import \{ TRAINING_MOBILE_TABLE_FLAG_KEY \} from "\.\.\/lib\/trainingMobileTableFlag\.js"/,
  );
  const start = apiSource.indexOf('router.get("/training/me"');
  assert.ok(start !== -1, '/training/me skal findes i api.js');
  // #4847: haevet 9600 → 13000. dayClose-blokken lagde et flag-opslag og et
  // betinget responsfelt ind i samme handler, saa res.json faldt uden for vinduet
  // og `mobileTable,`-matchet gik roedt. Samme fejlklasse som i
  // apiTrainingMeRaceDay.routes.test.js — se forward-guarden dér, som maaler den
  // FAKTISKE handler-laengde, saa den her ikke skal gaettes to steder.
  const block = apiSource.slice(start, start + 13000);
  assert.match(block, /readFlagStage\(supabase, TRAINING_MOBILE_TABLE_FLAG_KEY\)/);
  assert.match(block, /const mobileTable = evaluateFlagStage\(mobileTableStage, \{ isBetaTester \}\)/);
  // Feltet skal med i svaret som en BAR boolean — ikke som et betinget spread
  // (klienten skal kunne se "gammel visning" uden at gaette). `[\r\n]` og ikke
  // `\n`: kildefilen har CRLF paa Windows-checkouts.
  assert.match(block, /[\r\n]\s*mobileTable,[\r\n]/);
  // Og det maa ALDRIG udledes af noget klienten sender.
  assert.doesNotMatch(block, /req\.(query|body|headers)[^\n]*mobileTable/i);
});

test("#3643 wiring: klienten normaliserer et manglende felt til false", () => {
  const useTrainingSource = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/useTraining.js"),
    "utf8",
  );
  assert.match(useTrainingSource, /setMobileTable\(data\.mobileTable === true\)/);
});

test("#3643 migration: raekken oprettes idempotent i stadie beta (ejer 19/9)", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../database/2026-09-19-3643-training-mobile-table-flag.sql"),
    "utf8",
  );
  assert.match(sql, /'training_mobile_table'/);
  assert.match(sql, /'"beta"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
