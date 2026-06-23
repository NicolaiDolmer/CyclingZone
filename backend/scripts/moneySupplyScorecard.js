#!/usr/bin/env node
// #1441 money-supply-scorecard — beviser anti-inflation FØR ship.
// To linser:
//   (A) SYNTETISK fresh-population-net (PRIMÆR gate) — modellerer relaunch-populationen
//       DB-frit: generateLaunchPopulation → allocateStarterSquads → frossen løn
//       (round(base_value × SALARY_RATE)). Det er DENNE konfiguration de friske hold
//       starter i (#1441 A6) — IKKE de gamle frosne live-lønninger.
//   (B) LIVE-snapshot (reference only) — læser live-population read-only. Live-lønninger
//       er FROSSET på den GAMLE skala (D1 median ~1,7M) → ubrugelige til kalibrering;
//       beholdt kun som konserverings-/drift-tjek + reference.
// Report-pattern (ingen exit(1)) — ejer reviewer FØR relaunch.
//   node scripts/moneySupplyScorecard.js [--markdown]   (live kræver readonly-env)
//   node scripts/moneySupplyScorecard.js --synthetic-only   (springer live over)
//
// FOREVER-RELAUNCH 4-DIVISIONS-FORSLAG (#1663 forever-frys, Task 8):
//   node scripts/moneySupplyScorecard.js --tiers4 [--synthetic-only]
//     Modellerer en 4-tier/15-pulje-pyramide (tier 1×1, 2×2, 3×4, 4×8) klar til
//     100 managers og FORESLÅR div-4-net-konstanter (sponsor/upkeep/debt-ceiling/
//     bonus). Tier 4 er BUNDEN + indgangs-tieren → SKAL være bæredygtig fra dag 1.
//     Dette er et FORSLAG ejeren granit-fryser — landes IKKE i economyConstants.js her.
import dotenv from "dotenv";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  SALARY_RATE,
  PRIZE_PER_POINT,
  INITIAL_BALANCE,
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  DEBT_CEILING_BY_DIVISION,
  NEGATIVE_BALANCE_INTEREST_RATE,
} from "../lib/economyConstants.js";
// Kalibrerings-override (sponsor + upkeep): default = prod-konstanterne, så denne gate
// stadig gælder prod ved baseline. Sat via env/--config → re-tjek fresh-population ved
// de sweep-anbefalede sponsor-tal UDEN at røre prod (task 4: fresh må ikke regressere).
// NB: ppp/flatten påvirker IKKE denne linse — præmien her er et fast estimat (det BLØDESTE
// input), ikke den målte kurve; det er prizeDistributionScorecard der måler præmie-niveau.
import { resolveOverrides, renownSponsorFor } from "./lib/economyCalibrationOverrides.js";
import { generateLaunchPopulation } from "../lib/fictionalLaunchPopulation.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { allocateStarterSquads, STARTER_SQUAD } from "../lib/starterSquadAllocator.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

// ── ASSUMPTION: roster-størrelse pr. hold ved relaunch ──────────────────────────
// Autoritativ kilde: starterSquadAllocator.STARTER_SQUAD. Den fulde start-trup er nu
// TOTAL_SIZE (12 = CORE_SIZE 8 kerne + 4 svag hale) efter race-hub 0c.
// Scorecardet kalder allocateStarterSquads (= den løbsklare KERNE, CORE_SIZE=8/hold);
// den svage race-hub-0c-hale (TAIL_SIZE=4) allokeres separat og indgår IKKE her.
// Halen er bevidst dybe domestiques (base_value ~7k / lav løn) → forsvindende lille
// effekt på money supply, så money-supply-tallet er reelt uændret af de 4 ekstra ryttere.
// Allokeringen er DIVISION-BLIND (snake-draft på base_value over ALLE manager-hold,
// fairness-balanceret), så lønbyrden er ~ens pr. hold uanset division. De gamle 22/15/9-
// rosters i economyContractSimulation.js er MODNE-hold-templates, IKKE den friske relaunch.
const RELAUNCH_TEAM_COUNT = 22; // relaunch-rehearsal 2026-06-11: 22 beta-manager-hold (#1191).

// ── ASSUMPTION: per-division præmie-estimat (det BLØDESTE input) ────────────────
// Præmie = Σ(race_points × PRIZE_PER_POINT) fordelt på løbsresultater — kan ikke
// udledes fra live-DB (0 prize-transaktioner: ledgeren er nulstillet i pre-relaunch-state).
// Proxy: economyContractSimulation.js' repræsentative "kompetent mid-table"-præmie pr.
// division (ejer-reviewet for #1309-sim'en). Dette er en MODEL-input, ikke målt; nettoen
// er FØLSOM for dette tal (prize=0 → alle divisioner dybt negative; se sensitivitet i output).
const PRIZE_ESTIMATE_BY_DIVISION = { 1: 160000, 2: 70000, 3: 25000 };

// ════════════════════════════════════════════════════════════════════════════════
// FOREVER-RELAUNCH 4-DIVISIONS-MODEL (#1663 forever-frys, Task 8) — FORSLAG
// ════════════════════════════════════════════════════════════════════════════════
// En forever-relaunch åbner med en 4-tier/15-pulje-pyramide klar til 100 managers.
// Tier 4 bliver BUNDEN + indgangs-tieren for nye managers → den SKAL være bæredygtig
// fra dag 1 (et kompetent div-4-hold må ALDRIG garanteret gå konkurs). Disse tal
// granit-fryses FOR EVIGT ved forever — derfor dette eksplicitte FORSLAG (ejer fryser).

// ── Pyramide-struktur: 15 puljer fordelt 1/2/4/8 over tier 1-4 ──────────────────
// Tier 1 = toppen (1 pulje), tier 4 = bunden (8 puljer). 100 managers fordeles
// proportionalt med pulje-antallet pr. tier (flere puljer i bunden = flest managers
// i bunden, realistisk talent-pyramide). En pulje ≈ DIVISION_CAPACITY-størrelse.
const TIERS4_POOLS_BY_DIVISION = { 1: 1, 2: 2, 3: 4, 4: 8 }; // sum = 15
const TIERS4_TARGET_MANAGERS = 100;

// ── FORSLAG: div-4-net-konstanter (det Task 8 leverer) ───────────────────────────
// Tier 4 er bunden: laveste sponsor (under D3's 340k), upkeep på GULVET (konveks
// "blød bund" §3.1 — den stejle top (D1) bærer anti-inflations-lasten, bunden er
// beskyttet) og laveste repræsentative præmie (få/ingen point i bunden).
//   • SPONSOR_INCOME_BY_DIVISION[4] = 315.000  (under D3=340k → distinkt bundtier)
//   • UPKEEP_BY_DIVISION[4]        = 0         (gulv; konveks blød bund)
//   • DEBT_CEILING_BY_DIVISION[4]  = 400.000   (under D3=600k; bunden låner mindst)
//   • DIVISION_BONUSES[4]          = [50k,25k,10k] (under D3=[75k,50k,25k])
const TIERS4_PROPOSED = Object.freeze({
  sponsor: 315000,
  upkeep: 0,
  debtCeiling: 400000,
  bonuses: [50000, 25000, 10000],
});

// ── ASSUMPTION: per-tier præmie-estimat i 4-division-modellen (det BLØDESTE input) ─
// D1-D3 = uændret fra 3-division-modellen. Tier 4 (bunden) får et LAVERE estimat end
// D3: i en 4-lags-pyramide flytter de svageste hold ned i tier 4 og scorer få/ingen
// point → repræsentativ præmie ≈ 10.000 (under D3's 25.000). Dette er en ANTAGELSE —
// præmie-input er det blødeste led; sensitiviteten (×0..×2) udskrives så ejeren ser
// hvor robust nettoen er (prize=0-grenen beviser at selv et nul-scorende hold ikke
// går konkurs — det er det kritiske krav for indgangs-tieren).
const TIERS4_PRIZE_ESTIMATE_BY_DIVISION = { 1: 160000, 2: 70000, 3: 25000, 4: 10000 };

async function fetchAll(supabase, table, select, build = (q) => q) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(
      supabase.from(table).select(select)
    ).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// ── (A) SYNTETISK fresh-population-net ──────────────────────────────────────────
// Genererer den låste launch-population, kører den ægte starter-squad-allokering, og
// beregner den frosne lønbyrde (round(base_value × SALARY_RATE)) pr. hold. Returnerer
// median per-team-lønbyrde (division-blind) + populations-statistik.
function computeFreshSalaryBurden() {
  const model = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderValuationModel.json"), "utf8"));
  const baseline = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderTypesBaseline.json"), "utf8"));

  const { riders } = generateLaunchPopulation();
  const pool = [];
  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    const abilities = deriveAbilities({}, { ...r, id: `fic-${i}` }, { asOfYear: REFERENCE_YEAR });
    const { primary } = computeRiderTypes(abilities, baseline);
    const visible = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) visible[k] = abilities[k];
    // base_value === market_value ved seed (prize_earnings_bonus = 0).
    const base_value = Math.round(predictBaseValue({ primary_type: primary.key }, visible, model) ?? 0);
    const age = r._meta?.age ?? (REFERENCE_YEAR - new Date(r.birthdate).getFullYear());
    pool.push({ id: `fic-${i}`, age, potentiale: Number(r.potentiale), base_value });
  }

  const teamIds = Array.from({ length: RELAUNCH_TEAM_COUNT }, (_, i) => `team-${i}`);
  const { assignments, leftToMarket, stats } = allocateStarterSquads(pool, teamIds);
  const byId = new Map(pool.map((p) => [p.id, p]));

  const burdens = teamIds.map((t) =>
    assignments[t].reduce(
      (s, id) => s + computeFrozenSalary({ base_value: byId.get(id).base_value, prize_earnings_bonus: 0 }),
      0
    )
  );
  const squadSizes = teamIds.map((t) => assignments[t].length);

  return {
    populationSize: pool.length,
    teamCount: RELAUNCH_TEAM_COUNT,
    squadSize: STARTER_SQUAD.CORE_SIZE,
    minSquadSize: Math.min(...squadSizes),
    maxSquadSize: Math.max(...squadSizes),
    burdenMin: Math.min(...burdens),
    burdenMedian: median(burdens),
    burdenMean: Math.round(burdens.reduce((a, b) => a + b, 0) / burdens.length),
    burdenMax: Math.max(...burdens),
    leftToMarket: leftToMarket.length,
    fairnessSpread: Math.round(stats.maxSquadBaseValue - stats.minSquadBaseValue),
  };
}

function printSyntheticSection(fresh, overrides) {
  const SPONSOR_INCOME_BY_DIVISION = overrides.sponsorBase;
  const UPKEEP_BY_DIVISION = overrides.upkeep;
  const usingOverride =
    SPONSOR_INCOME_BY_DIVISION[1] !== 600000 || SPONSOR_INCOME_BY_DIVISION[2] !== 400000 ||
    SPONSOR_INCOME_BY_DIVISION[3] !== 340000 || UPKEEP_BY_DIVISION[1] !== 440000;

  console.log("=== #1441 money-supply-scorecard — (A) SYNTETISK fresh-population (PRIMÆR gate) ===\n");
  if (usingOverride) {
    console.log(`OVERRIDE AKTIV (kalibrering): sponsor D1=${SPONSOR_INCOME_BY_DIVISION[1]}/D2=${SPONSOR_INCOME_BY_DIVISION[2]}/D3=${SPONSOR_INCOME_BY_DIVISION[3]} · upkeep D1=${UPKEEP_BY_DIVISION[1]}/D2=${UPKEEP_BY_DIVISION[2]}/D3=${UPKEEP_BY_DIVISION[3]} (prod uændret)\n`);
  }

  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Roster-størrelse        : ${fresh.squadSize} ryttere/hold (starterSquadAllocator.CORE_SIZE)`);
  console.log(`                              division-BLIND allokering → samme lønbyrde i alle divisioner`);
  console.log(`  • Lønrate                 : ${SALARY_RATE} × market_value (= base_value ved seed; frossen ved signering)`);
  console.log(`  • Manager-hold ved launch : ${fresh.teamCount} (relaunch-rehearsal 2026-06-11)`);
  console.log(`  • Præmie-estimat (BLØDT)  : D1 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[3])}`);
  console.log(`                              proxy: contract-sim repræsentativ kompetent-hold-præmie (IKKE målt)`);
  console.log();

  console.log(`Fresh lønbyrde pr. hold (${fresh.populationSize} ryttere, ${fresh.leftToMarket} til markedet):`);
  console.log(`  min=${fmt(fresh.burdenMin)}  median=${fmt(fresh.burdenMedian)}  mean=${fmt(fresh.burdenMean)}  max=${fmt(fresh.burdenMax)}`);
  console.log(`  (squad-size faktisk ${fresh.minSquadSize}-${fresh.maxSquadSize}; fairness-spread ${fmt(fresh.fairnessSpread)} base_value)`);
  console.log();

  const salary = fresh.burdenMedian; // repræsentativ (division-blind)
  console.log("Per-division syntetisk net/sæson (no-engangs-konfig):");
  console.log("─────────────────────────────────────────────────────────────────────");

  let allPass = true;
  const nets = {};
  for (const d of [1, 2, 3]) {
    // #1663 renown-sponsor: friske hold har INGEN resultat-historik (standing=null) →
    // resultsScore=0 → multiplier=1,0 → sponsor = division-base UÆNDRET. Vi kalder den
    // delte renownSponsorFor for at bevise det per konstruktion (ikke for at ændre tallet):
    // fresh-gaten må aldrig regressere af renown-skalering.
    const sponsor = renownSponsorFor({
      divisionBase: SPONSOR_INCOME_BY_DIVISION[d] || 0,
      standing: null,
      divisionStandings: [],
      wResults: overrides.wResults,
      maxMultiplier: overrides.maxMultiplier,
    });
    const upkeep = UPKEEP_BY_DIVISION[d] || 0;
    const prize = PRIZE_ESTIMATE_BY_DIVISION[d] || 0;
    const net = sponsor + prize - salary - upkeep;
    nets[d] = net;

    let gateLabel, gatePass;
    if (d === 1) {
      const tolerance = sponsor * 0.05;
      gatePass = Math.abs(net) <= tolerance;
      gateLabel = `|net| ≤ ${fmt(tolerance)} (±5% sponsor)`;
    } else {
      gatePass = net >= 0 && net <= 30000;
      gateLabel = "net ∈ [0, +30.000]";
    }
    if (!gatePass) allPass = false;

    console.log(
      `  D${d}: sponsor ${fmt(sponsor)} + præmie ${fmt(prize)} − løn ${fmt(salary)} − upkeep ${fmt(upkeep)} = net ${fmt(net)}`
    );
    console.log(`       Gate [${gateLabel}]: ${gatePass ? "✅ PASS" : "❌ FAIL — juster konstanter"}`);
  }
  console.log("─────────────────────────────────────────────────────────────────────");

  // §2.1 sanity: median-balance ≤ 1,3× start ved sæson 5 (balance vokser med net/sæson).
  console.log("\n§2.1 sanity — balance-trajektorie (balance += net/sæson, 4 transitioner til S5):");
  let trajPass = true;
  for (const d of [1, 2, 3]) {
    const bal5 = INITIAL_BALANCE + 4 * nets[d];
    const ratio = bal5 / INITIAL_BALANCE;
    const ok = ratio <= 1.3;
    if (!ok) trajPass = false;
    console.log(`  D${d}: balance@S5 ≈ ${fmt(bal5)} (${ratio.toFixed(2)}× start) ${ok ? "✅" : "❌ >1,3×"}`);
  }

  // Sensitivitet på det bløde præmie-input.
  console.log("\nSensitivitet — præmie-estimat (det blødeste input):");
  for (const mult of [0, 0.5, 1, 1.5, 2]) {
    const row = [1, 2, 3].map((d) => {
      const net = (SPONSOR_INCOME_BY_DIVISION[d] || 0) + (PRIZE_ESTIMATE_BY_DIVISION[d] || 0) * mult - salary - (UPKEEP_BY_DIVISION[d] || 0);
      return `D${d}=${fmt(net)}`;
    });
    console.log(`  præmie ×${mult}: ${row.join("  ")}`);
  }

  console.log(
    `\nSamlet syntetisk gate: ${allPass && trajPass ? "✅ PASS — klar til relaunch" : "❌ FAIL — se ❌ ovenfor"}`
  );
  console.log(
    "Note: D1 break-even (net≈0) by design (§2.2 progressiv fordeling); D2/D3 lille positiv buffer."
  );
  console.log(
    "      Et hold der tjener 0 i præmie kører managed deficit (absorberet af 800k start) — by design."
  );
  console.log("      Ejer reviewer og godkender FØR relaunch.\n");

  return { allPass: allPass && trajPass, nets, salary };
}

// ── FOREVER-RELAUNCH 4-DIVISIONS-FORSLAG (#1663 forever-frys, Task 8) ─────────────
// Modellerer en 4-tier/15-pulje-pyramide klar til 100 managers og FORESLÅR div-4-
// net-konstanter. Lønbyrden er DIVISION-BLIND og en egenskab ved den repræsentative
// kompetent-roster (ikke ved populationsstørrelsen): vi genbruger derfor den SAMME
// kalibrerede burdenMedian som 3-division-gaten, så div-4-forslaget er direkte
// sammenligneligt med den allerede ejer-godkendte D1-D3-kalibrering (kun sponsor/
// upkeep/præmie varierer pr. tier). Det BLØDESTE input er præmie-estimatet (tier 4
// = 10k, antaget under D3) — sensitiviteten udskrives så ejeren ser robustheden.
function printTiers4Section(fresh, overrides) {
  // D1-D3 = prod-konstanterne (evt. override); D4 = FORSLAGET.
  const sponsorByDiv = {
    1: overrides.sponsorBase[1] ?? SPONSOR_INCOME_BY_DIVISION[1],
    2: overrides.sponsorBase[2] ?? SPONSOR_INCOME_BY_DIVISION[2],
    3: overrides.sponsorBase[3] ?? SPONSOR_INCOME_BY_DIVISION[3],
    4: TIERS4_PROPOSED.sponsor,
  };
  const upkeepByDiv = {
    1: overrides.upkeep[1] ?? UPKEEP_BY_DIVISION[1],
    2: overrides.upkeep[2] ?? UPKEEP_BY_DIVISION[2],
    3: overrides.upkeep[3] ?? UPKEEP_BY_DIVISION[3],
    4: TIERS4_PROPOSED.upkeep,
  };
  const debtCeilingByDiv = { ...DEBT_CEILING_BY_DIVISION, 4: TIERS4_PROPOSED.debtCeiling };

  const salary = fresh.burdenMedian; // division-blind repræsentativ lønbyrde (samme model)

  // Pulje→manager-fordeling (proportional med pulje-antal pr. tier).
  const totalPools = Object.values(TIERS4_POOLS_BY_DIVISION).reduce((a, b) => a + b, 0);
  const managersByDiv = {};
  let allocated = 0;
  for (const d of [1, 2, 3]) {
    managersByDiv[d] = Math.round((TIERS4_POOLS_BY_DIVISION[d] / totalPools) * TIERS4_TARGET_MANAGERS);
    allocated += managersByDiv[d];
  }
  managersByDiv[4] = TIERS4_TARGET_MANAGERS - allocated; // resten i bunden (overflow-tier)

  console.log("=== FOREVER-RELAUNCH 4-DIVISIONS-FORSLAG (#1663 forever-frys, Task 8) ===\n");
  console.log("Antagelser (eksplicitte — ejer granit-fryser):");
  console.log(`  • Pyramide               : 4 tiers, ${totalPools} puljer (tier 1×${TIERS4_POOLS_BY_DIVISION[1]}/2×${TIERS4_POOLS_BY_DIVISION[2]}/3×${TIERS4_POOLS_BY_DIVISION[3]}/4×${TIERS4_POOLS_BY_DIVISION[4]})`);
  console.log(`  • Population             : ${TIERS4_TARGET_MANAGERS} managers fordelt T1=${managersByDiv[1]}/T2=${managersByDiv[2]}/T3=${managersByDiv[3]}/T4=${managersByDiv[4]} (∝ pulje-antal)`);
  console.log(`  • Roster-størrelse       : ${fresh.squadSize} ryttere/hold (starterSquadAllocator.CORE_SIZE), division-BLIND`);
  console.log(`  • Lønbyrde (repræsentativ): ${fmt(salary)}/hold — SAMME kalibrerede model som D1-D3-gaten`);
  console.log(`                             (egenskab ved kompetent-roster, IKKE ved populationsstørrelse)`);
  console.log(`  • Lønrate                : ${SALARY_RATE} × market_value`);
  console.log(`  • Præmie-estimat (BLØDT) : D1 ${fmt(TIERS4_PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(TIERS4_PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(TIERS4_PRIZE_ESTIMATE_BY_DIVISION[3])} / D4 ${fmt(TIERS4_PRIZE_ESTIMATE_BY_DIVISION[4])}`);
  console.log(`                             tier 4 (bunden) ANTAGET under D3 (få/ingen point i bunden)`);
  console.log();

  console.log("FORSLAG — div-4 net-konstanter (granit-frys-kandidat):");
  console.log(`  SPONSOR_INCOME_BY_DIVISION[4] = ${fmt(TIERS4_PROPOSED.sponsor)}   (D3=${fmt(SPONSOR_INCOME_BY_DIVISION[3])} → bunden lavere)`);
  console.log(`  UPKEEP_BY_DIVISION[4]         = ${fmt(TIERS4_PROPOSED.upkeep)}         (D3=${fmt(UPKEEP_BY_DIVISION[3])} → gulv, konveks blød bund)`);
  console.log(`  DEBT_CEILING_BY_DIVISION[4]   = ${fmt(TIERS4_PROPOSED.debtCeiling)}   (D3=${fmt(DEBT_CEILING_BY_DIVISION[3])} → bunden låner mindst)`);
  console.log(`  DIVISION_BONUSES[4]           = [${TIERS4_PROPOSED.bonuses.map(fmt).join(", ")}]   (D3=[75.000, 50.000, 25.000])`);
  console.log();

  console.log("Per-tier syntetisk net/sæson (4-division-modellen):");
  console.log("─────────────────────────────────────────────────────────────────────");
  const nets = {};
  let allPass = true;
  for (const d of [1, 2, 3, 4]) {
    const sponsor = renownSponsorFor({
      divisionBase: sponsorByDiv[d],
      standing: null,
      divisionStandings: [],
      wResults: overrides.wResults,
      maxMultiplier: overrides.maxMultiplier,
    });
    const upkeep = upkeepByDiv[d];
    const prize = TIERS4_PRIZE_ESTIMATE_BY_DIVISION[d];
    const net = sponsor + prize - salary - upkeep;
    nets[d] = net;

    let gateLabel, gatePass;
    if (d === 1) {
      const tolerance = sponsor * 0.05;
      gatePass = Math.abs(net) <= tolerance;
      gateLabel = `|net| ≤ ${fmt(tolerance)} (±5% sponsor)`;
    } else {
      gatePass = net >= 0 && net <= 30000;
      gateLabel = "net ∈ [0, +30.000]";
    }
    if (!gatePass) allPass = false;

    const tag = d === 4 ? " ◄ FORSLAG" : "";
    console.log(
      `  D${d}: sponsor ${fmt(sponsor)} + præmie ${fmt(prize)} − løn ${fmt(salary)} − upkeep ${fmt(upkeep)} = net ${fmt(net)}${tag}`
    );
    console.log(`       Gate [${gateLabel}]: ${gatePass ? "✅ PASS" : "❌ FAIL — juster konstant"}`);
  }
  console.log("─────────────────────────────────────────────────────────────────────");

  // KRITISK krav: et kompetent div-4-hold må ALDRIG garanteret gå konkurs.
  // Bevis: prize=0 (et hold der scorer NUL point) — hvor mange sæsoner før 800k er væk?
  const d4Sponsor = renownSponsorFor({
    divisionBase: sponsorByDiv[4], standing: null, divisionStandings: [],
    wResults: overrides.wResults, maxMultiplier: overrides.maxMultiplier,
  });
  const d4NetZeroPrize = d4Sponsor + 0 - salary - upkeepByDiv[4];
  console.log("\nKRITISK — indgangs-tier-bæredygtighed (et kompetent D4-hold må ikke garanteret gå konkurs):");
  console.log(`  D4 net ved præmie=0 (nul-scorende hold): ${fmt(d4NetZeroPrize)}/sæson`);
  if (d4NetZeroPrize >= 0) {
    console.log(`  → IKKE-NEGATIVT selv uden præmie ✅ — bunden er bæredygtig uden at score et eneste point.`);
  } else {
    const seasonsToZero = Math.floor(INITIAL_BALANCE / -d4NetZeroPrize);
    console.log(`  → ${seasonsToZero} sæsoners buffer fra 800k-start før balance rammer 0 (managed deficit, by design).`);
    console.log(`  → INGEN garanteret konkurs ${seasonsToZero >= 5 ? "✅" : "❌ for kort buffer"} (krav: kompetent hold overlever uden point).`);
  }

  // §2.1 sanity: balance-trajektorie (4 transitioner til S5).
  console.log("\n§2.1 sanity — balance-trajektorie (balance += net/sæson, 4 transitioner til S5):");
  let trajPass = true;
  for (const d of [1, 2, 3, 4]) {
    const bal5 = INITIAL_BALANCE + 4 * nets[d];
    const ratio = bal5 / INITIAL_BALANCE;
    const ok = ratio <= 1.3;
    if (!ok) trajPass = false;
    console.log(`  D${d}: balance@S5 ≈ ${fmt(bal5)} (${ratio.toFixed(2)}× start) ${ok ? "✅" : "❌ >1,3×"}`);
  }

  // Sensitivitet på det bløde præmie-input (specielt tier 4).
  console.log("\nSensitivitet — præmie-estimat (det blødeste input):");
  for (const mult of [0, 0.5, 1, 1.5, 2]) {
    const row = [1, 2, 3, 4].map((d) => {
      const net = sponsorByDiv[d] + TIERS4_PRIZE_ESTIMATE_BY_DIVISION[d] * mult - salary - upkeepByDiv[d];
      return `D${d}=${fmt(net)}`;
    });
    console.log(`  præmie ×${mult}: ${row.join("  ")}`);
  }

  console.log(
    `\n4-divisions-gate: ${allPass && trajPass ? "✅ PASS — div-4-forslag bæredygtigt" : "❌ FAIL — se ❌ ovenfor"}`
  );
  console.log(
    "Note: tallene er et FORSLAG — landes IKKE i economyConstants.js her (ejer granit-fryser FØR forever)."
  );
  console.log(
    `      Negativ-rente=${(NEGATIVE_BALANCE_INTEREST_RATE * 100).toFixed(0)}%; debt-ceiling[4]=${fmt(debtCeilingByDiv[4])} guarder bundens gæld.`
  );
  console.log("      Ejer reviewer og godkender FØR granit-frys.\n");

  return { allPass: allPass && trajPass, nets, salary, proposed: TIERS4_PROPOSED };
}

// ── (B) LIVE-snapshot (reference only) ──────────────────────────────────────────
async function printLiveSection() {
  dotenv.config({
    path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"),
    quiet: true,
  });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_READONLY_KEY) {
    console.log("=== (B) LIVE-snapshot — SPRUNGET OVER (mangler readonly-env) ===");
    console.log("    SUPABASE_URL / SUPABASE_READONLY_KEY ikke sat (.codex.local/supabase-readonly.env).\n");
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_READONLY_KEY);

  // Kanonisk billable-filter (§2.6): is_ai=false AND is_test_account=false AND is_frozen=false,
  // har user_id, ikke bank. Read-only bypasser RLS → gentag diskriminatoren eksplicit.
  const allTeams = await fetchAll(
    supabase,
    "teams",
    "id, balance, division, is_ai, is_bank, is_test_account, is_frozen, user_id"
  );
  const teams = allTeams.filter(
    (t) => t.user_id != null && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen
  );
  const teamIds = teams.map((t) => t.id);

  const [allRiders, tx] = await Promise.all([
    fetchAll(supabase, "riders", "team_id, salary"),
    fetchAll(supabase, "finance_transactions", "team_id, amount", (q) => q.in("team_id", teamIds)),
  ]);
  const teamIdSet = new Set(teamIds);
  const riders = allRiders.filter((r) => teamIdSet.has(r.team_id));

  const sumByTeam = new Map();
  for (const r of tx) sumByTeam.set(r.team_id, (sumByTeam.get(r.team_id) || 0) + (r.amount || 0));
  let driftTeams = 0;
  for (const t of teams) {
    const expected = INITIAL_BALANCE + (sumByTeam.get(t.id) || 0);
    if (Math.abs(t.balance - expected) > 0) driftTeams++;
  }
  const aggregateSupply = teams.reduce((s, t) => s + (t.balance || 0), 0);

  const salaryByTeam = new Map();
  for (const r of riders) salaryByTeam.set(r.team_id, (salaryByTeam.get(r.team_id) || 0) + (r.salary || 0));

  console.log(`=== (B) LIVE-snapshot (old frozen salaries — REFERENCE ONLY, ${teams.length} hold) ===\n`);
  console.log(`Aggregat pengemængde : ${fmt(aggregateSupply)} CZ$`);
  console.log(
    `Konserverings-drift  : ${driftTeams} hold med uventet balance ${driftTeams === 0 ? "✅" : "❌ (ledger ude af sync)"}`
  );
  console.log();
  console.log("Per-division median-balance + live-lønbyrde (IKKE en gate — gammel frossen skala):");
  for (const d of [1, 2, 3]) {
    const divTeams = teams.filter((t) => t.division === d);
    if (!divTeams.length) {
      console.log(`  D${d}: ingen rigtige hold i live-populationen`);
      continue;
    }
    const medBalance = median(divTeams.map((t) => t.balance || 0));
    const medSalary = median(divTeams.map((t) => salaryByTeam.get(t.id) || 0));
    console.log(
      `  D${d}: n=${divTeams.length}  median-balance=${fmt(medBalance)} (${(medBalance / INITIAL_BALANCE).toFixed(2)}× start)  median-løn=${fmt(medSalary)}`
    );
  }
  console.log(
    "\nNote: live-lønninger er FROSSET på den GAMLE skala (signeret før 0.067-retunen) → ikke"
  );
  console.log(
    "      repræsentative for fresh relaunch. Kalibreringen sker mod (A) syntetisk, ikke (B) live."
  );
  console.log(`      Præmie-per-point=${fmt(PRIZE_PER_POINT)}, løn-rate=${SALARY_RATE}.\n`);
}

async function main() {
  const syntheticOnly = process.argv.includes("--synthetic-only");
  const tiers4 = process.argv.includes("--tiers4");

  const overrides = resolveOverrides();
  const fresh = computeFreshSalaryBurden();
  const syntheticResult = printSyntheticSection(fresh, overrides);

  let tiers4Result = null;
  if (tiers4) {
    console.log();
    tiers4Result = printTiers4Section(fresh, overrides);
  }

  if (!syntheticOnly) {
    await printLiveSection();
  }

  console.log(
    `HEADLINE: syntetisk net-gate ${syntheticResult.allPass ? "✅ PASS" : "❌ FAIL"} (primær). Live er reference only.`
  );
  if (tiers4Result) {
    console.log(
      `HEADLINE (4-div-forslag): div-4-net-gate ${tiers4Result.allPass ? "✅ PASS" : "❌ FAIL"} — FORSLAG, ejer granit-fryser.`
    );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
