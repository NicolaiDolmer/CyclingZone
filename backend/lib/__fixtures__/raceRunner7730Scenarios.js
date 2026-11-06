// #7730: faste, syntetiske etaper gennem raceRunner og motoren, hvor jagt-gulvet er i spil. Delt af
// raceRunner7730Flag.test.js og generatoren af den frosne fixture (raceRunner7730FlagOff.json).
// Samme fil koeres i merge-basen (foer kontakten) og i den nye kode; kun hashes forlader modulet
// (hard rule 17). Ingen prod-data.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { entrants7236, stages7236 } from "./raceRunner7236Scenarios.js";
import { digestOf } from "../engine/v4/testUtils/oldRevisionDigests6199.ts";
import { stageRaceRuns } from "../engine/v4/testUtils/stageRaceField6804.ts";

export const RACE_7730 = Object.freeze({ id: "race-7730-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

/** Nok seeds til at begge lodtraekningens udfald er med paa flad og rullende. */
export const ENGINE_SEEDS_7730 = Object.freeze(Array.from({ length: 12 }, (_, i) => `7730-off-${i}`));

export function stages7730() {
  return stages7236().map((s) => ({ ...s, race_id: RACE_7730.id, id: `sp-7730-${s.stage_number}` }));
}

export function entrants7730() {
  return entrants7236(30, 5);
}

/** Motoren med en optager af hver etapes output (argumenter og markeringer uroert). */
function capturing(v4Engine) {
  const outputs = [];
  return {
    outputs,
    engine: v4Engine && { ...v4Engine, simulateStage: (args) => { const out = v4Engine.simulateStage(args); outputs.push(out); return out; } },
  };
}

export function wholeRace7730(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7730.id });
  const cap = capturing(v4Engine);
  const result = buildRaceResults({ race: RACE_7730, stages: stages7730(), entrants: entrants7730(), pointsLookup: {}, v3: true, v4Engine: cap.engine, teamOrderRows: [], rulesRevision, engineInputRecorder: recorder });
  return { result, recorder, outputs: cap.outputs };
}

export function stageByStage7730(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7730.id });
  const cap = capturing(v4Engine);
  const result = buildStageRowsAccumulated({
    race: RACE_7730, stagesSorted: stages7730(), stageIndex, entrants: entrants7730(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine: cap.engine, teamOrderRows: [], rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder, outputs: cap.outputs };
}

/** Checksum, motor-input og output pr. etape. */
export async function digests7730({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7730.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7730 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7730(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7730(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7730(e, "s5_profiles_v3", 1) },
]);

/** Motorens komplette output paa jagt-gulvets profiler, pr. revision. */
export function engineDigests7730(extra = {}) {
  const out = {};
  for (const rev of ["s5_profiles_v3", "s5_profiles_v2"]) {
    for (const r of stageRaceRuns(rev, ["flat", "rolling"], ENGINE_SEEDS_7730)) out[`${rev}:${r.key}`] = digestOf(r.output);
  }
  return { ...out, ...extra };
}

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7730Runner(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7730) out[c.key] = await digests7730(c.run(v4Engine));
  return { ...out, engine: engineDigests7730() };
}
