// #7640: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor, hvor en
// alt ud-rytter angriber FREM fra gruppen paa en stigning. Delt af raceRunner7640Flag.test.js
// og generatoren af den frosne fixture (raceRunner7640FlagOff.json). Samme fil koeres i
// merge-basen (foer ledningen) og i den nye kode; kun hashes forlader modulet (hard rule 17).
// Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { stages7236 } from "./raceRunner7236Scenarios.js";
import { digest7640, entrants7640 } from "./splitAttack7640Scenarios.js";

export const RACE_7640 = Object.freeze({ id: "race-7640-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

/** Samme etaper som #7236 (flad, topankomst, bjerg med kort nedkoersel), bundet til dette loeb. */
export function stages7640() {
  return stages7236().map((s) => ({ ...s, race_id: RACE_7640.id, id: `sp-7640-${s.stage_number}` }));
}

/**
 * Etape-overstyringerne (race_stage_roles-formen) der giver de samme alt ud-ryttere som
 * entrants7640 paa hver etape; raceRunner laeser effort derfra, ikke fra entranten.
 */
export function stageRoleOverrides7640() {
  const allOut = entrants7640().filter((e) => e.effort === "all_out");
  return new Map(stages7640().map((s) => [s.stage_number, new Map(allOut.map((e) => [e.rider_id, { race_role: null, effort: "all_out" }]))]));
}

/** Motoren med en optager af hver etapes output (argumenter og markeringer uroert). */
function capturing(v4Engine) {
  const outputs = [];
  return {
    outputs,
    engine: v4Engine && { ...v4Engine, simulateStage: (args) => { const out = v4Engine.simulateStage(args); outputs.push(out); return out; } },
  };
}

export function wholeRace7640(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7640.id });
  const cap = capturing(v4Engine);
  const result = buildRaceResults({ race: RACE_7640, stages: stages7640(), entrants: entrants7640(), pointsLookup: {}, v3: true, stageRoleOverrides: stageRoleOverrides7640(), v4Engine: cap.engine, rulesRevision, engineInputRecorder: recorder });
  return { result, recorder, outputs: cap.outputs };
}

export function stageByStage7640(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7640.id });
  const cap = capturing(v4Engine);
  const result = buildStageRowsAccumulated({
    race: RACE_7640, stagesSorted: stages7640(), stageIndex, entrants: entrants7640(), pointsLookup: {},
    priorStageRows: [], v3: true, stageRoleOverrides: stageRoleOverrides7640(), v4Engine: cap.engine, rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder, outputs: cap.outputs };
}

/** Checksum, motor-input og output pr. etape, plus outputtet uden split-aarsager. */
export async function digests7640({ result, recorder, outputs }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7640.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
    withoutCausesSha256: outputs.map((o) => digest7640(o).withoutCausesSha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7640 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7640(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7640(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7640(e, "s5_profiles_v3", 1) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7640Runner(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7640) out[c.key] = await digests7640(c.run(v4Engine));
  return out;
}
