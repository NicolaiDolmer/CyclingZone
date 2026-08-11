#!/usr/bin/env node
// Fit UNGDOMS-baseline for ryttertype-z-score (#3570, fast-track under #3564-kæden) —
// skriver backend/lib/riderTypesBaselineYouth.json.
//
// ROD-ÅRSAG (målt, #3564/#3570): unge ryttere (16-21 år) klassificeres i produktion
// mod riderTypesBaseline.json — fittet over VOKSEN-caps (n=8.266, se
// fitRiderTypesBaseline.js --caps). I det voksen-rum er unges caps-profil strukturelt
// anderledes (fx time_trial z≈−1,92 for en typisk ungdomsprofil), og aggression har et
// alders-gulv (abilityDerivation.js: 0,85·pcmFrac(stat_ftr)+0,15·youth for ALLE
// 16-21-årige) der giver et kunstigt aggression-niveau uanset talent — baroudeur
// (vægte: kun ÉN negativ vægt, aggression:3) vinder derfor klassifikationen for langt
// de fleste unge (målt 9/8: 76,7 % af human-ejede 16-21-årige er baroudeur).
//
// RETTELSEN (metode valideret i scripts/simYouthClassificationFix3458.js, variant "A"):
// fit en SEPARAT baseline over selve ungdomspopulationens caps — z-scores bliver
// meningsfulde INDEN FOR kuldet i stedet for mod en voksenpopulation unge pr.
// definition ligger under. Målt løft (n=20.000, denne fils population, den
// RIGTIGE shippede YOUTH_GEN_CONFIG uden sim-overrides — se validation-feltet i
// riderTypesBaselineYouth.json): G1 (arketype-genkendelse) 20,4 % → 50,5 %.
// (simYouthClassificationFix3458.js's ofte citerede 24,5 % → 75,5 % blev målt
// med dens CLI-defaults --boost=2/--ceil=60, som #3561 senere strammede til
// 0,8/54 — det ærlige, opnåelige tal mod dagens generator er ~20 % → ~50 %.)
//
// Population + fit-matematik er 1:1 genbrug af simYouthClassificationFix3458.js's
// variant A — SAMME afled-kæde som produktionens deriveForRiderIds (physiology →
// abilities → bootstrap-type [NEUTRAL_BASELINE] → buildCapsForRider), SAMME
// fitBaseline (mean/std pr. evne, population-varians). Ingen afvigelse fra den
// validerede metode.
//
// Determinisme: fast seed (ingen DB, ingen wall-clock) — samme output hver kørsel.
//
//   node scripts/fitRiderTypesBaselineYouth.js               # skriv riderTypesBaselineYouth.json
//   node scripts/fitRiderTypesBaselineYouth.js --dry-run      # vis tal, skriv ikke
//   node scripts/fitRiderTypesBaselineYouth.js --n=20000      # override populationsstørrelse

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, ABILITY_KEYS, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../lib/riderTypesBaselineYouth.json");
const shippedAdultBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const DRY_RUN = process.argv.includes("--dry-run");
const N = parseInt(arg("n", "20000"), 10);
// Fast seed (2026 — samme konvention som simYouthClassificationFix3458.js). Ingen
// relation til kalenderåret; determinisme er hele pointen.
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = 2026;

// Genskaber ÉN akademi-kandidats caps PRÆCIS som produktionens deriveForRiderIds
// (backend/lib/backfillCores.js, trin 1-3): physiology → abilities → BOOTSTRAP-type
// (klassificeret mod LIVE abilities, NEUTRAL_BASELINE — ikke den caps-fittede
// baseline, som ville give forkerte z-scores på dette trin) → buildCapsForRider.
function candidateCaps(riderRow) {
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale }, bootstrap.primary.key, bootstrap.secondary.key);
  return { caps, bootstrapPrimary: bootstrap.primary.key, bootstrapSecondary: bootstrap.secondary.key };
}

function fitBaseline(sets) {
  const mean = {}, std = {};
  for (const a of ABILITY_KEYS) {
    const vals = sets.map((s) => Number(s[a]) || 0);
    const m = vals.reduce((x, y) => x + y, 0) / (vals.length || 1);
    const v = vals.reduce((x, y) => x + (y - m) ** 2, 0) / (vals.length || 1);
    mean[a] = Math.round(m * 1000) / 1000;
    std[a] = Math.round((Math.sqrt(v) || 1) * 1000) / 1000;
  }
  return { mean, std };
}

function main() {
  console.log(`=== Fit UNGDOMS-baseline (#3570) ${DRY_RUN ? "(DRY-RUN)" : "(WRITE)"} — n=${N}, seed=${SEED} ===`);

  const rng = makeRng(SEED);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: N,
  });

  const rows = candidates.map((c, i) => {
    const riderRow = { id: `fit-youth-${i}`, ...c.rider };
    const { caps, bootstrapPrimary, bootstrapSecondary } = candidateCaps(riderRow);
    return { caps, archetypeDraw: c.archetypeDraw, bootstrapPrimary, bootstrapSecondary };
  });

  const { mean, std } = fitBaseline(rows.map((r) => r.caps));

  console.log(`\nUngdoms-kandidater: ${rows.length}`);
  console.log("ability          mean     std");
  for (const a of ABILITY_KEYS) {
    console.log(`  ${a.padEnd(13)} ${String(mean[a]).padStart(7)} ${String(std[a]).padStart(7)}`);
  }

  // G1-selv-verifikation (samme metode som simYouthClassificationFix3458.js): rammer
  // klassifikatoren det trukne anlæg, når vi klassificerer MOD DENNE nye baseline?
  const youthBaseline = { mean, std };
  const hitRate = (baseline) => {
    let hits = 0;
    const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
    for (const r of rows) {
      const key = computeRiderTypes(r.caps, baseline).primary.key;
      dist[key]++;
      // #3632: G1 er STRIKS (den trukne primaer) — alle anlaeg er nu to-delte.
      if (key === r.archetypeDraw.primary) hits++;
    }
    return { pct: Math.round((hits / rows.length) * 1000) / 10, dist };
  };
  const before = hitRate(shippedAdultBaseline);
  const after = hitRate(youthBaseline);
  const distPct = (dist) => Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((dist[t] / rows.length) * 1000) / 10]));
  console.log(`\nG1 FØR (voksen-baseline, dagens defekt): ${before.pct} %`);
  console.log(`G1 EFTER (denne ungdoms-baseline):        ${after.pct} %`);
  console.log(`fordeling EFTER: ${JSON.stringify(distPct(after.dist))}`);

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke.");
    return;
  }

  const payload = {
    description:
      "UNGDOMS-fittet population-baseline (mean/std pr. game-ability) til ryttertype-z-score for 16-21-årige (#3564/#3570). " +
      "Klassificering mod DENNE baseline i stedet for riderTypesBaseline.json (voksen-fittet) retter den strukturelle " +
      "baroudeur-overvægt unge ryttere fik af at blive z-scoret mod en voksenpopulation de pr. definition ligger under " +
      "(time_trial strukturelt lavt + aggression-aldersgulv i abilityDerivation.js). Fittet over ability_caps for en " +
      "fiktiv akademi-kandidat-population (samme afled-kæde som produktionens deriveForRiderIds trin 1-3: physiology → " +
      "abilities → bootstrap-type [NEUTRAL_BASELINE] → buildCapsForRider) — metode 1:1 genbrugt fra " +
      "scripts/simYouthClassificationFix3458.js's validerede variant A. Deterministisk (fast seed, ingen DB).",
    population: "fictional-academy-youth-caps",
    method: "simYouthClassificationFix3458.js variant A (caps × ungdoms-fittet baseline)",
    fitted_at: new Date().toISOString().slice(0, 10),
    seed: SEED,
    n: rows.length,
    validation: {
      g1_before_pct_adult_baseline: before.pct,
      g1_after_pct_youth_baseline: after.pct,
      distribution_after_pct: distPct(after.dist),
    },
    mean,
    std,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\n✅ Skrev ${OUT_PATH}`);
}

main();
