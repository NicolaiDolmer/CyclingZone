// #7236: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor.
// Delt af raceRunner7236Flag.test.js og generatoren af den frosne fixture
// (raceRunner7236FlagOff.json). Samme fil koeres i merge-basen (foer koblingen) og i
// den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";

export const RACE_7236 = Object.freeze({ id: "race-7236-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 11 + i * 5) % 55); });
  return a;
}

export function entrants7236(n = 30, teams = 5) {
  const perTeam = Math.ceil(n / teams);
  return Array.from({ length: n }, (_, i) => {
    const team = String.fromCharCode(65 + Math.floor(i / perTeam));
    return {
      rider_id: `r${String(i).padStart(3, "0")}`,
      team_id: `team-${team}`,
      team_name: `Hold ${team}`,
      rider_name: `Rytter ${i}`,
      is_u25: i % 5 === 0,
      abilities: abil(i),
      form: 30 + (i % 40),
      fatigue: (i * 7) % 60,
      ...(i % perTeam === 0 ? { race_role: "captain" } : {}),
    };
  });
}

/** Flad etape, topankomst og en bjergetape med flere stigninger og kort nedkoersel til maal. */
export function stages7236() {
  return [
    {
      stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
      demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
      climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
      race_id: RACE_7236.id, id: "sp-7236-1",
    },
    {
      stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
      climbs: [{ name: "Col A", crest_km: 158, category: "1", summit_finish: true }],
      sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
      race_id: RACE_7236.id, id: "sp-7236-2",
    },
    {
      stage_number: 3, profile_type: "mountain", finale_type: "descent",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 170,
      climbs: [
        { name: "Col B", crest_km: 60, category: "1" },
        { name: "Col C", crest_km: 110, category: "1" },
        { name: "Col D", crest_km: 162, category: "HC" },
      ],
      sprints: [{ name: "Sprint", km: 85, kind: "intermediate" }],
      race_id: RACE_7236.id, id: "sp-7236-3",
    },
  ];
}

async function digestsOf(result, recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7236.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

export function wholeRace7236(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7236.id });
  const result = buildRaceResults({ race: RACE_7236, stages: stages7236(), entrants: entrants7236(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder };
}

export function stageByStage7236(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7236.id });
  const result = buildStageRowsAccumulated({
    race: RACE_7236, stagesSorted: stages7236(), stageIndex, entrants: entrants7236(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7236 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7236(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7236(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage7236(e, "s5_profiles_v3", 2) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7236(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7236) {
    const { result, recorder } = c.run(v4Engine);
    out[c.key] = await digestsOf(result, recorder);
  }
  return out;
}

export { digestsOf as digests7236 };
