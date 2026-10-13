// #6523 — gaten om "saet dagen for flere ryttere paa een gang" paa Today-fanen.
// Startstadiet er `off`: ejeren skal se aegte billeder foer beta.
//
// To fejlklasser daekkes:
//   1) SELVE GATEN: off/beta/on + fail-safe.
//   2) WIRINGEN: at /api/training/me laeser flaget SERVER-SIDE og sender en bar
//      boolean, og at klienten normaliserer et manglende felt til false (= den
//      gamle visning). Kildeteksten scannes, samme moenster som
//      trainingMobileTableFlag.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey, findStageFlag } from "./stageFlagCatalog.js";
import { TRAINING_BULK_DAY_FLAG_KEY, isTrainingBulkDayEnabled } from "./trainingBulkDayFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");

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

test("#6523: noeglen er training_bulk_day og staar i STAGE_FLAGS", () => {
  assert.equal(TRAINING_BULK_DAY_FLAG_KEY, "training_bulk_day");
  assert.equal(isStageFlagKey(TRAINING_BULK_DAY_FLAG_KEY), true);
  assert.equal(findStageFlag(TRAINING_BULK_DAY_FLAG_KEY).area, "training");
});

test("#6523 stadie beta: KUN beta-testere faar den nye linje", async () => {
  const supabase = fakeSupabase("beta");
  assert.equal(await isTrainingBulkDayEnabled(supabase, { isBetaTester: false }), false);
  assert.equal(await isTrainingBulkDayEnabled(supabase, { isBetaTester: true }), true);
});

test("#6523 stadie on/off: on gaelder alle, off gaelder ingen, heller ikke beta-testere", async () => {
  assert.equal(await isTrainingBulkDayEnabled(fakeSupabase("on")), true);
  assert.equal(await isTrainingBulkDayEnabled(fakeSupabase("off"), { isBetaTester: true }), false);
});

test("#6523 fail-safe: manglende raekke, ukendt vaerdi, fejl eller ingen klient giver false", async () => {
  assert.equal(await isTrainingBulkDayEnabled(fakeSupabase(undefined), { isBetaTester: true }), false);
  assert.equal(await isTrainingBulkDayEnabled(fakeSupabase("vroevl"), { isBetaTester: true }), false);
  assert.equal(await isTrainingBulkDayEnabled(null, { isBetaTester: true }), false);
  const errClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }),
    }),
  };
  assert.equal(await isTrainingBulkDayEnabled(errClient, { isBetaTester: true }), false);
});

test("#6523 wiring: /api/training/me laeser flaget server-side og sender en bar boolean", () => {
  assert.match(apiSource, /import \{ TRAINING_BULK_DAY_FLAG_KEY \} from "\.\.\/lib\/trainingBulkDayFlag\.js"/);
  const start = apiSource.indexOf('router.get("/training/me"');
  assert.ok(start !== -1, "/training/me skal findes i api.js");
  const block = apiSource.slice(start, start + 15000);
  assert.match(block, /readFlagStage\(supabase, TRAINING_BULK_DAY_FLAG_KEY\)/);
  assert.match(block, /const bulkDay = evaluateFlagStage\(bulkDayStage, \{ isBetaTester \}\)/);
  assert.match(block, /\n\s*bulkDay,\n/);
  assert.doesNotMatch(block, /req\.(query|body|headers)[^\n]*bulkDay/i);
});

test("#6523 wiring: klienten normaliserer et manglende felt til false", () => {
  const useTrainingSource = readFileSync(resolve(__dirname, "../../frontend/src/lib/useTraining.js"), "utf8");
  assert.match(useTrainingSource, /setBulkDay\(data\.bulkDay === true\)/);
});

test("#6523 migration: raekken oprettes idempotent i stadie off", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../database/2026-10-12-6523-training-bulk-day-flag.sql"),
    "utf8",
  );
  assert.match(sql, /'training_bulk_day'/);
  assert.match(sql, /'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
