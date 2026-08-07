// #3459 — Løbsdags-modellen: 28-dages simulering af D1-D4 (fase 1, V2, READ-ONLY).
//
// Udvider fatigueSimulation2650.js's metode (seedet PRNG, empirisk input fra prod,
// formula-parity mod de FAKTISKE lib-formler) til den fulde løbsdags-model fra
// docs/superpowers/specs/2026-08-06-loebsdags-model-design.md:
//   D1 — på løbsdage udføres IKKE det planlagte pas (hverken fatigue eller udvikling)
//   D2 — løbet giver udviklings-stimulus = 1,10-1,20x det erstattede pas, KUN i
//        løbets profil-relevante evner (RACE_PROFILE_ABILITY_MAP nedenfor)
//   D3 — parameter-sweep: raceLoad×{1.0,1.25,1.5,1.75} × recovery-varianter
//   D4 — AI kører SAMME motor med en foreslået standard-træningsplan (ingen
//        aiRecoverySweep-særtilfælde)
//
// Ny fil (ikke en udvidelse af fatigueSimulation2650.js) fordi modellen er
// strukturelt anderledes (udvikling er nu en del af simuleringen, ikke kun fatigue).
// fatigueSimulation2650.js's status_quo-reproduktion bevares urørt som separat
// artefakt/reference.
//
// FATIGUE-fidelity: nextFatigue-formlen er 1:1 reimplementeret (kopieret fra
// riderCondition.js linje 27-37) fordi cfg (recoveryBase/recoveryFraction) skal
// kunne DI'es pr. D3-kandidat — samme mønster + selvcheck som fatigueSimulation2650.js.
//
// UDVIKLINGS-fidelity: population-samplet (population_sample_2650.json) har KUN
// {is_ai, fatigue, recovery} — ingen alder/potentiale/caps/gap pr. rytter (det sample
// blev trukket til #2650's fatigue-only-formål). For at undgå at trække et nyt,
// bredere sample (uden for denne opgaves read-only-ramme til at genbruge eksisterende
// data) bruges en REPRÆSENTATIV rytter-konstant (alder 27 = karrieretop, potentiale 3
// = median, gap-til-loft = 1 "enhed") til udviklings-beregningen. Det er en RELATIV
// model — absolutte "ability-point" er ikke meningsfulde her, kun forholdet mellem
// scenarier (racing vs. bænk, træning vs. race-stimulus) er det. Se "Åbne risici" i
// rapporten. abilityMult/focusGrowthMult/growthFractionForAge/youthMultiplier/
// youthRateForPotential er de ÆGTE eksporterede funktioner fra dailyTraining.js/
// training.js/academyFlag.js/riderProgression.js — ikke gættet.
//
// Kør: node backend/scripts/loebsdagsModelSimulation.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { raceFatigueLoad } from "../lib/raceFatigue.js";
import { DAILY_TRAINING_CONFIG, growthFractionForAge } from "../lib/dailyTraining.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES, TRAINING_FOCUS_KEYS } from "../lib/training.js";
import { youthMultiplier } from "../lib/academyFlag.js";
import { youthRateForPotential } from "../lib/riderProgression.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { nextFatigue, CONDITION_CONFIG } from "../lib/riderCondition.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad";

// ── Empirisk input (genbruger #2650's sample; race-frekvens + intensitet/fokus
//    RE-VERIFICERET mod prod 2026-08-06 sen eftermiddag, se opgave-rapporten for
//    de rå SQL-tal) ───────────────────────────────────────────────────────────
const population = JSON.parse(fs.readFileSync(path.join(SCRATCH, "population_sample_2650.json"), "utf8"));

// Race-dags-frekvens: dedupe(rider_id,race_id,stage_number), imported_at seneste
// 14 dage, samme "rigtige hold"-filter (is_ai/is_bank/is_frozen/is_test_account).
// Genverificeret 2026-08-06: human 41571 race-day-rows / 3207 ryttere / 14d,
// AI 29969/3473/14d — marginalt højere end #2650's 18/7-baserede 12.806/8.661
// (populationen bevæger sig time for time), samme størrelsesorden.
const HUMAN_RACE_PROB_PER_DAY = 41571 / 3207 / 14; // ≈ 0.9261
const AI_RACE_PROB_PER_DAY_CURRENT_ENGINE = 29969 / 3473 / 14; // ≈ 0.6164 (status quo, IKKE ændret af D1-D4 — D4 ændrer AI's TRÆNING, ikke dens race-tilmelding)

// Trænings-intensitet + -fokus for MENNESKE-hold (training_plans, re-queried
// 2026-08-06): intensity normal 2058/hard 1060/easy 579/rest 542 (n=4239);
// focus vo2max 1655/threshold 1006/endurance 623/sprint 482/aero 370/technique 103
// (n=4239). Uafhængig sampling af de to dimensioner (rimelig forenkling — vi har
// ikke den fulde joint-fordeling, kun to marginaler fra samme tabel).
const HUMAN_INTENSITY_DIST = [
  ["normal", 2058 / 4239], ["hard", 1060 / 4239], ["easy", 579 / 4239], ["rest", 542 / 4239],
];
const HUMAN_FOCUS_DIST = [
  ["vo2max", 1655 / 4239], ["threshold", 1006 / 4239], ["endurance", 623 / 4239],
  ["sprint", 482 / 4239], ["aero", 370 / 4239], ["technique", 103 / 4239],
];

// D4 — foreslået AI-standardplan (der findes ingen "AI-manager-valgte planer" i
// dag, så dette er et FORSLAG, ikke et empirisk tal): normal/easy-rotation 50/50
// (ingen "hard" — AI skal ikke ramme skaderisiko-kanten uden en manager til at
// nedjustere; ingen "rest" — AI'en er per definition altid "til stede"), fokus
// uniformt fordelt over alle 6 fokusser (AI har ingen specialiserings-bias som en
// menneske-manager — jævn udvikling over hele evne-paletten er den mest neutrale
// bænk-baseline for balance-sammenligning).
const AI_INTENSITY_DIST = [["normal", 0.5], ["easy", 0.5]];
const AI_FOCUS_DIST = TRAINING_FOCUS_KEYS.map((f) => [f, 1 / TRAINING_FOCUS_KEYS.length]);

// ── D2 — race-profil → udviklings-relevante evner ──────────────────────────
// Dokumenteret forslag (afledt af raceFatigue.js's 9 profiltyper + eksisterende
// TRAINING_FOCUSES-grupperinger, så mapningen "føles" som den trænings-fokus
// løbstypen mest ligner):
const RACE_PROFILE_ABILITY_MAP = Object.freeze({
  // Fladt/sprinter-terræn: aero (flat) + sprint-fokus (sprint,acceleration).
  flat: ["flat", "sprint", "acceleration"],
  // Bølget terræn uden hårde stigninger: punchy ryk + tempo-holdeevne (vo2max-adjacent).
  rolling: ["punch", "tempo", "endurance"],
  // Kuperet: klassisk vo2max-trekant (climbing/punch/tempo).
  hilly: ["climbing", "punch", "tempo"],
  // Én-dags-klassiker (teknisk + hårdt, IKKE brosten): teknik + udholdenhed/durability.
  classic: ["punch", "durability", "positioning"],
  // Brosten: teknik (cobblestone) + robusthed + fladt-power.
  cobbles: ["cobblestone", "durability", "flat"],
  // Bjerg: climbing + udholdenhed/durability (vo2max+endurance-krydsning).
  mountain: ["climbing", "endurance", "durability"],
  // Højbjerg: samme som bjerg + recovery (længere/hårdere belastning kræver mere
  // restitutionsevne for at kunne omsætte belastningen — spejler raceLoad 20 vs 18).
  high_mountain: ["climbing", "endurance", "recovery", "durability"],
  // Enkeltstart: threshold+aero-krydsning (time_trial er fælles for begge fokusser).
  itt: ["time_trial", "tempo"],
  // Holdenkeltstart: samme TT-evne + taktik/positionering (holdsamarbejde).
  ttt: ["time_trial", "tactics", "positioning"],
});

// Kalender-scenarier for profil-MIX (påvirker den GENNEMSNITLIGE raceLoad/løbsdag,
// jf. opgaven — "profilmixet ændrer den gennemsnitlige raceLoad pr. dag"):
//
// "current" — race_stage_profiles-tabellen ER populeret i prod nu (modsat #2650's
// 6/8-formiddags-snapshot der fandt den tom under sæson-overgangen); re-queried
// 2026-08-06: flat 707, mountain 512, hilly 414, high_mountain 179, rolling 138,
// cobbles 102, itt 77, classic 77, ttt 2 (n=2208).
const PROFILE_MIX_CURRENT = [
  ["flat", 707], ["mountain", 512], ["hilly", 414], ["high_mountain", 179],
  ["rolling", 138], ["cobbles", 102], ["itt", 77], ["classic", 77], ["ttt", 2],
].map(([t, n]) => [t, n / 2208]);

// "K-B" — S3-målkalenderen fra opgavebeskrivelsen: flad 24 / kuperet(hilly) 30 /
// bjerg(mountain) 28 / ITT 8 / brosten(cobbles) 6 / TTT 4 (n=100). Ingen
// "rolling"/"classic"/"high_mountain" i denne målkalender — 0-vægtet.
const PROFILE_MIX_KB = [
  ["flat", 24], ["hilly", 30], ["mountain", 28], ["itt", 8], ["cobbles", 6], ["ttt", 4],
].map(([t, n]) => [t, n / 100]);

const DAYS = 28;
const TARGET_LO = 40, TARGET_HI = 60, PUNISH_THRESHOLD = 70;
const REP_AGE = 27;          // repræsentativ alder (karrieretop, youthMultiplier=1.0)
const REP_POTENTIALE = 3;    // repræsentativ potentiale (median af 1-6-skalaen)
const DEV_MULT = 1.15;       // D2 midtpunkt (ejer-valgt bånd 1.10-1.20)
const DEV_MULT_LO = 1.10, DEV_MULT_HI = 1.20; // G4-sensitivitet

// ── Deterministisk PRNG (samme mulberry32 som #2650) ────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted(rng, dist) {
  const r = rng();
  let acc = 0;
  for (const [key, w] of dist) {
    acc += w;
    if (r < acc) return key;
  }
  return dist[dist.length - 1][0];
}

// ── Udviklings-"enheds"-model (se fil-header for hvorfor gap=1) ─────────────
// Spejler dailyAbilityDelta (dailyTraining.js linje 64-88) 1:1 i STRUKTUR
// (samme faktorer, samme rækkefølge), men med gap=1 (relativ model) og uden
// staff/facility/academy-leddene (alle = 1.0 for en "gennemsnits-rytter uden
// klub-opgraderinger" — konservativt, undervurderer ikke forskellen mellem
// scenarier, som er det denne sim faktisk måler).
function trainingUnitTotal({ focus, intensity }, noise) {
  if (intensity === "rest") return 0;
  const focusAbilities = TRAINING_FOCUSES[focus] ?? [];
  const base = (growthFractionForAge(REP_AGE) * DAILY_TRAINING_CONFIG.dailyBudgetBoost) / DAILY_TRAINING_CONFIG.daysPerSeason;
  const potRate = youthRateForPotential(REP_POTENTIALE);
  let total = 0;
  for (const ability of VISIBLE_ABILITIES) {
    const mult = focusAbilities.includes(ability)
      ? (TRAINING_CONFIG.focusGrowthMult[intensity] ?? 1)
      : TRAINING_CONFIG.offFocusMult;
    total += base * mult * youthMultiplier(REP_AGE) * potRate * noise;
  }
  return total;
}

// ── D3-kandidater: recovery-varianter × raceLoad-multiplikatorer ───────────
const RECOVERY_VARIANTS = {
  unchanged: { label: "recovery uændret (base4/frac0.13)", recoveryBase: 4, recoveryFraction: 0.13 },
  base5: { label: "recoveryBase 4→5", recoveryBase: 5, recoveryFraction: 0.13 },
  frac015: { label: "recoveryFraction 0.13→0.15", recoveryBase: 4, recoveryFraction: 0.15 },
  // BONUS (uden for opgavens 3-punkts-liste): begge enkelt-varianter lander
  // menneske-medianen lige PÅ 60-grænsen ved raceLoad×1.0 (se rapport) — testet
  // her for at se om en KOMBINERET, lidt kraftigere recovery giver mere luft.
  combined_base5_frac015: { label: "KOMBINERET: base 4→5 + frac 0.13→0.15", recoveryBase: 5, recoveryFraction: 0.15 },
};
const RACELOAD_MULTS = [1.0, 1.25, 1.5, 1.75];

function buildCandidates() {
  const out = {};
  for (const [rKey, rVar] of Object.entries(RECOVERY_VARIANTS)) {
    for (const mult of RACELOAD_MULTS) {
      const key = `${rKey}_x${mult}`;
      out[key] = {
        label: `raceLoad×${mult} + ${rVar.label}`,
        recoveryBase: rVar.recoveryBase,
        recoveryFraction: rVar.recoveryFraction,
        raceLoadMult: mult,
      };
    }
  }
  return out;
}
const CANDIDATES = buildCandidates();

// ── Simulering af én rytter over DAYS dage, fuld D1-D4-model ───────────────
function simulateRider({ startFatigue, recoveryAbility, rng, candidate, profileMix, raceProb, intensityDist, focusDist, devMult = DEV_MULT }) {
  let fatigue = startFatigue;
  const trace = [fatigue];
  let daysToTarget = null;
  let daysRaced = 0;
  let cumulativeDev = 0;
  const devByAbility = {};
  for (const a of VISIBLE_ABILITIES) devByAbility[a] = 0;

  for (let day = 1; day <= DAYS; day++) {
    const noise = 0.85 + 0.3 * rng(); // samme ±15%-spredning som DAILY_TRAINING_CONFIG.noiseSpan
    const racesToday = rng() < raceProb;
    let trainingLoad = 0, raceLoad = 0, devToday = 0;

    if (racesToday) {
      daysRaced++;
      const profile = pickWeighted(rng, profileMix);
      raceLoad = raceFatigueLoad(profile) * candidate.raceLoadMult;
      // D1: intet trænings-load denne dag. D2: udviklingsstimulus = devMult × det
      // ERSTATTEDE pas' udvikling (trukket fra samme intensitet/fokus-fordeling som
      // hvis dagen IKKE var en løbsdag — "det pas der ellers var blevet kørt").
      const wouldBeIntensity = pickWeighted(rng, intensityDist);
      const wouldBeFocus = pickWeighted(rng, focusDist);
      const replaced = trainingUnitTotal({ focus: wouldBeFocus, intensity: wouldBeIntensity }, noise);
      devToday = replaced * devMult;
      const relevant = RACE_PROFILE_ABILITY_MAP[profile] ?? [];
      if (relevant.length) {
        const per = devToday / relevant.length;
        for (const a of relevant) devByAbility[a] += per;
      }
    } else {
      const intensity = pickWeighted(rng, intensityDist);
      const focus = pickWeighted(rng, focusDist);
      trainingLoad = DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0;
      devToday = trainingUnitTotal({ focus, intensity }, noise);
      const focusAbilities = TRAINING_FOCUSES[focus] ?? [];
      if (intensity !== "rest") {
        for (const a of VISIBLE_ABILITIES) {
          const mult = focusAbilities.includes(a) ? (TRAINING_CONFIG.focusGrowthMult[intensity] ?? 1) : TRAINING_CONFIG.offFocusMult;
          const base = (growthFractionForAge(REP_AGE) * DAILY_TRAINING_CONFIG.dailyBudgetBoost) / DAILY_TRAINING_CONFIG.daysPerSeason;
          devByAbility[a] += base * mult * youthMultiplier(REP_AGE) * youthRateForPotential(REP_POTENTIALE) * noise;
        }
      }
    }

    const recovery = candidate.recoveryBase
      + CONDITION_CONFIG.recoveryFromAbility * ((recoveryAbility || 0) / 99)
      + candidate.recoveryFraction * Math.max(0, fatigue);
    const next = fatigue + trainingLoad + raceLoad - recovery;
    fatigue = Math.max(0, Math.min(100, Math.round(next)));

    trace.push(fatigue);
    cumulativeDev += devToday;
    if (daysToTarget === null && fatigue >= TARGET_LO && fatigue <= TARGET_HI) daysToTarget = day;
  }

  return { finalFatigue: fatigue, trace, daysToTarget, daysRaced, cumulativeDev, devByAbility };
}

function percentile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function summarize(results) {
  const finals = results.map((r) => r.finalFatigue).sort((a, b) => a - b);
  return {
    n: results.length,
    median: percentile(finals, 0.5),
    p90: percentile(finals, 0.9),
    mean: Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10,
    pctGe70: Math.round((finals.filter((f) => f >= PUNISH_THRESHOLD).length / finals.length) * 1000) / 10,
    pctInTargetBand: Math.round((finals.filter((f) => f >= TARGET_LO && f <= TARGET_HI).length / finals.length) * 1000) / 10,
  };
}

function runCandidate(candidateKey, calendarKey) {
  const candidate = CANDIDATES[candidateKey];
  const profileMix = calendarKey === "kb" ? PROFILE_MIX_KB : PROFILE_MIX_CURRENT;
  const humanStart = population.filter((p) => p.is_ai === false);
  const aiStart = population.filter((p) => p.is_ai === true);

  const seedBase = [...(candidateKey + calendarKey)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const humanRng = mulberry32(seedBase * 7 + 1);
  const aiRng = mulberry32(seedBase * 7 + 2);

  const humanResults = humanStart.map((p) => simulateRider({
    startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: false, rng: humanRng, candidate,
    profileMix, raceProb: HUMAN_RACE_PROB_PER_DAY, intensityDist: HUMAN_INTENSITY_DIST, focusDist: HUMAN_FOCUS_DIST,
  }));
  const aiResults = aiStart.map((p) => simulateRider({
    startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: true, rng: aiRng, candidate,
    profileMix, raceProb: AI_RACE_PROB_PER_DAY_CURRENT_ENGINE, intensityDist: AI_INTENSITY_DIST, focusDist: AI_FOCUS_DIST,
  }));

  return {
    candidate: candidateKey, calendar: calendarKey, label: candidate.label,
    human: summarize(humanResults), ai: summarize(aiResults),
    humanRaw: humanResults, aiRaw: aiResults,
  };
}

// ── G3 — 5-dages etapeløbs-spidstest ────────────────────────────────────────
// Eksplicit sekvens (grand-tour-agtig blanding): hilly, flat, mountain,
// high_mountain, itt. ALLE dage er løbsdage (racesToday=true tvunget) for de
// udtrukne ryttere, ingen tilfældig raceProb — det ER en etapeserie.
const STAGE_RACE_SEQUENCE = ["hilly", "flat", "mountain", "high_mountain", "itt"];
function simulateStageRace({ startFatigue, recoveryAbility, candidate }) {
  let fatigue = startFatigue;
  const trace = [fatigue];
  let peak = fatigue;
  for (const profile of STAGE_RACE_SEQUENCE) {
    const raceLoad = raceFatigueLoad(profile) * candidate.raceLoadMult;
    const recovery = candidate.recoveryBase
      + CONDITION_CONFIG.recoveryFromAbility * ((recoveryAbility || 0) / 99)
      + candidate.recoveryFraction * Math.max(0, fatigue);
    fatigue = Math.max(0, Math.min(100, Math.round(fatigue + raceLoad - recovery)));
    trace.push(fatigue);
    peak = Math.max(peak, fatigue);
  }
  return { trace, peak, exceeded70: peak >= PUNISH_THRESHOLD };
}
function runStageRaceSpikeTest(candidateKey) {
  const candidate = CANDIDATES[candidateKey];
  const sample = population.slice(0, 200); // 100 human + 100 AI (samplet er 500/500, første 200 er repræsentativt nok til en spids-test)
  const results = sample.map((p) => simulateStageRace({ startFatigue: p.fatigue, recoveryAbility: p.recovery, candidate }));
  const exceeded = results.filter((r) => r.exceeded70).length;
  return { candidate: candidateKey, n: results.length, pctExceeded70: Math.round((exceeded / results.length) * 1000) / 10, meanPeak: Math.round((results.reduce((a, r) => a + r.peak, 0) / results.length) * 10) / 10 };
}

// ── G4 — udviklingstempo racende vs. bænk ───────────────────────────────────
// To syntetiske sub-kohorter på HUMAN-fordelingen: "racer" (empirisk raceProb,
// som i dag) vs. "bænk" (raceProb=0, ren træning — samme intensitets/fokus-mix).
// Sammenligner kumuleret udviklings-"enheder" over 28 dage.
function runDevTempoComparison(candidateKey, devMult = DEV_MULT) {
  const candidate = CANDIDATES[candidateKey];
  const humanStart = population.filter((p) => p.is_ai === false);
  const rngRacer = mulberry32(999001);
  const rngBench = mulberry32(999002);

  const racerResults = humanStart.map((p) => simulateRider({
    startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: false, rng: rngRacer, candidate,
    profileMix: PROFILE_MIX_CURRENT, raceProb: HUMAN_RACE_PROB_PER_DAY,
    intensityDist: HUMAN_INTENSITY_DIST, focusDist: HUMAN_FOCUS_DIST, devMult,
  }));
  const benchResults = humanStart.map((p) => simulateRider({
    startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: false, rng: rngBench, candidate,
    profileMix: PROFILE_MIX_CURRENT, raceProb: 0,
    intensityDist: HUMAN_INTENSITY_DIST, focusDist: HUMAN_FOCUS_DIST, devMult,
  }));

  const avgDev = (arr) => arr.reduce((a, r) => a + r.cumulativeDev, 0) / arr.length;
  const racerAvg = avgDev(racerResults);
  const benchAvg = avgDev(benchResults);
  return {
    candidate: candidateKey, devMult,
    racerAvgDev28d: Math.round(racerAvg * 1000) / 1000,
    benchAvgDev28d: Math.round(benchAvg * 1000) / 1000,
    racerVsBenchRatio: Math.round((racerAvg / benchAvg) * 1000) / 1000,
    racerAvgDaysRaced: Math.round((racerResults.reduce((a, r) => a + r.daysRaced, 0) / racerResults.length) * 10) / 10,
  };
}

// ── Selv-check: nextFatigue-reimplementering matcher riderCondition.js ─────
function selfCheckFormulaParity() {
  const cases = [
    { fatigue: 50, intensity: "normal", recoveryAbility: 40, raceLoad: 0 },
    { fatigue: 90, intensity: "rest", recoveryAbility: 15, raceLoad: 12 },
    { fatigue: 0, intensity: "hard", recoveryAbility: 99, raceLoad: 0 },
  ];
  for (const c of cases) {
    const expected = nextFatigue(c);
    const load = DAILY_TRAINING_CONFIG.fatigueLoad[c.intensity] ?? 0;
    const recovery = CONDITION_CONFIG.recoveryBase
      + CONDITION_CONFIG.recoveryFromAbility * ((c.recoveryAbility || 0) / 99)
      + CONDITION_CONFIG.recoveryFraction * Math.max(0, c.fatigue);
    const actual = Math.max(0, Math.min(100, Math.round(c.fatigue + load + c.raceLoad - recovery)));
    if (actual !== expected) throw new Error(`Formula parity FAILED: ${JSON.stringify(c)} reimpl=${actual} lib=${expected}`);
  }
  console.log("[selfcheck] nextFatigue-reimplementering matcher riderCondition.js bit-identisk (status-quo cfg). OK.");
}

function fmtRow(label, s) {
  return `${label.padEnd(24)} median=${String(s.median).padStart(3)}  p90=${String(s.p90).padStart(3)}  mean=${String(s.mean).padStart(5)}  %>=70=${String(s.pctGe70).padStart(5)}%  %in[40-60]=${String(s.pctInTargetBand).padStart(5)}%`;
}

function main() {
  selfCheckFormulaParity();
  console.log("=".repeat(110));
  console.log("#3459 løbsdags-model — 28-dages simulering D1-D4 (read-only, empirisk input re-verificeret 2026-08-06)");
  console.log(`Race-sandsynlighed/dag: human=${HUMAN_RACE_PROB_PER_DAY.toFixed(4)}  AI=${AI_RACE_PROB_PER_DAY_CURRENT_ENGINE.toFixed(4)}`);
  console.log(`raceLoad vægtet gnsn: current-kalender≈${(PROFILE_MIX_CURRENT.reduce((a,[t,w])=>a+raceFatigueLoad(t)*w,0)).toFixed(2)}  K-B-kalender≈${(PROFILE_MIX_KB.reduce((a,[t,w])=>a+raceFatigueLoad(t)*w,0)).toFixed(2)}`);
  console.log("=".repeat(110));

  const allResults = [];
  for (const calendarKey of ["current", "kb"]) {
    console.log(`\n${"#".repeat(60)}\nKALENDER-SCENARIE: ${calendarKey === "kb" ? "K-B S3-målkalender" : "Nuværende (race_stage_profiles live-mix)"}\n${"#".repeat(60)}`);
    for (const key of Object.keys(CANDIDATES)) {
      const r = runCandidate(key, calendarKey);
      allResults.push({ candidate: r.candidate, calendar: r.calendar, label: r.label, human: r.human, ai: r.ai });
      console.log(`\n### ${r.label}`);
      console.log(fmtRow("  Human +28d", r.human));
      console.log(fmtRow("  AI +28d", r.ai));
    }
  }

  console.log(`\n${"#".repeat(60)}\nG3 — 5-DAGES ETAPELØBS-SPIDSTEST (${STAGE_RACE_SEQUENCE.join(" → ")})\n${"#".repeat(60)}`);
  const stageRaceResults = [];
  for (const key of Object.keys(CANDIDATES)) {
    const r = runStageRaceSpikeTest(key);
    stageRaceResults.push(r);
    console.log(`  ${CANDIDATES[key].label.padEnd(45)} meanPeak=${String(r.meanPeak).padStart(6)}  %ryttere≥70 undervejs=${r.pctExceeded70}%`);
  }

  console.log(`\n${"#".repeat(60)}\nG4 — UDVIKLINGSTEMPO: RACENDE VS. BÆNK (devMult=${DEV_MULT}, alle recovery-varianter × raceLoad{1.0,1.25})\n${"#".repeat(60)}`);
  const g4Results = [];
  for (const rKey of Object.keys(RECOVERY_VARIANTS)) {
    for (const mult of [1.0, 1.25]) {
      const key = `${rKey}_x${mult}`;
      for (const dm of [DEV_MULT_LO, DEV_MULT, DEV_MULT_HI]) {
        const r = runDevTempoComparison(key, dm);
        g4Results.push(r);
        console.log(`  ${CANDIDATES[key].label.padEnd(40)} devMult=${dm}  racerAvgDev/28d=${r.racerAvgDev28d}  benchAvgDev/28d=${r.benchAvgDev28d}  ratio(racer/bænk)=${r.racerVsBenchRatio}  gnsn.løbsdage=${r.racerAvgDaysRaced}`);
      }
    }
  }

  const outPath = path.join(SCRATCH, "loebsdagsModelSimulation-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ sweep: allResults, stageRace: stageRaceResults, devTempo: g4Results }, null, 2));
  console.log(`\nFuldt resultat skrevet til: ${outPath}`);
}

main();
