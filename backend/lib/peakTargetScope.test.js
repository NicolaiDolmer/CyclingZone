import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { peakTargetRaceStarted, plannerSquadFor } from "./peakTargetScope.js";

test("#5992 peakTargetRaceStarted: scheduled uden kørte etaper er åbent", () => {
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: 0 }), false);
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: null }), false);
  assert.equal(peakTargetRaceStarted({ status: "scheduled" }), false);
  // Ældre rækker/mocks uden status: kun etape-tallet afgør.
  assert.equal(peakTargetRaceStarted({ stages_completed: 0 }), false);
});

test("#5992 peakTargetRaceStarted: én kørt etape eller færdigt løb er startet", () => {
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: 1 }), true);
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: "3" }), true);
  assert.equal(peakTargetRaceStarted({ status: "completed", stages_completed: 0 }), true);
  assert.equal(peakTargetRaceStarted({ status: "completed", stages_completed: 21 }), true);
});

test("#5992 peakTargetRaceStarted: ugyldigt input behandles defensivt som startet", () => {
  assert.equal(peakTargetRaceStarted(null), true);
  assert.equal(peakTargetRaceStarted(undefined), true);
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: "x" }), true);
  assert.equal(peakTargetRaceStarted({ status: "scheduled", stages_completed: -1 }), true);
});

test("#5992 plannerSquadFor følger det fælles senior-prædikat", () => {
  assert.equal(plannerSquadFor({ squad: "senior", is_academy: false }), "senior");
  assert.equal(plannerSquadFor({ squad: "u23", is_academy: true }), "u23");
  assert.equal(plannerSquadFor({ squad: "junior", is_academy: true }), "junior");
  // Før backfill: is_academy alene gør ham til ungdom, med akademiets fallback.
  assert.equal(plannerSquadFor({ squad: "senior", is_academy: true }), "junior");
  // Manglende trup-kolonner gør aldrig en seniorrytter usynlig.
  assert.equal(plannerSquadFor({}), "senior");
  // squad alene er strengere end is_academy.
  assert.equal(plannerSquadFor({ squad: "u23", is_academy: false }), "u23");
});

// Kildetjek: boardet, enkelt-POST og bulk skal alle bruge de to regler. Et nyt
// kaldsted der kun filtrerer på dato er præcis den fejl #5992 handlede om.
test("#5992 api.js: board, POST og bulk bruger peak-scope-reglerne", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "routes", "api.js"), "utf8");
  assert.match(src, /import \{ peakTargetRaceStarted, plannerSquadFor \} from "\.\.\/lib\/peakTargetScope\.js"/);
  assert.match(src, /if \(peakTargetRaceStarted\(race\)\) return \{ status: 409, error: "race_already_started" \}/);
  assert.match(src, /plannerSquadFor\(rider\) !== "senior"/);
  assert.match(src, /reason: "race_already_started"/);
  assert.match(src, /reason: "rider_not_senior_squad"/);
  assert.match(src, /r\.squad === "senior" && r\.peaks\.length < MAX_PEAK_PLANS_PER_SEASON/);
  assert.match(src, /r\.isMine && r\.date && !r\.started && !realTargetIds\.has\(r\.id\)/);
});
