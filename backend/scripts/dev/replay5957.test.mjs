// #5957: korrelationsankeret (gate) + replay-scriptets rene hjaelpere.
//
// Ankeret maaler det spillerne maerker: rangerer v4 rytterne efter den evne
// etapen kraever? Det koeres paa prod-lignende felter (ét felt pr. liga-
// division fra den pinnede prod-population, AI-roller og -ordrer), fordi
// flip-gatens felter trukket fra hele populationen har bredere evne-spredning
// end et rigtigt divisionsfelt og derfor skjulte faldet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCases, divisionBatches, offlineCorrelation, spearmanAbilityVsRank, summarize } from "./replay5957.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const POPULATION = path.join(here, "..", "baselines", "population-snapshot-2026-09-24.json");
const STAGES = path.join(here, "..", "baselines", "v4-proxy-stages-2026-09-06.json");

test("spearmanAbilityVsRank: bedste evne vinder = 1, omvendt = -1, baand haandteres", () => {
  const perfect = [{ ability: 90, rank: 1 }, { ability: 50, rank: 2 }, { ability: 10, rank: 3 }];
  assert.equal(spearmanAbilityVsRank(perfect), 1);
  const reversed = perfect.map((p, i) => ({ ...p, rank: 3 - i }));
  assert.equal(spearmanAbilityVsRank(reversed), -1);
  const ties = [{ ability: 50, rank: 1 }, { ability: 50, rank: 2 }, { ability: 10, rank: 3 }];
  assert.ok(spearmanAbilityVsRank(ties) > 0.8);
  assert.equal(spearmanAbilityVsRank(perfect.slice(0, 2)), null, "under tre ryttere maales ikke");
});

test("buildCases: kun v4-koersler med 30+ placerede ryttere og en relevant evne", () => {
  const riders = Array.from({ length: 31 }, (_, i) => `r${i}`);
  const cache = {
    runs: [
      { race_id: "A", stage_number: 1, engine_version: 4, entrant_snapshot: riders },
      { race_id: "A", stage_number: 2, engine_version: 2, entrant_snapshot: riders },
      { race_id: "B", stage_number: 1, engine_version: 4, entrant_snapshot: riders.slice(0, 10) },
    ],
    races: [{ id: "A", stages: 2 }, { id: "B", stages: 1 }],
    profiles: [
      { race_id: "A", stage_number: 1, profile_type: "flat" },
      { race_id: "A", stage_number: 2, profile_type: "flat" },
      { race_id: "B", stage_number: 1, profile_type: "flat" },
    ],
    entries: riders.map((id) => ({ race_id: "A", rider_id: id, team_id: "T1", race_role: "free_role" })),
    orders: [],
    results: riders.map((id, i) => ({ race_id: "A", stage_number: 1, result_type: "stage", rank: i + 1, rider_id: id })),
    teams: [{ id: "T1", is_ai: true }],
    abilities: riders.map((id, i) => ({ rider_id: id, sprint: 90 - i })),
  };
  const cases = buildCases(cache);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].ability, "sprint");
  assert.equal(cases[0].entrants.length, 31);
  assert.equal(cases[0].entrants[0].team_is_ai, true);
});

test("divisionBatches: etaperne fordeles over divisionerne, felter kun fra egen division", () => {
  const population = {
    teams: [{ id: "t1", league_division_id: 1 }, { id: "t2", league_division_id: 2 }],
    riders: [{ id: "a", team_id: "t1" }, { id: "b", team_id: "t2" }, { id: "c", team_id: null }],
  };
  const batches = divisionBatches(population, [{ stage_number: 1 }, { stage_number: 2 }, { stage_number: 3 }]);
  assert.deepEqual(batches.map((b) => b.population.riders.map((r) => r.id)), [["a"], ["b"]]);
  assert.deepEqual(batches.map((b) => b.stages.map((s) => s.stage_number)), [[1, 3], [2]]);
});

// Gulvene er undersoegelsens maal (#5957-rapporten): specialisterne skal igen
// rangeres efter evnen paa flad, kuperet/rullende og brosten, uden at bjerg og
// enkeltstart forringes. Grupperne slaar etapetyper sammen, saa en enkelt
// etapetype med faa etaper ikke goer gaten til stoej.
const GATE = [
  { label: "flad (sprint)", types: ["flat"], min: 0.65 },
  { label: "kuperet/rullende (punch)", types: ["hilly", "rolling"], min: 0.55 },
  { label: "brosten/klassiker", types: ["cobbles", "classic"], min: 0.55 },
  { label: "bjerg (climbing)", types: ["mountain", "high_mountain"], min: 0.65 },
  { label: "enkeltstart (time_trial)", types: ["itt"], min: 0.7 },
];

test("#5957 korrelationsanker: v4 rangerer specialisterne efter evnen paa prod-lignende divisionsfelter", async () => {
  const population = JSON.parse(readFileSync(POPULATION, "utf8"));
  const stagesFile = JSON.parse(readFileSync(STAGES, "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  const rows = await offlineCorrelation({
    population, stages, seeds: ["s1"], fieldSize: 180, orderMode: "ai", divisionFields: true,
  });
  const failures = [];
  for (const gate of GATE) {
    const vals = rows.filter((r) => gate.types.includes(r.profile_type)).map((r) => r.v4).filter(Number.isFinite);
    assert.ok(vals.length > 0, `${gate.label}: ingen etaper i ankeret`);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    if (!(mean >= gate.min)) failures.push(`${gate.label}: ${mean.toFixed(2)} < ${gate.min}`);
  }
  assert.deepEqual(failures, [], `korrelationsankeret fejler:\n${failures.join("\n")}\n${JSON.stringify(summarize(rows))}`);
});
