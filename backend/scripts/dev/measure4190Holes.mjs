#!/usr/bin/env node
// #4190: HVAD ligger i hullerne? Read-only.
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { loadPoolsAndCatalog, applyGtStagePatch } from "../s3CalendarPackageScorecard.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { pools, catalog } = await loadPoolsAndCatalog(supabase);
const cat = applyGtStagePatch(catalog);
const catById = new Map(cat.map((c) => [c.id, c]));
const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: cat, from: new Date("2026-01-01T00:00:00Z"), baseSeed: 1 });
const t1 = tierPlans.find((t) => t.tier === 1);
const p = t1.pools[0];
const byRace = new Map(); const byDay = new Map();
for (const st of p.stageRows) {
  if (!byRace.has(st.pool_race_id)) byRace.set(st.pool_race_id, []);
  byRace.get(st.pool_race_id).push(st.game_day);
  if (!byDay.has(st.game_day)) byDay.set(st.game_day, new Set());
  byDay.get(st.game_day).add(st.pool_race_id);
}
const nm = (id) => `${catById.get(id)?.name ?? id} [${catById.get(id)?.race_class ?? "?"}]`;
const days = [...byDay.keys()].sort((a,b)=>a-b);
console.log(`D1: game_days ${days[0]}..${days[days.length-1]}, distinkte ${days.length}, tomme dage i intervallet ${days[days.length-1]-days[0]+1-days.length}`);
for (const r of p.raceRows) {
  const gd = [...new Set(byRace.get(r.pool_race_id) ?? [])].sort((a,b)=>a-b);
  if (gd.length < 2) continue;
  const holes = [];
  for (let d = gd[0]; d <= gd[gd.length-1]; d++) if (!gd.includes(d)) holes.push(d);
  if (!holes.length) continue;
  console.log(`\n${nm(r.pool_race_id)} ${r.stages}et  huller: ${holes.join(",")}`);
  for (const h of holes) {
    const occ = [...(byDay.get(h) ?? [])].map(nm);
    console.log(`   gd ${h}: ${occ.length ? occ.join(" | ") : "TOM (ingen løb overhovedet)"}`);
  }
}
