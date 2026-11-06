// #7715: faste, syntetiske etaper gennem raceRunner med den rigtige v4-motor, hvor en del af
// feltet er meget traet. Delt af raceRunner7715Flag.test.js og generatoren af den frosne
// fixture (raceRunner7715FlagOff.json). Samme fil koeres i merge-basen (foer kontakten) og i
// den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { entrants7236, stages7236 } from "./raceRunner7236Scenarios.js";

export const RACE_7715 = Object.freeze({ id: "race-7715-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

/** Samme etaper som #7236 (flad, topankomst, bjerg), bundet til dette loeb. */
export function stages7715() {
  return stages7236().map((s) => ({ ...s, race_id: RACE_7715.id, id: `sp-7715-${s.stage_number}` }));
}

/** Hver tredje rytter er sprinter-bygget og udkoert: meget traet og daarlig til bjerget. */
export function entrants7715() {
  return entrants7236(30, 5).map((e, i) => (i % 3 === 2
    ? { ...e, fatigue: 95, abilities: { ...e.abilities, climbing: Math.round((e.abilities?.climbing ?? 0) / 3), sprint: 90, flat: 90 } }
    : e));
}

export function tiredRiderIds7715() {
  return entrants7715().filter((e) => e.fatigue === 95).map((e) => e.rider_id);
}

/** Motoren med en optager af hver etapes output (argumenter og markeringer uroert). */
function capturing(v4Engine) {
  const outputs = [];
  return {
    outputs,
    engine: v4Engine && { ...v4Engine, simulateStage: (args) => { const out = v4Engine.simulateStage(args); outputs.push(out); return out; } },
  };
}

export function wholeRace7715(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7715.id });
  const cap = capturing(v4Engine);
  const result = buildRaceResults({ race: RACE_7715, stages: stages7715(), entrants: entrants7715(), pointsLookup: {}, v3: true, v4Engine: cap.engine, teamOrderRows: [], rulesRevision, engineInputRecorder: recorder });
  return { result, recorder, outputs: cap.outputs };
}

export function stageByStage7715(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7715.id });
  const cap = capturing(v4Engine);
  const result = buildStageRowsAccumulated({
    race: RACE_7715, stagesSorted: stages7715(), stageIndex, entrants: entrants7715(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine: cap.engine, teamOrderRows: [], rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder, outputs: cap.outputs };
}

/** Checksum, motor-input og output pr. etape. */
export async function digests7715({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7715.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7715 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7715(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7715(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7715(e, "s5_profiles_v3", 1) },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage7715(e, "s5_profiles_v3", 2) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7715Runner(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7715) out[c.key] = await digests7715(c.run(v4Engine));
  return out;
}
