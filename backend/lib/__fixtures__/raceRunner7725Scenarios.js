// #7725: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor, med
// dagsformen taendt som i prod. Delt af dayWords7725Flag.test.js og generatoren af den
// frosne fixture (raceRunner7725FlagOff.json). Samme fil koeres i merge-basen (foer
// kontakten) og i den nye kode; kun hashes forlader modulet (hard rule 17).

import { createHash } from "node:crypto";
import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { RACE_7644, entrants7644, stages7644 } from "./raceRunner7644Scenarios.js";

export const RACE_7725 = RACE_7644;
export const entrants7725 = entrants7644;
export const stages7725 = stages7644;

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Hvad spilleren ender med at se og hvad der betales ud fra: rækkerne, tidslinjerne og motorens hash. */
export async function digests7725({ result, recorder }) {
  const rows = await buildSnapshotRows({ raceId: RACE_7725.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
    resultRowsSha256: sha(result.resultRows ?? null),
    timelinesSha256: sha(result.timelines ?? null),
  };
}

export function wholeRace7725(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7725.id });
  const result = buildRaceResults({ race: RACE_7725, stages: stages7725(), entrants: entrants7725(), pointsLookup: {}, v3: true, v4Engine, rulesRevision, timeline: true, engineInputRecorder: recorder });
  return { result, recorder };
}

export function stageByStage7725(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7725.id });
  const result = buildStageRowsAccumulated({
    race: RACE_7725, stagesSorted: stages7725(), stageIndex, entrants: entrants7725(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, rulesRevision, timeline: true, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Noeglerne i den frosne fixture: revision x sti, dagsformen taendt som i prod. */
export const OFF_DIGEST_CASES_7725 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7725(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7725(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage2", run: (e) => stageByStage7725(e, "s5_profiles_v3", 1) },
]);

export async function computeOffDigests7725() {
  const engine = { ...(await loadRaceEngineV4()), dayForm6649: true };
  const out = {};
  for (const c of OFF_DIGEST_CASES_7725) out[c.key] = await digests7725(c.run(engine));
  return out;
}
