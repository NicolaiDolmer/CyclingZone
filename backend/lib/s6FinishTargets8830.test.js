// #8830 (ejer 26/11): S6's afslutningsmaal pr. division og pr. niveau, maalt paa den
// offline S6-kalender (30/11-26/12, 140 loebsdage) over frø 1-5, med ejerens +-2 point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOfflineSeasonGates } from "../scripts/dev/seasonCalendarGatesOffline.mjs";
import { seniorAnchorsFromPlan, withMiniEditionRoutes, buildMiniEditionRow } from "./youthMiniEditions7471.js";
import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { S6_FINISH_TARGETS, S6_FINISH_TOLERANCE_PP, s6FinishShares } from "./stageFinaleMetrics.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const SEEDS = [1, 2, 3, 4, 5];

test("#8830 S6: hver division og hvert ungdomsniveau ligger i afslutningsmaalet (+-2 point)", { timeout: 600000 }, async () => {
  const youthFx = JSON.parse(readFileSync(join(FIX, "youthMiniEditions7471.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(FIX, "racePoolCatalog.prod.json"), "utf8")).catalog;
  /** @type {Record<string, any[]>} */
  const stagesBy = {};
  for (const seed of SEEDS) {
    const r = await runOfflineSeasonGates({ seasonNumber: 6, firstDay: "2026-11-30", lastDay: "2026-12-26", raceDayTarget: 140, baseSeed: seed });
    for (const t of r.plan.planTiers) for (const [, st] of t.profilesByPoolRaceId) (stagesBy[`D${t.tier}`] ??= []).push(...st);
    const d1 = r.plan.planTiers.find((t) => t.tier === 1);
    const anchors = seniorAnchorsFromPlan({ tierPlan: d1, catalog });
    for (const squad of ["u23", "junior"]) {
      const minis = withMiniEditionRoutes(youthFx.catalog.map((c) => buildMiniEditionRow(c, squad)));
      const { tierPlans } = buildTierMaterializationPlan({
        pools: [{ id: 900, tier: 1, pool_index: 0, realManagerCount: 0, squad }], catalog: minis,
        from: new Date("2026-11-29T12:00:00Z"), realDays: 27, squad, raceDayTarget: 140,
        seasonLastRaceDay: null, seasonTransitionAt: null, miniEditionAnchors: anchors, baseSeed: seed,
      });
      const plan = tierPlans[0];
      let profiles = plan.profilesByPoolRaceId;
      if (!profiles?.size) {
        profiles = new Map(plan.pools[0].raceRows.map((row) => [row.pool_race_id,
          generateRaceStageProfiles(minis.find((m) => m.id === row.pool_race_id) ?? row, { profileModel: "s5" })]));
      }
      for (const [, st] of profiles) (stagesBy[squad] ??= []).push(...st);
    }
  }
  const tol = S6_FINISH_TOLERANCE_PP;
  const lines = [];
  const brud = [];
  for (const [level, stages] of Object.entries(stagesBy)) {
    const target = S6_FINISH_TARGETS[level.startsWith("D") ? "senior" : level];
    const sh = s6FinishShares(stages);
    lines.push(`${level}: opad ${sh.up.toFixed(1)} % · flad spurt ${sh.flatSprint.toFixed(1)} % (n=${sh.n})`);
    for (const [key, [lo, hi]] of /** @type {Array<[string, number[]]>} */ (Object.entries(target))) {
      const v = /** @type {any} */ (sh)[key];
      if (v < lo - tol || v > hi + tol) brud.push(`${level} ${key} ${v.toFixed(1)} % uden for ${lo}-${hi} ±${tol}`);
    }
  }
  assert.deepEqual(Object.keys(stagesBy).sort(), ["D1", "D2", "D3", "D4", "junior", "u23"]);
  assert.deepEqual(brud, [], `${brud.join("\n")}\n${lines.join("\n")}`);
});
