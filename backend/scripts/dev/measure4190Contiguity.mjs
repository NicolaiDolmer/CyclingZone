#!/usr/bin/env node
// #4190 måling: er et løbs etaper på SAMMENHÆNGENDE løbsdage (game_day) i PAKKERENS
// EGET output? 100 % read-only: buildTierMaterializationPlan er ren (ingen DB/writes),
// og der laves kun .select()-kald mod Supabase (league_divisions/teams/race_pool).
//
//   cd backend && node scripts/dev/measure4190Contiguity.mjs
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { loadPoolsAndCatalog, applyGtStagePatch } from "../s3CalendarPackageScorecard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const FROM = new Date("2026-01-01T00:00:00Z");
const { pools, catalog } = await loadPoolsAndCatalog(supabase);
const cat = applyGtStagePatch(catalog);
const catById = new Map(cat.map((c) => [c.id, c]));

for (const seed of [1, 2, 3]) {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: cat, from: FROM, baseSeed: seed });
  console.log(`\n=== baseSeed ${seed} ===`);
  for (const tp of tierPlans) {
    const pl0 = tp.pools[0];
    const stagesByRace = new Map();
    for (const st of pl0.stageRows ?? []) {
      if (!stagesByRace.has(st.pool_race_id)) stagesByRace.set(st.pool_race_id, []);
      stagesByRace.get(st.pool_race_id).push(st.game_day);
    }
    const rows = [];
    for (const r of pl0.raceRows ?? []) {
      const gd = [...new Set(stagesByRace.get(r.pool_race_id) ?? [])].sort((a, b) => a - b);
      if (!gd.length) continue;
      const span = gd[gd.length - 1] - gd[0] + 1;
      rows.push({ id: r.pool_race_id, name: catById.get(r.pool_race_id)?.name ?? r.name ?? "?", cls: catById.get(r.pool_race_id)?.race_class ?? "?", stages: r.stages ?? 1, days: gd.length, span, holes: span - gd.length, gd });
    }
    const sr = rows.filter((r) => r.stages > 1);
    const gapped = sr.filter((r) => r.holes > 0);
    const od = rows.filter((r) => r.stages === 1 && r.days !== 1);
    console.log(`tier ${tp.tier}: etapeløb ${sr.length}, med huller ${gapped.length}, maks hul ${sr.reduce((m, r) => Math.max(m, r.holes), 0)}, endagsløb>1 dag ${od.length}`);
    if (tp.tier === 1) for (const r of gapped.sort((a, b) => b.holes - a.holes).slice(0, 8)) console.log(`   ${r.holes.toString().padStart(2)} huller  ${r.stages}et  ${r.cls.padEnd(18)} ${r.name}  gd=[${r.gd.join(",")}]`);
  }
}
