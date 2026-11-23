// #8549 PR 2 · Motorens og prognosens kobling til Week blocks (kilde-wiring, OFF-1).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(resolve(__dirname, "dailyTrainingEngine.js"), "utf8").replace(/\r\n/g, "\n");
const forecast = readFileSync(resolve(__dirname, "trainingWeekPlanForecast.js"), "utf8").replace(/\r\n/g, "\n");

test("OFF-1: kontakten laeses kun med programceller OG en 'week'-plan; ellers false uden opslag", () => {
  assert.match(engine, /weekPriorityOn = programsOn && \(Array\.isArray\(weekPlanRow\) \? weekPlanRow : \[\]\)\.some\(\(r\) => r\.plan_kind === "week"\)\n\s+\? await isTrainingWeekPriorityEnabledForTeam\(supabase, teamId\)\n\s+: false;/);
  assert.match(engine, /plannedStageDaysByRider = weekPriorityOn && conditionPerDate && dateDays\.length === 5/);
});

test("motoren: off giver dagens kald (kildefelt = programSlot), og traethedsgraensen bruger feltet selv", () => {
  assert.match(engine, /: \{ sourceSlot: programSlot, applied: false \};/);
  assert.match(engine, /slotIndex: weekPriority\.sourceSlot \?\? programSlot,/);
  assert.match(engine, /slotIndex: programSlot, rodeStagePreviousDate:/);
});

test("rapporten faar kun source_slot, naar reglen gjaldt (off = intet nyt felt)", () => {
  assert.match(engine, /weekPriority\.applied && weekPriority\.sourceSlot != null[^{}]+\{ source_slot: weekPriority\.sourceSlot \}/);
});

test("I5: prognosen bruger samme indgang og samme gate som motoren", () => {
  assert.match(forecast, /weekPriorityPlacement\(\{/);
  assert.match(forecast, /weekRows\.some\(\(row\) => row\.plan_kind === "week"\)\n\s+\? await isTrainingWeekPriorityEnabledForTeam\(supabase, team\.id\)/);
  assert.match(forecast, /select\("rider_id, days, plan_kind"\)/);
});
