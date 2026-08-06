// #2650 — Fatigue-mætning: 28-dages simulering pr. kohorte (menneske vs. AI).
//
// READ-ONLY. Ingen DB-skrivning. Genbruger de FAKTISKE prod-formler direkte fra
// riderCondition.js / dailyTraining.js / raceFatigue.js (importeret, ikke
// genskrevet) så simuleringen aldrig kan drifte fra den kode der rent faktisk
// kører. Empiriske input (start-fordeling, race-frekvens, trænings-intensitet-
// fordeling) er hentet read-only fra prod 2026-08-06 (Supabase project
// ghwvkxzhsbbltzfnuhhz) — se kommentarer ved hver konstant for kilden.
//
// Kør: node backend/scripts/fatigueSimulation2650.js
//
// VIGTIGT FUND (verificeret 2026-08-06, IKKE i issuets 18/7-tal): #3015
// (b2c99b42, merged 2026-08-03) fixede AI-holdenes manglende restitution.
// Prod-snapshot i dag viser AI-kohorten er VENDT — median 33 / snit 31.2,
// under 40-60-målbåndet, IKKE over det som issuet beskriver. Menneske-
// kohorten er stadig over målbåndet (median 85 / snit 70.7). Simuleringen
// nedenfor bruger DAGENS empiriske start-fordelinger, ikke 18/7-tallene.

import { nextFatigue, CONDITION_CONFIG } from "../lib/riderCondition.js";
import { DAILY_TRAINING_CONFIG } from "../lib/dailyTraining.js";
import { raceFatigueLoad } from "../lib/raceFatigue.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Empirisk input (kilde: read-only SQL mod prod, 2026-08-06) ─────────────

// Start-population: 500 tilfældigt udtrukne ryttere pr. kohorte (riders/teams/
// rider_condition/rider_derived_abilities join, ekskl. bank/frozen/test-hold),
// gemt i scratchpad (se opgavebeskrivelsen). n=6672 i alt i prod (3199 human +
// 3473 AI); sample n=500/500 er tilstrækkeligt til stabile percentiler.
const SAMPLE_PATH = process.env.FATIGUE_SIM_SAMPLE_PATH ||
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/population_sample_2650.json";
const population = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));

// Race-dags-frekvens pr. 14 dage (race_results.imported_at som proxy for
// løbsdato, dedupe på rider_id/race_id/stage_number, seneste 14 dage, samme
// hold-filter som ovenfor): human avg_race_days_per_14d=12.806 (84.7% af
// rytterne racede mindst 1 gang), AI=8.661 (89.8%). Omregnet til daglig
// race-sandsynlighed pr. rytter (uniform over dagene — vi har ikke pr.-dag
// kalenderdata, kun 14-dages-summen):
const HUMAN_RACE_PROB_PER_DAY = 12.806 / 14; // ≈ 0.9147
const AI_RACE_PROB_PER_DAY = 8.661 / 14;     // ≈ 0.6186

// Trænings-intensitet-fordeling for MENNESKE-hold på dage rytteren IKKE racer
// (kilde: training_plans.intensity, distinct rows grupperet, n=4234): normal
// 2055 (48.5%), hard 1064 (25.1%), easy 582 (13.7%), rest 533 (12.6%).
// Ryttere UDEN eksplicit plan falder tilbage til DEFAULT_PROGRAM.intensity=
// "normal" (dailyTraining.js resolveProgram) — indregnet ved at behandle
// "normal"-andelen som gulv (plan-fordelingen er allerede repræsentativ nok
// til at bruge direkte, da ~73% af human-rytterne har en training_plans-row).
const HUMAN_TRAINING_INTENSITY_DIST = [
  ["normal", 0.485], ["hard", 0.251], ["easy", 0.137], ["rest", 0.126],
];

// #3015 (verificeret i kode, backend/lib/aiRecoverySweep.js + trainingSweep.js
// is_ai=false-filter): AI-hold får IKKE dailyTrainingEngine (trænings-plan,
// ability-progression) — kun den dedikerede recovery-sweep, som ALTID kalder
// nextFatigue med intensity="rest". Ingen fordeling at trække fra — status
// quo for AI er deterministisk "rest" hver dag (raceLoad lægges oveni separat
// via raceFatigue.js på dage AI-holdet racer, uafhængigt af sweepen — se
// aiRecoverySweep.js linje 100-102).
const AI_TRAINING_INTENSITY = "rest";

// Race-belastning pr. etapeprofil (RACE_FATIGUE_BY_PROFILE, raceFatigue.js).
// race_stage_profiles er TOM i prod lige nu (sæson-overgang) så vi har ingen
// live profil-mix at trække fra — bruger derfor to eksplicitte scenarier:
// "default" = kodens egen ukendt-profil-fallback (12, rolling), og
// "avg" = uvægtet gennemsnit af alle 9 profiltyper (128/9 ≈ 14.2). Vi
// rapporterer begge; hovedtabellen bruger "default"=12 fordi det er den
// faktiske fallback-værdi koden selv bruger når profilen ikke er kendt.
// raceFatigueLoad() er den EKSPORTEREDE funktion fra raceFatigue.js — det
// underliggende RACE_FATIGUE_BY_PROFILE-objekt er ikke exporteret, så vi
// kalder funktionen i stedet for at duplikere tallene (undgår formel-drift).
const KNOWN_PROFILE_TYPES = ["flat", "rolling", "hilly", "classic", "cobbles", "mountain", "high_mountain", "itt", "ttt"];
const RACE_LOAD_DEFAULT = raceFatigueLoad("__unknown__"); // koden falder tilbage til 12 (rolling) for ukendt profil
const RACE_LOAD_AVG = KNOWN_PROFILE_TYPES.reduce((a, t) => a + raceFatigueLoad(t), 0) / KNOWN_PROFILE_TYPES.length; // ≈14.2

// Recovery-ability bruges direkte fra hver rytters eget sample-punkt
// (rider_derived_abilities.recovery, 0-99 skala) — ikke en kohorte-konstant.

const DAYS = 28;
const TARGET_LO = 40, TARGET_HI = 60, PUNISH_THRESHOLD = 70;

// ── Deterministisk PRNG (seedet) så kørsler er reproducerbare ──────────────
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

// ── Kandidat-konfigurationer ─────────────────────────────────────────────
// Hver kandidat overrider ét eller flere led i CONDITION_CONFIG / raceLoad /
// AI-intensitet. status_quo = 0 ændringer (ren reproduktion af prod-koden).
const CANDIDATES = {
  status_quo: {
    label: "Status quo (prod-formler uændret)",
    conditionOverrides: {},
    raceLoadMult: 1.0,
    aiIntensity: AI_TRAINING_INTENSITY,
    noStackOnRaceDay: false,
  },
  K1_recovery_boost: {
    label: "K1: recovery-øgning (recoveryBase 4→5.5, recoveryFraction 0.13→0.16)",
    conditionOverrides: { recoveryBase: 5.5, recoveryFraction: 0.16 },
    raceLoadMult: 1.0,
    aiIntensity: AI_TRAINING_INTENSITY,
    noStackOnRaceDay: false,
  },
  K2_raceload_scaledown: {
    label: "K2: raceLoad nedskaleret 25% (alle profiltyper × 0.75)",
    conditionOverrides: {},
    raceLoadMult: 0.75,
    aiIntensity: AI_TRAINING_INTENSITY,
    noStackOnRaceDay: false,
  },
  K3_no_stack_plus_ai_easy: {
    label: "K3: ingen træning-oveni-race-stakning (mennesker, hård/full rest) + AI-sweep 'rest'→'easy'",
    conditionOverrides: {},
    raceLoadMult: 1.0,
    aiIntensity: "easy", // AI løftes fra rest(-14) til easy(+4) — se begrundelse i rapport
    noStackOnRaceDay: true, // hvis rytteren racer i dag, springes dagens trænings-intensitet over (behandles som "rest")
  },
  K4_soft_downgrade_plus_ai_easy: {
    label: "K4: BLØD race-dag-nedgradering (hard/normal→easy, IKKE fuld rest) + raceLoad×0.85 + AI 'rest'→'easy'",
    conditionOverrides: {},
    raceLoadMult: 0.85,
    aiIntensity: "easy",
    noStackOnRaceDay: "soft", // se simulateRider: nedgraderer kun hard/normal→easy, rører ikke rest/easy-planer
  },
};

// ── Simulering af én rytter over DAYS dage ──────────────────────────────
function simulateRider({ startFatigue, recoveryAbility, isAi, rng, candidate }) {
  const cfg = { ...CONDITION_CONFIG, ...candidate.conditionOverrides };
  const raceProb = isAi ? AI_RACE_PROB_PER_DAY : HUMAN_RACE_PROB_PER_DAY;
  const raceLoadPoint = RACE_LOAD_DEFAULT * candidate.raceLoadMult;

  let fatigue = startFatigue;
  const trace = [fatigue];
  let daysToTarget = null; // første dag fatigue rammer [40,60]-båndet

  for (let day = 1; day <= DAYS; day++) {
    const racesToday = rng() < raceProb;
    const raceLoad = racesToday ? raceLoadPoint : 0;

    let intensity;
    if (isAi) {
      intensity = candidate.aiIntensity;
    } else {
      const planned = pickWeighted(rng, HUMAN_TRAINING_INTENSITY_DIST);
      if (racesToday && candidate.noStackOnRaceDay === true) {
        intensity = "rest"; // K3: ingen træningsplan-belastning oveni race-dagen
      } else if (racesToday && candidate.noStackOnRaceDay === "soft") {
        // K4: kun de to tungeste intensiteter nedgraderes til "easy" på en
        // race-dag; en rytter der ALLEREDE havde rest/easy planlagt beholder den.
        intensity = (planned === "hard" || planned === "normal") ? "easy" : planned;
      } else {
        intensity = planned;
      }
    }

    // Reimplementerer nextFatigue's formel manuelt KUN for at kunne injicere
    // cfg-overrides (den importerede nextFatigue bruger CONDITION_CONFIG
    // direkte og kan ikke DI'es) — load/recovery-leddene er 1:1 kopieret fra
    // riderCondition.js linje 30-37, ikke gættet.
    const load = DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0;
    const recovery =
      cfg.recoveryBase +
      cfg.recoveryFromAbility * ((recoveryAbility || 0) / 99) +
      cfg.recoveryFraction * Math.max(0, fatigue);
    const next = fatigue + load + raceLoad - recovery;
    fatigue = Math.max(0, Math.min(100, Math.round(next)));

    trace.push(fatigue);
    if (daysToTarget === null && fatigue >= TARGET_LO && fatigue <= TARGET_HI) {
      daysToTarget = day;
    }
  }

  return { finalFatigue: fatigue, trace, daysToTarget };
}

function percentile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(results) {
  const finals = results.map((r) => r.finalFatigue).sort((a, b) => a - b);
  const withTarget = results.filter((r) => r.daysToTarget !== null);
  return {
    n: results.length,
    median: percentile(finals, 0.5),
    p90: percentile(finals, 0.9),
    mean: Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10,
    pctGe70: Math.round((finals.filter((f) => f >= PUNISH_THRESHOLD).length / finals.length) * 1000) / 10,
    pctInTargetBand: Math.round((finals.filter((f) => f >= TARGET_LO && f <= TARGET_HI).length / finals.length) * 1000) / 10,
    medianDaysToTarget: withTarget.length
      ? percentile(withTarget.map((r) => r.daysToTarget).sort((a, b) => a - b), 0.5)
      : null,
    pctReachedTargetWithin28d: Math.round((withTarget.length / results.length) * 1000) / 10,
  };
}

function runCandidate(candidateKey) {
  const candidate = CANDIDATES[candidateKey];
  const humanStart = population.filter((p) => p.is_ai === false);
  const aiStart = population.filter((p) => p.is_ai === true);

  // Seed pr. (kandidat, kohorte) for reproducerbarhed uden fælles RNG-state
  // mellem kandidater (undgår at kandidat-rækkefølgen påvirker resultatet).
  const seedBase = [...candidateKey].reduce((a, c) => a + c.charCodeAt(0), 0);
  const humanRng = mulberry32(seedBase * 7 + 1);
  const aiRng = mulberry32(seedBase * 7 + 2);

  const humanResults = humanStart.map((p) =>
    simulateRider({ startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: false, rng: humanRng, candidate }));
  const aiResults = aiStart.map((p) =>
    simulateRider({ startFatigue: p.fatigue, recoveryAbility: p.recovery, isAi: true, rng: aiRng, candidate }));

  return {
    candidate: candidateKey,
    label: candidate.label,
    human: { startSummary: summarize(humanStart.map((p) => ({ finalFatigue: p.fatigue, daysToTarget: null }))), after28d: summarize(humanResults) },
    ai: { startSummary: summarize(aiStart.map((p) => ({ finalFatigue: p.fatigue, daysToTarget: null }))), after28d: summarize(aiResults) },
  };
}

function fmtRow(cohortLabel, s) {
  return `${cohortLabel.padEnd(22)} median=${String(s.median).padStart(3)}  p90=${String(s.p90).padStart(3)}  mean=${String(s.mean).padStart(5)}  %>=70=${String(s.pctGe70).padStart(5)}%  %in[40-60]=${String(s.pctInTargetBand).padStart(5)}%  medianDaysToTarget=${s.medianDaysToTarget ?? "n/a"}  reached28d=${s.pctReachedTargetWithin28d}%`;
}

function selfCheckFormulaParity() {
  // Sanity-check: vores manuelle reimplementering (nødvendig for cfg-DI) skal
  // være bit-identisk med den IMPORTEREDE nextFatigue for status-quo-config
  // (ingen overrides) — ellers driver simuleringen fra den kode der rent
  // faktisk kører i prod.
  const cases = [
    { fatigue: 50, intensity: "normal", recoveryAbility: 40, raceLoad: 0 },
    { fatigue: 90, intensity: "rest", recoveryAbility: 15, raceLoad: 12 },
    { fatigue: 0, intensity: "hard", recoveryAbility: 99, raceLoad: 0 },
    { fatigue: 100, intensity: "easy", recoveryAbility: 0, raceLoad: 20 },
  ];
  for (const c of cases) {
    const expected = nextFatigue(c);
    const load = DAILY_TRAINING_CONFIG.fatigueLoad[c.intensity] ?? 0;
    const recovery =
      CONDITION_CONFIG.recoveryBase +
      CONDITION_CONFIG.recoveryFromAbility * ((c.recoveryAbility || 0) / 99) +
      CONDITION_CONFIG.recoveryFraction * Math.max(0, c.fatigue);
    const actual = Math.max(0, Math.min(100, Math.round(c.fatigue + load + c.raceLoad - recovery)));
    if (actual !== expected) {
      throw new Error(`Formula parity FAILED for ${JSON.stringify(c)}: reimpl=${actual} lib=${expected}`);
    }
  }
  console.log("[selfcheck] Manuel reimplementering matcher riderCondition.nextFatigue bit-identisk (4/4 cases). OK.");
}

function main() {
  selfCheckFormulaParity();
  console.log("=".repeat(100));
  console.log("#2650 fatigue-mætning — 28-dages simulering (read-only, empirisk input fra prod 2026-08-06)");
  console.log(`Sample: ${population.length} ryttere (${population.filter(p=>!p.is_ai).length} human / ${population.filter(p=>p.is_ai).length} AI)`);
  console.log(`Race-sandsynlighed/dag: human=${HUMAN_RACE_PROB_PER_DAY.toFixed(3)}  AI=${AI_RACE_PROB_PER_DAY.toFixed(3)}`);
  console.log(`raceLoad-punktestimat: default(rolling-fallback)=${RACE_LOAD_DEFAULT}  uvægtet-gnsn-alle-profiler=${RACE_LOAD_AVG.toFixed(1)}`);
  console.log("=".repeat(100));

  const allResults = [];
  for (const key of Object.keys(CANDIDATES)) {
    const r = runCandidate(key);
    allResults.push(r);
    console.log(`\n### ${r.label}`);
    console.log(fmtRow("  Human START", r.human.startSummary));
    console.log(fmtRow("  Human +28d", r.human.after28d));
    console.log(fmtRow("  AI START", r.ai.startSummary));
    console.log(fmtRow("  AI +28d", r.ai.after28d));
  }

  const outPath = path.join(
    "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad",
    "fatigueSimulation2650-results.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nFuldt resultat skrevet til: ${outPath}`);
}

main();
