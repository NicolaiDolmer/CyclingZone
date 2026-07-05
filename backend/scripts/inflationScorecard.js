#!/usr/bin/env node
// #1441 Fase 3 bølge A2 — inflations-scorecard (Fase 2-restancen fra coherence-design §6).
// Spørgsmål: vokser den aggregerede pengemængde M(s) forbi mål-kurven?
//   Mål-kurve: M(s)/M(0) ∈ [0,8, 1,3] for alle s ≤ 5 (§2.1-konsistent: økonomien er
//   designet ~flad — D1 break-even, D2/D3 lille buffer).
// Linser:
//   (A) SYNTETISK baseline (PRIMÆR gate) — fresh-population-nettoen (samme model som
//       moneySupplyScorecard (A)) aggregeret over divisions-fordelingen af hold.
//   (B) SYNTETISK + faciliteter — hvert hold følger "balanced"-strategien fra
//       facilityInvestmentModel med ADOPTION_BUDGET_SHARE (0,6) af præmie-budgettet
//       → beviser at facility-sinket ABSORBERER overskud (M_fac < M_base) uden at
//       vælte feltet (M_fac(s)/M(0) ≥ 0,5 alle sæsoner). All-in (share=1,0) printes
//       som REFERENCE-linje uden gate (stress-scenarie, ikke forventet adfærd).
//   (C) LIVE (--live, reference only) — aggregeret finance_transactions pr. type.
// Report-pattern (ingen exit(1)).
//   node scripts/inflationScorecard.js [--seasons=5] [--live] [--markdown]
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { INITIAL_BALANCE, SPONSOR_INCOME_BY_DIVISION, UPKEEP_BY_DIVISION } from "../lib/economyConstants.js";
import { computeFreshSalaryBurden, RELAUNCH_TEAM_COUNT } from "./lib/freshPopulationBurden.js";
import { renownSponsorFor, resolveOverrides } from "./lib/economyCalibrationOverrides.js";
import {
  DEFAULT_MODEL_CONSTANTS, STRATEGIES, PRIZE_ESTIMATE_BY_DIVISION,
  simulateStrategy, computeBonus,
} from "./lib/facilityInvestmentModel.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

// ── ASSUMPTION: divisions-fordeling af de 22 relaunch-hold ───────────────────────
// Pool-træet er 1/2/4/8-pyramide, men 22 beta-hold fylder ikke alle puljer; 8/8/6 er
// den repræsentative fordeling fra relaunch-rehearsal (D1-pulje fuld, D2 to puljer,
// resten i D3). BLØDT input — kun vægtningen af per-division-nets, ikke nets selv.
const TEAMS_BY_DIVISION = { 1: 8, 2: 8, 3: 6 };

// Antagelses-guard: fordelingen SKAL summe til relaunch-holdantallet fra burden-modellen.
{
  const sum = Object.values(TEAMS_BY_DIVISION).reduce((a, b) => a + b, 0);
  if (sum !== RELAUNCH_TEAM_COUNT) {
    throw new Error(`TEAMS_BY_DIVISION summer til ${sum}, men RELAUNCH_TEAM_COUNT er ${RELAUNCH_TEAM_COUNT} — opdatér fordelingen.`);
  }
}

// Mål-kurve (§2.1): pengemængden skal holde sig i [0,8, 1,3] × start over horisonten.
const TARGET_BAND = { lo: 0.8, hi: 1.3 };

// ── ASSUMPTION: facility-adoption i gate-scenariet ────────────────────────────────
// Gate-scenariet antager at hold bruger 60% af præmie-budgettet på faciliteter —
// IKKE 100%. Begrundelse (review-korrektion efter første A2-kalibrering, 8235bc46):
// faciliteter er FRIVILLIGT gold-sink-forbrug, og frivillig deflation er by design
// (spec §2.1 kalder faciliteter "det store gold-sink" — sinkets FORMÅL er at
// absorbere overskud). Den tidligere gate (ALLE 22 hold all-in med HELE præmien,
// floor ≥ 0,5) var dobbelt-urealistisk worst-case og STRAFFEDE sinket for at virke —
// den pressede konstanterne ud i degenererede former (se audit-rapporten).
// 0,6 er gate-scenariet (høj men realistisk adoption); all-in (1,0) rapporteres
// som stress-REFERENCE uden gate. BLØDT input — ejer sanity-tjekker.
const ADOPTION_BUDGET_SHARE = 0.6;

async function main() {
  const seasons = parseInt(arg("seasons", "5"), 10);
  const live = !!arg("live", false);
  const markdown = !!arg("markdown", false);

  const overrides = resolveOverrides();
  const fresh = computeFreshSalaryBurden();
  const salary = fresh.burdenMedian;
  const teamsTotal = Object.values(TEAMS_BY_DIVISION).reduce((a, b) => a + b, 0);

  console.log("=== INFLATIONS-SCORECARD — pengemængde vs. mål-kurve (coherence §6, Fase 2-restance) ===\n");
  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Hold-fordeling         : D1=${TEAMS_BY_DIVISION[1]} / D2=${TEAMS_BY_DIVISION[2]} / D3=${TEAMS_BY_DIVISION[3]} (${teamsTotal} hold, relaunch-rehearsal-split)`);
  console.log(`  • Lønbyrde (division-blind): ${fmt(salary)}/hold (samme fresh-model som moneySupplyScorecard)`);
  console.log(`  • Præmie-estimat (BLØDT) : D1 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[3])}`);
  console.log(`  • Mål-kurve              : M(s)/M(0) ∈ [${TARGET_BAND.lo}, ${TARGET_BAND.hi}] for s ≤ ${seasons}`);
  console.log(`  • Facility-adoption (BLØDT): ${ADOPTION_BUDGET_SHARE * 100}% af præmie-budgettet i gate-scenariet; all-in (100%) = stress-reference uden gate\n`);

  // Per-division fresh-net (renown fresh = base per konstruktion).
  const netByDiv = {};
  for (const d of [1, 2, 3]) {
    const sponsor = renownSponsorFor({
      divisionBase: overrides.sponsorBase[d] ?? SPONSOR_INCOME_BY_DIVISION[d],
      standing: null, divisionStandings: [],
      wResults: overrides.wResults, maxMultiplier: overrides.maxMultiplier,
    });
    netByDiv[d] = sponsor + PRIZE_ESTIMATE_BY_DIVISION[d] - salary - (overrides.upkeep[d] ?? UPKEEP_BY_DIVISION[d]);
  }

  // ── (A) Baseline: M(s) = M(0) + s × Σ_d hold[d] × net[d] ────────────────────────
  const M0 = teamsTotal * INITIAL_BALANCE;
  const totalNetPerSeason = [1, 2, 3].reduce((s, d) => s + TEAMS_BY_DIVISION[d] * netByDiv[d], 0);

  // ── (B) Faciliteter: per-division facility-cashflow fra "balanced"-strategien ────
  // simulateStrategy returnerer slut-tilstand; til KURVEN behøver vi per-sæson-forbrug,
  // så vi kører sim'en for hver horisont s = 1..seasons og differentierer (spent +
  // recurring er kumulative/øjebliksværdier). Facility-sinket pr. hold pr. sæson s =
  // (spent(s) − spent(s−1)) + recurring(s). Kommerciel bonus-indkomst er en FAUCET og
  // skal tælles med: + commercialIncome(s) (computeBonus-formlen fra modellen = co-SSOT
  // med strengthValuePerSeason for commercial — brug simulateStrategy-output pr. horisont).
  // budgetShare sendes til modellen (SSOT) — gate-scenarie 0,6 vs. all-in-reference 1,0.
  const computeFacilityFlows = (budgetShare) => {
    const byDiv = {};
    for (const d of [1, 2, 3]) {
      const flows = [];
      let prevSpent = 0;
      for (let s = 1; s <= seasons; s++) {
        const r = simulateStrategy({ priorities: STRATEGIES["balanced"], division: d, seasons: s, budgetShare });
        const capex = r.spent - prevSpent;
        prevSpent = r.spent;
        // recurring ved horisont s (øjebliksværdi) + kommerciel indkomst ved slut-tilstand
        const commercialIncome = computeBonus(DEFAULT_MODEL_CONSTANTS, "commercial", r.endTiers.commercial, r.endStaff.commercial)
          * (DEFAULT_MODEL_CONSTANTS.sponsorBase[d] || 0);
        flows.push({ capex, recurring: r.recurring, commercialIncome });
      }
      byDiv[d] = flows;
    }
    return byDiv;
  };
  const facilityFlowByDiv = computeFacilityFlows(ADOPTION_BUDGET_SHARE);
  const facilityFlowAllInByDiv = computeFacilityFlows(1.0);

  console.log("Per-division fresh-net/sæson (baseline):");
  for (const d of [1, 2, 3]) console.log(`  D${d}: net ${fmt(netByDiv[d])} × ${TEAMS_BY_DIVISION[d]} hold`);
  console.log();

  console.log(`Pengemængde-kurve (M(0) = ${fmt(M0)}; facility-scenarie = ${ADOPTION_BUDGET_SHARE * 100}% adoption af præmie-budgettet):`);
  console.log("  sæson   M_baseline      ratio    M_faciliteter   ratio    facility-sink/sæson");
  let mBase = M0, mFac = M0, mFacAllIn = M0;
  let basePass = true, facFloorPass = true;
  const curve = [];
  for (let s = 1; s <= seasons; s++) {
    mBase += totalNetPerSeason;
    let facSink = 0, facSinkAllIn = 0;
    for (const d of [1, 2, 3]) {
      const f = facilityFlowByDiv[d][s - 1];
      facSink += TEAMS_BY_DIVISION[d] * (f.capex + f.recurring - f.commercialIncome);
      const fa = facilityFlowAllInByDiv[d][s - 1];
      facSinkAllIn += TEAMS_BY_DIVISION[d] * (fa.capex + fa.recurring - fa.commercialIncome);
    }
    mFac = mFac + totalNetPerSeason - facSink;
    mFacAllIn = mFacAllIn + totalNetPerSeason - facSinkAllIn;
    const rBase = mBase / M0, rFac = mFac / M0;
    if (rBase < TARGET_BAND.lo || rBase > TARGET_BAND.hi) basePass = false;
    if (rFac < 0.5) facFloorPass = false;
    curve.push({ s, mBase, rBase, mFac, rFac, facSink, mFacAllIn, rFacAllIn: mFacAllIn / M0, facSinkAllIn });
    console.log(`  ${s}       ${fmt(mBase).padStart(12)}  ${rBase.toFixed(2)}×   ${fmt(mFac).padStart(12)}  ${rFac.toFixed(2)}×   ${fmt(facSink)}`);
  }
  const sinkWorks = curve[curve.length - 1].mFac < curve[curve.length - 1].mBase;
  console.log();
  console.log("  REFERENCE (ingen gate) — all-in-stress: alle hold bruger 100% af præmien:");
  console.log("  sæson   M_fac(all-in)   ratio    sink/sæson");
  for (const r of curve) {
    console.log(`  ${r.s}       ${fmt(r.mFacAllIn).padStart(12)}  ${r.rFacAllIn.toFixed(2)}×   ${fmt(r.facSinkAllIn)}`);
  }
  console.log("  NOTE: all-in er et stress-scenarie, ikke forventet adfærd — frivilligt");
  console.log("  gold-sink-forbrug er deflation by design (§2.1); gaten sidder på 0,6-scenariet.");
  console.log();
  console.log(`  Gate [baseline i mål-kurve [${TARGET_BAND.lo}, ${TARGET_BAND.hi}]× alle sæsoner]: ${basePass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Gate [facility-sinket absorberer overskud: M_fac(${seasons}) < M_base(${seasons})]: ${sinkWorks ? "✅ PASS" : "❌ FAIL — sinket bider ikke"}`);
  console.log(`  Gate [faciliteter vælter ikke feltet (${ADOPTION_BUDGET_SHARE * 100}% adoption): M_fac/M(0) ≥ 0,5 alle sæsoner]: ${facFloorPass ? "✅ PASS" : "❌ FAIL — sinket er for voldsomt"}`);

  if (markdown) {
    console.log("\n### Pengemængde-kurve (markdown)\n");
    console.log(`| sæson | M_baseline | ratio | M_fac (${ADOPTION_BUDGET_SHARE * 100}%) | ratio | sink | M_fac (all-in, ref) | ratio |`);
    console.log("|---|---|---|---|---|---|---|---|");
    for (const r of curve) console.log(`| ${r.s} | ${fmt(r.mBase)} | ${r.rBase.toFixed(2)}× | ${fmt(r.mFac)} | ${r.rFac.toFixed(2)}× | ${fmt(r.facSink)} | ${fmt(r.mFacAllIn)} | ${r.rFacAllIn.toFixed(2)}× |`);
  }

  const allPass = basePass && sinkWorks && facFloorPass;
  console.log(`\nHEADLINE: inflations-gate ${allPass ? "✅ PASS" : "❌ FAIL"} (syntetisk primær; §2.1-mål-kurve).`);
  console.log("NOTE: 100% syntetisk. Live-linsen (--live) er reference only.\n");

  if (live) await printLiveSection();
}

// ── (C) LIVE-reference (aggregeret finance_transactions pr. type) ─────────────────
async function printLiveSection() {
  dotenv.config({ path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"), quiet: true });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_READONLY_KEY) {
    console.log("=== (C) LIVE-reference — SPRUNGET OVER (mangler readonly-env) ===\n");
    return;
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_READONLY_KEY);
  // Aggregér pr. type med paginering (fetchAll-mønster fra moneySupplyScorecard).
  const pageSize = 1000;
  const byType = new Map();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("finance_transactions").select("type, amount").range(from, from + pageSize - 1);
    if (error) throw new Error(`finance_transactions: ${error.message}`);
    for (const r of data || []) byType.set(r.type, (byType.get(r.type) || 0) + (r.amount || 0));
    if (!data || data.length < pageSize) break;
  }
  console.log("=== (C) LIVE-reference — aggregeret flow pr. type (REFERENCE ONLY) ===");
  for (const [type, sum] of [...byType.entries()].sort((a, b) => a[1] - b[1])) {
    console.log(`  ${type.padEnd(24)} ${fmt(sum).padStart(14)}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
