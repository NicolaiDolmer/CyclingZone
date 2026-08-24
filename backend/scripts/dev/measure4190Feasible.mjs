#!/usr/bin/env node
// #4190: hvor mange D1-løbsdage er FRI for et igangvaerende ikke-GT-etapeloeb?
// (= hvor mange dage et monument kunne laegges uden at afbryde et etapeloeb). Read-only.
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
const cat = applyGtStagePatch(catalog); const catById = new Map(cat.map((c) => [c.id, c]));
for (const seed of [1,2,3]) {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: cat, from: new Date("2026-01-01T00:00:00Z"), baseSeed: seed });
  const t1 = tierPlans.find((t)=>t.tier===1); const p = t1.pools[0];
  const byRace = new Map();
  for (const st of p.stageRows) { if(!byRace.has(st.pool_race_id)) byRace.set(st.pool_race_id,[]); byRace.get(st.pool_race_id).push(st.game_day); }
  const all = p.stageRows.map(s=>s.game_day); const lo=Math.min(...all), hi=Math.max(...all);
  const busy = new Set(); const gtBusy = new Set(); let nonGtCount=0, monCount=0;
  for (const r of p.raceRows) {
    const c = catById.get(r.pool_race_id) ?? {};
    if (c.race_class === "Monuments") { monCount++; continue; }
    if ((r.stages ?? 1) < 2) continue;
    const isGt = (r.stages ?? 1) >= 15;
    if (!isGt) nonGtCount++;
    const gd = byRace.get(r.pool_race_id).sort((a,b)=>a-b);
    for (let d = gd[0]; d <= gd[gd.length-1]; d++) { busy.add(d); if (isGt) gtBusy.add(d); }
  }
  let free = 0, freeAll = 0; for (let d=lo; d<=hi; d++) { if (!busy.has(d) || gtBusy.has(d)) { if(!busy.has(d)||gtBusy.has(d)){ /* optaget dag - spring frem */ } } }
  for (let d=lo; d<=hi; d++) { const nonGtBusy = busy.has(d) && !gtBusy.has(d); if (!nonGtBusy) free++; if (!busy.has(d)) freeAll++; }
  console.log(`seed ${seed}: D1 loebsdage ${lo}..${hi} (${hi-lo+1}) | ikke-GT-etapeloeb ${nonGtCount} | monumenter ${monCount} | dage uden igangvaerende ikke-GT-etapeloeb: ${free} (${(100*free/(hi-lo+1)).toFixed(0)} %) | dage uden NOGET igangvaerende etapeloeb (GT medregnet): ${freeAll} (${(100*freeAll/(hi-lo+1)).toFixed(0)} %)`);
}
