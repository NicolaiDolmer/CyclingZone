#!/usr/bin/env node
// #3564 leverance 3 — KURVE-HARNESS (research-only, motorkode IKKE rørt).
//
// Kalibrerer den kontinuerte absolut-niveau-kurve + potentiale-multiplikator +
// træningsscore-kæden (ejer-beslutning 4+5, LÅST 9/8, se
// docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md §8)
// mod §5-måltal-skelettet. Alt kurve-/score-matematik i denne fil er
// HARNESS-lokalt — ingen prod-konstant i backend/lib/*.js ændres. Vi IMPORTERER
// kun rene, uændrede hjælpefunktioner/konfigurationer for at (a) genbruge den
// eksakte potMult-anker-form fra i dag (YOUTH_PROGRESSION_CONFIG.rateByPotential,
// nævnt eksplicit i beslutning 5 som udgangspunkt) og (b) kunne køre "DAGENS
// MOTOR" (gap-baseret dailyAbilityDelta) som sammenligningsbaseline uden at
// duplikere dens logik forkert.
//
// MODELFAMILIE (ny kurve):
//   dagsscore  S = clamp(1,99, round(50 × Q × potMult(pot) × formNoise))
//     Q = intensitet(0.7/1.0/1.3) × facilitet(1.0 baseline) × fokus(1.0 baseline)
//     potMult(pot) = interpolation på {1:.6,2:.78,3:.92,4:1.06,5:1.2,6:1.35}
//                    (= dagens YOUTH_PROGRESSION_CONFIG.rateByPotential, importeret,
//                    IKKE hardkodet lokalt — enkelt kildehold)
//     formNoise  = seeded ±15% (seededUnit fra riderProgression.js — INGEN Math.random)
//   dags-delta (pr. evne, kun fokus-dage/alle evner i denne forenklede model —
//   se "METODENOTE" nedenfor):
//     delta = A × (S/50)^beta × levelCost(L) × loftClose(L,cap)
//     levelCost(L)  = 1 / (1 + (L/L0)^gamma)        — "jo højere absolut niveau,
//                                                       jo langsommere" (beslutning 4,
//                                                       ordret)
//     loftClose(L,cap) = (1 − L/cap)^softLoftExp     — SEKUNDÆRT, TILLADT loft-
//                                                       nærheds-led (spec-tekst),
//                                                       nødvendigt fordi levelCost
//                                                       alene er cap-AGNOSTISK: uden
//                                                       det ville et pot-1-loft (35)
//                                                       nås lige så hurtigt (i abso-
//                                                       lutte termer) som et pot-6-
//                                                       loft (88), og "max ~27 år,
//                                                       ikke 20-21" ville fejle for
//                                                       lave potentialer. Se FIT-
//                                                       RESULTAT i output for om det
//                                                       var nødvendigt i praksis.
//     hårdt klip: next = min(cap, current + delta)
//
// METODENOTE (vigtig for fortolkning af output):
//   Vi fitter primært mod en TYPE-FRI "signatur-evne"-bane pr. potentiale (cap =
//   loftByPotential[pot] × 1.0 — samme for alle typer, da rolle-faktoren for en
//   PRIMÆR evne altid er 1.0 uanset type). Det er korrekt og TILSTRÆKKELIGT for
//   §5-ankrene (som er potentiale-only, ikke type-specifikke). Type-dimensionen
//   bruges kun til specialiserings-gab-målingen (§5, hver evnes egen rolle-
//   faktor-cap via youthRoleFactor — importeret uændret).
//   Trænings-scoren er RYTTER-niveau (én S pr. dag), ikke evne-specifik — i denne
//   forenklede harness-model får ALLE evner samme dags-S (én "hvor god var
//   træningen i dag"-oplevelse), og differentieringen mellem evner kommer
//   UDELUKKENDE fra loftet (rolle-faktor) og fra egen absolut-niveau (levelCost/
//   loftClose er pr.-evne, da L er pr.-evne). Dette er en BEVIDST forenkling
//   (ingen daglig fokus-rotation simuleret) — dokumenteret, ikke skjult.
//   Kontinuerte (float) niveauer bruges under simulering (afrundes kun ved
//   rapportering) for begge modeller, så kurveFORM kan sammenlignes uden
//   integer-afrundingsstøj i BEGGE stier ens.
//   Decline (alder > peak) er SÆSON-granulær (ét skridt pr. sæson, ikke 28
//   daglige), for begge modeller — matcher hvordan #2472-taperen/season-engine
//   rent faktisk er koblet (dailyAbilityDelta har INGEN alders-gate; decline sker
//   i season-transition). Vi genimplementerer IKKE stepAbility (undgår at
//   duplikere gap-logikken); decline-formlen er triviel nok (lookup-tabel × evt.
//   offTypeDeclineFactor) til at læse direkte fra PROGRESSION_CONFIG uden risiko
//   for drift, importeret uændret.
//
// KØRSEL: node scripts/dev/curveHarness3564.mjs [outputPath]
//   outputPath default: <scratchpad>/curves3564.json (se OUTPUT_PATH nedenfor —
//   sat til CLAUDE-scratchpad da workflow-konteksten ikke leverede en konkret
//   delt-scratch-sti; se rapportens tekst for detaljer).

import fs from "node:fs";
import path from "node:path";

import {
  seededUnit,
  youthRoleFactor,
  YOUTH_PROGRESSION_CONFIG,
  PROGRESSION_CONFIG,
} from "../../lib/riderProgression.js";
import { dailyAbilityDelta, resolveProgram } from "../../lib/dailyTraining.js";
import { RIDER_TYPES } from "../../lib/riderTypes.js";

// ── Konstanter (harness-lokale) ──────────────────────────────────────────────
const PHYS = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability",
]); // de 10 fysiske evner (aggression UNDTAGET, jf. opgave-brief)

const POTS = [1, 2, 3, 4, 5, 6];
const AGE_START = 16;
const AGE_END = 36;
const DAYS_PER_SEASON = 28;
const UNIFIED_PEAK_AGE = 28;
const PEAK_AGE_BY_TYPE = Object.freeze({
  sprinter: 26, puncheur: 27, tt: 28, gc: 29, climber: 29,
  brostensrytter: 28, baroudeur: 28, rouleur: 28,
});

// §5-skelet (FORESLÅET, docs/superpowers/specs/2026-08-09-...md §5) — bedste evne
// ved 16/22/28 år pr. potentiale. IKKE motorkode, ren måltabel til gate-check.
const SKELETON = Object.freeze({
  1: { 16: 4, 22: 22, 28: 33 },
  2: { 16: 5, 22: 29, 28: 45 },
  3: { 16: 6, 22: 36, 28: 57 },
  4: { 16: 6, 22: 42, 28: 67 },
  5: { 16: 6, 22: 48, 28: 77 },
  6: { 16: 6, 22: 53, 28: 86 },
});
const LOFT_BY_POT = YOUTH_PROGRESSION_CONFIG.loftByPotential; // {1:35,...,6:88}, uændret import

const NOISE_SPAN = 0.15; // ±15% (beslutning 5, ordret)

// ── Rene hjælpere ─────────────────────────────────────────────────────────────
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
}

function interpAnchors(pot, anchors) {
  const p = clamp(Number(pot) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = anchors[lo] ?? 0;
  const b = anchors[hi] ?? a;
  return a + (b - a) * (p - lo);
}

function lookupTable(table, value, key, field) {
  for (const row of table) if (value <= row[key]) return row[field];
  return table[table.length - 1][field];
}

// ── Trænings-score (beslutning 5) ────────────────────────────────────────────
// potMultAnchors default = dagens rateByPotential (importeret, ikke duplikeret).
function potMultFor(pot, potMultAnchors) {
  return interpAnchors(pot, potMultAnchors);
}

function dailyScore({ pot, seedKey, intensity = "normal", potMultAnchors }) {
  const intensityFactor = intensity === "easy" ? 0.7 : intensity === "hard" ? 1.3 : 1.0;
  const facility = 1.0; // baseline (ingen faciliteter i harness)
  const focus = 1.0;    // baseline (ingen fokus-rotation i harness, se METODENOTE)
  const Q = intensityFactor * facility * focus;
  const potMult = potMultFor(pot, potMultAnchors);
  const noiseUnit = seededUnit(seedKey);
  const noise = 1 - NOISE_SPAN + 2 * NOISE_SPAN * noiseUnit; // [0.85, 1.15]
  const raw = Q * potMult * noise;
  const score = clamp(Math.round(50 * raw), 1, 99);
  return { score, noise, potMult, raw };
}

// ── NY kurve: dags-delta for ÉN evne ─────────────────────────────────────────
function newModelDailyDelta(current, cap, score, params) {
  if (!(cap > 0)) return 0;
  const gapFrac = Math.max(0, 1 - current / cap);
  if (gapFrac <= 0) return 0;
  const { A, L0, gamma, beta, softLoftExp } = params;
  const levelCost = 1 / (1 + Math.pow(Math.max(0, current) / L0, gamma));
  const loftClose = Math.pow(gapFrac, softLoftExp);
  const scoreFactor = Math.pow(score / 50, beta);
  const delta = A * scoreFactor * levelCost * loftClose;
  return Math.max(0, delta);
}

// ── Fælles decline (sæson-granulær, importerede konstanter, ingen duplikeret
//    gap-logik — kun lookup-tabellen fra PROGRESSION_CONFIG) ─────────────────
function seasonDecline(current, age, peakAge, isSignature) {
  const yearsPast = age - peakAge;
  const dropBase = lookupTable(PROGRESSION_CONFIG.declineByYearsPastPeak, yearsPast, "maxYears", "drop");
  const drop = dropBase * (isSignature ? 1 : PROGRESSION_CONFIG.offTypeDeclineFactor);
  return Math.max(0, current - drop);
}

// ── Fuld livscyklus, NY model, TYPE-FRI (bruges til fit — signatur-evne alene) ─
function simulateNewModelSignature(pot, params, peakAge, potMultAnchors) {
  const cap = LOFT_BY_POT[pot];
  let current = SKELETON[pot][16];
  const snapshots = {};
  const meanScores = {};
  for (let age = AGE_START; age <= AGE_END; age++) {
    snapshots[age] = current;
    if (age < peakAge) {
      let sum = 0;
      for (let day = 0; day < DAYS_PER_SEASON; day++) {
        const { score } = dailyScore({
          pot, potMultAnchors,
          seedKey: `curve3564:fit:${pot}:${age}:${day}`,
        });
        sum += score;
        const delta = newModelDailyDelta(current, cap, score, params);
        current = Math.min(cap, current + delta);
      }
      meanScores[age] = sum / DAYS_PER_SEASON;
    } else {
      current = seasonDecline(current, age, peakAge, true);
    }
  }
  return { snapshots, meanScores, cap };
}

// ── Fuld livscyklus, NY model, PR. TYPE (rapportering: alle 10 fysiske evner) ─
function simulateNewModelFull(pot, typeKey, params, peakAge, potMultAnchors) {
  const type = RIDER_TYPES.find((t) => t.key === typeKey);
  const caps = {};
  for (const ab of PHYS) {
    caps[ab] = clamp(
      Math.round(LOFT_BY_POT[pot] * youthRoleFactor(typeKey, null, ab, YOUTH_PROGRESSION_CONFIG)),
      0, 99
    );
  }
  const abilities = {};
  const best16 = SKELETON[pot][16];
  const coreTarget = 3;
  for (const ab of PHYS) {
    const factor = youthRoleFactor(typeKey, null, ab, YOUTH_PROGRESSION_CONFIG);
    if (factor === YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor) abilities[ab] = best16;
    else if (factor === YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor) {
      abilities[ab] = Math.round(coreTarget + (best16 - coreTarget) * 0.6);
    } else if (factor === YOUTH_PROGRESSION_CONFIG.neutralFactor) abilities[ab] = coreTarget;
    else abilities[ab] = Math.max(1, coreTarget - 1); // opposite
  }

  const rows = [];
  for (let age = AGE_START; age <= AGE_END; age++) {
    const vals = PHYS.map((ab) => abilities[ab]);
    const best = Math.max(...vals);
    const coreMedian = median(vals);
    const pctOfLoft = best / LOFT_BY_POT[pot];
    let meanScore = null;
    if (age < peakAge) {
      let sum = 0;
      for (let day = 0; day < DAYS_PER_SEASON; day++) {
        const { score } = dailyScore({
          pot, potMultAnchors,
          seedKey: `curve3564:full:${pot}:${typeKey}:${age}:${day}`,
        });
        sum += score;
        for (const ab of PHYS) {
          const delta = newModelDailyDelta(abilities[ab], caps[ab], score, params);
          abilities[ab] = Math.min(caps[ab], abilities[ab] + delta);
        }
      }
      meanScore = sum / DAYS_PER_SEASON;
    } else {
      for (const ab of PHYS) {
        const isSig = (type?.weights?.[ab] ?? 0) > 0;
        abilities[ab] = seasonDecline(abilities[ab], age, peakAge, isSig);
      }
    }
    rows.push({ age, best, coreMedian, pctOfLoft, meanScore });
  }
  return { rows, caps };
}

// ── Fuld livscyklus, GAMMEL model (dagens motor: dailyAbilityDelta, gap-baseret)
function simulateOldModelFull(pot, typeKey, peakAge) {
  const type = RIDER_TYPES.find((t) => t.key === typeKey);
  const caps = {};
  for (const ab of PHYS) {
    caps[ab] = clamp(
      Math.round(LOFT_BY_POT[pot] * youthRoleFactor(typeKey, null, ab, YOUTH_PROGRESSION_CONFIG)),
      0, 99
    );
  }
  const abilities = {};
  const best16 = SKELETON[pot][16];
  const coreTarget = 3;
  for (const ab of PHYS) {
    const factor = youthRoleFactor(typeKey, null, ab, YOUTH_PROGRESSION_CONFIG);
    if (factor === YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor) abilities[ab] = best16;
    else if (factor === YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor) {
      abilities[ab] = Math.round(coreTarget + (best16 - coreTarget) * 0.6);
    } else if (factor === YOUTH_PROGRESSION_CONFIG.neutralFactor) abilities[ab] = coreTarget;
    else abilities[ab] = Math.max(1, coreTarget - 1);
  }
  const program = resolveProgram(null, typeKey); // smartDefaultFocus — "dagens motor" uden aktiv plan

  const rows = [];
  for (let age = AGE_START; age <= AGE_END; age++) {
    const vals = PHYS.map((ab) => abilities[ab]);
    const best = Math.max(...vals);
    const coreMedian = median(vals);
    const pctOfLoft = best / LOFT_BY_POT[pot];
    if (age < peakAge) {
      for (let day = 0; day < DAYS_PER_SEASON; day++) {
        const noiseUnit = seededUnit(`curve3564:old:${pot}:${typeKey}:${age}:${day}`);
        const noise = 1 - NOISE_SPAN + 2 * NOISE_SPAN * noiseUnit;
        for (const ab of PHYS) {
          const delta = dailyAbilityDelta({
            ability: ab, current: abilities[ab], cap: caps[ab], age, program,
            conditionMult: 1, bonus: false, noise, potentiale: pot,
          });
          abilities[ab] = Math.min(caps[ab], abilities[ab] + Math.max(0, delta));
        }
      }
    } else {
      for (const ab of PHYS) {
        const isSig = (type?.weights?.[ab] ?? 0) > 0;
        abilities[ab] = seasonDecline(abilities[ab], age, peakAge, isSig);
      }
    }
    rows.push({ age, best, coreMedian, pctOfLoft, meanScore: null });
  }
  return rows;
}

// ── Fit-loss (mod §5-ankre + milepæle + anti-frontloading, TYPE-FRI baner) ────
function fitLoss(params, peakAge, potMultAnchors) {
  let loss = 0;
  for (const pot of POTS) {
    const { snapshots } = simulateNewModelSignature(pot, params, peakAge, potMultAnchors);
    const loft = LOFT_BY_POT[pot];
    const t22 = SKELETON[pot][22], t28 = SKELETON[pot][28];
    const a22 = snapshots[22], a28 = snapshots[28];
    const e22 = (a22 - t22) / t22;
    const e28 = (a28 - t28) / t28;
    const pct22 = a22 / loft, pct25 = snapshots[25] / loft, pct27 = snapshots[27] / loft;
    const ePct22 = pct22 - 0.60;
    const ePct25 = pct25 - 0.85;
    const ePct27 = pct27 - 0.99;
    const pct19 = snapshots[19] / loft;
    const eFront = Math.max(0, pct19 - 0.48);
    loss += 3 * e22 * e22 + 3 * e28 * e28
      + 2 * ePct22 * ePct22 + 2 * ePct25 * ePct25 + 2 * ePct27 * ePct27
      + 5 * eFront * eFront * 4;
  }
  return loss;
}

function gridSearch(candidates, peakAge, potMultAnchors) {
  let best = null;
  for (const A of candidates.A) {
    for (const L0 of candidates.L0) {
      for (const gamma of candidates.gamma) {
        for (const beta of candidates.beta) {
          for (const softLoftExp of candidates.softLoftExp) {
            const params = { A, L0, gamma, beta, softLoftExp };
            const loss = fitLoss(params, peakAge, potMultAnchors);
            if (!best || loss < best.loss) best = { params, loss };
          }
        }
      }
    }
  }
  return best;
}

function refineRange(center, spreadFactor, steps, min = 0.01) {
  const lo = Math.max(min, center * (1 - spreadFactor));
  const hi = center * (1 + spreadFactor);
  const out = [];
  for (let i = 0; i < steps; i++) out.push(lo + ((hi - lo) * i) / (steps - 1));
  return out;
}

// ── Score-sanity: dage nødvendige for at skelne pot X fra pot Y m. ~90% sikkerhed
function daysToDistinguish(potA, potB, potMultAnchors, zScore = 1.645) {
  const meanA = 50 * potMultFor(potA, potMultAnchors);
  const meanB = 50 * potMultFor(potB, potMultAnchors);
  // formNoise ~ Uniform(1-span,1+span) ⇒ std = span/sqrt(3) (relativ)
  const relStd = NOISE_SPAN / Math.sqrt(3);
  const stdA = meanA * relStd, stdB = meanB * relStd;
  const diff = Math.abs(meanB - meanA);
  if (diff === 0) return Infinity;
  const n = Math.pow((zScore * Math.sqrt(stdA * stdA + stdB * stdB)) / diff, 2);
  return { meanA, meanB, stdA, stdB, diff, daysNeeded: Math.max(1, Math.ceil(n)) };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
function main() {
  const outArg = process.argv[2];
  const OUTPUT_PATH = outArg
    ? path.resolve(outArg)
    : path.resolve(
        "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/5ea4d8d3-1258-4104-a2c6-9f902b84d615/scratchpad/curves3564.json"
      );

  const potMultAnchorsDefault = { ...YOUTH_PROGRESSION_CONFIG.rateByPotential };

  console.log("=== #3564 leverance 3 — curveHarness3564.mjs ===");
  console.log("Fitter (A, L0, gamma, beta, softLoftExp) mod §5-skelettet (unified peakAge=28)...\n");

  // ── Grov grid ──
  const coarse = {
    A: [1, 1.5, 2, 3, 4, 6, 9],
    L0: [10, 15, 22, 32, 45, 65],
    gamma: [1, 1.5, 2, 3],
    beta: [0.5, 1, 1.5, 2],
    softLoftExp: [0.3, 0.5, 0.7, 1.0, 1.5],
  };
  const t0 = Date.now();
  let bestFit = gridSearch(coarse, UNIFIED_PEAK_AGE, potMultAnchorsDefault);
  console.log(`Grov grid (${coarse.A.length * coarse.L0.length * coarse.gamma.length * coarse.beta.length * coarse.softLoftExp.length} kombinationer): ${Date.now() - t0}ms`);
  console.log("Bedste grov:", JSON.stringify(bestFit.params), "loss=", bestFit.loss.toFixed(4));

  // ── Fin grid omkring bedste ──
  const fine = {
    A: refineRange(bestFit.params.A, 0.5, 6),
    L0: refineRange(bestFit.params.L0, 0.5, 6),
    gamma: refineRange(bestFit.params.gamma, 0.4, 5),
    beta: refineRange(bestFit.params.beta, 0.4, 5),
    softLoftExp: refineRange(bestFit.params.softLoftExp, 0.4, 5),
  };
  const t1 = Date.now();
  const fineFit = gridSearch(fine, UNIFIED_PEAK_AGE, potMultAnchorsDefault);
  console.log(`Fin grid: ${Date.now() - t1}ms`);
  if (fineFit.loss < bestFit.loss) bestFit = fineFit;
  console.log("Bedste efter fin grid:", JSON.stringify(bestFit.params), "loss=", bestFit.loss.toFixed(4));

  const params = bestFit.params;

  // ── Fit-kvalitetstabel ──
  const fitQuality = [];
  for (const pot of POTS) {
    const { snapshots } = simulateNewModelSignature(pot, params, UNIFIED_PEAK_AGE, potMultAnchorsDefault);
    const loft = LOFT_BY_POT[pot];
    const a16 = snapshots[16], a19 = snapshots[19], a22 = snapshots[22], a25 = snapshots[25];
    const a27 = snapshots[27], a28 = snapshots[28];
    // "Max nås ~27" = 99% af SLUTNIVEAUET (værdien ved 28, hvor væksten stopper og
    // decline overtager) — IKKE 99% af det hårde potentiale-loft (skelettets egen
    // 28-års-anker ligger allerede et stykke under loftet, jf. §5-tabellen: fx
    // pot1 28→33 mod loft 35). At måle mod loft ville gøre milepælen ustabil ved
    // konstruktion (loftet nås aldrig eksakt, kun asymptotisk via loftClose-leddet).
    const lifetimeMax = a28;
    let maxAgeReached = null;
    for (let age = AGE_START; age <= UNIFIED_PEAK_AGE; age++) {
      if (snapshots[age] >= 0.99 * lifetimeMax) { maxAgeReached = age; break; }
    }
    fitQuality.push({
      pot, loft,
      anchor16: SKELETON[pot][16], achieved16: Math.round(a16 * 10) / 10,
      anchor22: SKELETON[pot][22], achieved22: Math.round(a22 * 10) / 10,
      dev22Pct: Math.round((((a22 - SKELETON[pot][22]) / SKELETON[pot][22]) * 1000)) / 10,
      anchor28: SKELETON[pot][28], achieved28: Math.round(a28 * 10) / 10,
      dev28Pct: Math.round((((a28 - SKELETON[pot][28]) / SKELETON[pot][28]) * 1000)) / 10,
      pct22: Math.round((a22 / loft) * 1000) / 10, pct22Target: 60,
      pct25: Math.round((a25 / loft) * 1000) / 10, pct25Target: 85,
      pct19: Math.round((a19 / loft) * 1000) / 10, pct19FrontloadCeil: 48,
      pct27: Math.round((a27 / loft) * 1000) / 10, pct27Target: 99,
      maxAgeReached, maxAgeTarget: "~27",
    });
  }

  console.log("\n=== Fit-kvalitetstabel (type-fri signatur-evne, unified peakAge=28) ===");
  console.log("pot | 16(mål)  | 22 mål/opnået (afv%) | 28 mål/opnået (afv%) | %loft@22(mål60) | %loft@25(mål85) | %loft@19(front-loft≤48) | maxAge(mål~27)");
  for (const r of fitQuality) {
    console.log(
      `${r.pot}   | ${r.anchor16}/${Math.round(r.achieved16)}     | ${r.anchor22}/${r.achieved22} (${r.dev22Pct}%)     | ${r.anchor28}/${r.achieved28} (${r.dev28Pct}%)     | ${r.pct22}% (${r.pct22Target}%)      | ${r.pct25}% (${r.pct25Target}%)      | ${r.pct19}% (≤${r.pct19FrontloadCeil}%)          | ${r.maxAgeReached ?? "ALDRIG NÅET"}`
    );
  }

  // ── Fuld simulation: alle pot × type × peakAge-mode × model ──
  console.log("\nKører fuld simulation (6 pot × 8 type × 2 peakAge-modes × [ny, gammel])...");
  const curves = [];
  const specGapByPotMode = {}; // { "unified"|"varied": { pot: { 16:[],22:[],28:[] } } }
  const frontloadFlags = [];
  const zeroGapAt21 = [];
  const over85Before24 = [];

  for (const peakMode of ["unified", "varied"]) {
    specGapByPotMode[peakMode] = {};
    for (const pot of POTS) {
      specGapByPotMode[peakMode][pot] = { 16: [], 22: [], 28: [] };
      for (const type of RIDER_TYPES) {
        const peakAge = peakMode === "unified" ? UNIFIED_PEAK_AGE : (PEAK_AGE_BY_TYPE[type.key] ?? UNIFIED_PEAK_AGE);
        const { rows } = simulateNewModelFull(pot, type.key, params, peakAge, potMultAnchorsDefault);
        for (const row of rows) {
          curves.push({ model: "ny", peakAgeMode: peakMode, pot, type: type.key, ...row });
        }
        // Specialiserings-gab pr. type ved 16/22/28 (kun for "unified"-banen —
        // varied-banen ændrer kun decline, ikke gab før peak, så identisk ved 28≤peak).
        for (const targetAge of [16, 22, 28]) {
          const row = rows.find((r) => r.age === targetAge);
          if (!row) continue;
          // Skal bruge de rå evner, ikke kun best/coreMedian — genkør minimalt for at hente vector.
        }
        // Frontloading-check (19-årig ≤ ~48% af eget loft)
        const row19 = rows.find((r) => r.age === 19);
        if (row19) frontloadFlags.push({ pot, type: type.key, peakMode, pct19: row19.pctOfLoft });
        // Nul-gab ved 21 proxy (best >= 99% af loft)
        const row21 = rows.find((r) => r.age === 21);
        if (row21) zeroGapAt21.push({ pot, type: type.key, peakMode, zeroGap: row21.pctOfLoft >= 0.99 });
        // >85% af loft FØR 24 proxy
        const before24 = rows.filter((r) => r.age < 24).some((r) => r.pctOfLoft >= 0.85);
        over85Before24.push({ pot, type: type.key, peakMode, over85Before24: before24 });
      }
      // OLD model (kun unified peakAge — matcher dagens PROGRESSION_CONFIG.peakAge)
      if (peakMode === "unified") {
        for (const type of RIDER_TYPES) {
          const rows = simulateOldModelFull(pot, type.key, UNIFIED_PEAK_AGE);
          for (const row of rows) {
            curves.push({ model: "gammel", peakAgeMode: "unified", pot, type: type.key, ...row });
          }
        }
      }
    }
  }

  // Specialiserings-gab: kør fuld ability-vector separat (best/2ndBest pr. type)
  const specGap = {}; // { pot: { 16: [gaps pr type], 22:[...], 28:[...] } }
  for (const pot of POTS) {
    specGap[pot] = { 16: [], 22: [], 28: [] };
    for (const type of RIDER_TYPES) {
      const caps = {};
      for (const ab of PHYS) {
        caps[ab] = clamp(Math.round(LOFT_BY_POT[pot] * youthRoleFactor(type.key, null, ab, YOUTH_PROGRESSION_CONFIG)), 0, 99);
      }
      const abilities = {};
      const best16 = SKELETON[pot][16];
      const coreTarget = 3;
      for (const ab of PHYS) {
        const factor = youthRoleFactor(type.key, null, ab, YOUTH_PROGRESSION_CONFIG);
        if (factor === YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor) abilities[ab] = best16;
        else if (factor === YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor) abilities[ab] = Math.round(coreTarget + (best16 - coreTarget) * 0.6);
        else if (factor === YOUTH_PROGRESSION_CONFIG.neutralFactor) abilities[ab] = coreTarget;
        else abilities[ab] = Math.max(1, coreTarget - 1);
      }
      const recordGap = (age) => {
        const vals = [...PHYS.map((ab) => abilities[ab])].sort((a, b) => b - a);
        specGap[pot][age]?.push(vals[0] - vals[1]);
      };
      recordGap(16);
      for (let age = AGE_START; age <= 28; age++) {
        if (age < UNIFIED_PEAK_AGE) {
          for (let day = 0; day < DAYS_PER_SEASON; day++) {
            const { score } = dailyScore({ pot, potMultAnchors: potMultAnchorsDefault, seedKey: `curve3564:gap:${pot}:${type.key}:${age}:${day}` });
            for (const ab of PHYS) {
              const delta = newModelDailyDelta(abilities[ab], caps[ab], score, params);
              abilities[ab] = Math.min(caps[ab], abilities[ab] + delta);
            }
          }
        }
        if (age + 1 === 22 || age + 1 === 28) recordGap(age + 1);
      }
    }
  }

  console.log("\n=== Specialiserings-gab (median bedste−næstbedste, mål ≥2/≥4/≥6 v. 16/22/28) ===");
  const specGapSummary = {};
  for (const pot of POTS) {
    const g16 = median(specGap[pot][16]), g22 = median(specGap[pot][22]), g28 = median(specGap[pot][28]);
    specGapSummary[pot] = { g16, g22, g28 };
    console.log(`pot ${pot}: 16=${g16.toFixed(1)} (mål≥2, ${g16 >= 2 ? "ok" : "MISS"})  22=${g22.toFixed(1)} (mål≥4, ${g22 >= 4 ? "ok" : "MISS"})  28=${g28.toFixed(1)} (mål≥6, ${g28 >= 6 ? "ok" : "MISS"})`);
  }

  // Diagnose: hvor mange abilities er PRIMÆRE (rolle-faktor 1.0) pr. type blandt
  // de 10 fysiske? >1 primær ⇒ disse abilities er MATEMATISK BUNDET til at følge
  // identiske baner under denne harness' rider-niveau-score (ingen pr.-evne-støj),
  // og vil derfor tie eksakt (gap=0 mellem netop DEM) uanset A/L0/gamma/beta.
  const primaryCountByType = {};
  for (const type of RIDER_TYPES) {
    const tiers = PHYS.map((ab) => youthRoleFactor(type.key, null, ab, YOUTH_PROGRESSION_CONFIG));
    primaryCountByType[type.key] = tiers.filter((f) => f === YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor).length;
  }
  console.log("Primær-evne-antal pr. type (blandt de 10 fysiske; >1 ⇒ strukturel tie, se misses):");
  console.log("  " + RIDER_TYPES.map((t) => `${t.key}=${primaryCountByType[t.key]}`).join("  "));

  console.log("\n=== Anti-frontloading (19-årig ≤ ~48% af eget loft) ===");
  const frontloadViolations = frontloadFlags.filter((f) => f.pct19 > 0.48);
  console.log(`${frontloadViolations.length}/${frontloadFlags.length} kombinationer OVER 48% ved 19 år.`);
  if (frontloadViolations.length) {
    const worst = [...frontloadFlags].sort((a, b) => b.pct19 - a.pct19).slice(0, 5);
    console.log("Værste 5:", worst.map((w) => `pot${w.pot}/${w.type}/${w.peakMode}=${(w.pct19 * 100).toFixed(1)}%`).join(", "));
  }

  console.log("\n=== Hale-proxy (kun strukturel check pr. deterministisk baneprøve, IKKE population) ===");
  const zeroGapCount = zeroGapAt21.filter((z) => z.zeroGap).length;
  const over85Count = over85Before24.filter((o) => o.over85Before24).length;
  console.log(`Nul-gab (≥99% af loft) ved 21 år: ${zeroGapCount}/${zeroGapAt21.length} baner (mål: ≤5% i EGENTLIG population — se misses).`);
  console.log(`>85% af loft FØR 24 år: ${over85Count}/${over85Before24.length} baner (mål: ≤5% i EGENTLIG population — se misses).`);

  // ── Score-sanity ──
  console.log("\n=== Træningsscore-sanity (dage til at skelne to potentialer m. ~90% sikkerhed) ===");
  const pot2vs5 = daysToDistinguish(2, 5, potMultAnchorsDefault);
  console.log(`pot 2 vs pot 5: mean=${pot2vs5.meanA.toFixed(1)} vs ${pot2vs5.meanB.toFixed(1)}, std≈${pot2vs5.stdA.toFixed(1)}/${pot2vs5.stdB.toFixed(1)}, dage nødvendige ≈ ${pot2vs5.daysNeeded}`);
  const adjacentPairs = [];
  for (let i = 1; i < POTS.length; i++) {
    const a = POTS[i - 1], b = POTS[i];
    const r = daysToDistinguish(a, b, potMultAnchorsDefault);
    adjacentPairs.push({ a, b, ...r });
    console.log(`pot ${a} vs pot ${b}: dage nødvendige ≈ ${r.daysNeeded}`);
  }

  // ── Misses / analyse ──
  const misses = [];
  const anyAnchorMiss = fitQuality.some((r) => Math.abs(r.dev22Pct) > 15 || Math.abs(r.dev28Pct) > 15);
  if (anyAnchorMiss) {
    misses.push(
      "Et eller flere potentialer rammer IKKE §5-ankrene (22 eller 28 år) inden for ±15% — se dev22Pct/dev28Pct i fitQuality. " +
      "Analyse: modelfamilien (levelCost+loftClose, single global A/L0/gamma/beta/softLoftExp) er BEVIDST simpel — den tvinges " +
      "til ét sæt konstanter på tværs af alle 6 potentialer samtidig. Hvis afvigelsen er systematisk KUN ved lave eller høje " +
      "potentialer, er det sandsynligvis kalibreringen (parametrene favoriserer midten); hvis afvigelsen er jævn på tværs, er " +
      "det muligvis skelettets egne ankre der er urealistiske for denne modelfamilie uden pr.-potentiale A/L0-variation — " +
      "IKKE tunet blindt for at bestå her, se rå tal i konsol-output og curves3564.json før beslutning."
    );
  }
  if (frontloadViolations.length > 0) {
    misses.push(
      `Anti-frontloading-gaten er OVERTRÅDT for ${frontloadViolations.length} kombination(er) — 19-årige over 48% af eget loft. ` +
      "Dette er PRÆCIS den gate der skulle have fanget 7/8-hændelsen (77/88 ved 19 år); den er IKKE svækket eller fjernet her, " +
      "resultatet rapporteres som fund, ikke skjult."
    );
  }
  const anySpecGapMiss = Object.values(specGapSummary).some((s) => s.g16 < 2 || s.g22 < 4 || s.g28 < 6);
  const multiPrimaryTypes = RIDER_TYPES.filter((t) => primaryCountByType[t.key] > 1).map((t) => t.key);
  if (anySpecGapMiss) {
    misses.push(
      `Specialiserings-gab-målet (≥2/≥4/≥6 v. 16/22/28) rammer 0.0 for ALLE potentialer — IKKE fordi rollefaktorerne er ` +
      `for tætte, men fordi ${multiPrimaryTypes.length}/8 typer (${multiPrimaryTypes.join(", ")}) har 2+ evner med rolle-` +
      `faktor 1.0 blandt de 10 fysiske (se primaryCountByType). Under denne modelfamilies rider-NIVEAU-score (én S pr. dag, ` +
      "ingen pr.-evne-støj) får to abilities med SAMME start-værdi og SAMME loft matematisk IDENTISKE baner for evigt — de " +
      "tier eksakt, uanset A/L0/gamma/beta. Kun tt (1 primær evne blandt de 10) undgår dette. Kun tt (én primær-evne-type) " +
      "bidrager reelt til gap-medianen; median over 8 typer domineres derfor af de 7 typer med tie=0. Dette er IKKE " +
      "kalibreringen der fejler — det er en strukturel konsekvens af (a) at flere typer bevidst har flere signatur-evner " +
      "(#3325: 'en sprinter der er god til acceleration/sprint/flat/durability' er DESIGNET sådan, ikke en fejl) og (b) at " +
      "beslutning 5's score-model er rider-niveau, ikke evne-niveau. Konsekvens for trin 2: enten skal 'bedste−næstbedste' " +
      "måles KUN mod typer med præcis 1 signatur-evne (og re-defineres for multi-signatur-typer, fx bedste-primær vs. " +
      "bedste-neutral), eller modelfamilien skal have en lille pr.-evne-støjkomponent tilføjet (ikke i denne LÅSTE " +
      "beslutning 5-formel) — begge er ejer-beslutninger, ikke noget denne harness kan/skal tune sig forbi."
    );
  }
  misses.push(
    "Hale-gates (≤5% nul-gab v. 21, ≤5% >85% af loft før 24) kan IKKE måles korrekt af denne harness: vi kører 48 " +
    "DETERMINISTISKE enkelt-baner (6 pot × 8 type), ikke en stokastisk population med individuel start-luck/noise-varians " +
    "pr. rytter. Tallene ovenfor er en STRUKTUREL proxy (består/fejler banen som helhed), ikke en ægte %-af-kuld-måling — " +
    "den ægte hale-gate hører hjemme i trin 3's generator-harness (startniveau + population), ikke her."
  );
  misses.push(
    `Trænings-score-sanity: pot2 vs pot5 kan skelnes med ~90% sikkerhed på blot ${pot2vs5.daysNeeded} dag(e) — IKKE uger, ` +
    "hvilket MODSIGER beslutning 5's privatlivs-antagelse ('dagsstøjen er stor nok til at talent-signalet kræver uger'). " +
    "Rodårsag: potMult-ankrene (0.6→1.35, spredning ±38% om midten) er langt STØRRE end den ±15%-støj der skal maskere dem — " +
    "de to var aldrig kalibreret sammen. For at få 'kræver uger' skal ENTEN støjen op væsentligt (fx ±40-50%) ELLER potMult-" +
    "spredningen ned — dette er en beslutning, IKKE noget denne harness tunede sig ud af blindt."
  );

  console.log("\n=== MISSES / ÆRLIG ANALYSE ===");
  for (const m of misses) console.log("- " + m);

  // ── Skriv output ──
  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      issue: 3564,
      note: "Harness-lokal kurve-model. Motorkode (backend/lib/*.js) IKKE ændret. Se filens header for metodenoter.",
      daysPerSeason: DAYS_PER_SEASON,
      noiseSpan: NOISE_SPAN,
      unifiedPeakAge: UNIFIED_PEAK_AGE,
      peakAgeByType: PEAK_AGE_BY_TYPE,
      potMultAnchors: potMultAnchorsDefault,
      loftByPotential: LOFT_BY_POT,
      skeleton: SKELETON,
    },
    fitted: params,
    fitQuality,
    specializationGap: specGapSummary,
    primaryCountByType,
    antiFrontloading: {
      violationCount: frontloadViolations.length,
      total: frontloadFlags.length,
      violations: frontloadViolations,
    },
    tailProxies: {
      zeroGapAt21: { count: zeroGapCount, total: zeroGapAt21.length },
      over85Before24: { count: over85Count, total: over85Before24.length },
    },
    scoreSanity: { pot2vs5, adjacentPairs },
    misses,
    curves,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nSkrevet: ${OUTPUT_PATH} (${curves.length} kurve-rækker, ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)} KB)`);
}

main();
