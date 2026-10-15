// #5928: raceRunner haefter etapens reelle arbejde (motorens indsats + gruppe-andele) paa
// run'et under s5_profiles_v1, saa den frosne belastning (freezeConditionLoadSnapshots ->
// raceConditionLoads) foelger det rytteren faktisk lavede. Alle andre revisioner: intet.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRaceResults, buildStageRowsAccumulated } from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { conditionWorkForRun, raceConditionLoads, stageAccumulationMultiplier } from "./raceFatigue.js";

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

const ENTRANTS = Array.from({ length: 16 }, (_, i) => ({
  rider_id: `r${String(i).padStart(2, "0")}`,
  team_id: i < 8 ? "A" : "B",
  team_name: i < 8 ? "Team A" : "Team B",
  rider_name: `Rider ${i}`,
  is_u25: false,
  abilities: abil(i),
  fatigue: (i * 3) % 30,
  race_role: i === 0 || i === 8 ? "captain" : "helper",
  team_is_ai: i < 8,
}));

const RACE = { id: "race-5928-runner", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };
const STAGES = [
  {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
    climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }], race_id: RACE.id, id: "sp-1",
  },
  {
    stage_number: 2, profile_type: "mountain", finale_type: "long_climb", demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
    climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
    sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }], race_id: RACE.id, id: "sp-2",
  },
];

test("#5928: buildRaceResults under s5_profiles_v1 haefter arbejdet usynligt paa hvert run", async () => {
  const v4Engine = await loadRaceEngineV4();
  const { runs } = buildRaceResults({ race: RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: {}, v3: true, v4Engine, rulesRevision: "s5_profiles_v1" });
  assert.equal(runs.length, 2);
  for (const run of runs) {
    const work = conditionWorkForRun(run);
    assert.equal(work.stageNumber, run.stage_number);
    assert.ok(work.efforts instanceof Map && work.efforts.size === ENTRANTS.length, "motorens indsats for hele feltet");
    assert.ok(work.exposure instanceof Map);
    assert.equal(Object.keys(run).includes("conditionWork"), false, "run-formen er uaendret");
    const loads = raceConditionLoads(run.entrant_snapshot, STAGES[run.stage_number - 1].profile_type, null, "s5_profiles_v1", work);
    assert.equal(loads.length, ENTRANTS.length);
    assert.ok(loads.every((l) => Number.isFinite(l.load) && l.load > 0));
  }
  // Etape 2 baerer etapens plads: en normal rytter i feltet koster mere end paa etape 1's profil alene.
  assert.ok(stageAccumulationMultiplier(conditionWorkForRun(runs[1]).stageNumber) > 1);
});

test("#5928: buildStageRowsAccumulated (etape-for-etape-stien) haefter samme arbejde", async () => {
  const v4Engine = await loadRaceEngineV4();
  const { runs } = buildStageRowsAccumulated({ race: RACE, stagesSorted: STAGES, stageIndex: 0, entrants: ENTRANTS, pointsLookup: {}, priorStageRows: [], v3: true, v4Engine, rulesRevision: "s5_profiles_v1" });
  const work = conditionWorkForRun(runs[0]);
  assert.equal(work.stageNumber, 1);
  assert.ok(work.efforts instanceof Map && work.efforts.size === ENTRANTS.length);
});

test("#5928: under en S4-revision haeftes intet, og belastningen er den gamle", async () => {
  const v4Engine = await loadRaceEngineV4();
  const { runs } = buildRaceResults({ race: RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: {}, v3: true, v4Engine, rulesRevision: "official_times_v4" });
  for (const run of runs) {
    assert.deepEqual(conditionWorkForRun(run), { stageNumber: run.stage_number });
    const profile = STAGES[run.stage_number - 1].profile_type;
    assert.deepEqual(
      raceConditionLoads(run.entrant_snapshot, profile, null, "official_times_v4", conditionWorkForRun(run)),
      raceConditionLoads(run.entrant_snapshot, profile, null, "official_times_v4"),
    );
  }
});
