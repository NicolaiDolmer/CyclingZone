// #7640: faste, syntetiske etaper gennem den rigtige v4-motor (broen), hvor en alt ud-rytter
// angriber FREM fra gruppen paa en stigning. Delt af climbSelection7640.test.ts og generatoren
// af den frosne fixture (splitAttack7640Off.json). Samme fil koeres i merge-basen (foer
// kontakten) og i den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data.

import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { hashEngineOutput } from "../engineInputSnapshot1857.js";
import { entrants7236, stages7236 } from "./raceRunner7236Scenarios.js";

/** Hver anden rytter koerer alt ud, saa angrebet frem sker paa bjergetaperne. */
export function entrants7640() {
  return entrants7236(30, 5).map((e, i) => (i % 2 === 0 ? { ...e, effort: "all_out" } : e));
}

/** Noeglerne i den frosne fixture: revision x etape. */
export const CASES_7640 = Object.freeze([
  { key: "s5_profiles_v3:stage2", revision: "s5_profiles_v3", stageIndex: 1 },
  { key: "s5_profiles_v3:stage3", revision: "s5_profiles_v3", stageIndex: 2 },
  { key: "s5_profiles_v2:stage2", revision: "s5_profiles_v2", stageIndex: 1 },
]);

/** En etape gennem broen. `extra` er kontakterne (tom = som i spillet i dag). */
export function run7640(engine, c, extra = {}) {
  const stages = stages7236();
  const stage = stages[c.stageIndex];
  return engine.simulateStage({
    entrants: entrants7640(), stageProfile: stage, seedString: `race-7640-fixture:${stage.stage_number}`,
    stageNumber: stage.stage_number, isStageRace: true, raceStages: stages, rulesRevision: c.revision, ...extra,
  });
}

/** Kopi af resultatet uden aarsagen paa klatre-splittene (alt andet uroert). */
export function withoutSplitCauses(value) {
  if (Array.isArray(value)) return value.map(withoutSplitCauses);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, withoutSplitCauses(v)]));
  if (value === null || typeof value !== "object" || value instanceof Set) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = withoutSplitCauses(v);
  if (value.type === "peloton_splits" && out.params && typeof out.params === "object") {
    const { cause: _cause, ...rest } = out.params;
    out.params = rest;
  }
  return out;
}

/** Hashes af hele outputtet og af outputtet uden split-aarsager. */
export function digest7640(result) {
  return { outputSha256: hashEngineOutput(result), withoutCausesSha256: hashEngineOutput(withoutSplitCauses(result)) };
}

/** Motoren som i spillet i dag (ingen kontakt sendt). */
export async function computeOffDigests7640(engine = null) {
  const v4 = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of CASES_7640) out[c.key] = digest7640(run7640(v4, c));
  return out;
}
