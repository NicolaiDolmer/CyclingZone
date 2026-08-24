#!/usr/bin/env node
// backend/scripts/dev/measure4190GameDayContiguity.mjs
// #4190 — ligger et løbs etaper på SAMMENHÆNGENDE løbsdage (game_day)?
//
// Hvorfor scriptet findes: issuet antog at generatoren spreder et løbs etaper ud.
// Denne måling viser at pakkerens EGET output er sammenhængende i D2/D3/D4 og kun
// har huller i D1 hvor et monument (#4075) eller en GT-hviledag (#3470) bevidst
// skydes ind. De 167 uforklarede huller i live S3 stammer fra den dato-baserede
// afledning i calendarGameDayRepair.deriveGameDayAxis, ikke fra pakkeren.
//
// 100 % READ-ONLY: buildTierMaterializationPlan er en REN funktion (ingen DB,
// ingen writes); der laves kun .select()-kald mod Supabase
// (league_divisions / teams / race_pool). Rører ALDRIG den live kalender.
//
//   cd backend && node scripts/dev/measure4190GameDayContiguity.mjs
//   cd backend && node scripts/dev/measure4190GameDayContiguity.mjs --holes   (hvad ligger i hullerne)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { loadPoolsAndCatalog, applyGtStagePatch } from "../s3CalendarPackageScorecard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });

const SHOW_HOLES = process.argv.includes("--holes");
const FROM = new Date("2026-01-01T00:00:00Z"); // vilkårlig: kun scheduling-tider, ikke målt
const GT_MIN_STAGES = 15;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { pools, catalog } = await loadPoolsAndCatalog(supabase);
const cat = applyGtStagePatch(catalog);
const catById = new Map(cat.map((c) => [c.id, c]));
const nameOf = (id) => `${catById.get(id)?.name ?? id} [${catById.get(id)?.race_class ?? "?"}]`;

/** Løbsdage pr. løb + belægning pr. løbsdag for én pulje. Ren aflæsning af planen. */
function indexPool(pool) {
  const byRace = new Map();
  const byDay = new Map();
  for (const st of pool.stageRows ?? []) {
    if (!byRace.has(st.pool_race_id)) byRace.set(st.pool_race_id, new Set());
    byRace.get(st.pool_race_id).add(st.game_day);
    if (!byDay.has(st.game_day)) byDay.set(st.game_day, new Set());
    byDay.get(st.game_day).add(st.pool_race_id);
  }
  return { byRace, byDay };
}

for (const seed of [1, 2, 3]) {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: cat, from: FROM, baseSeed: seed });
  console.log(`\n=== baseSeed ${seed} ===`);

  for (const tp of tierPlans) {
    const pool = tp.pools[0];
    const { byRace, byDay } = indexPool(pool);

    const rows = [];
    for (const r of pool.raceRows ?? []) {
      const gd = [...(byRace.get(r.pool_race_id) ?? [])].sort((a, b) => a - b);
      if (!gd.length) continue;
      const span = gd[gd.length - 1] - gd[0] + 1;
      rows.push({ id: r.pool_race_id, stages: r.stages ?? 1, days: gd.length, holes: span - gd.length, gd });
    }
    const stageRaces = rows.filter((r) => r.stages > 1);
    const gapped = stageRaces.filter((r) => r.holes > 0);
    const oneDayBad = rows.filter((r) => r.stages === 1 && r.days !== 1);
    const maxHoles = stageRaces.reduce((m, r) => Math.max(m, r.holes), 0);

    console.log(
      `tier ${tp.tier}: etapeløb ${stageRaces.length}, med huller ${gapped.length}, ` +
      `største hul ${maxHoles}, endagsløb der bruger mere end 1 løbsdag ${oneDayBad.length}`
    );

    if (!SHOW_HOLES) continue;
    for (const r of gapped.sort((a, b) => b.holes - a.holes)) {
      const holes = [];
      for (let d = r.gd[0]; d <= r.gd[r.gd.length - 1]; d++) if (!r.gd.includes(d)) holes.push(d);
      const isGt = r.stages >= GT_MIN_STAGES;
      console.log(`\n  ${nameOf(r.id)} ${r.stages} etaper${isGt ? " (Grand Tour)" : ""}, huller: ${holes.join(",")}`);
      for (const h of holes) {
        const occupants = [...(byDay.get(h) ?? [])].map(nameOf);
        console.log(`     løbsdag ${h}: ${occupants.length ? occupants.join(" | ") : "TOM (ingen løb)"}`);
      }
    }
  }
}
