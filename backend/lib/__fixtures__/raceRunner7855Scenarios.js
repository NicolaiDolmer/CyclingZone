// #7855: faste, syntetiske etaper gennem raceRunner med den rigtige v4-motor, hvor hold har
// gemt etapeplaner med og uden trøjejagt (Hent point / Hent bjergpoint). Delt af
// jerseyHunt7855Flag.test.js og generatoren af den frosne fixture (raceRunner7855FlagOff.json).
// Samme fil koeres i merge-basen (foer kontakten, hvor jagt-opgaverne er ukendte og planen
// derfor ignoreres) og i den nye kode; kun hashes forlader modulet (hard rule 17).
// Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { entrants7236, stages7236 } from "./raceRunner7236Scenarios.js";

export const RACE_7855 = Object.freeze({ id: "race-7855-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

// Bjergetapens gemte segmenter (som rutegeneratoren skriver dem), saa alle tre toppe og spurten
// er rigtige passager undervejs. Uden segmenter gaetter adapteren kun etapens sidste stykke.
const MOUNTAIN_SEGMENTS_7855 = Object.freeze([
  { kind: "rolling", from_km: 0, to_km: 50 },
  { kind: "climb", from_km: 50, to_km: 60, category: "1", avg_gradient: 6.5, top_elevation_m: 1400 },
  { kind: "descent", from_km: 60, to_km: 70, technicality: 2 },
  { kind: "flat", from_km: 70, to_km: 100 },
  { kind: "climb", from_km: 100, to_km: 110, category: "1", avg_gradient: 7, top_elevation_m: 1600 },
  { kind: "descent", from_km: 110, to_km: 122, technicality: 2 },
  { kind: "rolling", from_km: 122, to_km: 148 },
  { kind: "climb", from_km: 148, to_km: 162, category: "HC", avg_gradient: 8, top_elevation_m: 2100 },
  { kind: "descent", from_km: 162, to_km: 170, technicality: 3 },
]);

/** Samme etaper som #7236 (flad med spurt, topankomst med spurt, bjerg med tre toppe og en spurt); bjergetapen med segmenter. */
export function stages7855() {
  return stages7236().map((s) => ({
    ...s,
    race_id: RACE_7855.id,
    id: `sp-7855-${s.stage_number}`,
    ...(s.stage_number === 3 ? { segments: MOUNTAIN_SEGMENTS_7855.map((seg) => ({ ...seg })) } : {}),
  }));
}

// Faste roller til rytterne med plan (resten koerer paa deres rolle som i #7236).
const ROLES_7855 = Object.freeze({
  r001: "helper", r002: "helper", r003: "sprint_captain", r007: "helper", r008: "hunter",
  r009: "helper", r013: "hunter", r014: "helper", r019: "free_role", r020: "helper",
});

export function entrants7855() {
  return entrants7236(30, 5).map((e) => (ROLES_7855[e.rider_id] ? { ...e, race_role: ROLES_7855[e.rider_id] } : e));
}

const HOLD = (id) => `team-${String.fromCharCode(65 + Math.floor(Number(id.slice(1)) / 6))}`;

function row(stageNumber, plans) {
  const byTeam = new Map();
  for (const [riderId, plan] of plans) {
    const team = HOLD(riderId);
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({ rider_id: riderId, effort: "normal", try_break: false, leadout: false, plan });
  }
  return [...byTeam].map(([team_id, riders]) => ({ team_id, race_id: RACE_7855.id, stage_number: stageNumber, breakaway_stance: null, riders }));
}

/**
 * Planerne. Etape 1: point paa hele etapen (gyldig) og point kun i de sidste km (ingen spurt
 * dér, ugyldig). Etape 2: point (gyldig) og bjergpoint (kun topankomst, ugyldig). Etape 3:
 * bjergpoint efter foerste top, bjergpoint fra start til sat, point til anden top, og en plan
 * uden jagt (koerer i basen og i den nye kode).
 */
export function teamOrderRows7855() {
  return [
    ...row(1, [
      ["r001", [{ task: "hunt_points" }]],
      ["r003", [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }]],
      ["r007", [{ task: "stay_sheltered" }, { task: "hunt_points", from: { at: "final_km" } }]],
      ["r019", [{ task: "hunt_points" }, { task: "ride_for_result", from: { at: "final_km" } }]],
    ]),
    ...row(2, [
      ["r003", [{ task: "hunt_points" }, { task: "grupetto", from: { at: "dropped" } }]],
      ["r009", [{ task: "hunt_kom" }]],
      ["r014", [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }]],
    ]),
    ...row(3, [
      ["r002", [{ task: "shelter_leader" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }]],
      ["r008", [{ task: "hunt_kom" }, { task: "ride_in", from: { at: "dropped" } }]],
      ["r013", [{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }]],
      ["r014", [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }]],
      ["r020", [{ task: "hunt_kom" }, { task: "hunt_points", from: { at: "kom", kom_index: 0 } }, { task: "ride_in", from: { at: "dropped" } }]],
    ]),
  ];
}

/** Motoren med en optager af hver etapes output (argumenter og markeringer uroert). */
function capturing(v4Engine) {
  const outputs = [];
  return {
    outputs,
    engine: v4Engine && { ...v4Engine, simulateStage: (args) => { const out = v4Engine.simulateStage(args); outputs.push(out); return out; } },
  };
}

export function wholeRace7855(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7855.id });
  const cap = capturing(v4Engine);
  const result = buildRaceResults({ race: RACE_7855, stages: stages7855(), entrants: entrants7855(), pointsLookup: {}, v3: true, v4Engine: cap.engine, teamOrderRows: teamOrderRows7855(), rulesRevision, engineInputRecorder: recorder });
  return { result, recorder, outputs: cap.outputs };
}

export function stageByStage7855(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7855.id });
  const cap = capturing(v4Engine);
  const result = buildStageRowsAccumulated({
    race: RACE_7855, stagesSorted: stages7855(), stageIndex, entrants: entrants7855(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine: cap.engine, teamOrderRows: teamOrderRows7855(), rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder, outputs: cap.outputs };
}

/** Checksum, motor-input og output pr. etape. */
export async function digests7855({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7855.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7855 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7855(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7855(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage1", run: (e) => stageByStage7855(e, "s5_profiles_v3", 0) },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage7855(e, "s5_profiles_v3", 2) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7855Runner(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7855) out[c.key] = await digests7855(c.run(v4Engine));
  return out;
}
