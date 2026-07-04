#!/usr/bin/env node
// READ-ONLY rekalibrerings-analyse for #2082 — ingen prod-mutation, ingen schema-ændring.
// Untracked artifakt (beslutningsstøtte til ejer-review 6/7), IKKE en permanent gate
// (den er scripts/previewDailyTraining.js, som allerede er fixet i PR #2200).
//
// BAGGRUND (research 5/7): der findes INGEN fast sæsonlængde i kodebasen. Sæson-1 har
// kørt siden 8/5-2026 og er stadig ÅBEN i dag (~57+ dage) — transfer-vinduet lukkes
// administrativt (closes_at + readiness-gates), ikke efter et fast dagtal.
// DAILY_TRAINING_CONFIG.daysPerSeason=28 er en race-kalender-batch-størrelse
// (raceCalendarLanePacker.js), IKKE en sæson-længde-konstant den blev genbrugt fra.
//
// KONSEKVENS: at rette daysPerSeason til et nyt FAST tal (60 el. andet) løser IKKE
// problemet strukturelt — næste gang en sæson kører længe (som S1 allerede gør),
// overskyder systemet igen, ubegrænset, fordi der intet loft er på "denne sæsons andel".
//
// Dette script simulerer derfor 3 kandidater over et SWEEP af dagtal (30/60/90/120),
// for at vise at kun én af dem er STABIL uanset hvor længe sæsonen rent faktisk varer:
//
//  0. NUVÆRENDE (uændret prod-formel): dagligt tick mod LIVSTIDS-loftet, ingen
//     sæson-budget-grænse. Vokser ubegrænset med flere dage — dette ER bugget.
//  1. SÆSON-BUDGET-CAP: samme daglige formel, men det EFFEKTIVE loft for sæsonens
//     dage fastfryses ved sæson-start til seasonStart + gap×frac×growthMult (samme
//     additive mål som L0's sæsonvise skridt, stepAbility). Når dette er nået,
//     stopper væksten NATURLIGT (gap→0) resten af sæsonen — uanset hvor mange dage
//     der er tilbage. Selvkorrigerende for variabel sæsonlængde.
//  2. SÆSON-BUDGET-CAP + HÅRD DAGS-CAP (ejerens forslag): som 1, men clamper også
//     hver evnes daglige gevinst til maks +1/dag — værn mod enkelt-dags-spikes
//     (adresserer prod-empiriens "værste +156 pt/10 dage" outlier-case).
//
// Kør: node scripts/trainingRecalibrationCandidates.js [--seed=2026] [--count=400]

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
  resolveProgram,
  applyDailyTick,
  growthFractionForAge,
} from "../lib/dailyTraining.js";
import {
  nextFatigue,
  nextForm,
  conditionMultiplier,
} from "../lib/riderCondition.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { isAcademyAge } from "../lib/academyFlag.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEED = parseInt(arg("seed", "2026"), 10);
const COUNT = parseInt(arg("count", "400"), 10);
const REFERENCE_YEAR = 2026;
const cfg = PROGRESSION_CONFIG;
const SEASONS = 12; // #2082-krav: simulér over 10-12 sæsoner til ejer-scorecard
const DAY_SWEEP = [28, 60, 90, 120]; // "hvor mange dage varede sæsonen rent faktisk"

// Ejer-godkendt 5/7: aftagende akademi-rate (mere synlig fremgang tidligt, samme
// ~50%-ved-S5-7-slutmål som en flad 0.11). Season-index 0-baseret (s=0 → sæson 1).
function academySeasonFrac(seasonIndex) {
  if (seasonIndex < 2) return 0.16;  // sæson 1-2
  if (seasonIndex < 4) return 0.11;  // sæson 3-4
  return 0.08;                        // sæson 5+
}

const fmt1 = (n) => n.toFixed(1);
const padE = (s, n) => String(s).padEnd(n);

function abilitySum(abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) s += abilities[ab] ?? 0;
  return s;
}
// Pr.-evne clampet gap-sum (IKKE aggregate-sum-så-clamp) — off-type-evner ligger tit
// allerede over deres lave ungdomsloft ved baseline; et aggregate-clamp lader det
// negative bidrag skjule sig og kan overdrive "gap lukket %" for kohorten.
function clampedGapSum(caps, abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) {
    const cur = abilities[ab] ?? 0;
    const cap = caps?.[ab] ?? cur;
    s += Math.max(0, cap - cur);
  }
  return s;
}
function deepCopyAbilities(ab) {
  const out = {};
  for (const k of VISIBLE_ABILITIES) if (ab[k] != null) out[k] = ab[k];
  return out;
}

// ── Population (identisk metode med previewDailyTraining.js) ────────────────
const { riders: raw } = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR });
const population = raw.map((r, i) => {
  const startAbilities = deriveAbilities({}, { ...r, id: `base:${i}` }, { asOfYear: REFERENCE_YEAR });
  const abilities = {};
  for (const ab of VISIBLE_ABILITIES) if (startAbilities[ab] != null) abilities[ab] = startAbilities[ab];
  const primaryType = r._meta.archetype;
  const potentiale = r.potentiale;
  const startAge = r._meta.age;
  const caps = buildCaps(abilities, primaryType, potentiale, cfg);
  const secondaryType = computeRiderTypes(abilities).secondary?.key ?? primaryType;
  const youthCaps = buildYouthCaps(potentiale, primaryType, secondaryType, YOUTH_PROGRESSION_CONFIG);
  return { i, primaryType, secondaryType, potentiale, startAge, abilities, caps, youthCaps };
});

const academyCohort = population.filter(
  (p) => p.startAge >= 16 && p.startAge <= 19 && p.potentiale >= 4 && p.potentiale <= 6
);

// ── Kandidat-simulering ───────────────────────────────────────────────────────
// mode: "current" | "budget" | "budget+cap"
function simulateAcademyMember(p, daysPerSeasonActual, mode) {
  let abilityState = deepCopyAbilities(p.abilities);
  let progressState = {};
  const seasonEndSums = [];
  const seasonEndGaps = []; // mod lifetime youthCaps, kun mens akademi-alder
  let day10Sum = null;
  let retired = false;

  for (let s = 0; s < SEASONS; s++) {
    if (retired) {
      seasonEndSums.push(seasonEndSums[seasonEndSums.length - 1] ?? abilitySum(abilityState));
      seasonEndGaps.push(null);
      continue;
    }
    const currentAge = p.startAge + s;
    const inAcademy = isAcademyAge(currentAge);
    const lifetimeCaps = inAcademy ? p.youthCaps : p.caps;
    const riderId = `cand:${p.i}`;
    const seasonStartAbilities = deepCopyAbilities(abilityState);

    // Sæson-budget-cap (kandidat 1+2): fastfrys et EFFEKTIVT loft for denne sæsons
    // dage = seasonStart + (lifetimeCap - seasonStart) × frac × growthMult — samme
    // additive mål som L0's sæsonvise skridt (stepAbility). "current" (kandidat 0)
    // bruger i stedet lifetime-loftet direkte hele sæsonen (= dagens prod-adfærd).
    let tickCaps = lifetimeCaps;
    if (mode === "budget" || mode === "budget+cap") {
      const frac = growthFractionForAge(currentAge);
      tickCaps = {};
      for (const ab of VISIBLE_ABILITIES) {
        const cur = seasonStartAbilities[ab] ?? 0;
        const life = lifetimeCaps[ab] ?? cur;
        const gap = Math.max(0, life - cur);
        tickCaps[ab] = cur + gap * frac; // NB: growthMult (youth/pot) ligger allerede i dailyAbilityDelta
      }
    } else if (mode === "budget-tuned") {
      // Ejer-godkendt 5/7: aftagende akademi-rate (0.16→0.11→0.08, se academySeasonFrac
      // ovenfor) i stedet for en flad 0.11 — samme ~50%-ved-S5-7-slutmål, men mere synlig
      // fremgang for nye akademi-spillere i sæson 1-2. growthFractionForAge (0.35 for ≤19)
      // er den ALMINDELIGE voksen-progressions-rate — for hurtig til akademiets
      // specifikke "luk gap over en lang ungdomskarriere"-mål.
      const frac = academySeasonFrac(s);
      tickCaps = {};
      for (const ab of VISIBLE_ABILITIES) {
        const cur = seasonStartAbilities[ab] ?? 0;
        const life = lifetimeCaps[ab] ?? cur;
        const gap = Math.max(0, life - cur);
        tickCaps[ab] = cur + gap * frac;
      }
    }

    let fatigue = 30, form = 40;
    const prog = resolveProgram({ focus: "endurance", intensity: "normal" });

    for (let d = 0; d < daysPerSeasonActual; d++) {
      const intensity = d % 7 === 0 ? "rest" : prog.intensity;
      const actualProg = d % 7 === 0 ? resolveProgram({ focus: prog.focus, intensity: "rest" }) : prog;
      const condMult = conditionMultiplier({ form, fatigue });
      const bonus = (d * 7 + s) % 10 < 6;
      const dateStr = `s${s}d${d}`;

      let tickResult = applyDailyTick({
        riderId, dateStr, age: currentAge, abilities: abilityState, caps: tickCaps,
        progress: progressState, program: actualProg, conditionMult: condMult, bonus,
        potentiale: p.potentiale,
      });

      if (mode === "budget+cap" || mode === "current+cap" || mode === "budget-tuned") {
        // Hård dags-cap: clamp hver evnes daglige gevinst til maks +1/dag.
        const clampedAbilities = { ...abilityState };
        for (const ab of VISIBLE_ABILITIES) {
          const before = abilityState[ab] ?? 0;
          const after = tickResult.abilities[ab] ?? before;
          clampedAbilities[ab] = Math.min(after, before + 1);
        }
        tickResult = { ...tickResult, abilities: clampedAbilities };
      }

      abilityState = tickResult.abilities;
      progressState = tickResult.progress;
      fatigue = nextFatigue({ fatigue, intensity, recoveryAbility: abilityState.recovery ?? 50 });
      form = nextForm({ form, fatigue });
      if (s === 0 && d === 9) day10Sum = abilitySum(abilityState);
    }

    const riderObj = { id: riderId, primary_type: p.primaryType, potentiale: p.potentiale, age: currentAge };
    const { next, retirement } = developRiderSeason(
      riderObj, abilityState, lifetimeCaps, s + 1, cfg, null, { skipGrowth: true }
    );
    abilityState = next;
    if (retirement.retire) retired = true;

    seasonEndSums.push(abilitySum(abilityState));
    seasonEndGaps.push(inAcademy ? clampedGapSum(lifetimeCaps, abilityState) : null);
  }

  const initialGap = clampedGapSum(p.youthCaps, p.abilities);
  return { seasonEndGaps, day10Sum, initialGap, startSum: abilitySum(p.abilities) };
}

function runCandidate(mode, daysPerSeasonActual) {
  const results = academyCohort.map((p) => simulateAcademyMember(p, daysPerSeasonActual, mode));
  const gain10 = results.map((r) => (r.day10Sum != null ? r.day10Sum - r.startSum : null)).filter((x) => x != null);
  const avgGain10 = gain10.length ? gain10.reduce((s, v) => s + v, 0) / gain10.length : NaN;
  const worstGain10 = gain10.length ? Math.max(...gain10) : NaN;

  const gapRows = [];
  for (let s = 0; s < SEASONS; s++) {
    let fracSum = 0, n = 0;
    for (const r of results) {
      const gapNow = r.seasonEndGaps[s];
      if (gapNow == null || r.initialGap <= 0) continue;
      fracSum += (r.initialGap - gapNow) / r.initialGap;
      n++;
    }
    gapRows.push({ season: s + 1, avgFracClosed: n ? fracSum / n : null, n });
  }
  return { avgGain10, worstGain10, gapRows };
}

// ── OUTPUT ────────────────────────────────────────────────────────────────────
console.log(`\n🔬 REKALIBRERINGS-ANALYSE — #2082 (n=${academyCohort.length} akademi-kohorte, seed=${SEED})\n`);
console.log("Mål (ejer 2/7): ~50% af ungdoms-loft-gap lukket efter 5-7 sæsoner (~9-13%/sæson, aftagende).\n");

for (const mode of ["current", "current+cap", "budget", "budget+cap", "budget-tuned"]) {
  const label = { current: "0. NUVÆRENDE (rate mod livstids-loft, intet sæson-budget)",
                  "current+cap": "0b. NUVÆRENDE + KUN HÅRD DAGS-CAP (+1/evne/dag, intet sæson-budget)",
                  budget: "1. SÆSON-BUDGET-CAP (growthFractionForAge — 0.35 for ≤19, for hurtig)",
                  "budget+cap": "2. SÆSON-BUDGET-CAP + HÅRD DAGS-CAP (samme frac som 1)",
                  "budget-tuned": "3. ANBEFALING: SÆSON-BUDGET-CAP (aftagende 0.16→0.11→0.08, ejer-valgt 5/7) + HÅRD DAGS-CAP" }[mode];
  console.log("─".repeat(80));
  console.log(label + "\n");
  console.log(`   ${padE("Sæson-længde:", 16)}${DAY_SWEEP.map((d) => padE(`${d}d`, 9)).join("")}`);
  const bySweep = DAY_SWEEP.map((d) => runCandidate(mode, d));
  for (let s = 0; s < SEASONS; s++) {
    const cells = bySweep.map((r) => {
      const row = r.gapRows[s];
      return row?.avgFracClosed != null ? padE(`${fmt1(row.avgFracClosed * 100)}%`, 9) : padE("-", 9);
    });
    if (cells.every((c) => c.trim() === "-")) break; // hele kohorten er ude af akademi-alder
    console.log(`   ${padE(`S${s + 1} ⌀ lukket:`, 16)}${cells.join("")}`);
  }
  console.log(`\n   Pt-gevinst/10 dage (sæson 1, ved 60d-sæson): ⌀=${fmt1(bySweep[1].avgGain10)}   værste=${fmt1(bySweep[1].worstGain10)}   (prod-empiri: ⌀25.3 / værste 156)`);
  console.log("");
}

console.log("─".repeat(80));
console.log("LÆSNING: kandidat 0's S1-tal VOKSER kraftigt fra venstre mod højre (28d→120d) —");
console.log("det ER strukturbugget: jo længere sæsonen rent faktisk varer, jo mere overskydes");
console.log("målet. Kandidat 1+2's rækker bør være ~STABILE på tværs af kolonnerne — uanset");
console.log("sæsonlængde nås samme sæsonvise gap-lukning, fordi væksten mætter ved budgettet.");
console.log("Færdig. Read-only — intet skrevet til prod/DB.");
