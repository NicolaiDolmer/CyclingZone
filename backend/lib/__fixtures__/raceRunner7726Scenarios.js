// #7726: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor og
// enkeltstarter i loebet. Delt af ittNoDayRoll7726Flag.test.js og generatoren af den
// frosne fixture (raceRunner7726FlagOff.json). Samme fil koeres i merge-basen (foer
// kontakten) og i den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";

export const RACE_7726 = Object.freeze({ id: "race-7726-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

export function entrants7726(n = 48, teams = 6) {
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

const flatSeg = (from, to) => ({ kind: "flat", from_km: from, to_km: to });
const climbSeg = (from, to, category, avg_gradient, top_elevation_m) => ({ kind: "climb", from_km: from, to_km: to, category, avg_gradient, top_elevation_m });

/** Vejetape, flad enkeltstart og kuperet enkeltstart. */
export function stages7726() {
  return [
    {
      stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
      demand_vector: DEMAND_VECTORS.flat, distance_km: 170,
      climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
      race_id: RACE_7726.id, id: "sp-7726-1",
    },
    {
      stage_number: 2, profile_type: "itt", finale_type: "solo_tt",
      demand_vector: DEMAND_VECTORS.itt, distance_km: 32,
      climbs: [], sprints: [], segments: [flatSeg(0, 32)],
      race_id: RACE_7726.id, id: "sp-7726-2",
    },
    {
      stage_number: 3, profile_type: "itt_hilly", finale_type: "solo_tt",
      demand_vector: DEMAND_VECTORS.itt_hilly, distance_km: 28,
      climbs: [{ name: "Col A", crest_km: 18, category: "3" }], sprints: [],
      segments: [flatSeg(0, 12), climbSeg(12, 18, "3", 5, 600), flatSeg(18, 28)],
      race_id: RACE_7726.id, id: "sp-7726-3",
    },
  ];
}

async function digestsOf(result, recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7726.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

export function wholeRace7726(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7726.id });
  const result = buildRaceResults({ race: RACE_7726, stages: stages7726(), entrants: entrants7726(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder };
}

export function stageByStage7726(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7726.id });
  const result = buildStageRowsAccumulated({
    race: RACE_7726, stagesSorted: stages7726(), stageIndex, entrants: entrants7726(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7726 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7726(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7726(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7726(e, "s5_profiles_v3", 1) },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage7726(e, "s5_profiles_v3", 2) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7726(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7726) {
    const { result, recorder } = c.run(v4Engine);
    out[c.key] = await digestsOf(result, recorder);
  }
  return out;
}

export { digestsOf as digests7726 };
