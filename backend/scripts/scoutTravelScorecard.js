#!/usr/bin/env node
// #2244 Talentspejder Fase 3 (Slice D) — scout-travel-cost-scorecard. MERGE-GATE for
// Slice C (jf. plan docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md).
//
// Spørgsmål: hvor stor en andel af en aktiv managers sæson-indkomst æder standard-
// spejderomkostningerne (SCOUT_JOB_CONFIG defaults i backend/lib/scoutEngine.js)?
//
// GATE: for en "aktiv manager"-profil (2 målrettede opgaver/uge alternerende niveau-
// step + 1 mission/måned, begge til plan-defaults: 15.000 × niveau-step / 60.000 flat)
// skal samlet scouting-spend pr. sæson ligge i [2%, 15%] af typisk sæson-indkomst.
//
// "Typisk sæson-indkomst" — SAMME kilde som money-supply-/inflations-scorecardene
// (#1441 mønster): SPONSOR_INCOME_BY_DIVISION (economyConstants.js, prod-SSOT) +
// PRIZE_ESTIMATE_BY_DIVISION (facilityInvestmentModel.js — repræsentativ kompetent-
// hold-præmie, ejer-reviewet proxy, samme tal som money-supply/inflation/facility-
// scorecardene). Gross (sponsor+præmie), IKKE net efter løn/upkeep: "indkomst" er
// hvad holdet modtager, ikke hvad der er tilbage efter faste omkostninger — løn/upkeep
// er ikke discretionary-budgettet spejder-spend konkurrerer med.
//
// Sæson-længde: 10-12 uger (docs/i18n/GLOSSARY.md "Season"-definition) — 11 uger
// centralt scenarie + 10/12 som sensitivitet (uger→måneder for mission-kadence:
// uger/4,345).
//
// 100% syntetisk — ingen DB-kald, ingen mutation. Læser KUN de eksporterede
// konstanter (SCOUT_JOB_CONFIG, SPONSOR_INCOME_BY_DIVISION); rører intet.
//   node scripts/scoutTravelScorecard.js [--markdown]
import { SCOUT_JOB_CONFIG } from "../lib/scoutEngine.js";
import { SPONSOR_INCOME_BY_DIVISION } from "../lib/economyConstants.js";
import { PRIZE_ESTIMATE_BY_DIVISION } from "./lib/facilityInvestmentModel.js";

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

const GATE_LO = 0.02;
const GATE_HI = 0.15;
const WEEKS_PER_MONTH = 4.345; // 52/12 — mønster: uger→måned-konvertering.
const SEASON_WEEKS_SCENARIOS = [10, 11, 12]; // GLOSSARY.md: "10-12 uger"; 11 = centralt.

const TARGETED_JOBS_PER_WEEK = 2;
// "alternerende niveau" — annen uge-jobs skifter mellem niveau-step 1 og 2 (spec-tekst,
// Slice D-brief). Gennemsnitlig cost/job = (cost(step1)+cost(step2))/2.
const TARGETED_STEP_PATTERN = [1, 2];
const MISSIONS_PER_MONTH = 1;

function targetedJobCost(step) {
  return step * SCOUT_JOB_CONFIG.target.costPerLevel;
}

function computeSeasonSpend(weeks) {
  const avgTargetedCostPerJob =
    TARGETED_STEP_PATTERN.reduce((s, step) => s + targetedJobCost(step), 0) / TARGETED_STEP_PATTERN.length;
  const weeklyTargetedSpend = TARGETED_JOBS_PER_WEEK * avgTargetedCostPerJob;
  const targetedSpendSeason = weeklyTargetedSpend * weeks;

  const months = weeks / WEEKS_PER_MONTH;
  const missionsInSeason = MISSIONS_PER_MONTH * months;
  const missionSpendSeason = missionsInSeason * SCOUT_JOB_CONFIG.mission.cost;

  const totalSpend = targetedSpendSeason + missionSpendSeason;
  return {
    weeks,
    avgTargetedCostPerJob,
    weeklyTargetedSpend,
    targetedSpendSeason,
    months,
    missionsInSeason,
    missionSpendSeason,
    totalSpend,
  };
}

function typicalSeasonIncomeByDivision() {
  const out = {};
  for (const d of [1, 2, 3]) {
    const sponsor = SPONSOR_INCOME_BY_DIVISION[d] || 0;
    const prize = PRIZE_ESTIMATE_BY_DIVISION[d] || 0;
    out[d] = { sponsor, prize, total: sponsor + prize };
  }
  return out;
}

function main() {
  const markdown = process.argv.includes("--markdown");

  console.log("=== #2244 SCOUT-TRAVEL-COST-SCORECARD (Slice D — merge-gate FØR Slice C) ===\n");
  console.log("Aktiv-manager-profil (plan-defaults, docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md):");
  console.log(`  • Målrettede opgaver : ${TARGETED_JOBS_PER_WEEK}/uge, alternerende niveau-step [${TARGETED_STEP_PATTERN.join(",")}] à ${fmt(SCOUT_JOB_CONFIG.target.costPerLevel)}/step`);
  console.log(`  • Missioner          : ${MISSIONS_PER_MONTH}/måned à ${fmt(SCOUT_JOB_CONFIG.mission.cost)} (flat)`);
  console.log(`  • Sæson-længde       : ${SEASON_WEEKS_SCENARIOS.join("-")} uger (docs/i18n/GLOSSARY.md), 11 = centralt scenarie\n`);

  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Typisk sæson-indkomst = sponsor + præmie-estimat (GROSS, ikke net efter løn/upkeep)`);
  console.log(`  • Præmie-estimat (BLØDT, samme proxy som money-supply-/inflations-/facility-scorecardene):`);
  const income = typicalSeasonIncomeByDivision();
  for (const d of [1, 2, 3]) {
    console.log(`      D${d}: sponsor ${fmt(income[d].sponsor)} + præmie ${fmt(income[d].prize)} = ${fmt(income[d].total)}/sæson`);
  }
  console.log();

  console.log("── Sæson-spend (centralt scenarie: 11 uger) ──");
  const central = computeSeasonSpend(11);
  console.log(`  Målrettede opgaver : ${fmt(central.avgTargetedCostPerJob)}/job (gnsn.) × ${TARGETED_JOBS_PER_WEEK}/uge × ${central.weeks} uger = ${fmt(central.targetedSpendSeason)}`);
  console.log(`  Missioner          : ${central.missionsInSeason.toFixed(2)} missioner (${central.months.toFixed(2)} måneder × 1/måned) × ${fmt(SCOUT_JOB_CONFIG.mission.cost)} = ${fmt(central.missionSpendSeason)}`);
  console.log(`  Total spend/sæson  : ${fmt(central.totalSpend)}\n`);

  console.log("── GATE: scouting-spend ∈ [2%, 15%] af typisk sæson-indkomst — pr. division ──");
  let allPass = true;
  const rows = [];
  for (const d of [1, 2, 3]) {
    const frac = central.totalSpend / income[d].total;
    const gatePass = frac >= GATE_LO && frac <= GATE_HI;
    if (!gatePass) allPass = false;
    rows.push({ d, frac, gatePass });
    console.log(`  D${d}: spend ${fmt(central.totalSpend)} / indkomst ${fmt(income[d].total)} = ${pct(frac)} ${gatePass ? "✅ PASS" : "❌ FAIL"} (mål [${pct(GATE_LO)}, ${pct(GATE_HI)}])`);
  }
  console.log(`  Gate [alle divisioner ∈ bånd]: ${allPass ? "✅ PASS" : "❌ FAIL — spend-defaults for høje/lave relativt til indkomst"}\n`);

  console.log("── Sensitivitet — sæson-længde (10/11/12 uger) ──");
  for (const weeks of SEASON_WEEKS_SCENARIOS) {
    const s = computeSeasonSpend(weeks);
    const cells = [1, 2, 3].map((d) => `D${d}=${pct(s.totalSpend / income[d].total)}`);
    console.log(`  ${weeks} uger: total ${fmt(s.totalSpend)} → ${cells.join("  ")}`);
  }
  console.log();

  if (!allPass) {
    console.log("── FORSLAG (kun til ejer-review — landes IKKE her) ──");
    console.log("  Defaults uændrede (plan-instruks: gate-fail ⇒ dokumentér, ikke rekalibrér).");
    console.log("  Kandidat-justeringer (illustrative, vælg ÉN retning ved review):");
    // Find det multiplum af nuværende defaults der ville centre D2 (mid-tier-reference)
    // midt i båndet (~8,5%).
    const targetFrac = (GATE_LO + GATE_HI) / 2;
    const targetSpendD2 = income[2].total * targetFrac;
    const scaleFactor = targetSpendD2 / central.totalSpend;
    console.log(`    • Skalér BEGGE costs med ×${scaleFactor.toFixed(2)} (target ${fmt(SCOUT_JOB_CONFIG.target.costPerLevel * scaleFactor)}/step, mission ${fmt(SCOUT_JOB_CONFIG.mission.cost * scaleFactor)}) → D2-spend centreres ~${pct(targetFrac)}`);
    console.log(`    • ELLER reducér frekvens-antagelsen (denne er en model-profil, ikke en hård cap — spillere kan spende mindre)`);
    console.log(`    • ELLER accepter som top-of-range for en MEGET aktiv manager (båndet er til "typisk", ikke "max")\n`);
  }

  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`HEADLINE: scout-travel-cost-gate ${allPass ? "✅ PASS — Slice-D-krav opfyldt" : "❌ FAIL — se FORSLAG ovenfor, ejer-review krævet"}`);
  console.log("NOTE: dette er en model-profil (BLØDT input, aftalt i Slice-D-briefen) — ikke en hård spend-cap i spillet.\n");

  if (markdown) {
    console.log("### Markdown-summary\n");
    console.log("| Division | Indkomst | Spend | Andel | Gate |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| D${r.d} | ${fmt(income[r.d].total)} | ${fmt(central.totalSpend)} | ${pct(r.frac)} | ${r.gatePass ? "PASS" : "FAIL"} |`);
    }
    console.log();
  }

  return { allPass, central, income, rows };
}

main();
