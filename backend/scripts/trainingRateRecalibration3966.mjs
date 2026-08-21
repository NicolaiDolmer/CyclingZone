#!/usr/bin/env node
// Dry-run — traeningsrate-rekalibrering (#3966, ejer-beslutning 21/8).
//
// LAESER KUN. Ingen DB-writes, ingen migrationer. Simulerer daglig traening
// (dailyAbilityDelta, samme formel som prod) for repraesentative baand af den
// AEGTE population (docs/snapshots/3591/riders_full.json, 8.717 ryttere) under
// tre parametersaet:
//   FOER_14_8  — praecis formlen inden #3709 trin 4/5 (ingen roleRate, gammel
//                rateByPotential, offFocusMult 0.97)
//   NU         — den kommittede prod-formel efter trin 7 (#3746, 20/8)
//   TUNET      — kandidat-rekalibrering, denne PR
//
// Koer: node scripts/trainingRateRecalibration3966.mjs [--snapshot=path] [--json=out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { youthMultiplier } from "../lib/academyFlag.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const SNAPSHOT = arg("snapshot", "C:/Dev/CyclingZone/docs/snapshots/3591/riders_full.json");

// ── DE TRE PARAMETERSAET ─────────────────────────────────────────────────────
// dailyAbilityDelta laeser roleRateFactor via riderProgression.ROLE_CLASS_RATE og
// youthRateForPotential via YOUTH_PROGRESSION_CONFIG.rateByPotential — begge er
// modul-niveau frosne konstanter, saa vi kan ikke injicere dem via parametre uden
// at aendre prod-signaturen. I stedet regner scriptet formlen HELT UD selv, i
// laesbar form, med de tre saet som lokale konstanter — samme formel-kaede som
// dailyAbilityDelta (backend/lib/dailyTraining.js:113-158), verificeret bit-for-bit
// mod den NU-koerte spillervendteGates3709.mjs (S4=311 dage, S5=3.07x — se PR-body).
const PARAM_SETS = {
  foer_14_8: {
    label: "Foer 14/8 (foer #3709 trin 4/5)",
    roleRate: { signatur: 1.0, sekundaer: 1.0, haandvaerk: 1.0, andenRolle: 1.0, svaghed: 1.0 },
    offFocusMult: 0.97,
    rateByPotential: { 1: 0.60, 2: 0.78, 3: 0.92, 4: 1.06, 5: 1.20, 6: 1.35 },
  },
  nu: {
    label: "NU (trin 7, #3746, 20/8 - kommitteret)",
    roleRate: { signatur: 0.45, sekundaer: 0.36, haandvaerk: 0.22, andenRolle: 0.15, svaghed: 0.05 },
    offFocusMult: 0.35,
    rateByPotential: { 1: 0.11, 2: 0.27, 3: 0.42, 4: 0.58, 5: 0.73, 6: 0.89 },
  },
  tunet: {
    label: "TUNET (denne PR, #3966)",
    // roleRate UAENDRET — S1-S5-taggene (roleTags) og haandvaerks-prisen for
    // faerdighedsdage (#3762) er separate, ejer-besluttede balance-valg denne PR
    // ikke roerer. Kun de to led der reelt sank raten siden 14/8 skrues paa.
    roleRate: { signatur: 0.45, sekundaer: 0.36, haandvaerk: 0.22, andenRolle: 0.15, svaghed: 0.05 },
    // offFocusMult uaendret 0.35 (ejer-besluttet 14/8, dokumenteret negativ-test i
    // training.js — at loesne den igen risikerer at goere fokusvalget ligegyldigt,
    // som var netop problemet 0.97 loeste). Denne PR roerer KUN fokus-traeningens rate.
    offFocusMult: 0.35,
    // rateByPotential LOEFTET — se PR-body for udledning. Kandidaten er FUNDET
    // ved at binaersoege det stoerste loeft S1-S5 (scripts/spillervendteGates3709.mjs,
    // ejerens egne 15-16/8-krav) tillader: pot6 er praktisk talt uaendret (0.89,
    // S4 er ALLEREDE maksimalt stram — 311 af 286-386 dage, 25 dages margin), og
    // pot1-4 er loeftet saa meget S5 (fart-spaend, 2.5-3.5x) tillader (2.61x, 0.11
    // margin over gulvet). Der er IKKE plads til mere under de eksisterende gates
    // — se "AABNE SPOERGSMAAL" i PR-body for hvorfor.
    rateByPotential: { 1: 0.135, 2: 0.31, 3: 0.47, 4: 0.62, 5: 0.74, 6: 0.89 },
  },
};

const DAILY_CFG = { daysPerSeason: 28, dailyBudgetBoost: 1.0 };
const GROWTH_FRACTION_BY_AGE = [
  { maxAge: 19, frac: 0.35 },
  { maxAge: 22, frac: 0.28 },
  { maxAge: 25, frac: 0.18 },
  { maxAge: 99, frac: 0.10 },
];
function growthFractionForAge(age) {
  for (const row of GROWTH_FRACTION_BY_AGE) if (age <= row.maxAge) return row.frac;
  return GROWTH_FRACTION_BY_AGE.at(-1).frac;
}

// Ren, lokal reimplementering af dailyAbilityDelta's kaede, parametriseret over
// roleRate/offFocusMult/rateByPotential — SAMME led i SAMME raekkefoelge som
// backend/lib/dailyTraining.js:113-158, kun med de tre saet som injicerbare
// tal i stedet for imports fra riderProgression.js. focusGrowthMult.hard (1.60)
// er uaendret prod-konstant (training.js) — ikke en del af denne rekalibrering.
const FOCUS_MULT_HARD = 1.60;
function dailyDeltaFor(paramSet, { gap, age, potentiale, roleClass = "signatur", staffBonus = 1, facilityMult = 1, bonus = false }) {
  if (gap <= 0) return 0;
  const base = (gap * growthFractionForAge(age) * DAILY_CFG.dailyBudgetBoost) / DAILY_CFG.daysPerSeason;
  const mult = FOCUS_MULT_HARD; // on-focus hard traening (den scenarietype #3966 handler om)
  const roleRate = paramSet.roleRate[roleClass];
  const potRate = paramSet.rateByPotential[potentiale] ?? paramSet.rateByPotential[Math.round(potentiale)];
  const ym = youthMultiplier(age);
  return base * mult * roleRate * 1 /* conditionMult */ * ym * potRate
    * (bonus ? 1.25 : 1) * 1 /* noise */ * staffBonus * facilityMult * 1 /* academyRateMult */;
}

// Simuler N dage fremad for en rytter, dag-for-dag (gap lukker undervejs, saa
// dagligt tick genberegnes — ikke en lukket formel). cap er FAST (samme cap paa
// tvaers af de tre saet — rolleTags roeres ikke af denne PR).
function simulateWeeks(paramSet, { start, cap, age, potentiale, roleClass, weeks = 8, staffBonus = 1, facilityMult = 1, bonus = false }) {
  let cur = start;
  const perWeek = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const gap = Math.max(0, cap - cur);
      cur += dailyDeltaFor(paramSet, { gap, age, potentiale, roleClass, staffBonus, facilityMult, bonus });
    }
    perWeek.push(+(cur - start).toFixed(2));
  }
  return { totalGain: +(cur - start).toFixed(2), perWeek, finalValue: +cur.toFixed(2) };
}

// ── BAAND: alder x potentiale, repraesentativt for "ung rytter under udvikling" ──
const AGE_BANDS = [17, 20, 24];
const POTENTIALE_BANDS = [1, 2, 3, 4, 5, 6];

function fmtRow(cols) { return `| ${cols.join(" | ")} |`; }

console.log("# Traeningsrate-rekalibrering (#3966) - dry-run mod aegte population\n");
console.log(`Snapshot: ${SNAPSHOT}\n`);

// ═══ DEL 1: SCORECARD — ugentlig fremgang (evne-point), signatur-evne, hard fokus-traening ═══
console.log("## Scorecard - point efter 2 uger (BASIS: ingen staff/facilitet), signatur-evne, hard fokus, 17 aar\n");
console.log(fmtRow(["potentiale", "alder", "foer 14/8", "nu (trin 7)", "tunet", "tunet vs. foer"]));
console.log(fmtRow(["---", "---", "---", "---", "---", "---"]));

const scorecardRows = [];
for (const potentiale of POTENTIALE_BANDS) {
  const age = 17;
  const scenario = { start: 20, cap: 93, age, potentiale, roleClass: "signatur", weeks: 2 };
  const foer = simulateWeeks(PARAM_SETS.foer_14_8, scenario);
  const nu = simulateWeeks(PARAM_SETS.nu, scenario);
  const tunet = simulateWeeks(PARAM_SETS.tunet, scenario);
  scorecardRows.push({ potentiale, age, foer: foer.totalGain, nu: nu.totalGain, tunet: tunet.totalGain });
  console.log(fmtRow([
    potentiale, age,
    foer.totalGain, nu.totalGain, tunet.totalGain,
    `${((tunet.totalGain / (foer.totalGain || 1)) * 100).toFixed(0)}%`,
  ]));
}

console.log("\n## Ugentlig fremgang, pot 5 (\"ung high-potentiale\"), 17 aar, BASIS - uge 1-4\n");
console.log(fmtRow(["saet", "uge 1", "uge 2", "uge 3", "uge 4"]));
console.log(fmtRow(["---", "---", "---", "---", "---"]));
for (const key of ["foer_14_8", "nu", "tunet"]) {
  const r = simulateWeeks(PARAM_SETS[key], { start: 20, cap: 93, age: 17, potentiale: 5, roleClass: "signatur", weeks: 4 });
  console.log(fmtRow([PARAM_SETS[key].label, ...r.perWeek]));
}

// ═══ DEL 2: ENGINE-BUNDET VS. INDHOLDS-BUNDET GAP ═══
console.log("\n## Engine- vs. indholds-bundet\n");
console.log("Alle raekker i scorecardet ovenfor bruger identisk start=20/cap=93/alder=17 - forskellen mellem foer/nu/tunet er derfor 100% engine-bundet (rate-parametrene), 0% indholds-bundet (gap-stoerrelse). DEL 3 nedenfor laegger det FAKTISKE gap fra populationen oveni, saa begge effekter ses samlet.");

// ═══ DEL 3: PR. ALDERS-/POTENTIALE-BAAND PAA AEGTE POPULATION ═══
console.log("\n## Rate pr. baand - aegte population, faktisk gap (cap 93 for signatur, faktisk current)\n");
console.log(fmtRow(["baand (alder)", "potentiale", "n", "median gap", "foer (uge 2)", "nu (uge 2)", "tunet (uge 2)"]));
console.log(fmtRow(["---", "---", "---", "---", "---", "---", "---"]));

const riders = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const bandResults = [];
for (const ageBand of AGE_BANDS) {
  for (const potBand of POTENTIALE_BANDS) {
    const cohort = riders.filter((r) => {
      if (r.age == null || r.potentiale == null) return false;
      const potRounded = Math.round(r.potentiale);
      const ageLo = ageBand === 17 ? 16 : ageBand === 20 ? 19 : 23;
      const ageHi = ageBand === 17 ? 18 : ageBand === 20 ? 22 : 27;
      return r.age >= ageLo && r.age <= ageHi && potRounded === potBand;
    });
    if (cohort.length === 0) continue;
    // Signatur-evnen for denne kohorte: brug "sprint" som proxy-evne (samme evne
    // gates-scriptet bruger) — repraesentativ nok til rate-sammenligning paa tvaers
    // af baand, uden at skulle udlede hver rytters faktiske signatur-evne fra type.
    const gaps = cohort.map((r) => Math.max(0, 93 - (r.abilities?.sprint ?? 20)));
    const medianGap = median(gaps);
    const sampleGap = medianGap ?? 40;
    const scenario = { start: 93 - sampleGap, cap: 93, age: ageBand, potentiale: potBand, roleClass: "signatur", weeks: 2 };
    const foer = simulateWeeks(PARAM_SETS.foer_14_8, scenario);
    const nu = simulateWeeks(PARAM_SETS.nu, scenario);
    const tunet = simulateWeeks(PARAM_SETS.tunet, scenario);
    bandResults.push({ ageBand, potBand, n: cohort.length, medianGap, foer: foer.totalGain, nu: nu.totalGain, tunet: tunet.totalGain });
    console.log(fmtRow([ageBand, potBand, cohort.length, sampleGap.toFixed(1), foer.totalGain, nu.totalGain, tunet.totalGain]));
  }
}

if (arg("json", false)) {
  writeFileSync(String(arg("json")), JSON.stringify({ paramSets: PARAM_SETS, scorecardRows, bandResults }, null, 2));
}

console.log("\nDry-run faerdig. Ingen DB-writes. Koer scripts/spillervendteGates3709.mjs separat for at verificere S1-S5 mod den tunede rateByPotential (kraever midlertidig config-swap i riderProgression.js under lokal test - se PR-body for den faktiske gate-koersel mod den kommitterede aendring).");
