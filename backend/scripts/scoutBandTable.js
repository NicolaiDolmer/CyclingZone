#!/usr/bin/env node
// #2244 Talentspejder Fase 3 (Slice D) — spejder-præcisions-bånd-tabel.
// Print halvbredde-bånd for scout overall {40,60,80,99} × alder-bånd × niveau 1-3,
// jf. plan Task D (docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md).
//
// To uafhængige akser i den nuværende model (verificeret mod backend/lib/scouting.js +
// backend/lib/scoutingReport.js — ikke gættet):
//   (1) DELVIS scouting (level < maxLevel): halfWidth = baseUncertainty(age) ×
//       (1 - level/maxLevel) — ALDER-afhængig, IKKE spejder-rating-afhængig (gulvet
//       (scoutEngine.scoutHalfWidth) rammer først REST-båndet, se Task A2/A3-kommentarer
//       i scouting.js: "gulvet... ingen når 0 — residual anchorBias bevares").
//   (2) FULD scouting / REST-bånd (level == maxLevel, ELLER egen rytter): halfWidth =
//       scoutHalfWidth(...) — SPEJDER-RATING-afhængig, alder-UAFHÆNGig.
// Tabellen viser derfor begge akser eksplicit i stedet for at foregive én kombineret
// formel der ikke findes i koden.
//
// Type-loft-bånd (scoutingReport.buildTypeCeilingBands, rating-point-skala) er en
// TREDJE tabel: samme scoutHalfWidth-gulv-logik, men i 1-99-rating-punkter i stedet
// for stjerne-enheder.
//
// 100% syntetisk — ingen DB, ren funktionskald.
//   node scripts/scoutBandTable.js [--markdown]
import { SCOUTING_CONFIG, SCOUT_DISPLAY_CONFIG } from "../lib/scouting.js";
import { scoutHalfWidth } from "../lib/scoutEngine.js";
import { CEIL_HALF_WIDTH_BY_LEVEL } from "../lib/scoutingReport.js";

const markdown = process.argv.includes("--markdown");
const SCOUT_RATINGS = [40, 60, 80, 99];
const maxLevel = SCOUTING_CONFIG.maxLevel; // 3
const STAR_GULV_UNIT_SCALE = SCOUT_DISPLAY_CONFIG.residualHalfWidth / 3;

function baseUncertainty(age) {
  for (const row of SCOUT_DISPLAY_CONFIG.baseHalfWidthByAge) if (age <= row.maxAge) return row.half;
  return SCOUT_DISPLAY_CONFIG.baseHalfWidthByAge[SCOUT_DISPLAY_CONFIG.baseHalfWidthByAge.length - 1].half;
}

// Repræsentative alder-bånd (matcher baseHalfWidthByAge-grænserne 1:1).
const AGE_BUCKETS = [
  { label: "≤20 (U23-opdyrkning)", age: 19 },
  { label: "21-23 (U23-udgang)", age: 22 },
  { label: "24-27 (peak-nærmer)", age: 26 },
  { label: "28+ (etableret)", age: 30 },
];

function restHalfWidthStar(scout, bandFactor = 1) {
  return scoutHalfWidth(0, scout, [SCOUT_DISPLAY_CONFIG.residualHalfWidth], STAR_GULV_UNIT_SCALE) * bandFactor;
}

function main() {
  console.log("=== #2244 SPEJDER-PRÆCISIONS-BÅND-TABEL (Slice D) ===\n");

  // ── Tabel 1: DELVIS scouting (stjerne-halvbredde), alder × niveau — spejder-uafhængig ──
  console.log("── Tabel 1: delvis scouting — stjerne-halvbredde pr. alder-bånd × niveau (1..maxLevel-1) ──");
  console.log("   (spejder-rating-UAFHÆNGig i den nuværende model — kun REST-båndet nedenfor er rating-drevet)\n");
  const header1 = ["alder-bånd", ...Array.from({ length: maxLevel - 1 }, (_, i) => `niveau ${i + 1}`)];
  console.log(`  ${header1.join(" | ")}`);
  for (const bucket of AGE_BUCKETS) {
    const base = baseUncertainty(bucket.age);
    const cells = Array.from({ length: maxLevel - 1 }, (_, i) => {
      const level = i + 1;
      const knowledge = level / maxLevel;
      const half = base * (1 - knowledge);
      return `±${half.toFixed(2)}★`;
    });
    console.log(`  ${bucket.label.padEnd(24)} ${cells.join("   ")}`);
  }
  console.log();

  // ── Tabel 2: REST-bånd (fuld scouting, niveau == maxLevel / egen rytter) — spejder-drevet ──
  console.log(`── Tabel 2: REST-bånd (niveau == maxLevel=${maxLevel} / egen rytter) — stjerne-halvbredde × spejder-overall ──`);
  console.log("   (alder-UAFHÆNGig — anchorBias-restbåndet er konstant på tværs af aldre)\n");
  console.log("  spejder-overall | fremmed rytter (×1.0) | egen rytter (×0.8)");
  for (const overall of SCOUT_RATINGS) {
    const scout = { overall };
    const foreign = restHalfWidthStar(scout, 1);
    const own = restHalfWidthStar(scout, 0.8);
    console.log(`  ${String(overall).padEnd(15)} | ±${foreign.toFixed(3)}★                | ±${own.toFixed(3)}★`);
  }
  console.log();

  // ── Tabel 3: type-loft-bånd (scoutingReport, rating-point-skala) × spejder-overall × niveau ──
  console.log("── Tabel 3: type-loft-bånd (buildTypeCeilingBands) — rating-punkt-halvbredde × spejder-overall × niveau ──\n");
  const header3 = ["spejder-overall", ...Array.from({ length: maxLevel + 1 }, (_, i) => `niveau ${i}`)];
  console.log(`  ${header3.join(" | ")}`);
  for (const overall of SCOUT_RATINGS) {
    const scout = { overall };
    const cells = Array.from({ length: maxLevel + 1 }, (_, level) => {
      const half = scoutHalfWidth(level, scout, CEIL_HALF_WIDTH_BY_LEVEL);
      return `±${half.toFixed(2)}pt`;
    });
    console.log(`  ${String(overall).padEnd(15)} ${cells.join("   ")}`);
  }
  console.log();

  if (markdown) {
    console.log("### Markdown — Tabel 3 (type-loft-bånd)\n");
    console.log(`| Spejder-overall | ${Array.from({ length: maxLevel + 1 }, (_, i) => `Niveau ${i}`).join(" | ")} |`);
    console.log(`|---|${Array.from({ length: maxLevel + 1 }, () => "---|").join("")}`);
    for (const overall of SCOUT_RATINGS) {
      const scout = { overall };
      const cells = Array.from({ length: maxLevel + 1 }, (_, level) => `±${scoutHalfWidth(level, scout, CEIL_HALF_WIDTH_BY_LEVEL).toFixed(2)}`);
      console.log(`| ${overall} | ${cells.join(" | ")} |`);
    }
    console.log();
  }

  console.log("NOTE: gulvet (scoutEngine.minHalfWidthByScoutRating) er monotonisk faldende 40→99");
  console.log("      (bedre spejder = smallere REST/loft-bånd), men rammer ALDRIG under middelmådig-loftet");
  console.log("      4.5 (rating-pt) for overall<60 (spec beslutning 3) — se Tabel 2/3 overall=40 vs 60.\n");
}

main();
