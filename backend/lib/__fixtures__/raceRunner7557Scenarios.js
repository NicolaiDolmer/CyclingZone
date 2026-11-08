// #7557: faste, syntetiske etaper gennem raceRunner med den rigtige v4-motor, hvor hold har
// gemt ordren "lad gaa". Delt af raceRunner7557Flag.test.js og generatoren af den frosne
// fixture (raceRunner7557FlagOff.json). Samme fil koeres i merge-basen (foer kontakten) og i
// den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { entrants7236, stages7236 } from "./raceRunner7236Scenarios.js";

export const RACE_7557 = Object.freeze({ id: "race-7557-runner-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

/** Samme etaper som #7236 (flad, topankomst, bjerg), bundet til dette loeb. */
export function stages7557() {
  return stages7236().map((s) => ({ ...s, race_id: RACE_7557.id, id: `sp-7557-${s.stage_number}` }));
}

export function entrants7557() {
  return entrants7236(30, 5);
}

/** Hvert andet hold har gemt "lad gaa" paa alle etaper (race_team_orders-formen). */
export function letGoTeamIds7557() {
  const teams = [...new Set(entrants7557().map((e) => String(e.team_id)))].sort();
  return teams.filter((_, i) => i % 2 === 0);
}

export function teamOrderRows7557() {
  return stages7557().flatMap((s) => letGoTeamIds7557().map((team_id) => ({ team_id, race_id: RACE_7557.id, stage_number: s.stage_number, breakaway_stance: "let_go", riders: [] })));
}

/** Motoren med en optager af hver etapes output (argumenter og markeringer uroert). */
function capturing(v4Engine) {
  const outputs = [];
  return {
    outputs,
    engine: v4Engine && { ...v4Engine, simulateStage: (args) => { const out = v4Engine.simulateStage(args); outputs.push(out); return out; } },
  };
}

export function wholeRace7557(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7557.id });
  const cap = capturing(v4Engine);
  const result = buildRaceResults({ race: RACE_7557, stages: stages7557(), entrants: entrants7557(), pointsLookup: {}, v3: true, v4Engine: cap.engine, teamOrderRows: teamOrderRows7557(), rulesRevision, engineInputRecorder: recorder });
  return { result, recorder, outputs: cap.outputs };
}

export function stageByStage7557(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7557.id });
  const cap = capturing(v4Engine);
  const result = buildStageRowsAccumulated({
    race: RACE_7557, stagesSorted: stages7557(), stageIndex, entrants: entrants7557(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine: cap.engine, teamOrderRows: teamOrderRows7557(), rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder, outputs: cap.outputs };
}

/** Checksum, motor-input og output pr. etape. */
export async function digests7557({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7557.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7557 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7557(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7557(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7557(e, "s5_profiles_v3", 1) },
]);

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7557Runner(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7557) out[c.key] = await digests7557(c.run(v4Engine));
  return out;
}
