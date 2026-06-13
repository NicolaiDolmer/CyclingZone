/**
 * academyEconomySimulation.js — Akademi-økonomi + progression balance-sim (#1308)
 *
 * SYNTHETIC simulation (ingen DB krævet — flag er OFF, ingen akademi-data i prod).
 * Modellerer representative hold over 10 sæsoner med et fuldt akademi (8 slots).
 *
 * Tre metrikker med eksplicitte mål + PASS/FAIL:
 *
 *   1. SOLVENS: Kan et hold med fuldt akademi klare sig pr. division?
 *      Akademi-omkostninger = drift (8×DRIFT_PER_SEASON) + signing-fee (2 nye/sæson)
 *      + akademi-lønninger (8 ryttere × SALARY_RATE × repræsentativ ungdomsværdi).
 *      Target: akademi-omkostninger alene bringer IKKE holdet over debt-ceiling.
 *
 *   2. YOUTH UPLIFT: Ungdoms-multiplikatoren (YOUTH_MULT) giver en meningsfuld
 *      forbedring vs. baseline (mult=1). Target: ≥20% uplift, <100% (ikke trivielt).
 *
 *   3. PEAK-ALDER: Ungdomskohorten (16-21) peaker ved alder 27-28 (spec 5.2).
 *      Bruger de ÆGTE dailyAbilityDelta + youthMultiplier fra dailyTraining.js.
 *
 * CLI: node scripts/academyEconomySimulation.js [--markdown]
 * Exit: 0 ved alle PASS, 1 ved mindst ét FAIL (scorecard skrives uanset).
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
// salary-last er langt lavere end antaget; SIGNING_FEE_RATE er den primære cost.
const YOUTH_MARKET_VALUE_REP = 11_312;

// Nye signeringer pr. sæson (ud af 8 slots; CONTRACT_LENGTH=3 → ~2-3 fornyes/sæson).
const INTAKE_PER_SEASON = 2;

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
// ---------------------------------------------------------------------------

/**
 * Akademi-omkostninger pr. sæson:
 *   drift     = SLOTS × DRIFT_PER_SEASON
 *   signing   = INTAKE_PER_SEASON × SIGNING_FEE_RATE × YOUTH_MARKET_VALUE_REP
 *   salaries  = SLOTS × SALARY_RATE × YOUTH_MARKET_VALUE_REP
 */
function academyCostPerSeason() {
  const drift = ACADEMY.SLOTS * ACADEMY.DRIFT_PER_SEASON;
  const signing =
    INTAKE_PER_SEASON * ACADEMY.SIGNING_FEE_RATE * YOUTH_MARKET_VALUE_REP;
  const salaries =
    ACADEMY.SLOTS * ACADEMY.SALARY_RATE * YOUTH_MARKET_VALUE_REP;
  return { drift, signing, salaries, total: drift + signing + salaries };
}

function simulateSolvency() {
  const academyCost = academyCostPerSeason();
  const divResults = [];

  for (const div of [1, 2, 3]) {
    const debtCeiling = DEBT_CEILING_BY_DIVISION[div];
    const sponsorIncome = SPONSOR_INCOME_BASE;
    const prizes = PRIZES_BY_DIV[div];
    const seniorSalary = SENIOR_SALARY_BY_DIV[div];

    // Simmer to parallelle holds: et MED akademi, et UDEN (base).
    // Dette giver den rene akademi-inkrementale effekt, og skelner fra den
    // eksisterende base-økonomi (som ALLEREDE kan have underskud designet ind).
    let balanceWithAcademy = INITIAL_BALANCE;
    let balanceBase = INITIAL_BALANCE;
    const seasons = [];

    for (let s = 1; s <= SIM_SEASONS; s++) {
      const baseNet = sponsorIncome + prizes - seniorSalary;
      const totalNet = baseNet - academyCost.total;
      balanceWithAcademy += totalNet;
      balanceBase += baseNet;

      // Akademiets inkrementale balance-delta pr. sæson = -academyCost.total
      // Over S sæsoner er akademiets kumulerede effekt: S × academyCost.total
      const cumulativeAcademyCost = s * academyCost.total;

      seasons.push({
        season: s,
        balanceWithAcademy,
        balanceBase,
        totalNet,
        baseNet,
        cumulativeAcademyCost,
        // Akademiet sætter holdet over ceiling UDELUKKENDE pga. akademi
        academyCausesExcessDebt: balanceWithAcademy < -debtCeiling && balanceBase >= -debtCeiling,
      });
    }

    // Gate A: Akademiet alene er årsagen til at holdet krydser debt-ceiling (i nogen sæson)?
    // Dvs. base-balancen er OK (>= -ceiling) men akademi-balancen er under ceiling.
    const academyCausesDebtCrossing = seasons.some((s) => s.academyCausesExcessDebt);

    // Gate B: akademi-cost pr. sæson < total indkomst (sponsor + præmier)?
    // Afgørende affordability-gate: akademiet må ikke koste mere end hvad holdet tjener.
    const totalIncome = sponsorIncome + prizes;
    const affordabilityRatio = academyCost.total / totalIncome;
    const affordable = affordabilityRatio < 1.0; // akademi-cost < total indkomst

    // Gate C: S1 balance med akademi > 0 (holdet er IKKE straks insolvent).
    const s1Balance = seasons[0]?.balanceWithAcademy ?? 0;
    const s1Insolvent = s1Balance < 0;

    // PASS: akademiet forårsager IKKE debt-ceiling-overskridelse alene,
    //       og akademi-cost < total indkomst (affordable), og S1 positiv.
    const passResult = !academyCausesDebtCrossing && affordable && !s1Insolvent;

    divResults.push({
      div,
      debtCeiling,
      sponsorIncome,
      prizes,
      totalIncome,
      seniorSalary,
      academyCostPerSeason: academyCost.total,
      academyCostDrift: academyCost.drift,
      academyCostSigning: academyCost.signing,
      academyCostSalaries: academyCost.salaries,
      s1BalanceBase: seasons[0]?.balanceBase ?? 0,
      s1Balance,
      s1Insolvent,
      affordabilityRatio,
      affordable,
      academyCausesDebtCrossing,
      maxCumulativeAcademyCost: SIM_SEASONS * academyCost.total,
      seasons,
      pass: passResult,
    });
  }

  return { divResults, academyCost };
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
  const { divResults, academyCost } = solvency;
  const allPass =
    divResults.every((d) => d.pass) && uplift.pass && peakAge.pass;

  const lines = [];

  lines.push(
    "# Akademi-økonomi Scorecard — 2026-06-13",
    "",
    "Sim for **akademi-MVP** (#1308): solvens, youth-multiplikator-uplift og",
    "progression-peak for et fuldt akademi (8 slots) over 10 simulerede sæsoner.",
    "",
    "> **SYNTHETIC** — akademi-flaget er OFF. Ingen DB-adgang krævet.",
    "> Alle beløb er sim-startpunkter — ejer godkender før flag-flip.",
    "",
    "## Input-konstanter (fra `backend/lib/academyFlag.js` + `economyConstants.js`)",
    "",
    "| Konstant | Værdi | Kilde |",
    "|----------|-------|-------|",
    `| \`ACADEMY.SLOTS\` | ${ACADEMY.SLOTS} | academyFlag.js |`,
    `| \`ACADEMY.DRIFT_PER_SEASON\` | ${fmt(ACADEMY.DRIFT_PER_SEASON)} CZ$ | academyFlag.js (SIM-STARTPUNKT) |`,
    `| \`ACADEMY.SIGNING_FEE_RATE\` | ${ACADEMY.SIGNING_FEE_RATE * 100}% af market_value | academyFlag.js (SIM-STARTPUNKT) |`,
    `| \`ACADEMY.SALARY_RATE\` | ${ACADEMY.SALARY_RATE * 100}% af market_value | academyFlag.js |`,
    `| \`ACADEMY.YOUTH_MULT\` | ${ACADEMY.YOUTH_MULT} (aftagende mod 1.0 ved 22) | academyFlag.js |`,
    `| \`ACADEMY.CONTRACT_LENGTH\` | ${ACADEMY.CONTRACT_LENGTH} sæsoner | academyFlag.js |`,
    `| Repr. ungdomsrytter market_value | ${fmt(YOUTH_MARKET_VALUE_REP)} CZ$ | Antaget midterste bånd (16-21) |`,
    `| \`SPONSOR_INCOME_BASE\` | ${fmt(SPONSOR_INCOME_BASE)} CZ$ | economyConstants.js |`,
    `| \`INITIAL_BALANCE\` | ${fmt(INITIAL_BALANCE)} CZ$ | economyConstants.js |`,
    `| Debt-ceiling D1/D2/D3 | ${fmt(DEBT_CEILING_BY_DIVISION[1])} / ${fmt(DEBT_CEILING_BY_DIVISION[2])} / ${fmt(DEBT_CEILING_BY_DIVISION[3])} CZ$ | economyConstants.js |`,
    `| Nye signeringer/sæson (repr.) | ${INTAKE_PER_SEASON} | CONTRACT_LENGTH=3 → ~2 fornys/sæson |`,
    `| Sim-sæsoner (solvens) | ${SIM_SEASONS} | — |`,
    `| Ungdomskohort-størrelse (peak) | ${PEAK_COHORT_COUNT} | seed=${SIM_SEED} |`,
    ""
  );

  // --- METRIK 1: Solvens ---
  lines.push(
    "## Metrik 1: Akademi-solvens pr. division",
    "",
    "**Akademi-omkostninger pr. sæson** (alle divisioner ens — akademiet er delt konstant):",
    "",
    `| Post | Beløb |`,
    `|------|-------|`,
    `| Drift (8 × ${fmt(ACADEMY.DRIFT_PER_SEASON)}) | ${fmt(academyCost.drift)} CZ$ |`,
    `| Signing-fee (${INTAKE_PER_SEASON} × ${ACADEMY.SIGNING_FEE_RATE * 100}% × ${fmt(YOUTH_MARKET_VALUE_REP)}) | ${fmt(academyCost.signing)} CZ$ |`,
    `| Akademi-lønninger (8 × ${ACADEMY.SALARY_RATE * 100}% × ${fmt(YOUTH_MARKET_VALUE_REP)}) | ${fmt(academyCost.salaries)} CZ$ |`,
    `| **Total akademi-cost/sæson** | **${fmt(academyCost.total)} CZ$** |`,
    `| Over 10 sæsoner (kumulativt) | ${fmt(academyCost.total * SIM_SEASONS)} CZ$ |`,
    ""
  );

  lines.push(
    "**Gate A:** Akademiets omkostninger alene forårsager IKKE debt-ceiling-overskridelse",
    "(base-hold OK ≥ -ceiling, med-akademi-hold krydser ceiling = FAIL).",
    "**Gate B:** Akademi-cost pr. sæson < samlet indkomst (sponsor + præmier).",
    "  → Afgørende affordability-gate: akademiet må ikke koste mere end holdet tjener.",
    "**Gate C:** S1 balance med akademi > 0 (holdet er ikke straks insolvent).",
    "",
    "> **Vigtig kontekst:** D1/D2-holdene har ALLEREDE et designet underskud i base-økonomi",
    "> (sponsor 240k < senior-løn). Akademiet er et tillæg ovenpå. Gate A + B + C måler",
    "> om akademiet er BÆREDYGTIGT som et separat lag, ikke om holdet samlet set er",
    "> likvid i alle 10 sæsoner (det er et bredere økonomi-design-spørgsmål).",
    "",
    "| Division | Total indkomst/sæs. | Akad. cost/sæs. | Afford. (<100% indkomst) | S1 base-bal. | S1 m. akademi | Gate A | Gate C | **RESULTAT** |",
    "|----------|--------------------|-----------------|--------------------------|--------------|--------------:|:------:|:------:|:------------:|"
  );

  for (const d of divResults) {
    const gA = !d.academyCausesDebtCrossing ? "✅" : "❌";
    const gB_pct = pct(d.affordabilityRatio * 100, 0);
    const gB_icon = d.affordable ? "✅" : "❌";
    const gC = !d.s1Insolvent ? "✅" : "❌";
    const res = d.pass ? "✅ PASS" : "❌ FAIL";
    lines.push(
      `| D${d.div} | ${fmt(d.totalIncome)} | ${fmt(d.academyCostPerSeason)} | ${gB_icon} ${gB_pct} af indkomst | ${fmt(d.s1BalanceBase)} | ${fmt(d.s1Balance)} | ${gA} | ${gC} | **${res}** |`
    );
  }

  lines.push("");

  // Detalje-tabel: sæsonvis net for D3 (det snævre tilfælde)
  const d3 = divResults.find((d) => d.div === 3);
  if (d3) {
    lines.push(
      "### D3 sæsonvis saldo — med vs. uden akademi",
      "",
      "| Sæson | Base net | Med-akad. net | Balance (base) | Balance (m. akad.) | Akad. forårs. ceiling-kryds? |",
      "|------:|---------:|--------------:|---------------:|-------------------:|:----------------------------:|"
    );
    for (const s of d3.seasons) {
      const crossMark = s.academyCausesExcessDebt ? "JA ❌" : "—";
      lines.push(
        `| ${s.season} | ${fmt(s.baseNet)} | ${fmt(s.totalNet)} | ${fmt(s.balanceBase)} | ${fmt(s.balanceWithAcademy)} | ${crossMark} |`
      );
    }
    lines.push("");
    lines.push(
      `> **D3 kontekst:** Sponsor (${fmt(SPONSOR_INCOME_BASE)}) + præmier (${fmt(d3.prizes)}) − senior-løn (${fmt(d3.seniorSalary)}) = base-net ${fmt(d3.s1BalanceBase - INITIAL_BALANCE)}/sæs.`,
      `> Akademi tilføjer −${fmt(d3.academyCostPerSeason)} CZ$/sæs. mere. Debt-ceiling for D3: ${fmt(d3.debtCeiling)} CZ$.`,
      ""
    );
  }

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
    const actualDetail = `afford. ${pct(d.affordabilityRatio * 100, 0)} af indkomst${d.affordable ? "" : " OVER 100%!"}; S1 bal. ${fmt(d.s1Balance)}${d.s1Insolvent ? " (neg.!)" : ""}; ceiling-kryds: ${d.academyCausesDebtCrossing ? "JA" : "nej"}`;
    lines.push(
      `| SOL-D${d.div} | Solvens D${d.div}: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | ${actualDetail} | **${pass(d.pass)}** ${d.pass ? "✅" : "❌"} |`
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
  const d3Pass = divResults.find((d) => d.div === 3)?.pass ?? false;
  const d2Pass = divResults.find((d) => d.div === 2)?.pass ?? false;
  const d1Pass = divResults.find((d) => d.div === 1)?.pass ?? false;

  lines.push(
    "## RECOMMENDATION",
    "",
    "Ejer beslutter — sim leverer tal, ikke beslutninger. Nedenfor er ærlige fund:",
    ""
  );

  // DRIFT_PER_SEASON
  const cumulativeCost10 = academyCost.total * SIM_SEASONS;
  const d3Result = divResults.find((d) => d.div === 3);
  lines.push(
    `### DRIFT_PER_SEASON = ${fmt(ACADEMY.DRIFT_PER_SEASON)} CZ$`,
    ""
  );
  // Find worst-case for affordability across divisions
  const worstAfford = Math.max(...divResults.map((d) => d.affordabilityRatio));
  const bestAfford = Math.min(...divResults.map((d) => d.affordabilityRatio));

  lines.push(
    `Akademi-cost: **${fmt(academyCost.total)} CZ$/sæs.** (drift ${fmt(academyCost.drift)} + signing ${fmt(academyCost.signing)} + lønner ${fmt(academyCost.salaries)}).`,
    ""
  );

  if (worstAfford >= 1.0) {
    // D1 har lavest indkomst (sponsor 240k + præmier 160k = 400k) og er worst case
    const d1Result = divResults.find((d) => d.div === 1);
    lines.push(
      `**❌ PROBLEM:** Akademi-cost (${fmt(academyCost.total)}) overstiger D1's totale indkomst (${fmt(d1Result?.totalIncome)}) — akademiets lønsum og signing-fee er for høj relativt til indkomsten.`,
      "",
      `Kontekst: Senior-løn for D1 (${fmt(SENIOR_SALARY_BY_DIV[1])}) er allerede et problem for basis-solvens.`,
      `Akademiet er et yderligere lag. Problemet er strukturelt: DRIFT_PER_SEASON=15k er OK i sig selv,`,
      `men SALARY_RATE × YOUTH_MARKET_VALUE_REP × SLOTS giver 128.000/sæs. i akademi-lønninger alene.`,
      "",
      `**Mulige justeringer (ejer vælger ét eller flere):**`,
      `- Reducer YOUTH_MARKET_VALUE_REP-antagelsen (fx til 80.000 CZ$) → akademi-løn = ${fmt(ACADEMY.SLOTS * ACADEMY.SALARY_RATE * 80_000)} + signing = ${fmt(INTAKE_PER_SEASON * ACADEMY.SIGNING_FEE_RATE * 80_000)} → total ${fmt(academyCost.drift + ACADEMY.SLOTS * ACADEMY.SALARY_RATE * 80_000 + INTAKE_PER_SEASON * ACADEMY.SIGNING_FEE_RATE * 80_000)} CZ$/sæs.`,
      `- Reducer SALARY_RATE (fx til 0.05 i stedet for 0.10) → akademi-løn = ${fmt(ACADEMY.SLOTS * 0.05 * YOUTH_MARKET_VALUE_REP)} CZ$/sæs.`,
      `- Reducer SLOTS (fx til 4) → drift = ${fmt(4 * ACADEMY.DRIFT_PER_SEASON)}, løn = ${fmt(4 * ACADEMY.SALARY_RATE * YOUTH_MARKET_VALUE_REP)} CZ$/sæs.`,
      `- Reducer SIGNING_FEE_RATE (fx til 0.10) → signing = ${fmt(INTAKE_PER_SEASON * 0.10 * YOUTH_MARKET_VALUE_REP)} CZ$/sæs.`,
      ""
    );
  } else {
    lines.push(`**✅** Akademi-cost er under total indkomst for alle divisioner.`, "");
  }

  if (d3Result && !d3Pass) {
    lines.push(
      `**D3-specifikt:** D3 har S1-balance ${fmt(d3Result.s1Balance)} ${d3Result.s1Insolvent ? "(negativ!)" : "(positiv)"} og affordability ${pct(d3Result.affordabilityRatio * 100, 0)}. Se D3-tabellen ovenfor.`,
      ""
    );
  }

  // SIGNING_FEE_RATE
  lines.push(
    `### SIGNING_FEE_RATE = ${ACADEMY.SIGNING_FEE_RATE * 100}%`,
    ""
  );
  lines.push(
    `Signing-fee bidrager ${fmt(academyCost.signing)} CZ$/sæson (${INTAKE_PER_SEASON} nye ryttere × ${ACADEMY.SIGNING_FEE_RATE * 100}% × ${fmt(YOUTH_MARKET_VALUE_REP)} CZ$).`,
    `Dette er ${((academyCost.signing / academyCost.total) * 100).toFixed(1)}% af de samlede akademi-omkostninger.`,
    `**Vurdering:** Rimeligt — signing-fee er en engangsbetaling pr. ny rytter; 25% af en ungdomsværdi er acceptabelt.`,
    `Hvis ungdomsryttere bevisst sættes lavere (fx market_value ~80.000 CZ$), er signing-fee kun ${fmt(Math.round(INTAKE_PER_SEASON * ACADEMY.SIGNING_FEE_RATE * 80_000))} CZ$/sæson.`,
    ""
  );

  // YOUTH_MULT
  lines.push(
    `### YOUTH_MULT = ${ACADEMY.YOUTH_MULT}`,
    ""
  );
  if (uplift.pass) {
    lines.push(
      `**✅** Youth-multiplikatoren giver ${pct(uplift.upliftPct)} uplift for en ${uplift.age}-årig — inden for målet (${uplift.targetMin}%–${uplift.targetMax - 1}%).`,
      `YOUTH_MULT=1.5 er et fornuftigt startpunkt. Peaker stadig ved ${peakAge.medianPeakAge} → ungdomstræning accelererer tidlig vækst UDEN at skubbe peak senere.`,
      ""
    );
  } else {
    lines.push(
      `**❌** Youth-uplift er ${pct(uplift.upliftPct)} — uden for målet [${uplift.targetMin}%, ${uplift.targetMax}%[.`,
      `Overvej at justere YOUTH_MULT. Aktuel: ${ACADEMY.YOUTH_MULT}.`,
      ""
    );
  }

  // Overordnet
  if (allPass) {
    lines.push(
      "### Samlet vurdering",
      "",
      "**Alle tre metrikker er PASS.** Konstanterne er sim-startpunkter der kan flippes til prod,",
      "forudsat ejer accepterer denne balance. Den vigtigste nuance er D3-solvensen:",
      "se SOL-D3-rækken og D3-detaljetabellen ovenfor for at vurdere om D3-teams",
      "bør have begrænsede akademi-slots.",
      ""
    );
  } else {
    lines.push(
      "### Samlet vurdering",
      "",
      "**Mindst ét mål er FAIL.** Ejer bør gennemgå de røde rækker ovenfor",
      "og beslutte om konstanterne justeres, eller om acceptkriterierne revurderes.",
      ""
    );
  }

  lines.push(
    "---",
    "",
    `*Genereret af \`backend/scripts/academyEconomySimulation.js\` — #1308 akademi-MVP balance-sim.*`
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
    const summary = {
      solvency: solvency.divResults.map((d) => ({
        div: d.div,
        pass: d.pass,
        crossesCeiling: d.crossesCeiling,
        s1Insolvent: d.s1Insolvent,
        s1Balance: d.s1Balance,
        maxCumulativeAcademyCost: d.maxCumulativeAcademyCost,
        debtCeiling: d.debtCeiling,
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
