// #7290: raceRunners kobling af route_profile_hills. Markoeren paa etape-raekken
// skal med i run-identiteten (input_checksum), og uden markoer er checksummen
// byte-identisk med foer koblingen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRaceResults } from "./raceRunner.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { markStagesForProfileHills } from "./routeProfileHillsFlag.js";

const RACE = { id: "race-7290-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 1 };

function entrants(n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const abilities = {};
    ABILITY_KEYS.forEach((k, j) => { abilities[k] = 35 + ((i * 13 + j * 7) % 55); });
    return { rider_id: `r${String(i).padStart(3, "0")}`, team_id: `team-${i % 3}`, team_name: `Hold ${i % 3}`, rider_name: `Rytter ${i}`, abilities, form: 40, fatigue: 10 };
  });
}

function stages() {
  return [{
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: DEMAND_VECTORS.flat, distance_km: 160,
    climbs: [], sprints: [{ name: "Sprint", km: 80, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-1",
  }];
}

async function checksums(mark) {
  const real = await loadRaceEngineV4();
  const st = stages();
  if (mark) markStagesForProfileHills(st, { enabled: true, rulesRevision: "s5_profiles_v3" });
  const { runs } = buildRaceResults({ race: RACE, stages: st, entrants: entrants(), pointsLookup: {}, v3: true, v4Engine: real, rulesRevision: "s5_profiles_v3" });
  return runs.map((r) => r.input_checksum);
}

test("#7290 markoeren aendrer run-identiteten; uden markoer er den uaendret", async () => {
  const base = await checksums(false);
  assert.deepEqual(await checksums(false), base);
  const marked = await checksums(true);
  assert.notDeepEqual(marked, base);
});

test("#7290 markoeren saettes ikke under aeldre revisioner", () => {
  const st = stages();
  assert.equal(markStagesForProfileHills(st, { enabled: true, rulesRevision: "s5_profiles_v2" }), false);
  assert.equal("routeProfileHills" in st[0], false);
});
