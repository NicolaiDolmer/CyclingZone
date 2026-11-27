// #8799: faste, syntetiske kuperede og boelgede etaper gennem raceRunner med den rigtige v4-motor.
// Delt af hillySelection8799Flag.test.js og generatoren af den frosne fixture
// (raceRunner8799FlagOff.json). Samme fil koeres i merge-basen (foer kontakten) og i den nye
// kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { entrants7236 } from "./raceRunner7236Scenarios.js";

export const RACE_8799 = Object.freeze({ id: "race-8799-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

/** Kuperet med flad spurt efter en kat. 2 sent paa etapen, kuperet med bakkefinale, boelget med flad spurt. */
export function stages8799() {
  return [
    {
      stage_number: 1, profile_type: "hilly", finale_type: "flat_sprint",
      demand_vector: DEMAND_VECTORS.hilly, distance_km: 185,
      climbs: [
        { name: "Cote A", crest_km: 70, category: "3" },
        { name: "Cote B", crest_km: 120, category: "2" },
        { name: "Cote C", crest_km: 148, category: "2" },
      ],
      sprints: [{ name: "Sprint", km: 95, kind: "intermediate" }],
      race_id: RACE_8799.id, id: "sp-8799-1",
    },
    {
      stage_number: 2, profile_type: "hilly", finale_type: "punch",
      demand_vector: DEMAND_VECTORS.hilly, distance_km: 170,
      climbs: [
        { name: "Cote D", crest_km: 90, category: "2" },
        { name: "Cote E", crest_km: 140, category: "3" },
        { name: "Cote F", crest_km: 169, category: "3" },
      ],
      sprints: [{ name: "Sprint", km: 60, kind: "intermediate" }],
      race_id: RACE_8799.id, id: "sp-8799-2",
    },
    {
      stage_number: 3, profile_type: "rolling", finale_type: "flat_sprint",
      demand_vector: DEMAND_VECTORS.rolling, distance_km: 175,
      climbs: [
        { name: "Cote G", crest_km: 80, category: "4" },
        { name: "Cote H", crest_km: 150, category: "3" },
      ],
      sprints: [{ name: "Sprint", km: 100, kind: "intermediate" }],
      race_id: RACE_8799.id, id: "sp-8799-3",
    },
  ];
}

export function entrants8799() {
  return entrants7236(60, 10);
}

export function wholeRace8799(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_8799.id });
  const result = buildRaceResults({ race: RACE_8799, stages: stages8799(), entrants: entrants8799(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder };
}

export function stageByStage8799(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_8799.id });
  const result = buildStageRowsAccumulated({
    race: RACE_8799, stagesSorted: stages8799(), stageIndex, entrants: entrants8799(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Checksum, motor-input og output pr. etape. */
export async function digests8799({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_8799.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_8799 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace8799(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace8799(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage1", run: (e) => stageByStage8799(e, "s5_profiles_v3", 0) },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage8799(e, "s5_profiles_v3", 2) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests8799(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_8799) out[c.key] = await digests8799(c.run(v4Engine));
  return out;
}
