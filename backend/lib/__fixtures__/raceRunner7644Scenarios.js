// #7644: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor.
// Delt af descentRegroupCap7644Flag.test.js og generatoren af den frosne fixture
// (raceRunner7644FlagOff.json). Samme fil koeres i merge-basen (foer kontakten) og i
// den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";

export const RACE_7644 = Object.freeze({ id: "race-7644-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

export function entrants7644(n = 48, teams = 6) {
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

const climbSeg = (from, to, category, avg_gradient, top_elevation_m) => ({ kind: "climb", from_km: from, to_km: to, category, avg_gradient, top_elevation_m });
const descentSeg = (from, to, technicality) => ({ kind: "descent", from_km: from, to_km: to, technicality });
const flatSeg = (from, to) => ({ kind: "flat", from_km: from, to_km: to });

/** Flad etape, en bjergetape med lang nedkoersel fra sidste top og en med kort nedkoersel (dronningeetape). */
export function stages7644() {
  return [
    {
      stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
      demand_vector: DEMAND_VECTORS.flat, distance_km: 175,
      climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
      race_id: RACE_7644.id, id: "sp-7644-1",
    },
    {
      stage_number: 2, profile_type: "mountain", finale_type: "descent",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 185,
      climbs: [
        { name: "Col A", crest_km: 70, category: "1" },
        { name: "Col B", crest_km: 120, category: "1" },
        { name: "Col C", crest_km: 160, category: "HC" },
      ],
      segments: [
        flatSeg(0, 55), climbSeg(55, 70, "1", 6.5, 1500), descentSeg(70, 82, 2), flatSeg(82, 105),
        climbSeg(105, 120, "1", 7, 1700), descentSeg(120, 132, 2), flatSeg(132, 142),
        climbSeg(142, 160, "HC", 8, 2100), descentSeg(160, 178, 2), flatSeg(178, 185),
      ],
      sprints: [{ name: "Sprint", km: 95, kind: "intermediate" }],
      race_id: RACE_7644.id, id: "sp-7644-2",
    },
    {
      stage_number: 3, profile_type: "mountain", finale_type: "descent",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 170,
      climbs: [
        { name: "Col D", crest_km: 60, category: "1" },
        { name: "Col E", crest_km: 110, category: "1" },
        { name: "Col F", crest_km: 162, category: "HC" },
      ],
      segments: [
        flatSeg(0, 45), climbSeg(45, 60, "1", 6.5, 1500), descentSeg(60, 72, 2), flatSeg(72, 95),
        climbSeg(95, 110, "1", 7, 1700), descentSeg(110, 122, 2), flatSeg(122, 144),
        climbSeg(144, 162, "HC", 8, 2100), descentSeg(162, 170, 3),
      ],
      sprints: [{ name: "Sprint", km: 85, kind: "intermediate" }],
      race_id: RACE_7644.id, id: "sp-7644-3",
    },
  ];
}

async function digestsOf(result, recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7644.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

export function wholeRace7644(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7644.id });
  const result = buildRaceResults({ race: RACE_7644, stages: stages7644(), entrants: entrants7644(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder };
}

export function stageByStage7644(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7644.id });
  const result = buildStageRowsAccumulated({
    race: RACE_7644, stagesSorted: stages7644(), stageIndex, entrants: entrants7644(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7644 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7644(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7644(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7644(e, "s5_profiles_v3", 1) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7644(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7644) {
    const { result, recorder } = c.run(v4Engine);
    out[c.key] = await digestsOf(result, recorder);
  }
  return out;
}

export { digestsOf as digests7644 };
