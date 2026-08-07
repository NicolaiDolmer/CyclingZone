#!/usr/bin/env node
// Bygger kalibreringskurven bag de absolutte, sammenlignelige type-ratings (#3458
// Fase 1, Del B "skala-ærlighed"). READ-ONLY mod prod — ingen mutation.
//
// Problem (spec docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md
// §Del B, målt på #3372): de rå 1-99 type-ratings (ratingFromAbilities) er IKKE
// sammenlignelige på tværs af de 8 ryttertyper — baroudeur/gc-formlerne giver
// strukturelt højere tal for næsten alle ryttere end fx sprinter/brostensrytter.
// "84" i baroudeur betyder noget helt andet end "84" i gc.
//
// Løsning (ejer-beslutning 6/8): en ABSOLUT, FROSSEN kalibrering af MODELLEN — ikke
// et levende, befolknings-relativt lag. Denne kalibreringskurve fittes ÉN GANG mod en
// population og gøres derefter til en fast del af modellen: den regenereres IKKE
// automatisk eller på en fast kadence. En rekalibrering (fx efter Fase 2 justerer
// type-formlernes vægte) er en fremtidig, BEVIDST design-beslutning, kørt manuelt med
// dette script — ikke en cron/sweep-opgave. Se backend/lib/typeRatingScale.js for
// opslags-funktionen (calibratedTypeRating) der forbruger den committede kurve.
//
// Population (ved dette kalibreringsforsøg): aktive ryttere (ejede+AI, ikke-
// pensionerede — samme filter som measureBestType3372.js: riders.team_id != null &&
// !is_retired). Input pr. rytter er dennes EGEN, LIVE ability_caps (den faktiske
// gemte jsonb — IKKE en kontrafaktisk genberegning, i modsætning til
// measureBestType3372/measureNormalizedTypes3372, som spørger "hvad HVIS rollen var
// hans primære"). For hver af de 8 RIDER_TYPE_KEYS beregnes
// ratingFromAbilities(caps, type) — samme funktion buildTypeCeilingBands bruger i
// scout-rapporten.
//
//   node scripts/buildTypeRatingCalibration.js                # skriv lib/typeRatingCalibration.json
//   node scripts/buildTypeRatingCalibration.js --dry-run       # vis tal, skriv ikke
//   node scripts/buildTypeRatingCalibration.js --dry-run --g6  # + G6-måling (se PR-body)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const RUN_G6 = process.argv.includes("--g6") || DRY_RUN;
const OUT_PATH = join(__dirname, "../lib/typeRatingCalibration.json");
const G6_OUT_PATH = process.argv.includes("--g6-out")
  ? process.argv[process.argv.indexOf("--g6-out") + 1]
  : "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/g6-type-match-3458.json";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Kurve-værdi for position p (0-100) i en SORTERET (asc) talrække — lineær
// interpolation (samme metode som numpy's default/"R-7"), dvs. p=0 → min, p=100 → max.
function curveValue(sortedArr, p) {
  const n = sortedArr.length;
  if (n === 0) return null;
  if (n === 1) return sortedArr[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
}

// 101 punkter (position 0..100) — den kurve der committes og derefter FRYSES.
function buildCurve(sortedArr) {
  const out = [];
  for (let p = 0; p <= 100; p++) {
    const v = curveValue(sortedArr, p);
    out.push(v == null ? null : Math.round(v * 100) / 100);
  }
  return out;
}

// Selv-konsistent opslag (samme interpolation som typeRatingScale.js) — bruges KUN
// til G6-målingen her i scriptet, så vi ikke behøver at importere routes/api.js.
function calibratedFromCurve(curve, raw) {
  const n = curve.length;
  if (raw <= curve[0]) return 1;
  if (raw >= curve[n - 1]) return 99;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid] <= raw) lo = mid; else hi = mid;
  }
  const c0 = curve[lo], c1 = curve[hi];
  const frac = c1 === c0 ? 0 : (raw - c0) / (c1 - c0);
  return Math.round(Math.max(1, Math.min(99, lo + frac)));
}

async function main() {
  console.log(`=== #3458 Fase 1: byg type-rating kalibreringskurve ${DRY_RUN ? "(DRY-RUN)" : "(WRITE)"} ===`);
  const { data: season } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? null;

  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select("rider_id, ability_caps, riders!inner(id, team_id, is_retired)")
      .order("rider_id"));

  // Pr. rytter: ÉT sæt LIVE ability_caps, ratet under alle 8 typer (ingen
  // kontrafaktisk genberegning — dette ER hvad scout-rapporten viser i dag).
  const ratingsByType = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, []]));
  let n = 0, skippedNoCaps = 0;
  const perRider = []; // { id, assigned, caps-baserede ratings } — genbruges til G6 nedenfor.

  for (const row of rows) {
    const r = row.riders;
    if (!r || r.team_id == null || r.is_retired) continue;
    const caps = row.ability_caps;
    if (!caps || typeof caps !== "object") { skippedNoCaps++; continue; }
    n++;
    const ratings = {};
    for (const t of RIDER_TYPE_KEYS) {
      const score = ratingFromAbilities(caps, t);
      ratings[t] = score;
      ratingsByType[t].push(score);
    }
    perRider.push({ id: r.id, ratings });
  }

  const types = {};
  console.log(`\nn=${n} (${skippedNoCaps} sprunget over, mangler ability_caps)`);
  console.log("type              n    min    p25   median    p75    max");
  for (const t of RIDER_TYPE_KEYS) {
    const sorted = ratingsByType[t].slice().sort((a, b) => a - b);
    const curve = buildCurve(sorted);
    types[t] = { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], curve };
    const p25 = curveValue(sorted, 25), median = curveValue(sorted, 50), p75 = curveValue(sorted, 75);
    console.log(
      `${t.padEnd(16)} ${String(sorted.length).padStart(5)} ${String(sorted[0]).padStart(6)} ` +
      `${String(Math.round(p25)).padStart(6)} ${String(Math.round(median)).padStart(8)} ` +
      `${String(Math.round(p75)).padStart(6)} ${String(sorted[sorted.length - 1]).padStart(6)}`
    );
  }

  const payload = {
    description:
      "FROSSEN kalibreringskonstant (#3458 Fase 1, Del B) - ikke et levende, befolknings-relativt lag. " +
      "Fundet empirisk ved at fitte ratingFromAbilities(LIVE ability_caps, type) mod den daværende aktive " +
      "population (ejede+AI, ikke-pensionerede), derefter frosset fast som en engangs-rettelse af MODELLEN: " +
      "et råt tal transformeres til den samme absolutte 1-99-skala i alle 8 roller. Forbruges af " +
      "backend/lib/typeRatingScale.js (calibratedTypeRating - lineær interpolation, clamp [1,99]). " +
      "Regenereres IKKE automatisk/på fast kadence - en rekalibrering er en fremtidig, bevidst DESIGN-" +
      "beslutning (Fase 2, når type-formlernes vægte efterses), kørt manuelt med dette script.",
    frozen: true,
    calibratedAt: new Date().toISOString(),
    seasonNumber,
    n,
    calibrationPopulation: "riders.team_id != null && !riders.is_retired (ejede+AI); rytter uden ability_caps udelades",
    types,
  };

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke lib/typeRatingCalibration.json.");
  } else {
    writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\n✅ Skrev ${OUT_PATH}`);
  }

  if (RUN_G6) {
    console.log("\n=== G6 (spec-gate): tildelt primærtype i kalibreret top-1/top-3 (LIVE caps) ===");
    // Genindlæs tildelt primary_type (ikke selekteret ovenfor — separat, let opslag).
    const assignedRows = await fetchAllRows(() =>
      supabase.from("riders").select("id, primary_type").not("primary_type", "is", null).order("id"));
    const assignedById = new Map(assignedRows.map((r) => [r.id, r.primary_type]));

    let measured = 0, top1 = 0, top3 = 0;
    for (const rider of perRider) {
      const assigned = assignedById.get(rider.id);
      if (!assigned) continue;
      const ranked = RIDER_TYPE_KEYS
        .map((t) => ({ t, r: calibratedFromCurve(types[t].curve, rider.ratings[t]) }))
        .sort((a, b) => b.r - a.r);
      const rank = ranked.findIndex((x) => x.t === assigned);
      if (rank < 0) continue;
      measured++;
      if (rank === 0) top1++;
      if (rank <= 2) top3++;
    }
    const pct = (x) => Math.round((x / measured) * 1000) / 10;
    const g6 = {
      generatedAt: new Date().toISOString(),
      measured,
      top1MatchPct: pct(top1),
      top3MatchPct: pct(top3),
    };
    writeFileSync(G6_OUT_PATH, JSON.stringify(g6, null, 2));
    console.log(`n målt=${measured}`);
    console.log(`Tildelt primærtype = kalibreret top-1: ${g6.top1MatchPct} %`);
    console.log(`Tildelt primærtype i kalibreret top-3:  ${g6.top3MatchPct} %`);
    console.log(`(skrevet til ${G6_OUT_PATH})`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
