#!/usr/bin/env node
// Sim-harness + kalibrerings-gate for daglig træning (#1305) — spec afsnit 13.
//
// Formål: DETERMINISTIC dry-run (ingen DB, ingen Math.random/Date.now) over en
// simuleret population. Måler to scorecards:
//
//  1. PEAK-ALDER: 18-19-årige debutanter under daglig træning topper ved alder
//     27-28 (median) — spec 5.2 (peak efter 9-10 sæsoner).
//
//  2. HUMAN/AI-DRIFT: AI-hold får kun sæsonvis L0 (ingen daglig træning).
//     Drift = (human − ai)/ai × 100 pr. sæson. Spec 9.1: ejer genkalibrerer
//     hvis AI falder >10 % bagud efter 3 sæsoner (harnesset leverer baseline-tal).
//
// DETERMINISME-NOTER:
//  • Begge kohorter kører fra IDENTISKE start-abilities (populationen genereres ÉN
//    gang, deep-copy pr. kohort).
//  • riderId til seeding: "human:<idx>" / "ai:<idx>" — stabile, ingen DB-id.
//  • dateStr: "s<season>d<day>" — ingen reelle datoer.
//  • Pensionerede ryttere fryses fra og med den sæson de trækker sig (sidst kendte
//    ability-sum fastholdes) og MEDTAGES i drift-snittet som stabil observation —
//    begge kohorter pensionerer ens (samme seeds), så driften forvrides ikke.
//
// KALIBRERING (2026-06-12) — SUPERSEDET af #2082-fixet nedenfor, se ny måling:
//  dailyBudgetBoost = 1.0 → seed 2026: median peak-alder 27 ✓  (n=17 debutanter)
//                            seed 7:    median peak-alder 27 ✓  (n=19 debutanter)
//                            seed 42:   median peak-alder 27 ✓  (n=25 debutanter)
//  Alle tre seeds: GATE PASS. Dette resultat brugte DAYS=28 (buggy — se #2082-FIX
//  punkt 2) og manglede potentiale-parameteren (punkt 1), så det målte IKKE prods
//  faktiske vækst-hastighed. Ny måling efter fix (samme 3 seeds, --real-days=60):
//  median peak-alder 22-23 ∉ {27,28} → GATE FAIL på alle tre. Ryttere topper altså
//  ~5 sæsoner for tidligt i prod — konsistent med akademi-empirien i #2082.
//  Human/AI-drift S3: ~8 % (alle seeds, uændret rækkefølge ift. tidligere ~2 %-fund
//  — drift-formlen selv er ikke ramt af #2082-bugsne, men absolut-tallene skifter
//  når human-siden simuleres korrekt). Stadig under spec 9.1's 10%-grænse ved S3.
//  Drift vokser til ~22-23 % ved S8 (decline er sæsonbaseret for begge, men AI
//  falder hurtigere uden daglig progress til at modvirke).
//
//  AKADEMI-KOHORTE (scorecard 4, ny 2026-07-05): 16-19 år, pot 4-6, n=4-7 pr. seed.
//  Gap mod ungdoms-loft lukkes 78-80 % ALLEREDE efter sæson 1 og ~97-99 % efter
//  sæson 3-4 (alle 3 seeds) — ejerens mål er ~50 % lukket efter 5-7 sæsoner (issue-
//  kommentar 2/7). Dette BEKRÆFTER kvantitativt hovedproblemet i #2082: akademi-
//  ryttere udvikler sig 5-7× for hurtigt mod deres loft. Point-gevinst/10 dage
//  (sæson 1) matcher prod-empirien i størrelsesorden (sim ⌀ 32 vs. prod ⌀ 25.3),
//  hvilket validerer at harnesset nu er retvisende for kalibrerings-arbejdet.
//
//  INTET REKALIBRERET ENDNU — kun harness+scorecard-fix. Rekalibrering (fx dæmp
//  youthMultiplier/rateByPotential, hård dags-cap) er ejer-beslutning 6/7 (#2082).
//
// #2082-FIX (2026-07-05): gaten validerede IKKE det system der kører i prod:
//  1. applyDailyTick kaldtes UDEN potentiale → youthRateForPotential(undefined)=0.6
//     for ALLE i sim, mens prod bruger 0.6-1.35 pr. potentiale (fixet — se pot-param).
//  2. DAYS var trainCfg.daysPerSeason (28, en BUDGET-RATE-konstant), men prod-sæson
//     kører ~60+ kalenderdage/tick → 2,1× flere e-folds end simuleret (fixet — DAYS
//     er nu et separat --real-days CLI-flag, default 60).
//  3. Ingen akademi-kohorte-segment: 16-19-årige (pot 4-6) er "præcis dér problemet
//     bor" (prod-empiri 22/6-1/7: +25,3 pt/10 dage i snit, værste +156 pt/10 dage
//     16 år pot 6). Tilføjet SCORECARD 4 nedenfor: dedikeret akademi-simulering med
//     ungdoms-caps (buildYouthCaps, #1791) der skifter til voksen-caps ved alder 22+
//     (matcher buildCapsForRider), + gap-lukning pr. sæson mod ejerens mål
//     (~50 % af gappet lukket efter 5-7 sæsoner, jf. issue-kommentar 2/7).
//
// Kør: node scripts/previewDailyTraining.js [--seasons=12] [--count=400] \
//                                           [--seed=2026] [--real-days=60] [--enforce-targets]
//      (eller: npm run training:gate)

import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import {
  buildCaps,
  buildYouthCaps,
  developRiderSeason,
  PROGRESSION_CONFIG,
  YOUTH_PROGRESSION_CONFIG,
} from "../lib/riderProgression.js";
import {
  DAILY_TRAINING_CONFIG,
  resolveProgram,
  applyDailyTick,
} from "../lib/dailyTraining.js";
import {
  nextFatigue,
  nextForm,
  conditionMultiplier,
} from "../lib/riderCondition.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { isAcademyAge } from "../lib/academyFlag.js";

// ── CLI-args (spejler simulateSeasonDryRun.js) ────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEED = parseInt(arg("seed", "2026"), 10);
const SEASONS = parseInt(arg("seasons", "12"), 10);
const COUNT = parseInt(arg("count", "400"), 10);
const ENFORCE_TARGETS = !!arg("enforce-targets", false);
const REFERENCE_YEAR = 2026;

const cfg = PROGRESSION_CONFIG;
const trainCfg = DAILY_TRAINING_CONFIG;
// #2082: trainCfg.daysPerSeason (28) er en BUDGET-RATE-konstant (dailyAbilityDelta
// deler gap-brøken over denne værdi), IKKE antal daglige ticks i simuleringsløkken.
// Prod kører ét tick pr. kalenderdag i en ~60+ dages sæson (server-cron), så
// loopet herunder skal iterere over den REELLE sæsonlængde — ellers underkøres
// budgettet med ~2,1× (28 vs ~60 e-folds pr. sæson).
const REAL_DAYS_PER_SEASON = parseInt(arg("real-days", "60"), 10);
const DAYS = REAL_DAYS_PER_SEASON;

const padE = (s, n) => String(s).padEnd(n);
const fmt1 = (n) => n.toFixed(1);

console.log(`\n🚴  TRAINING-GATE — seed=${SEED} count=${COUNT} seasons=${SEASONS} dailyBudgetBoost=${trainCfg.dailyBudgetBoost} (in-memory, rører ikke prod)\n`);

// ── 1. Generér population ÉN gang ────────────────────────────────────────────
const { riders: raw } = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR });

// Byd abilities og caps; gem start-state til deep-copy.
const population = raw.map((r, i) => {
  const startAbilities = deriveAbilities({}, { ...r, id: `base:${i}` }, { asOfYear: REFERENCE_YEAR });
  // Fjern rider_id/formula_version fra abilities-objektet (ikke evner)
  const abilities = {};
  for (const ab of VISIBLE_ABILITIES) {
    if (startAbilities[ab] != null) abilities[ab] = startAbilities[ab];
  }
  const primaryType = r._meta.archetype;
  const potentiale = r.potentiale;
  const startAge = r._meta.age;
  const caps = buildCaps(abilities, primaryType, potentiale, cfg);
  // Sekundær type (kun brugt til akademi-loftets rolle-faktor, #2082 scorecard 4) —
  // genbruger prod-koden computeRiderTypes (samme klassifikation som rider_types-kolonnen).
  const secondaryType = computeRiderTypes(abilities).secondary?.key ?? primaryType;
  // Ungdoms-loft er konstant over hele akademi-alderen (kun potentiale+type-afhængigt,
  // IKKE alders- eller baseline-afhængigt) → beregnes ÉN gang her, ligesom voksen-caps.
  const youthCaps = buildYouthCaps(potentiale, primaryType, secondaryType, YOUTH_PROGRESSION_CONFIG);
  return { i, primaryType, secondaryType, potentiale, startAge, abilities, caps, youthCaps };
});

// ── 2. Hjælpere ──────────────────────────────────────────────────────────────
function abilitySum(abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) s += abilities[ab] ?? 0;
  return s;
}

function deepCopyAbilities(ab) {
  const out = {};
  for (const k of VISIBLE_ABILITIES) if (ab[k] != null) out[k] = ab[k];
  return out;
}

// ── 3. Simulerings-løkke pr. kohort ──────────────────────────────────────────
// history[i][s] = abilitySum efter sæson s (0-indekseret sæson = sæson 1)
function simulateCohort(label) {
  const isHuman = label === "human";
  const history = Array.from({ length: COUNT }, () => []);
  const retired = new Array(COUNT).fill(false);

  // Start-abilities: deep-copy fra population
  const abilityState = population.map((p) => deepCopyAbilities(p.abilities));
  const progressState = population.map(() => ({}));

  for (let s = 0; s < SEASONS; s++) {
    // Condition: form og træthed nulstilles sæsonvis (frisk sæson-start)
    const fatigue = new Array(COUNT).fill(30);
    const form    = new Array(COUNT).fill(40);

    for (let i = 0; i < COUNT; i++) {
      if (retired[i]) {
        // Frys historien — ingen nye sæsoner
        history[i].push(history[i][history[i].length - 1] ?? abilitySum(abilityState[i]));
        continue;
      }

      const p = population[i];
      const currentAge = p.startAge + s;
      const riderId = `${label}:${i}`;

      if (isHuman) {
        // ── DAGLIG TRÆNING ──────────────────────────────────────────────────
        const prog = resolveProgram({ focus: "endurance", intensity: "normal" });

        for (let d = 0; d < DAYS; d++) {
          const intensity = d % 7 === 0 ? "rest" : prog.intensity;
          const actualProg = d % 7 === 0
            ? resolveProgram({ focus: prog.focus, intensity: "rest" })
            : prog;

          const condMult = conditionMultiplier({ form: form[i], fatigue: fatigue[i] });
          // Deterministisk "klik"-rate: ~60 % (dag * 7 + sæson) % 10 < 6
          const bonus = (d * 7 + s) % 10 < 6;

          const dateStr = `s${s}d${d}`;
          const tickResult = applyDailyTick({
            riderId,
            dateStr,
            age: currentAge,
            abilities: abilityState[i],
            caps: p.caps,
            progress: progressState[i],
            program: actualProg,
            conditionMult: condMult,
            bonus,
            potentiale: p.potentiale, // #2082: manglede — youthRateForPotential(undefined)=0.6 for ALLE uden denne
          });

          abilityState[i] = tickResult.abilities;
          progressState[i] = tickResult.progress;

          // Opdatér form/træthed
          fatigue[i] = nextFatigue({ fatigue: fatigue[i], intensity, recoveryAbility: abilityState[i].recovery ?? 50 });
          form[i]    = nextForm({ form: form[i], fatigue: fatigue[i] });
        }

        // Sæsonvis: KUN decline + retirement (skipGrowth=true for human)
        const riderObj = { id: riderId, primary_type: p.primaryType, potentiale: p.potentiale, age: currentAge };
        const { next, retirement } = developRiderSeason(
          riderObj,
          abilityState[i],
          p.caps,
          s + 1,
          cfg,
          null,
          { skipGrowth: true }
        );
        abilityState[i] = next;
        if (retirement.retire) retired[i] = true;

      } else {
        // ── AI: ren sæsonvis L0 (ingen daglig træning) ──────────────────────
        const riderObj = { id: riderId, primary_type: p.primaryType, potentiale: p.potentiale, age: currentAge };
        const { next, retirement } = developRiderSeason(
          riderObj,
          abilityState[i],
          p.caps,
          s + 1,
          cfg,
          null,
          {}
        );
        abilityState[i] = next;
        if (retirement.retire) retired[i] = true;
      }

      history[i].push(abilitySum(abilityState[i]));
    }
  }

  return history;
}

// ── Akademi-kohorte (#2082 scorecard 4): startAlder 16-19, potentiale 4-6 ──────
// "Præcis dér problemet bor" (issue #2082). Kører SAMME daglige tick-motor som
// "human"-kohorten ovenfor, men skifter caps pr. sæson efter alder — ungdoms-
// caps (buildYouthCaps, afkoblet fra baseline) mens rytteren er i akademi-alderen
// (ACADEMY.MIN_AGE-MAX_AGE), voksen-caps (p.caps) derefter — matcher
// buildCapsForRider (#2001) i prod. Den generelle simulateCohort() ovenfor bruger
// KUN voksen-caps hele livet og måler derfor ikke ungdoms-loftets adfærd.
const academyCohort = population.filter(
  (p) => p.startAge >= 16 && p.startAge <= 19 && p.potentiale >= 4 && p.potentiale <= 6
);

function simulateAcademyMember(p) {
  let abilityState = deepCopyAbilities(p.abilities);
  let progressState = {};
  const seasonEndSums = [];
  const seasonEndGaps = []; // (capSum - abilitySum) pr. sæson, kun mens akademi-alder; null derefter
  let day10Sum = null; // abilitySum efter dag 10 i sæson 0 — matcher prod-empiriens "pr. 10 dage"
  let retired = false;

  for (let s = 0; s < SEASONS; s++) {
    if (retired) {
      seasonEndSums.push(seasonEndSums[seasonEndSums.length - 1] ?? abilitySum(abilityState));
      seasonEndGaps.push(null);
      continue;
    }
    const currentAge = p.startAge + s;
    const inAcademy = isAcademyAge(currentAge);
    const caps = inAcademy ? p.youthCaps : p.caps;
    const riderId = `academy:${p.i}`;

    let fatigue = 30, form = 40;
    const prog = resolveProgram({ focus: "endurance", intensity: "normal" });

    for (let d = 0; d < DAYS; d++) {
      const intensity = d % 7 === 0 ? "rest" : prog.intensity;
      const actualProg = d % 7 === 0
        ? resolveProgram({ focus: prog.focus, intensity: "rest" })
        : prog;
      const condMult = conditionMultiplier({ form, fatigue });
      const bonus = (d * 7 + s) % 10 < 6;
      const dateStr = `s${s}d${d}`;
      const tickResult = applyDailyTick({
        riderId,
        dateStr,
        age: currentAge,
        abilities: abilityState,
        caps,
        progress: progressState,
        program: actualProg,
        conditionMult: condMult,
        bonus,
        potentiale: p.potentiale,
      });
      abilityState = tickResult.abilities;
      progressState = tickResult.progress;
      fatigue = nextFatigue({ fatigue, intensity, recoveryAbility: abilityState.recovery ?? 50 });
      form = nextForm({ form, fatigue });

      if (s === 0 && d === 9) day10Sum = abilitySum(abilityState);
    }

    const riderObj = { id: riderId, primary_type: p.primaryType, potentiale: p.potentiale, age: currentAge };
    const { next, retirement } = developRiderSeason(
      riderObj, abilityState, caps, s + 1, cfg, null, { skipGrowth: true }
    );
    abilityState = next;
    if (retirement.retire) retired = true;

    seasonEndSums.push(abilitySum(abilityState));
    seasonEndGaps.push(inAcademy ? Math.max(0, abilitySum(caps) - abilitySum(abilityState)) : null);
  }

  const initialGap = Math.max(0, abilitySum(p.youthCaps) - abilitySum(p.abilities));
  return { p, seasonEndSums, seasonEndGaps, day10Sum, initialGap, startSum: abilitySum(p.abilities) };
}

const t0 = Date.now();
const humanHistory = simulateCohort("human");
const aiHistory    = simulateCohort("ai");
const academyResults = academyCohort.map(simulateAcademyMember);
const elapsed = Date.now() - t0;

// ── 4. SCORECARD 1: Peak-alder for debutanter (≤19 ved sæson 0) ─────────────
const debutants = population.filter((p) => p.startAge <= 19);
const peakAges = debutants.map((p) => {
  const hist = humanHistory[p.i];
  // ArgMax over ability-sum-historien
  let maxVal = -Infinity, maxS = 0;
  for (let s = 0; s < hist.length; s++) {
    if (hist[s] > maxVal) { maxVal = hist[s]; maxS = s; }
  }
  return p.startAge + maxS; // alder ved peak-sæson
});

peakAges.sort((a, b) => a - b);
const medianPeakAge = peakAges.length
  ? peakAges[Math.floor(peakAges.length / 2)]
  : NaN;

// ── 5. SCORECARD 2: Human/AI-drift pr. sæson ─────────────────────────────────
const driftRows = [];
for (let s = 0; s < SEASONS; s++) {
  let humanSum = 0, aiSum = 0, n = 0;
  for (let i = 0; i < COUNT; i++) {
    const h = humanHistory[i][s];
    const a = aiHistory[i][s];
    if (h == null || a == null) continue;
    humanSum += h;
    aiSum += a;
    n++;
  }
  const humanAvg = n ? humanSum / n : 0;
  const aiAvg    = n ? aiSum / n : 0;
  const drift    = aiAvg ? ((humanAvg - aiAvg) / aiAvg) * 100 : 0;
  driftRows.push({ season: s + 1, humanAvg, aiAvg, drift, n });
}

// ── 6. SANITY: gennemsnitlige dage pr. +1 ability-point (alder 19 vs 25) ─────
// Bruger population's abilities + caps + boost til at estimere: ved alder A,
// hvormange dage kræves for ét +1 i en signatur-evne på medianen?
function avgDaysPerPoint(age) {
  // Gennemsnit over alle ryttere: daglig delta mod caps i signatur-evnen
  const deltas = population.map((p) => {
    // Find signatur-evne: tag den med størst cap-gap
    let bestAb = null, bestGap = 0;
    for (const ab of VISIBLE_ABILITIES) {
      const gap = (p.caps[ab] ?? 0) - (p.abilities[ab] ?? 0);
      if (gap > bestGap) { bestGap = gap; bestAb = ab; }
    }
    if (!bestAb || bestGap <= 0) return null;
    // Simpel delta: base = gap × growthFrac × boost / days (ingen condition/bonus — bare basis-raten)
    const { growthFractionByAge } = PROGRESSION_CONFIG;
    let frac = growthFractionByAge[growthFractionByAge.length - 1].frac;
    for (const row of growthFractionByAge) {
      if (age <= row.maxAge) { frac = row.frac; break; }
    }
    const delta = (bestGap * frac * trainCfg.dailyBudgetBoost) / DAYS;
    return delta > 0 ? 1 / delta : null;
  }).filter((x) => x != null);

  if (!deltas.length) return NaN;
  return deltas.reduce((s, v) => s + v, 0) / deltas.length;
}

const daysPerPointAge19 = avgDaysPerPoint(19);
const daysPerPointAge25 = avgDaysPerPoint(25);

// ── 7. SCORECARD 4: Akademi-kohorte (16-19, pot 4-6) ─────────────────────────
// (a) Point-gevinst pr. 10 dage (sæson 1) — direkte sammenlignelig med
//     prod-empirien i issue #2082 (22/6-1/7, 1.488 ryttere): +25,3 pt/10 dage i
//     snit, værste +156 pt/10 dage (16 år, pot 6).
const gain10 = academyResults
  .map((r) => (r.day10Sum != null ? r.day10Sum - r.startSum : null))
  .filter((x) => x != null);
const avgGain10 = gain10.length ? gain10.reduce((s, v) => s + v, 0) / gain10.length : NaN;
const worstGain10 = gain10.length ? Math.max(...gain10) : NaN;

// (b) Gap-lukning pr. sæson mod ejerens mål: ~50 % lukket efter 5-7 sæsoner
//     (issue-kommentar 2/7), dvs. ~9-13 %/sæson af REST-gappet, aftagende kurve.
const gapRows = [];
for (let s = 0; s < SEASONS; s++) {
  let fracSum = 0, n = 0;
  for (const r of academyResults) {
    const gapNow = r.seasonEndGaps[s];
    if (gapNow == null || r.initialGap <= 0) continue;
    fracSum += (r.initialGap - gapNow) / r.initialGap;
    n++;
  }
  gapRows.push({ season: s + 1, avgFracClosed: n ? fracSum / n : null, n });
}

// ── 8. OUTPUT ─────────────────────────────────────────────────────────────────
console.log("─".repeat(80));
console.log("1. PEAK-ALDER SCORECARD — debutanter (startAlder ≤ 19)\n");
console.log(`   n=${debutants.length}   median peak-alder=${medianPeakAge}   (mål: 27-28)`);
if (peakAges.length) {
  const p25 = peakAges[Math.floor(peakAges.length * 0.25)];
  const p75 = peakAges[Math.floor(peakAges.length * 0.75)];
  console.log(`   p25=${p25}   p75=${p75}   min=${peakAges[0]}   max=${peakAges[peakAges.length - 1]}`);
}

const gatePass = medianPeakAge === 27 || medianPeakAge === 28;
if (gatePass) {
  console.log(`\n   ✓ GATE PASS — median peak-alder ${medianPeakAge} ∈ {27, 28}`);
} else {
  console.log(`\n   ✗ GATE FAIL — median peak-alder ${medianPeakAge} ∉ {27, 28}`);
}

console.log(`\n${"─".repeat(80)}`);
console.log("2. HUMAN/AI DRIFT BASELINE — pr. sæson\n");
console.log(`   ${padE("Sæson", 7)}${padE("human ⌀", 11)}${padE("ai ⌀", 11)}${padE("drift", 9)}note`);
console.log(`   ${"-".repeat(52)}`);
for (const row of driftRows) {
  const driftStr = `${row.drift >= 0 ? "+" : ""}${fmt1(row.drift)}%`;
  const note = row.season === 3 ? " ← spec 9.1-grænse (>10% → revurdér)" : "";
  const flag = Math.abs(row.drift) > 10 && row.season <= 3 ? " ⚠" : "";
  console.log(`   ${padE(`S${row.season}`, 7)}${padE(fmt1(row.humanAvg), 11)}${padE(fmt1(row.aiAvg), 11)}${padE(driftStr, 9)}${note}${flag}`);
}

console.log(`\n${"─".repeat(80)}`);
console.log("3. SANITY — dage pr. +1 ability-point (basis-rate, ingen bonus/condition)\n");
console.log(`   Alder 19: ~${fmt1(daysPerPointAge19)} dage/+1   ·   Alder 25: ~${fmt1(daysPerPointAge25)} dage/+1`);
console.log(`   (Chunky-progress check: 25 bør være mærkbart langsommere end 19)`);

console.log(`\n${"─".repeat(80)}`);
console.log("4. AKADEMI-KOHORTE (startAlder 16-19, potentiale 4-6) — #2082\n");
console.log(`   n=${academyCohort.length}`);
console.log(`\n   (a) Point-gevinst pr. 10 dage (sæson 1) — sammenlign mod prod-empiri:`);
console.log(`       Sim:  ⌀=${fmt1(avgGain10)} pt/10 dage   ·   værste=${fmt1(worstGain10)} pt/10 dage`);
console.log(`       Prod (22/6-1/7, jf. #2082): ⌀=25.3 pt/10 dage   ·   værste=156 pt/10 dage (16 år, pot 6)`);

console.log(`\n   (b) Gap-lukning pr. sæson mod ungdoms-loft (ejer-mål 2/7: ~50% lukket efter 5-7 sæsoner):`);
console.log(`   ${padE("Sæson", 7)}${padE("⌀ lukket", 11)}${padE("n", 6)}note`);
console.log(`   ${"-".repeat(45)}`);
for (const row of gapRows) {
  if (row.avgFracClosed == null) break; // alle ude af akademi-alder herfra
  const pctStr = `${fmt1(row.avgFracClosed * 100)}%`;
  const note = row.season === 5 || row.season === 7 ? " ← ejer-mål-vindue (~50%)" : "";
  console.log(`   ${padE(`S${row.season}`, 7)}${padE(pctStr, 11)}${padE(String(row.n), 6)}${note}`);
}

console.log(`\n${"─".repeat(80)}`);
console.log(`Køretid: ${elapsed} ms   ·   dailyBudgetBoost=${trainCfg.dailyBudgetBoost}   ·   daysPerSeason=${DAYS}`);
console.log(`Færdig. Read-only — intet skrevet til prod/DB.`);

if (!gatePass && ENFORCE_TARGETS) {
  console.log(`\n❌ GATE FAIL + --enforce-targets → exit 1`);
  process.exit(1);
}
