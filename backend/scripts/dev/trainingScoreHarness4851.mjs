#!/usr/bin/env node
// #4851 — TRAENINGSSCORE-HARNESS (gate G1, G3, G4 i spec §7).
//
// Koerer PRODUKTIONSSTIEN (`applyDailyTick` fra backend/lib/dailyTraining.js),
// ikke en lokal genimplementering. Det er hele pointen med postmortem 5/7: "en
// gate der ikke spejler produktionsstien er ikke en gate". Kun input-siden er
// harness-lokal (evne-vektorer, alder, potentiale, form/traethed og planer fra
// et READ-ONLY prod-udtraek), og kondition/traethed udvikler sig dag for dag med
// de samme `nextFatigue`/`nextForm`/`conditionMultiplier` som motoren bruger.
//
// FOER/EFTER er den SAMME kode med to score-konfigurationer:
//   FOER  = deltaCoupling.gamma 0      ⇒ rytter-leddet er dagens faktor-kaede
//   EFTER = TRAINING_SCORE_CONFIG      ⇒ rytter-leddet er scorens afvigelse
// Det isolerer praecis den ene aendring gaten spoerger til.
//
// GATES
//   G1  sæsonens samlede evne-udvikling foer mod efter (maa IKKE stige)
//   G3  score-fordelingen: ingen bunkning i enderne, og en haard dag paa en
//       frisk rytter med god traener tydeligt over en let dag paa en traet uden
//   G4  0 raekker med score 0 eller 1 paa et gennemfoert pas
//
// KOERSEL (fra repo-roden):
//   node backend/scripts/dev/trainingScoreHarness4851.mjs <population.json> [dage]
//
// <population.json> er et array af
//   { potentiale, birthYear, primary_type, secondary_type, is_academy, is_ai,
//     form, fatigue, focus, intensity, abilities: {<evne>: <tal>} }
// Read-only udtraek; harnessen skriver ALDRIG til nogen database.

import { readFileSync } from "node:fs";
import { applyDailyTick, resolveProgram } from "../../lib/dailyTraining.js";
import { TRAINING_SCORE_CONFIG, computeTrainingScore } from "../../lib/trainingScore.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { nextFatigue, nextForm, conditionMultiplier } from "../../lib/riderCondition.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { riderLevelBand } from "../../lib/staffAbilityConstants.js";
// Launch-referenceaaret erklaeres ÉT sted (lib/riderSeasonAge.js) — guarden i
// riderSeasonAge.test.js faelder enhver kopi. Udtraekket baerer foedselsaaret,
// saa alderen udledes af det og saesonnummeret via samme SSOT som motoren.
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";

const POPULATION_PATH = process.argv[2];
const DAYS = Number(process.argv[3] ?? 14);
const SEASON_NUMBER = Number(process.argv[4] ?? 3);

if (!POPULATION_PATH) {
  console.error("brug: node backend/scripts/dev/trainingScoreHarness4851.mjs <population.json> [dage]");
  process.exit(2);
}

// "FOER"-konfigurationen: samme skala, koblingen sat ud af kraft.
const BEFORE_CFG = Object.freeze({
  ...TRAINING_SCORE_CONFIG,
  deltaCoupling: Object.freeze({ gamma: 0, normalizer: 1 }),
});

function dateStr(offset) {
  const d = new Date(Date.UTC(2026, 8, 1) + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function totalAbilityPoints(abilities) {
  let sum = 0;
  for (const k of VISIBLE_ABILITIES) sum += Number(abilities[k] ?? 0);
  return sum;
}

// Én rytters 14 dage under én score-konfiguration. Returnerer de samlede point
// rytteren vandt + hver dags score.
function simulateRider(rider, scoreCfg) {
  const birthYear = Number(rider.birthYear ?? LAUNCH_REFERENCE_YEAR - 25);
  const age = LAUNCH_REFERENCE_YEAR + (SEASON_NUMBER - 1) - birthYear;
  let abilities = {};
  for (const k of VISIBLE_ABILITIES) abilities[k] = Number(rider.abilities?.[k] ?? 0);
  const startPoints = totalAbilityPoints(abilities);
  let progress = {};
  let form = Number(rider.form ?? 50);
  let fatigue = Number(rider.fatigue ?? 0);
  const scores = [];

  for (let day = 0; day < DAYS; day++) {
    const program = resolveProgram(
      rider.focus && rider.intensity ? { focus: rider.focus, intensity: rider.intensity } : null,
      rider.primary_type,
    );
    const caps = buildCapsForRider(
      abilities,
      { potentiale: rider.potentiale, is_academy: rider.is_academy, age },
      rider.primary_type,
      rider.secondary_type,
    );
    const conditionMult = conditionMultiplier({ form, fatigue });
    const result = applyDailyTick({
      riderId: `harness-${rider.birthYear}-${day}-${rider.primary_type}-${rider.potentiale}-${startPoints}`,
      dateStr: dateStr(day),
      age,
      abilities,
      caps,
      progress,
      program,
      conditionMult,
      bonus: false,
      potentiale: rider.potentiale,
      primaryType: rider.primary_type,
      secondaryType: rider.secondary_type,
      riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
      scoreCfg,
    });
    abilities = result.abilities;
    progress = result.progress;
    if (result.trainingScore) scores.push(result.trainingScore.score);
    fatigue = nextFatigue({ fatigue, intensity: program.intensity, recoveryAbility: abilities.recovery ?? 50 });
    form = nextForm({ form, fatigue });
  }

  return { gained: totalAbilityPoints(abilities) - startPoints, scores };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

const population = JSON.parse(readFileSync(POPULATION_PATH, "utf8"));

let beforeTotal = 0;
let afterTotal = 0;
const allScores = [];
for (const rider of population) {
  beforeTotal += simulateRider(rider, BEFORE_CFG).gained;
  const after = simulateRider(rider, TRAINING_SCORE_CONFIG);
  afterTotal += after.gained;
  allScores.push(...after.scores);
}

allScores.sort((a, b) => a - b);
const mean = allScores.reduce((s, n) => s + n, 0) / (allScores.length || 1);

// ── G3-kontrasten: to konkrete pas paa den SAMME rytterprofil ────────────────
const contrastRider = {
  program: { focus: "vo2max", intensity: "hard" },
  age: 24, potentiale: 4, primaryType: "climber", secondaryType: null,
};
const hardFreshGoodCoach = computeTrainingScore({
  ...contrastRider,
  conditionMult: conditionMultiplier({ form: 80, fatigue: 10 }),
  noise: 1,
  facilityTier: 4,
  staff: null,
}).score;
const easyTiredNoCoach = computeTrainingScore({
  ...contrastRider,
  program: { focus: "endurance", intensity: "easy" },
  conditionMult: conditionMultiplier({ form: 35, fatigue: 85 }),
  noise: 1,
}).score;

// ── Normalizer-kalibrering: middelvaerdien af (S/midpoint)^gamma ─────────────
const { gamma, normalizer } = TRAINING_SCORE_CONFIG.deltaCoupling;
const shapeMean = allScores.reduce(
  (s, n) => s + Math.pow(n / TRAINING_SCORE_CONFIG.midpoint, gamma), 0,
) / (allScores.length || 1);

const lowEnd = allScores.filter((s) => s <= 5).length;
const highEnd = allScores.filter((s) => s >= 95).length;
const g4 = allScores.filter((s) => s <= 1).length;

const report = {
  population: population.length,
  days: DAYS,
  ticksWithScore: allScores.length,
  G1_seasonDevelopment: {
    beforePoints: beforeTotal,
    afterPoints: afterTotal,
    deltaPct: beforeTotal === 0 ? null : Number((((afterTotal - beforeTotal) / beforeTotal) * 100).toFixed(2)),
    verdict: afterTotal <= beforeTotal ? "PASS (stiger ikke)" : "FAIL (stiger)",
  },
  G3_distribution: {
    min: allScores[0] ?? null,
    p10: quantile(allScores, 0.10),
    p25: quantile(allScores, 0.25),
    median: quantile(allScores, 0.50),
    p75: quantile(allScores, 0.75),
    p90: quantile(allScores, 0.90),
    max: allScores[allScores.length - 1] ?? null,
    mean: Number(mean.toFixed(2)),
    atLowEndPct: Number(((lowEnd / (allScores.length || 1)) * 100).toFixed(2)),
    atHighEndPct: Number(((highEnd / (allScores.length || 1)) * 100).toFixed(2)),
    hardFreshGoodCoach,
    easyTiredNoCoach,
    contrastGap: hardFreshGoodCoach - easyTiredNoCoach,
  },
  G4_zeroOrOne: { rows: g4, verdict: g4 === 0 ? "PASS" : "FAIL" },
  calibration: {
    gamma,
    normalizerInConfig: normalizer,
    measuredShapeMean: Number(shapeMean.toFixed(4)),
    // BEMAERK: measuredShapeMean er UVAEGTET (ét tal pr. pas), mens G1 vejer
    // hvert pas med rytterens gap og alders-fraktion. Kalibrér derfor paa
    // G1_seasonDevelopment.deltaPct — gang normalizer med (1 + deltaPct/100)
    // og koer igen, til deltaPct er <= 0.
    hint: "kalibrér paa G1_seasonDevelopment.deltaPct, ikke paa measuredShapeMean",
  },
};

console.log(JSON.stringify(report, null, 2));
