// Ejer 27/11 (#8826-billedet): saesonvaelgeren viste "Saeson 1 (aktuel)" under overskriften "Saeson 5",
// og datoerne skal staa kronologisk. Rodaarsag: planlaegnings-mocken og planner-mocken havde hver sit
// saesonnummer, og intet holdt dem ens. Denne test holder mocken sammenhaengende, saa et billede til
// ejeren aldrig viser to forskellige saesoner paa samme side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANNING_SEASON_SEED, previewPeakBoard } from "./planningWorkbenchMock.ts";
import { previewPlannerBoard } from "./plannerMock.js";

test("planlaegnings-mocken viser samme aktive saeson som saesonvaelgeren", () => {
  const active = previewPlannerBoard().season.number;
  assert.equal(PLANNING_SEASON_SEED.season.number, active);
  assert.equal(previewPeakBoard().season.number, active);
});

test("mock-kalenderens datoer er stigende og hvert loeb slutter ikke foer det starter", () => {
  const dates = PLANNING_SEASON_SEED.dayDates.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(PLANNING_SEASON_SEED.dayDates.map((d) => d.gameDay)).size, dates.length);
  for (const race of PLANNING_SEASON_SEED.races) assert.ok(race.gameDayEnd >= race.gameDayStart, race.id);
});
