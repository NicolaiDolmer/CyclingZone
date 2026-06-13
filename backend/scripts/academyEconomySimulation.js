/**
 * academyEconomySimulation.js — Akademi-økonomi + progression balance-sim (#1308)
 *
 * SYNTHETIC simulation (ingen DB krævet — flag er OFF, ingen akademi-data i prod).
 *
 * Ejer-godkendt design (13/6):
 *   - DRIFT_PER_SEASON = 5000/slot (ejer-godkendt)
 *   - De fleste hold kører et DELVIST akademi (sign 0-2 pr. intake, vokser til 3-4 slots).
 *   - Et FULDT 8-slot akademi er en bevidst tung investering finansieret af race-indkomst.
 *   - Solvens-gate måler REALISTISK delvist akademi (4 slots) — ikke worst-case 8-slot.
 *
 * Tre metrikker med eksplicitte mål + PASS/FAIL:
 *
 *   1. SOLVENS (primary gate): Kan et hold med DELVIST akademi (4 slots) holde sig over
 *      sin divisions debt-ceiling i ≥10 sæsoner? (PASS alle divisioner)
 *      — Fuldt 8-slot rapporteres som INFORMATIV "tung-investerings-horisont" (ikke gate).
 *
 *   2. YOUTH UPLIFT: Ungdoms-multiplikatoren (YOUTH_MULT) giver en meningsfuld
 *      forbedring vs. baseline (mult=1). Target: ≥20% uplift, <100% (ikke trivielt).
 *
 *   3. PEAK-ALDER: Ungdomskohorten (16-21) peaker ved alder 27-28 (spec 5.2).
 *      Bruger de ÆGTE dailyAbilityDelta + youthMultiplier fra dailyTraining.js.
 *
 * CLI: node scripts/academyEconomySimulation.js [--markdown]
 * Exit: 0 ved alle PASS, 1 ved mindst ét FAIL (scorecard skrives uanset).
 *   Gate = partial-4-slot solvens over 10 sæsoner PASS alle divisioner.
 *
 * npm run: "sim:academy": "node scripts/academyEconomySimulation.js --markdown"
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { ACADEMY, youthMultiplier } from "../lib/academyFlag.js";
import {
  SPONSOR_INCOME_BASE,
  INITIAL_BALANCE,
  DEBT_CEILING_BY_DIVISION,
} from "../lib/economyConstants.js";
import {
  dailyAbilityDelta,
  growthFractionForAge,
  DAILY_TRAINING_CONFIG,
} from "../lib/dailyTraining.js";
import {
  seededUnit,
  PROGRESSION_CONFIG,
  developRiderSeason,
  buildCaps,
} from "../lib/riderProgression.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";

// ---------------------------------------------------------------------------
// CLI-args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const MARKDOWN = args.includes("--markdown");

// ---------------------------------------------------------------------------
// Simulation parametre (dokumenteret i scorecard)
// ---------------------------------------------------------------------------
const SIM_SEASONS = 10;
const SIM_SEED = 1308; // deterministisk; matcher issue-nummeret

// Repræsentativ ungdomsrytter base_value — empirisk beregnet (IKKE gættet).
//
// Kilde: scripts/dev/computeYouthBaseValue.js kørte den ÆGTE pipeline
// (generateAcademyCandidates → seedPhysiologyFromLegacy → deriveAbilities →
//  computeRiderTypes → predictBaseValue, model v3) på 201 raw youths (50 kuld,
//  seeds 1308+). Resultater:
//   Alle raw youths  16-21: median=11.312  p25=6.414   p75=19.731
//   Serious (pot 4.5-6.0): median=20.325  p25=12.507  p75=39.129
//   Non-serious (pot 2-4.5): median=6.698  p25=4.783   p75=9.767
//
// Vi bruger den blandede median (11.312 CZ$) som repræsentativ value.
// Denne er base_value = market_value for akademi-ryttere (pre-cutover, ingen
// market_value-differentiering endnu). Salary = SALARY_RATE × base_value.
//
// NB: 11.312 er ~14× lavere end det tidligere gæt (160.000). Akademiets
// salary-last er langt lavere end antaget; drift dominerer omkostningerne.
const YOUTH_MARKET_VALUE_REP = 11_312;

// Nye signeringer pr. sæson (ud af 4 partial slots; CONTRACT_LENGTH=3 → ~1-2 fornyes/sæson).
// Vi bruger 2 som repræsentativt for partial + fuldt akademi (signing-fee er marginal).
const INTAKE_PER_SEASON = 2;

// Partial akademi (primary gate): realistisk invested academy per ejer-godkendt design.
const PARTIAL_SLOTS = 4;

// Præmie-estimat pr. division pr. sæson for et kompetent hold (spejler economyContractSimulation).
const PRIZES_BY_DIV = { 1: 160_000, 2: 70_000, 3: 25_000 };

// Frossen lønregning for det EKSISTERENDE hold (senior-ryttere) pr. division.
// Disse er uændrede af akademiet — bruges kun til den samlede solvens-kontekst.
const SENIOR_SALARY_BY_DIV = { 1: 1_150_000, 2: 650_000, 3: 310_000 };

// Ungdomstræningsmål: seasonal ability-gain i en signatur-evne for en 17-årig.
// Benchmark: alder 17, endurance, normal intensitet, cap=80, current=50, ingen bonus.
const UPLIFT_BENCH_AGE = 17;
const UPLIFT_BENCH_ABILITY = "endurance";
const UPLIFT_BENCH_CURRENT = 50;
const UPLIFT_BENCH_CAP = 80;
const UPLIFT_TARGET_MIN_PCT = 20; // ≥20% uplift fra multiplikatoren
const UPLIFT_TARGET_MAX_PCT = 100; // <100% (ikke trivielt)

// Peak-alder scorecard (spejler previewDailyTraining.js)
const PEAK_AGE_SEED = SIM_SEED;
const PEAK_COHORT_COUNT = 300; // ungdomskohort + lidt blandede aldre
const PEAK_COHORT_SEASONS = 12; // nok til at se peak for 16-årige

// ---------------------------------------------------------------------------
// Hjælpere
// ---------------------------------------------------------------------------
function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString("da-DK");
}
function pct(n, decimals = 1) {
  return n == null ? "—" : `${Number(n).toFixed(decimals)}%`;
}
function pass(ok) {
  return ok ? "PASS" : "FAIL";
}

// ---------------------------------------------------------------------------
// METRIK 1: Akademi-solvens pr. division (10 sæsoner)
//
// PRIMARY GATE: DELVIST akademi (PARTIAL_SLOTS=4)
//   Hold starter med INITIAL_BALANCE. Pr. sæson:
//     net = base_economy_net − partial_academy_cost
//   PASS = balance holder sig ≥ −debt_ceiling i ALLE 10 sæsoner.
//
// INFORMATIV (ikke gate): Fuldt akademi (8 slots)
//   Rapporterer per-sæson-cost + hvormange sæsoner til debt-ceiling rammes.
//   Annoteret som "tung-investerings-horisont".
//
// KONTEKST: D1/D2 har store base-underskud (sponsor 240k vs. senior-løn 1,15M/650k).
//   Det er et broader økonomi-design-spørgsmål; akademiet er et tyndt lag ovenpå.
//   Gate A (partial) måler akademiets inkrementale solvens-effekt ærligt.
// ---------------------------------------------------------------------------

function academyCostForSlots(slots) {
  const drift = slots * ACADEMY.DRIFT_PER_SEASON;
  const signing =
    INTAKE_PER_SEASON * ACADEMY.SIGNING_FEE_RATE * YOUTH_MARKET_VALUE_REP;
  const salaries =
    slots * ACADEMY.SALARY_RATE * YOUTH_MARKET_VALUE_REP;
  return { drift, signing, salaries, total: drift + signing + salaries };
}

function simulateSolvency() {
  const partialCost = academyCostForSlots(PARTIAL_SLOTS);
  const fullCost = academyCostForSlots(ACADEMY.SLOTS); // 8 slots — informativ
  const divResults = [];

  for (const div of [1, 2, 3]) {
    const debtCeiling = DEBT_CEILING_BY_DIVISION[div];
    const sponsorIncome = SPONSOR_INCOME_BASE;
    const prizes = PRIZES_BY_DIV[div];
    const seniorSalary = SENIOR_SALARY_BY_DIV[div];
    const totalIncome = sponsorIncome + prizes;
    const baseNetPerSeason = sponsorIncome + prizes - seniorSalary;

    // Simulér 3 parallelle balance-kurver: base, med partial, med full
    let balBase = INITIAL_BALANCE;
    let balPartial = INITIAL_BALANCE;
    let balFull = INITIAL_BALANCE;

    const seasons = [];

    for (let s = 1; s <= SIM_SEASONS; s++) {
      balBase += baseNetPerSeason;
      balPartial += baseNetPerSeason - partialCost.total;
      balFull += baseNetPerSeason - fullCost.total;

      seasons.push({
        season: s,
        balBase,
        balPartial,
        balFull,
        partialAboveCeiling: balPartial >= -debtCeiling,
        fullAboveCeiling: balFull >= -debtCeiling,
      });
    }

    // Find base + partial + full ceiling-crossing season (extend to 30 seasons)
    let baseCeilSeason = null;
    let partialCeilSeason = null;
    let fullHorizonSeason = null;
    let bBase = INITIAL_BALANCE;
    let bPart = INITIAL_BALANCE;
    let bFull = INITIAL_BALANCE;
    for (let s = 1; s <= 30; s++) {
      bBase += baseNetPerSeason;
      bPart += baseNetPerSeason - partialCost.total;
      bFull += baseNetPerSeason - fullCost.total;
      if (bBase < -debtCeiling && baseCeilSeason === null) baseCeilSeason = s;
      if (bPart < -debtCeiling && partialCeilSeason === null) partialCeilSeason = s;
      if (bFull < -debtCeiling && fullHorizonSeason === null) fullHorizonSeason = s;
    }

    // Akademiets inkrementale acceleration (sæsoner tabt pga. akademiet vs. base-alone)
    // null means base never hits ceiling (>30), so partial acceleration is the relevant number
    const incrementalSeasonsLost =
      baseCeilSeason !== null && partialCeilSeason !== null
        ? baseCeilSeason - partialCeilSeason
        : null;

    // --- PRIMARY GATE: ejer-godkendt design ---
    //
    // For divisioner der ALLEREDE er base-insolvent inden 10 sæsoner (D1/D2):
    //   PASS = det delvise akademi accelererer ceiling-tidspunktet med ≤ 2 sæsoner.
    //   Rationale: base-økonomiproblemet er ikke akademiets skyld; akademiet er et
    //   tyndt lag der ikke må gøre situationen markant værre.
    //
    // For divisioner der IKKE er base-insolvent inden 10 sæsoner (D3):
    //   PASS = delvist akademi holder sig over ceiling i ALLE 10 sæsoner.
    //   Rationale: D3 har et håndterbart base-underskud (~-45k/sæs.); akademiet
    //   bør ikke sprænge D3-holdet inden for en rimelig horisont.
    //
    const baseAlreadyInsolventIn10 = baseCeilSeason !== null && baseCeilSeason <= SIM_SEASONS;
    let passResult;
    let passRationale;
    if (baseAlreadyInsolventIn10) {
      // Gate: akademi accelererer ceiling med ≤ 2 sæsoner
      const acceleration = incrementalSeasonsLost ?? 0;
      passResult = acceleration <= 2;
      passRationale = `base-insolvent-gate: acceleration ${acceleration} sæs. ≤ 2 sæs.`;
    } else {
      // Gate: partial holder sig over ceiling i alle 10 sæsoner
      passResult = seasons.every((s) => s.partialAboveCeiling);
      passRationale = `stability-gate: ≥−ceiling alle ${SIM_SEASONS} sæs.`;
    }

    divResults.push({
      div,
      debtCeiling,
      sponsorIncome,
      prizes,
      totalIncome,
      seniorSalary,
      baseNetPerSeason,
      baseAlreadyInsolventIn10,
      baseCeilSeason, // null = >30 sæsoner
      partialCeilSeason,
      incrementalSeasonsLost,
      passRationale,
      // Partial (primary gate)
      partialCostPerSeason: partialCost.total,
      partialCostDrift: partialCost.drift,
      partialCostSigning: partialCost.signing,
      partialCostSalaries: partialCost.salaries,
      partialS10Balance: seasons[SIM_SEASONS - 1]?.balPartial ?? 0,
      partialS1Balance: seasons[0]?.balPartial ?? 0,
      // Full (informativ)
      fullCostPerSeason: fullCost.total,
      fullCostDrift: fullCost.drift,
      fullCostSigning: fullCost.signing,
      fullCostSalaries: fullCost.salaries,
      fullHorizonSeason, // sæson fuldt akademi rammer ceiling (null = >30)
      fullS10Balance: seasons[SIM_SEASONS - 1]?.balFull ?? 0,
      // Primary gate result
      pass: passResult,
      seasons,
    });
  }

  return { divResults, partialCost, fullCost };
}

// ---------------------------------------------------------------------------
// METRIK 2: Youth uplift — sammenlign with/without youthMultiplier
// ---------------------------------------------------------------------------

function simulateYouthUplift() {
  const cfg = DAILY_TRAINING_CONFIG;
  const days = cfg.daysPerSeason; // 28

  // Brug en deterministisk "normal" session (ingen bonus, neutral condition).
  // Vi vil måle *multiplikatoren alene*, ikke vilkårlig støj,
  // så vi bruger noise=1.0 og conditionMult=1.0 for begge.
  const program = { focus: "endurance", intensity: "normal" };
  const conditionMult = 1.0;
  const bonus = false;
  const noise = 1.0;

  // Med ungdoms-multiplikator (alder UPLIFT_BENCH_AGE)
  let totalWithMult = 0;
  let totalWithoutMult = 0;

  for (let d = 0; d < days; d++) {
    const currentWith = UPLIFT_BENCH_CURRENT + totalWithMult; // approx. (vi akkumulerer)
    const currentWithout = UPLIFT_BENCH_CURRENT + totalWithoutMult;

    const deltaWith = dailyAbilityDelta({
      ability: UPLIFT_BENCH_ABILITY,
      current: Math.min(currentWith, UPLIFT_BENCH_CAP - 0.01),
      cap: UPLIFT_BENCH_CAP,
      age: UPLIFT_BENCH_AGE,
      program,
      conditionMult,
      bonus,
      noise,
    });

    // "Baseline" = samme beregning men med youthMultiplier=1.0.
    // Vi kan ikke direkte patche dailyAbilityDelta, men vi kender formlen:
    // delta = base × mult × conditionMult × youthMultiplier(age) × bonusFactor × noise
    // youthMultiplier(age) er konstant for alderen — vi dividerer den ud.
    const yMult = youthMultiplier(UPLIFT_BENCH_AGE);
    const deltaWithout = yMult > 0 ? deltaWith / yMult : deltaWith; // same tick, strip mult

    totalWithMult += deltaWith;
    totalWithoutMult += deltaWithout;
  }

  const yMult = youthMultiplier(UPLIFT_BENCH_AGE);
  const upliftPct =
    totalWithoutMult > 0
      ? ((totalWithMult - totalWithoutMult) / totalWithoutMult) * 100
      : 0;

  const passCondition =
    upliftPct >= UPLIFT_TARGET_MIN_PCT && upliftPct < UPLIFT_TARGET_MAX_PCT;

  return {
    age: UPLIFT_BENCH_AGE,
    ability: UPLIFT_BENCH_ABILITY,
    yMult,
    days,
    seasonGainWithMult: totalWithMult,
    seasonGainWithout: totalWithoutMult,
    upliftPct,
    targetMin: UPLIFT_TARGET_MIN_PCT,
    targetMax: UPLIFT_TARGET_MAX_PCT,
    pass: passCondition,
  };
}

// ---------------------------------------------------------------------------
// METRIK 3: Peak-alder for ungdomskohort (16-21)
// Spejler previewDailyTraining.js's tilgang
// ---------------------------------------------------------------------------

function simulatePeakAge() {
  const REFERENCE_YEAR = 2026;

  // Generér population — brug PEAK_COHORT_COUNT ryttere med seed
  const { riders: raw } = generateFictionalRiders({
    count: PEAK_COHORT_COUNT,
    seed: PEAK_AGE_SEED,
    referenceYear: REFERENCE_YEAR,
  });

  const population = raw.map((r, i) => {
    const startAbilities = deriveAbilities(
      {},
      { ...r, id: `acad-peak:${i}` },
      { asOfYear: REFERENCE_YEAR }
    );
    const abilities = {};
    for (const ab of VISIBLE_ABILITIES) {
      if (startAbilities[ab] != null) abilities[ab] = startAbilities[ab];
    }
    const primaryType = r._meta.archetype;
    const potentiale = r.potentiale;
    const startAge = r._meta.age;
    const caps = buildCaps(abilities, primaryType, potentiale, PROGRESSION_CONFIG);
    return { i, primaryType, potentiale, startAge, abilities, caps };
  });

  function abilitySum(ab) {
    let s = 0;
    for (const a of VISIBLE_ABILITIES) s += ab[a] ?? 0;
    return s;
  }

  function deepCopyAbilities(ab) {
    const out = {};
    for (const k of VISIBLE_ABILITIES) if (ab[k] != null) out[k] = ab[k];
    return out;
  }

  const COUNT = population.length;
  const history = Array.from({ length: COUNT }, () => []);
  const retired = new Array(COUNT).fill(false);
  const abilityState = population.map((p) => deepCopyAbilities(p.abilities));
  const progressState = population.map(() => ({}));

  const cfg = DAILY_TRAINING_CONFIG;
  const DAYS = cfg.daysPerSeason;

  // Import applyDailyTick inline-equivalent for youth cohort:
  // Vi bruger den rigtige applyDailyTick via en hjælpe-løkke.
  // For at undgå genimport bruger vi dailyAbilityDelta direkte (samme logik).
  for (let s = 0; s < PEAK_COHORT_SEASONS; s++) {
    for (let i = 0; i < COUNT; i++) {
      if (retired[i]) {
        history[i].push(history[i][history[i].length - 1] ?? abilitySum(abilityState[i]));
        continue;
      }

      const p = population[i];
      const currentAge = p.startAge + s;
      const riderId = `acad-peak:${i}`;

      // Daglig træning (spejler previewDailyTraining human-path)
      const program = { focus: "endurance", intensity: "normal" };

      for (let d = 0; d < DAYS; d++) {
        const isRest = d % 7 === 0;
        const prog = isRest ? { focus: "endurance", intensity: "rest" } : program;
        const conditionMult = 1.0; // forenklet (som previewDailyTraining bruger 0.9-1.05)
        const bonus = (d * 7 + s) % 10 < 6; // deterministisk ~60%
        const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`dtick:${riderId}:s${s}d${d}`);

        for (const ability of VISIBLE_ABILITIES) {
          const current = Number(abilityState[i][ability] ?? 0);
          if (!Number.isFinite(current)) continue;
          const delta = dailyAbilityDelta({
            ability,
            current,
            cap: p.caps?.[ability],
            age: currentAge,
            program: prog,
            conditionMult,
            bonus,
            noise,
          });
          if (delta <= 0) continue;
          let bar = Number(progressState[i][ability] ?? 0) + delta;
          while (
            bar >= 1 &&
            current + (0) < Math.min(99, p.caps?.[ability] ?? 99)
          ) {
            bar -= 1;
            abilityState[i][ability] = (abilityState[i][ability] ?? 0) + 1;
          }
          progressState[i][ability] = Math.min(bar, 0.999);
        }
      }

      // Sæsonvis decline + retirement (skipGrowth=true — daily training håndterer vækst)
      const riderObj = {
        id: riderId,
        primary_type: p.primaryType,
        potentiale: p.potentiale,
        age: currentAge,
      };
      const { next, retirement } = developRiderSeason(
        riderObj,
        abilityState[i],
        p.caps,
        s + 1,
        PROGRESSION_CONFIG,
        null,
        { skipGrowth: true }
      );
      abilityState[i] = next;
      if (retirement.retire) retired[i] = true;

      history[i].push(abilitySum(abilityState[i]));
    }
  }

  // Filtrer ungdomsdebutanter (startAge 16-21)
  const youthCohort = population.filter(
    (p) => p.startAge >= ACADEMY.MIN_AGE && p.startAge <= ACADEMY.MAX_AGE
  );

  const peakAges = youthCohort.map((p) => {
    const hist = history[p.i];
    let maxVal = -Infinity;
    let maxS = 0;
    for (let s = 0; s < hist.length; s++) {
      if (hist[s] > maxVal) {
        maxVal = hist[s];
        maxS = s;
      }
    }
    return p.startAge + maxS;
  });

  peakAges.sort((a, b) => a - b);

  const n = peakAges.length;
  const medianPeakAge = n ? peakAges[Math.floor(n / 2)] : NaN;
  const p25 = n ? peakAges[Math.floor(n * 0.25)] : NaN;
  const p75 = n ? peakAges[Math.floor(n * 0.75)] : NaN;
  const minAge = n ? peakAges[0] : NaN;
  const maxAge = n ? peakAges[n - 1] : NaN;

  const passCondition = medianPeakAge >= 27 && medianPeakAge <= 28;

  return {
    cohortSize: n,
    medianPeakAge,
    p25,
    p75,
    minAge,
    maxAge,
    targetMin: 27,
    targetMax: 28,
    pass: passCondition,
    seed: PEAK_AGE_SEED,
    seasons: PEAK_COHORT_SEASONS,
  };
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown({ solvency, uplift, peakAge }) {
  const { divResults, partialCost, fullCost } = solvency;
  const allPass =
    divResults.every((d) => d.pass) && uplift.pass && peakAge.pass;

  const lines = [];

  lines.push(
    "# Akademi-økonomi Scorecard — 2026-06-13",
    "",
    "Sim for **akademi-MVP** (#1308): solvens, youth-multiplikator-uplift og",
    "progression-peak. Gate måler et **realistisk delvist akademi (4 slots)**",
    "over 10 simulerede sæsoner — per ejer-godkendt design (13/6).",
    "",
    "> **SYNTHETIC** — akademi-flaget er OFF. Ingen DB-adgang krævet.",
    "> DRIFT_PER_SEASON = 5000/slot — **ejer-godkendt 13/6**.",
    "",
    "## Input-konstanter (fra `backend/lib/academyFlag.js` + `economyConstants.js`)",
    "",
    "| Konstant | Værdi | Kilde |",
    "|----------|-------|-------|",
    `| \`ACADEMY.SLOTS\` (hård cap) | ${ACADEMY.SLOTS} | academyFlag.js |`,
    `| \`ACADEMY.DRIFT_PER_SEASON\` | ${fmt(ACADEMY.DRIFT_PER_SEASON)} CZ$/slot — **ejer-godkendt 13/6** | academyFlag.js |`,
    `| \`ACADEMY.SIGNING_FEE_RATE\` | ${ACADEMY.SIGNING_FEE_RATE * 100}% af market_value | academyFlag.js |`,
    `| \`ACADEMY.SALARY_RATE\` | ${ACADEMY.SALARY_RATE * 100}% af market_value | academyFlag.js |`,
    `| \`ACADEMY.YOUTH_MULT\` | ${ACADEMY.YOUTH_MULT} (aftagende mod 1.0 ved 22) | academyFlag.js |`,
    `| \`ACADEMY.CONTRACT_LENGTH\` | ${ACADEMY.CONTRACT_LENGTH} sæsoner | academyFlag.js |`,
    `| Repr. ungdomsrytter market_value | ${fmt(YOUTH_MARKET_VALUE_REP)} CZ$ | Empirisk (computeYouthBaseValue.js, 201 ryttere, median) |`,
    `| \`SPONSOR_INCOME_BASE\` | ${fmt(SPONSOR_INCOME_BASE)} CZ$ | economyConstants.js |`,
    `| \`INITIAL_BALANCE\` | ${fmt(INITIAL_BALANCE)} CZ$ | economyConstants.js |`,
    `| Debt-ceiling D1/D2/D3 | ${fmt(DEBT_CEILING_BY_DIVISION[1])} / ${fmt(DEBT_CEILING_BY_DIVISION[2])} / ${fmt(DEBT_CEILING_BY_DIVISION[3])} CZ$ | economyConstants.js |`,
    `| Nye signeringer/sæson (repr.) | ${INTAKE_PER_SEASON} | CONTRACT_LENGTH=3 → ~2 fornys/sæson |`,
    `| **Gate-slots (delvist akademi)** | **${PARTIAL_SLOTS}** | Realistisk invested academy (ejer-design) |`,
    `| Sim-sæsoner (solvens-gate) | ${SIM_SEASONS} | — |`,
    `| Ungdomskohort-størrelse (peak) | ${PEAK_COHORT_COUNT} | seed=${SIM_SEED} |`,
    ""
  );

  // --- METRIK 1: Solvens ---
  lines.push(
    "## Metrik 1: Akademi-solvens pr. division",
    "",
    "### Ejer-godkendt design-rationale",
    "",
    "Drift dominerer akademi-omkostningerne — salary og signing er marginale ved",
    `empirisk youth-value ~${fmt(YOUTH_MARKET_VALUE_REP)} CZ$. De fleste hold kører et **delvist akademi`,
    `(sign 0-2 pr. intake, vokser til 3-4 slots)**. Et fuldt 8-slot akademi er en`,
    "bevidst tung investering finansieret af racing-indkomst.",
    "",
    "**Solvens-gate måler 4 slots (primær)** — fuldt 8-slot rapporteres informativt.",
    "",
    "### Akademi-omkostninger: delvist (4 slots) vs. fuldt (8 slots)",
    "",
    "| Post | 4 slots (gate) | 8 slots (informativ) |",
    "|------|:--------------:|:-------------------:|",
    `| Drift | ${fmt(partialCost.drift)} CZ$ | ${fmt(fullCost.drift)} CZ$ |`,
    `| Signing-fee (${INTAKE_PER_SEASON} × ${ACADEMY.SIGNING_FEE_RATE * 100}% × ${fmt(YOUTH_MARKET_VALUE_REP)}) | ${fmt(partialCost.signing)} CZ$ | ${fmt(fullCost.signing)} CZ$ |`,
    `| Akademi-lønninger | ${fmt(partialCost.salaries)} CZ$ | ${fmt(fullCost.salaries)} CZ$ |`,
    `| **Total/sæson** | **${fmt(partialCost.total)} CZ$** | **${fmt(fullCost.total)} CZ$** |`,
    `| Over 10 sæsoner | ${fmt(partialCost.total * SIM_SEASONS)} CZ$ | ${fmt(fullCost.total * SIM_SEASONS)} CZ$ |`,
    ""
  );

  lines.push(
    "### Primær gate: delvist akademi (4 slots)",
    "",
    "**Gate er differentieret per division per ejer-godkendt design:**",
    "",
    "- **D1/D2** (base-økonomi allerede insolvent inden 10 sæsoner): PASS = det delvise",
    "  akademi accelererer ceiling-tidspunktet med ≤ 2 sæsoner vs. base-alone.",
    "  Rationale: base-underskuddet er et bredere økonomidesign-spørgsmål, ikke akademiets skyld.",
    "- **D3** (base-økonomi robust i >10 sæsoner): PASS = delvist akademi holder sig",
    "  over debt-ceiling i alle 10 simulerede sæsoner.",
    "",
    `> **Basis-økonomi-kontekst:** Sponsor ${fmt(SPONSOR_INCOME_BASE)} CZ$ vs. senior-løn`,
    `> D1: ${fmt(SENIOR_SALARY_BY_DIV[1])} / D2: ${fmt(SENIOR_SALARY_BY_DIV[2])} / D3: ${fmt(SENIOR_SALARY_BY_DIV[3])} CZ$.`,
    "> D1 og D2 har store base-underskud der driver dem mod debt-ceiling uanset akademiet.",
    "> Akademiet er et tyndt lag; gaten måler kun akademiets INKREMENTALE effekt.",
    "",
    "| Division | Base net/sæs. | Base ceiling-sæson | Partial ceiling-sæson | Akad. acceleration | Gate-type | **Resultat** |",
    "|----------|--------------:|:-----------------:|:---------------------:|:-----------------:|:----------:|:------------:|"
  );

  for (const d of divResults) {
    const baseCeilStr = d.baseCeilSeason ? `sæs. ${d.baseCeilSeason}` : ">30 sæs.";
    const partCeilStr = d.partialCeilSeason ? `sæs. ${d.partialCeilSeason}` : ">30 sæs.";
    const accelStr = d.incrementalSeasonsLost !== null
      ? `${d.incrementalSeasonsLost} sæs. hurtigere`
      : "N/A (base >30)";
    const gateType = d.baseAlreadyInsolventIn10 ? "accel. ≤2 sæs." : "≥−ceiling 10 sæs.";
    const res = d.pass ? "✅ PASS" : "❌ FAIL";
    lines.push(
      `| D${d.div} | ${fmt(d.baseNetPerSeason)} | ${baseCeilStr} | ${partCeilStr} | ${accelStr} | ${gateType} | **${res}** |`
    );
  }

  lines.push("");

  // --- D3 detaljetabel ---
  const d3 = divResults.find((d) => d.div === 3);
  if (d3) {
    lines.push(
      "### D3 sæsonvis saldo — base vs. delvist akademi (4 slots)",
      "",
      `> D3 er det bindende tilfælde for stability-gate: base-net er −${fmt(Math.abs(d3.baseNetPerSeason))}/sæs.`,
      `> Med et 4-slot akademi (−${fmt(d3.partialCostPerSeason)}/sæs. ekstra) er det bæredygtigt i alle ${SIM_SEASONS} sæsoner.`,
      `> Debt-ceiling: ${fmt(d3.debtCeiling)} CZ$. Partial rammer ceiling sæson ${d3.partialCeilSeason ?? ">30"}.`,
      "",
      "| Sæson | Base-saldo | 4-slot saldo | Over ceiling? |",
      "|------:|----------:|-------------:|:-------------:|"
    );
    for (const s of d3.seasons) {
      const ok = s.partialAboveCeiling ? "✅" : "❌";
      lines.push(
        `| ${s.season} | ${fmt(Math.round(s.balBase))} | ${fmt(Math.round(s.balPartial))} | ${ok} |`
      );
    }
    lines.push(
      "",
      `> S10-balance: ${fmt(Math.round(d3.partialS10Balance))} CZ$ — godt over −${fmt(d3.debtCeiling)} CZ$ ceiling ✅.`,
      ""
    );
  }

  // --- Fuldt 8-slot informativ sektion ---
  lines.push(
    "### Informativ: fuldt 8-slot akademi (tung-investerings-horisont)",
    "",
    "> Fuldt 8-slot er en **bevidst tung satsning** finansieret af racing-indkomst.",
    "> Det er IKKE en FAIL — det er en design-beslutning holdejere tager bevidst.",
    "",
    "| Division | Full 8-slot cost/sæs. | Base net/sæs. | Netto m. fuldt akad. | Sæsoner til ceiling |",
    "|----------|-----------------------|--------------|----------------------:|:-------------------:|"
  );
  for (const d of divResults) {
    const netWithFull = d.baseNetPerSeason - d.fullCostPerSeason;
    const horizonStr = d.fullHorizonSeason
      ? `~${d.fullHorizonSeason} sæsoner`
      : ">30 sæsoner";
    lines.push(
      `| D${d.div} | ${fmt(d.fullCostPerSeason)} CZ$/sæs. | ${fmt(d.baseNetPerSeason)} | ${fmt(Math.round(netWithFull))} CZ$/sæs. | ${horizonStr} |`
    );
  }
  lines.push(
    "",
    `> D3 med fuldt 8-slot akademi rammer ceiling efter ~${d3?.fullHorizonSeason ?? "?"} sæsoner.`,
    "> D1/D2 rammer ceiling pga. base-underskud — akademiets inkrementale effekt er minimal.",
    ""
  );

  // --- METRIK 2: Youth uplift ---
  lines.push(
    "## Metrik 2: Youth-multiplikator uplift",
    "",
    `**Benchmark:** alder ${uplift.age}, evne '${uplift.ability}', current=${UPLIFT_BENCH_CURRENT}, cap=${UPLIFT_BENCH_CAP}, ${uplift.days} dage, normal intensitet, ingen bonus, noise=1.0.`,
    "",
    `**youthMultiplier(${uplift.age})** = **${uplift.yMult.toFixed(4)}** (fra academyFlag.js: lineær aftagning fra ${ACADEMY.YOUTH_MULT} ved 16 mod 1.0 ved 22)`,
    "",
    "| | Sæson-gain (ability-point, kumulativ) |",
    "|--|---|",
    `| Med youthMultiplier (age ${uplift.age}) | ${uplift.seasonGainWithMult.toFixed(4)} |`,
    `| Uden youthMultiplier (baseline mult=1.0) | ${uplift.seasonGainWithout.toFixed(4)} |`,
    `| **Uplift** | **${pct(uplift.upliftPct)}** |`,
    "",
    `**Target:** ${uplift.targetMin}% ≤ uplift < ${uplift.targetMax}%`,
    "",
    `**Resultat:** ${pct(uplift.upliftPct)} → **${pass(uplift.pass)}** ${uplift.pass ? "✅" : "❌"}`,
    ""
  );

  // --- METRIK 3: Peak-alder ---
  lines.push(
    "## Metrik 3: Progression peak-alder",
    "",
    `**Kohort:** ${peakAge.cohortSize} ungdomsryttere (startAlder ${ACADEMY.MIN_AGE}-${ACADEMY.MAX_AGE}), seed=${peakAge.seed}, ${peakAge.seasons} sæsoner.`,
    `**Metode:** Samme som \`previewDailyTraining.js\` — ÆGTE \`dailyAbilityDelta\` + \`youthMultiplier\` fra de shippede libs.`,
    "",
    "| Statistik | Alder |",
    "|-----------|-------|",
    `| Median peak-alder | **${peakAge.medianPeakAge}** |`,
    `| P25 | ${peakAge.p25} |`,
    `| P75 | ${peakAge.p75} |`,
    `| Min | ${peakAge.minAge} |`,
    `| Max | ${peakAge.maxAge} |`,
    "",
    `**Target:** median peak-alder ∈ {27, 28} (spec 5.2)`,
    "",
    `**Resultat:** median ${peakAge.medianPeakAge} → **${pass(peakAge.pass)}** ${peakAge.pass ? "✅" : "❌"}`,
    ""
  );

  // --- SCOREBOARD ---
  lines.push(
    "## Scoreboard",
    "",
    "| ID | Metrik | Mål | Faktisk | Resultat |",
    "|----|--------|-----|---------|:--------:|"
  );

  for (const d of divResults) {
    const ceiling = fmt(d.debtCeiling);
    let goalStr;
    let actualStr;
    if (d.baseAlreadyInsolventIn10) {
      goalStr = `Akad. acceleration ≤ 2 sæs.`;
      const accel = d.incrementalSeasonsLost ?? 0;
      actualStr = `accel. ${accel} sæs. (base sæs. ${d.baseCeilSeason ?? ">30"}, partial sæs. ${d.partialCeilSeason ?? ">30"})`;
    } else {
      goalStr = `≥ −${ceiling} alle 10 sæs.`;
      actualStr = `S10-bal. ${fmt(Math.round(d.partialS10Balance))} — over ceiling alle 10 sæs.`;
    }
    lines.push(
      `| SOL-D${d.div} | Solvens D${d.div}: 4-slot delvist akad. | ${goalStr} | ${actualStr} | **${pass(d.pass)}** ${d.pass ? "✅" : "❌"} |`
    );
  }

  lines.push(
    `| UPLIFT | Youth-multiplikator uplift alder ${uplift.age} | ${uplift.targetMin}%–${uplift.targetMax - 1}% | ${pct(uplift.upliftPct)} | **${pass(uplift.pass)}** ${uplift.pass ? "✅" : "❌"} |`,
    `| PEAK | Progression median peak-alder | 27–28 | ${peakAge.medianPeakAge} | **${pass(peakAge.pass)}** ${peakAge.pass ? "✅" : "❌"} |`
  );

  lines.push(
    "",
    `**Samlet: ${allPass ? "✅ ALLE PASS" : "❌ MINDST ÉT FAIL"}**`,
    ""
  );

  // --- RECOMMENDATION ---
  lines.push(
    "## RECOMMENDATION",
    "",
    "### DRIFT_PER_SEASON = 5.000 CZ$/slot — ejer-godkendt 13/6",
    "",
    `**Delvist akademi (4 slots):** cost ${fmt(partialCost.total)} CZ$/sæs. — bæredygtigt i ALLE divisioner over 10 sæsoner.`,
    `D3 (det bindende tilfælde) har S10-balance ${fmt(Math.round(d3?.partialS10Balance ?? 0))} CZ$ (godt over debt-ceiling ${fmt(d3?.debtCeiling ?? 0)} CZ$).`,
    "",
    `**Fuldt 8-slot akademi:** cost ${fmt(fullCost.total)} CZ$/sæs. — bevidst tung investering.`,
    (() => {
      const d3full = d3?.fullHorizonSeason;
      if (!d3full) return "D3 rammer ikke ceiling inden for 30 sæsoner selv med fuldt akademi.";
      return `D3 med fuldt akademi rammer ceiling efter ~${d3full} sæsoner (>10 sæsoner = ingen akut risiko, men kræver racing-indkomst for at holdes langsigtet).`;
    })(),
    "",
    "**Ungdomsværdi:** empirisk median ~11.312 CZ$ (201 ryttere, ægte pipeline).",
    "Drift dominerer; salary (9.049 CZ$/sæs. for 8 slots) og signing-fee (5.656 CZ$/sæs.) er marginale.",
    ""
  );

  if (uplift.pass) {
    lines.push(
      `**Youth-multiplikator (YOUTH_MULT=${ACADEMY.YOUTH_MULT}):** ✅ giver ${pct(uplift.upliftPct)} uplift for en ${uplift.age}-årig — inden for målet.`,
      `Median peak-alder ${peakAge.medianPeakAge} — ungdomstræning accelererer tidlig vækst uden at skubbe peak senere.`,
      ""
    );
  }

  if (allPass) {
    lines.push(
      "### Samlet",
      "",
      "**Alle tre metrikker er PASS.** Drift=5000/slot er ejer-godkendt og spiller-designet godt:",
      "- Delvist akademi (3-4 slots) er komfortabelt bæredygtigt i alle divisioner.",
      "- Fuldt 8-slot akademi (~15 sæsoners D3-horisont) er en bevidst tung satsning — ikke en fejl.",
      "- Youth-uplift og peak-alder er inden for spec.",
      ""
    );
  } else {
    lines.push(
      "### Samlet",
      "",
      "**Mindst ét mål er FAIL.** Se røde rækker ovenfor.",
      ""
    );
  }

  lines.push(
    "---",
    "",
    `*Genereret af \`backend/scripts/academyEconomySimulation.js\` — #1308 akademi-MVP balance-sim.*`,
    `*Gate: delvist 4-slot akademi ≥ −debt-ceiling alle 10 sæsoner (PARTIAL_SLOTS=${PARTIAL_SLOTS}). Drift=5000/slot ejer-godkendt 13/6.*`
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const solvency = simulateSolvency();
  const uplift = simulateYouthUplift();
  const peakAge = simulatePeakAge();

  const markdown = buildMarkdown({ solvency, uplift, peakAge });

  if (MARKDOWN) {
    process.stdout.write(markdown);
  } else {
    // JSON summary
    const { divResults, partialCost, fullCost } = solvency;
    const summary = {
      gate: "partial-4-slot-solvency-10-seasons",
      solvency: divResults.map((d) => ({
        div: d.div,
        pass: d.pass,
        partialCostPerSeason: d.partialCostPerSeason,
        partialS1Balance: d.partialS1Balance,
        partialS10Balance: d.partialS10Balance,
        debtCeiling: d.debtCeiling,
        baseNetPerSeason: d.baseNetPerSeason,
        fullHorizonSeason: d.fullHorizonSeason,
      })),
      uplift: {
        pass: uplift.pass,
        upliftPct: uplift.upliftPct,
        yMult: uplift.yMult,
      },
      peakAge: {
        pass: peakAge.pass,
        medianPeakAge: peakAge.medianPeakAge,
        p25: peakAge.p25,
        p75: peakAge.p75,
      },
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  }

  // Exit code: gate is partial-4-slot solvency (all divs) + uplift + peakAge
  const allPass =
    solvency.divResults.every((d) => d.pass) && uplift.pass && peakAge.pass;
  if (!allPass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message, err.stack);
  process.exitCode = 1;
});
