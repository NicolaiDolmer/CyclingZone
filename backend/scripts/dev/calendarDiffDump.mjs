#!/usr/bin/env node
// #4103 — dumper hele den planlagte kalender som JSON (dag for dag, pr. division)
// plus monument-ruter. Bruges til foer/efter-visningen. 100 % offline.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { offlineCalendarFrom } from "./lib/devCalendarArgs.mjs";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const f = JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json"), "utf8"));
// #4239: --first-day/--now injiceres, saa scriptet er tidsuafhaengigt (defaults er frosne).
const { from } = offlineCalendarFrom();
const { tierPlans } = buildTierMaterializationPlan({ pools: f.pools, catalog: f.catalog, from, baseSeed: 1 });
const GT_MIN = 15;

const ud = { tiers: [], monumenter: [] };

for (const plan of tierPlans) {
  const pool = (plan.pools ?? [])[0];
  if (!pool) continue;
  const byId = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
  const dage = new Map();
  for (const s of pool.stageRows ?? []) {
    const r = byId.get(s.pool_race_id);
    const d = String(s.scheduled_at).slice(0, 10);
    if (!dage.has(d)) dage.set(d, []);
    dage.get(d).push({
      navn: r?.name ?? "?",
      etape: s.stage_number,
      afEtaper: r?.stages ?? 1,
      gt: !!r && r.race_type === "stage_race" && (r.stages ?? 0) >= GT_MIN,
      klasse: r?.race_class ?? null,
    });
  }
  ud.tiers.push({
    tier: plan.tier,
    udenAfgoerelse: plan.daysWithoutDecisionCount,
    overlapDage: plan.overlapDays,
    maksOverlap: plan.maxOverlap,
    dage: [...dage.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dato, poster]) => ({ dato, poster: poster.sort((a, b) => Number(b.gt) - Number(a.gt) || a.navn.localeCompare(b.navn)) })),
  });
}

for (const c of f.catalog) {
  if (c.race_class !== "Monuments") continue;
  const seedRace = {
    id: "x-" + c.id, pool_race_id: c.id, external_id: c.external_id,
    terrain_archetype: c.terrain_archetype, name: c.name, race_class: c.race_class,
    race_type: c.race_type, stages: c.stages,
    season_id: "00000000-0000-0000-0000-000000000003", season_variant: 0,
  };
  const p = generateRaceStageProfiles(seedRace)[0];
  ud.monumenter.push({ navn: c.name, profil: p.profile_type, km: p.distance_km, hm: p.elevation_gain_m });
}
ud.monumenter.sort((a, b) => b.km - a.km);

console.log(JSON.stringify(ud));
