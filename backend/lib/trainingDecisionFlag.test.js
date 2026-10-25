// #6110 S26 - gaten om "Dagens beslutning"-kortet paa Today-fanen.
// Daekker selve gaten (off/beta/on + fail-safe) og wiringen (server-side flag,
// bar boolean, klienten normaliserer et manglende felt til false).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey, findStageFlag } from "./stageFlagCatalog.js";
import { TRAINING_DECISION_FLAG_KEY, isTrainingDecisionEnabled } from "./trainingDecisionFlag.js";

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

test("noeglen er training_decision_card og staar i STAGE_FLAGS", () => {
  assert.equal(TRAINING_DECISION_FLAG_KEY, "training_decision_card");
  assert.equal(isStageFlagKey(TRAINING_DECISION_FLAG_KEY), true);
  assert.equal(findStageFlag(TRAINING_DECISION_FLAG_KEY).area, "training");
});

test("stadie beta: KUN beta-testere faar kortet; on gaelder alle; off ingen", async () => {
  const beta = fakeSupabase("beta");
  assert.equal(await isTrainingDecisionEnabled(beta, { isBetaTester: false }), false);
  assert.equal(await isTrainingDecisionEnabled(beta, { isBetaTester: true }), true);
  assert.equal(await isTrainingDecisionEnabled(fakeSupabase("on")), true);
  assert.equal(await isTrainingDecisionEnabled(fakeSupabase("off"), { isBetaTester: true }), false);
});

test("fail-safe: manglende raekke, ukendt vaerdi eller ingen klient giver false", async () => {
  assert.equal(await isTrainingDecisionEnabled(fakeSupabase(undefined), { isBetaTester: true }), false);
  assert.equal(await isTrainingDecisionEnabled(fakeSupabase("vroevl"), { isBetaTester: true }), false);
  assert.equal(await isTrainingDecisionEnabled(null, { isBetaTester: true }), false);
});

test("wiring: /api/training/me laeser flaget server-side og sender en bar boolean", () => {
  const start = apiSource.indexOf('router.get("/training/me"');
  assert.ok(start !== -1, "/training/me skal findes i api.js");
  const block = apiSource.slice(start, start + 15000);
  assert.match(block, /readFlagStage\(supabase, TRAINING_DECISION_FLAG_KEY\)/);
  assert.match(block, /const decisionCard = evaluateFlagStage\(decisionCardStage, \{ isBetaTester \}\)/);
  assert.match(block, /\n\s*decisionCard,\n/);
  assert.doesNotMatch(block, /req\.(query|body|headers)[^\n]*decisionCard/i);
});

test("wiring: klienten normaliserer et manglende felt til false", () => {
  const useTrainingSource = readFileSync(resolve(__dirname, "../../frontend/src/lib/useTraining.js"), "utf8");
  assert.match(useTrainingSource, /setDecisionCard\([^\n]*\.decisionCard === true\)/);
});

test("migration: raekken oprettes idempotent i stadie off", () => {
  const sql = readFileSync(resolve(__dirname, "../../database/2026-10-25-6110-training-decision-card-flag.sql"), "utf8");
  assert.match(sql, /'training_decision_card'/);
  assert.match(sql, /'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
