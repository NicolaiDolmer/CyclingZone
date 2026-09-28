// Ejer 28/9 (løbsdag 1): ungdomsløb får en mildere tidsgrænse. Skyggetesten af
// juniorernes 175 km bakkede etape gav 6 OTL i to klumper à 3 ryttere.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTimeLimit, timeLimitSecondsFor, timeLimitTuningFor, TIME_LIMIT_TUNING } from "./timeLimit.ts";
import type { StageResult } from "../types.ts";

function results(times: number[]): StageResult[] {
  return times.map((t, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`, rank: i + 1, time_seconds: t, group_id: "g", status: "finished",
  }) as StageResult);
}

// 80 ryttere: vinder 5 t, 74 i feltet, 3 på +38 min og 3 på +50 min.
const WINNER = 18_000;
const FIELD = [WINNER, ...Array(73).fill(WINNER + 300), ...Array(3).fill(WINNER + 38 * 60), ...Array(3).fill(WINNER + 50 * 60)];

test("senior (og udeladt trup) får PRÆCIS samme tuning-objekt: bit-identisk", () => {
  assert.equal(timeLimitTuningFor(undefined), TIME_LIMIT_TUNING);
  assert.equal(timeLimitTuningFor(null), TIME_LIMIT_TUNING);
  assert.equal(timeLimitTuningFor("senior"), TIME_LIMIT_TUNING);
});

test("senior: de to små klumper uden for grænsen ryger ud (reglen før 28/9)", () => {
  const out = applyTimeLimit({ results: results(FIELD), profileType: "hilly", distanceKm: 175 });
  assert.equal(out.otlRiderIds.length, 6);
});

for (const squad of ["u23", "junior"] as const) {
  test(`${squad}: dobbelt grænse-faktor og redning fra 3 ryttere i samlet ankomst`, () => {
    const tuning = timeLimitTuningFor(squad);
    assert.equal(
      timeLimitSecondsFor(WINNER, "hilly", tuning),
      timeLimitSecondsFor(WINNER, "hilly") + WINNER * TIME_LIMIT_TUNING.factorByProfileType.hilly,
    );
    const out = applyTimeLimit({ results: results(FIELD), profileType: "hilly", distanceKm: 175, tuning });
    assert.deepEqual(out.otlRiderIds, []);
    assert.equal(out.results.filter((r) => r.status === "otl").length, 0);
  });
}

test("junior: en ENLIG rytter langt efter ryger stadig ud (grænsen findes)", () => {
  const lone = [WINNER, ...Array(78).fill(WINNER + 300), WINNER + 90 * 60];
  const out = applyTimeLimit({ results: results(lone), profileType: "hilly", distanceKm: 175, tuning: timeLimitTuningFor("junior") });
  assert.equal(out.otlRiderIds.length, 1);
});
