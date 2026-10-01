// #6046: brostens-ankeret. Udvider #5957's korrelationsanker (replay5957.test.mjs)
// med brosten-/grusetaper under orders_gc_v1, hvor #6046's brostens-balance bor.
//
// Samme prod-lignende felter som #5957-ankeret (ét felt pr. liga-division fra den
// pinnede prod-population, AI-roller og -ordrer), men kun paa proxy-etaperne med
// brosten-profil, og med den taktiske regel-revision sat eksplicit. Ankeret
// kraever to ting: at brostensevnen rangerer feltet over et gulv, og at den goer
// det tydeligt bedre end legacy-revisionen paa praecis de samme felter. Tallene
// bag gulvet ligger privat i balance-internals/6046/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { divisionBatches, spearmanAbilityVsRank } from "./replay5957.mjs";
import { buildRaceContexts, v4EntrantsFromPopulation } from "../headToHeadV4.js";
import { buildStageTeamOrders } from "../lib/headToHeadOrders.js";
import { sampleField } from "../lib/headToHeadStats.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { stableSeed } from "../../lib/raceSimulator.js";
import { rankedFromV4Output } from "../../lib/raceEngineV4Bridge.js";
import { simulateStageV4 } from "../../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";
import { routeFromStageProfileRow } from "../../lib/engine/v4/adapters/routeAdapter.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const POPULATION = path.join(here, "..", "baselines", "population-snapshot-2026-09-24.json");
const STAGES = path.join(here, "..", "baselines", "v4-proxy-stages-2026-09-06.json");
const COBBLED = new Set(["cobbles", "gravel"]);
const SEEDS = ["s1", "s2", "s3"];
const FIELD_SIZE = 180;

function cobbledCorrelation(population, stages, rulesRevision) {
  const abilityById = new Map(population.riders.map((r) => [r.id, Number(r.abilities?.cobblestone) || 0]));
  const values = [];
  for (const seed of SEEDS) {
    for (const batch of divisionBatches(population, stages)) {
      const raceContexts = buildRaceContexts(batch.stages);
      for (const stageRow of batch.stages) {
        const stageSeed = `${seed}:${stageRow.stage_number ?? 1}`;
        const riders = sampleField(makeRng(stableSeed(`${stageSeed}:field`)), batch.population.riders, FIELD_SIZE);
        const route = routeFromStageProfileRow(stageRow);
        const built = buildStageTeamOrders({ riders, route, race: raceContexts.get(stageRow) });
        const output = simulateStageV4({
          route,
          startlist: v4EntrantsFromPopulation(riders, built.roles, built.effortByRider),
          orders: built.orders,
          seed: stageSeed,
          tuning: RACE_V4_TUNING,
          rules_revision: rulesRevision,
        });
        const rho = spearmanAbilityVsRank(rankedFromV4Output(output).map((x) => ({ ability: abilityById.get(x.rider_id) ?? 0, rank: x.rank })));
        if (Number.isFinite(rho)) values.push(rho);
      }
    }
  }
  return values.reduce((s, x) => s + x, 0) / values.length;
}

test("#6046 brostens-anker: brostensevnen rangerer feltet paa brosten/grus under orders_gc_v1", () => {
  const population = JSON.parse(readFileSync(POPULATION, "utf8"));
  const stagesFile = JSON.parse(readFileSync(STAGES, "utf8"));
  const stages = (Array.isArray(stagesFile) ? stagesFile : stagesFile.stages).filter((s) => COBBLED.has(s.profile_type));
  assert.ok(stages.length > 0, "ingen brosten-/grusetaper i proxy-etaperne");

  const legacy = cobbledCorrelation(population, stages, "legacy");
  const balanced = cobbledCorrelation(population, stages, "orders_gc_v1");
  const floor = 0.8;
  const margin = 0.08;
  assert.ok(balanced >= floor, `brosten under orders_gc_v1: ${balanced.toFixed(2)} < gulv ${floor}`);
  assert.ok(balanced >= legacy + margin, `brosten: orders_gc_v1 ${balanced.toFixed(2)} er ikke ${margin} over legacy ${legacy.toFixed(2)}`);
});
