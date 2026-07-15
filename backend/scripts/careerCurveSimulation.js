#!/usr/bin/env node
// #2437 + #2471 — Fuld karriere-kurve-simulering (16→36 år). READ-ONLY:
// kun SELECT mod prod-DB, INGEN writes/migrations/mutationer. Beslutningsstøtte til
// ejer-review FØR en model vælges — genbruger de ÆGTE motor-funktioner (ingen
// reimplementeret tick-matematik), se import-listen nedenfor.
//
// #2471-UDVIDELSE (15/7): loft-KILDEN er nu en dimension (capSource), fordi PR #2472
// ændrer hvor `caps` kommer fra — ikke hvordan tick'et regner:
//   • "db"     = den PERSISTEREDE ability_caps-værdi (dagens prod-adfærd, møntkast-
//                semantikken). Alle 5 #2437-modeller køres med denne, så scriptet
//                stadig reproducerer før-billedet 2026-07-15-academy-career-curves.json.
//   • "modelA" = loftet GENBEREGNET hver tick via den ægte buildCapsForRider:
//                cap = max(absolut_loft(potentiale, anlæg), current). PR #2472's model.
// Sammenligningen rate/3+db vs rate/3+modelA = præcis den rebasede tilstands effekt,
// målt i SAMME harness (ellers ville tallene ikke være sammenlignelige).
//
// To målinger er tilføjet oven på kurverne, fordi PR #2472's scorecard ikke fanger dem:
//   1) VOKSEN-POPULATION (22-28): scorecardet siger udviklingsrummet går 83 → 250
//      evne-point/rytter. Dagsraten er ∝ gappet (dailyAbilityDelta: gap = cap − current),
//      så de ~979 voksne får en utilsigtet vækst-effekt. Her måles den REALISEREDE vækst,
//      ikke bare hovedrummet.
//   2) FRYS-ANALYSE (alle aldre): model A's gulv max(absolut, current) giver gap = 0 —
//      og dermed permanent frys på den evne — for enhver evne hvor current ≥ absolut_loft.
//      Et gennemsnit skjuler det; her tælles rækkerne.
//
// BAGGRUND (verificeret): #2202 lod dailyTrainingEngine.js sende et SÆSON-LOFT
// (computeAcademySeasonCeiling) som `caps` til applyDailyTick i stedet for livstids-
// loftet. dailyAbilityDelta's gap (=cap−current) faldt fra ~17,9 til ~2,0 → dagsraten
// kollapsede ~9x og aftager derefter eksponentielt resten af sæsonen. Sæson-budgettet
// er ikke opbrugt i prod (83% ubrugt) fordi raten MOD budgettet selv aftager for
// hurtigt til at nå det. Dette script sammenligner 5 kandidat-modeller for at give
// ejeren den fulde kurve FØR en fix vælges (#2437).
//
// Kør: node scripts/careerCurveSimulation.js
//
// SÆSONLÆNGDE-SWEEP-POINTE: DAILY_TRAINING_CONFIG.daysPerSeason er en FROSSEN
// konstant (28) — dailyAbilityDelta dividerer ALTID med den, uanset hvor mange
// daglige ticks vi rent faktisk kører i en simuleret "sæson". Sweepet herunder
// varierer derfor ANTAL TICKS pr. simuleret sæson (28/60/120/200), IKKE selve
// konstanten. Det er bevidst: det er præcis den samme diskrepans som ramte prod
// (S1 var åben i 57+ dage mod den formel, der regner i 28-dages-bidder), og et
// loft-fri model (pre2202/rate-N) SKAL vise voksende gap-lukning ved flere ticks,
// mens sæson-budget-loftet (current) skal forblive mættet/stabilt uanset ticks.
// Det er en pointe i modellen, IKKE en fejl i dette script.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { applyDailyTick, computeAcademySeasonCeiling, resolveProgram } from "../lib/dailyTraining.js";
import { developRiderSeason, buildCapsForRider, buildYouthCaps, youthRoleFactor } from "../lib/riderProgression.js";
import { nextFatigue, nextForm, conditionMultiplier } from "../lib/riderCondition.js";
import { academySeasonFracForAge, isAcademyAge, ACADEMY } from "../lib/academyFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env — kør lokalt med env sat.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Konstanter ────────────────────────────────────────────────────────────────
const SEASON1_YEAR = 2026;         // jf. lib/riderProgressionEngine.LAUNCH_REFERENCE_YEAR (sæson 1)
const MIN_AGE = 16, MAX_AGE_POP = 21, MAX_AGE_SIM = 36;
// #2471: voksen-populationen. Øvre grænse = PROGRESSION_CONFIG.peakAge (28) — samme
// "prePeak"-definition som capSemanticsComparison.js's 83→250-tal, så de kan krydstjekkes.
const ADULT_MIN_AGE = 22, ADULT_MAX_AGE = 28;
// #2471 VETERANER (post-peak). KRITISK at måle: dailyAbilityDelta har INGEN aldersgate —
// kun stepAbility gater (age <= peakAge → vækst, ellers decline), og sæson-stien kører
// skipGrowth:true. Nettoresultat: decline sker 1× pr. sæson, mens daglig træning vokser
// HVER dag i ALLE aldre. Model A's højere loft genåbner derfor gappet for post-peak-
// ryttere, hvis current ligger under det potentiale-ankrede absolutte loft — dvs. den
// kan i praksis ophæve aldringen. Hverken PR-scorecardet eller 22-28-tabellen fanger det.
const VETERAN_MIN_AGE = 29, VETERAN_MAX_AGE = 36;
const VETERAN_SEASONS = 5; // horisont for veteran-tovtrækningen vækst vs. decline
const SEASON_LENGTHS = [28, 60, 120, 200];
const COHORT_POTENTIALS = [6, 5, 4]; // elite / stærk / god
const COHORT_LABELS = { 6: "elite (pot6)", 5: "stærk (pot5)", 4: "god (pot4)" };
const MODELS = ["pre2202", "current", "rate/2", "rate/3", "rate/4"];
const MODEL_LABELS = {
  pre2202: "pre2202 — livstidsloft, INTET sæson-loft, INGEN hardDailyCap (adfærd før 4/7)",
  current: "current — sæson-loft (computeAcademySeasonCeiling) + hardDailyCap (dagens prod)",
  "rate/2": "rate/2 — livstidsloft, INTET sæson-loft, academyRateMult=1/2 + hardDailyCap",
  "rate/3": "rate/3 — livstidsloft, INTET sæson-loft, academyRateMult=1/3 + hardDailyCap",
  "rate/4": "rate/4 — livstidsloft, INTET sæson-loft, academyRateMult=1/4 + hardDailyCap",
};

// ── #2471: loft-kilde ────────────────────────────────────────────────────────
// "db"     → persisteret ability_caps (statisk gennem karrieren, som i dag).
// "modelA" → buildCapsForRider genberegnet HVER tick, præcis som den rebasede motor
//            gør det (PR #2472). Genberegningen betyder noget: gulvet følger current,
//            så et decline-fald kan sænke loftet igen (ratchet nedad).
const CAP_SOURCE_LABELS = {
  db: "db — persisteret ability_caps (dagens prod: møntkast-semantikken)",
  modelA: "modelA — genberegnet hver tick: max(absolut_loft(pot, anlæg), current) (#2472)",
};

// Scenarier = (model, capSource). IKKE et fuldt kryds-produkt: de 5 #2437-modeller
// køres kun med db (de reproducerer før-billedet og er ejer-afgjort), mens den
// SHIPPEDE model (rate/3) også køres med modelA — det er den rebasede tilstand.
const SCENARIOS = [
  ...MODELS.map((model) => ({ model, capSource: "db" })),
  { model: "rate/3", capSource: "modelA" },
];
const scenarioKey = (model, capSource) => `${model}+${capSource}`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function abilitySum(abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) s += Number(abilities[ab]) || 0;
  return s;
}

// Pr.-evne clampet gap-sum (samme metode som scripts/trainingRecalibrationCandidates.js) —
// negative off-type-bidrag (current > cap) skjuler sig ikke i et aggregat-clamp.
function clampedGapSum(caps, abilities) {
  let s = 0;
  for (const ab of VISIBLE_ABILITIES) {
    const cur = Number(abilities[ab]) || 0;
    const cap = caps?.[ab] ?? cur;
    s += Math.max(0, cap - cur);
  }
  return s;
}

function deepCopyAbilities(ab) {
  const out = {};
  for (const k of VISIBLE_ABILITIES) if (ab[k] != null) out[k] = Number(ab[k]);
  return out;
}

// Alder ved sæson 1 (2026 − fødselsår), jf. lib/riderProgressionEngine.ageForSeason(bd,1).
function ageInSeason1(birthdate) {
  const birthYear = new Date(birthdate).getFullYear();
  return Number.isFinite(birthYear) ? SEASON1_YEAR - birthYear : null;
}

const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "-");
const padE = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);

// ── Model → tick-parametre pr. sæson/dag ────────────────────────────────────
function rateMultForModelKey(modelKey) {
  const m = /^rate\/(\d+)$/.exec(modelKey);
  return m ? 1 / Number(m[1]) : 1.0;
}

function tickCapsForModel(modelKey, { inAcademy, seasonStartAbilities, lifetimeCaps, age }) {
  if (modelKey === "current" && inAcademy) {
    return computeAcademySeasonCeiling({
      seasonStartAbilities, lifetimeCaps, frac: academySeasonFracForAge(age),
    });
  }
  return lifetimeCaps; // pre2202 + rate/N: ALDRIG sæson-loft, hverken akademi eller voksen
}

function hardDailyCapForModel(modelKey, inAcademy) {
  if (modelKey === "pre2202") return undefined; // #2082/#1938-sikkerhedsnettet fandtes ikke før 4/7
  return inAcademy ? ACADEMY.HARD_DAILY_CAP : undefined;
}

function academyRateMultForModel(modelKey, inAcademy) {
  if (!inAcademy) return 1.0;
  if (modelKey === "pre2202" || modelKey === "current") return 1.0; // styrer IKKE via rate-mult
  return rateMultForModelKey(modelKey);
}

// ── Population ───────────────────────────────────────────────────────────────
// Ægte prod-population på RIGTIGE hold (ikke AI/test/frosne/bank).
// Fødselsårs-intervallet er en ren perf-optimering (matcher ageInSeason1 præcist for
// hele kalenderår) — den autoritative alders-sandhed er stadig ageInSeason1() i JS.
//
// #2471: secondary_type hentes nu — model A's absolutte loft er en funktion af BEGGE
// anlægs-retninger (youthRoleFactor: primær 1,0 · sekundær 0,82 · modsat 0,12 ·
// neutral 0,45). Uden den ville en anlægs-sekundær evne få neutral-loft og tallene
// ville være forkerte. Aldersintervallet dækker både ungdom (16-21) og voksne (22-28).
async function fetchPopulation(minAge, maxAge) {
  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const minBirthYear = SEASON1_YEAR - maxAge;
  const maxBirthYear = SEASON1_YEAR - minAge;
  const rows = await fetchAllRows(() => supabase
    .from("riders")
    .select(`id, potentiale, primary_type, secondary_type, birthdate,
      team:team_id!inner(is_ai, is_test_account, is_frozen, is_bank),
      rider_derived_abilities!inner(ability_caps, ability_progress, ${abilityCols})`)
    .eq("is_retired", false)
    .eq("team.is_ai", false)
    .eq("team.is_test_account", false)
    .eq("team.is_frozen", false)
    .gte("birthdate", `${minBirthYear}-01-01`)
    .lte("birthdate", `${maxBirthYear}-12-31`)
    .order("id"));
  return rows;
}

// Rå DB-række → sim-rytter. Returnerer null hvis rækken ikke kan bruges.
function toSimRider(row, minAge, maxAge, counters) {
  const age = ageInSeason1(row.birthdate);
  if (age == null || age < minAge || age > maxAge) return null; // JS-alder er autoritativ
  const abRow = row.rider_derived_abilities;
  if (!abRow || abRow.ability_caps == null || typeof abRow.ability_caps !== "object") {
    counters.nullCapsSkipped++;
    return null;
  }
  if (row.team?.is_bank === true) return null; // COALESCE(is_bank,false)=false semantik
  const abilities = {};
  for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
  // #2471: SEED progress fra prod. applyDailyTick udbetaler kun HELE evne-point og
  // gemmer resten i ability_progress (dailyTraining.js: `nextProgress[k] = min(bar, 0.999)`).
  // Startede sim'en på {} ville den kassere en delvis optjening som motoren beholder —
  // og systematisk UNDERvurdere den langsomme (db-)models realiserede vækst i sæson 1.
  const startProgress = {};
  const p = abRow.ability_progress;
  if (p && typeof p === "object") {
    for (const k of VISIBLE_ABILITIES) if (Number.isFinite(Number(p[k]))) startProgress[k] = Number(p[k]);
  }
  return {
    id: row.id,
    primaryType: row.primary_type,
    secondaryType: row.secondary_type ?? null,
    potentiale: row.potentiale,
    startAge: age,
    abilities,
    startProgress,
    lifetimeCaps: abRow.ability_caps,
  };
}

// ── #2471: FRYS-ANALYSE (ingen simulering — ren beregning mod prod-tilstanden) ──
// En evne-række (rytter × evne) er FROSSEN under en given loft-semantik hvis
// gap = max(0, cap − current) === 0, dvs. current ≥ cap. dailyAbilityDelta's rate er
// ∝ gap, og stepAbility returnerer tidligt ved gap ≤ 0 → evnen kan aldrig stige igen.
//
//   • db     : frossen ⟺ current ≥ persisteret ability_caps[k]
//              (inkluderer de 351 "over eget loft"-ryttere — de er allerede frosne i dag)
//   • modelA : frossen ⟺ current ≥ absolut_loft[k]
//
// ATTRIBUTION (vigtig — gulvet er IKKE årsagen): med gulvet er
//   gap = max(0, max(abs, cur) − cur) = max(0, abs − cur)
// og uden gulvet er gap = max(0, abs − cur). De er ALGEBRAISK identiske, så gulvet kan
// ikke ændre om gap === 0. Frys-betingelsen er udelukkende abs ≤ cur. Frysene skyldes
// altså kalibreringen af det ABSOLUTTE loft (youthLoftForPotential × youthRoleFactor) —
// et ungdoms-udviklingsmål anvendt som livstidsloft på en voksen-population det aldrig
// blev kalibreret imod. At pille ved gulvet ville have nul effekt på frys OG genindføre
// "en voksen får et loft under sin current", som spec §4.2 eksplicit afviste.
// Den eneste knap der virker er YOUTH_PROGRESSION_CONFIG (neutralFactor/loftByPotential).
//
// Rollen (primær/sekundær/modsat/neutral) forklarer HVORFOR: modsat-type-evner har
// absolut loft = loft(pot) × 0,12 (fx 11 ved pot 6), så enhver klatrer med sprint > 11
// fryser på sprint by design. Det er ikke en fejl i model A — det er dens pris.
const ROLE_BY_FACTOR = { 1: "primær", 0.82: "sekundær", 0.45: "neutral", 0.12: "modsat" };

function analyseFreeze(population) {
  const groups = {
    all: { label: "16-36", riders: population },
    age_16_21: { label: "16-21", riders: population.filter((r) => r.startAge <= MAX_AGE_POP) },
    age_22_28: { label: "22-28", riders: population.filter((r) => r.startAge >= ADULT_MIN_AGE && r.startAge <= ADULT_MAX_AGE) },
    age_29_36: { label: "29-36", riders: population.filter((r) => r.startAge >= VETERAN_MIN_AGE && r.startAge <= VETERAN_MAX_AGE) },
  };

  const out = {};
  for (const [key, g] of Object.entries(groups)) {
    let rowsTotal = 0;
    const frozen = { db: 0, modelA: 0, both: 0, onlyModelA: 0, onlyDb: 0 };
    const byRole = {}; // rolle → { modelA, db }
    const ridersFullyFrozenA = [];
    const riderFrozenCountsA = [];
    let headroomLostA = 0; // samlet evne-point der forsvinder ved at fryse (mod absolut)

    for (const r of g.riders) {
      const absolute = buildYouthCaps(r.potentiale, r.primaryType, r.secondaryType);
      let frozenThisRiderA = 0;
      for (const ability of VISIBLE_ABILITIES) {
        const current = Math.round(Number(r.abilities[ability]) || 0);
        const dbCap = Number(r.lifetimeCaps?.[ability] ?? 0);
        const absCap = Number(absolute[ability] ?? 0);
        const fDb = current >= dbCap;
        const fA = current >= absCap;
        rowsTotal++;
        if (fDb) frozen.db++;
        if (fA) { frozen.modelA++; frozenThisRiderA++; }
        if (fDb && fA) frozen.both++;
        if (fA && !fDb) { frozen.onlyModelA++; headroomLostA += Math.max(0, dbCap - current); }
        if (fDb && !fA) frozen.onlyDb++;
        if (fA) {
          const factor = youthRoleFactor(r.primaryType, r.secondaryType, ability);
          const role = ROLE_BY_FACTOR[factor] ?? String(factor);
          byRole[role] ??= { modelA: 0, db: 0 };
          byRole[role].modelA++;
          if (fDb) byRole[role].db++;
        }
      }
      riderFrozenCountsA.push(frozenThisRiderA);
      if (frozenThisRiderA === VISIBLE_ABILITIES.length) {
        ridersFullyFrozenA.push({
          id: r.id, age: r.startAge, potentiale: r.potentiale,
          primary_type: r.primaryType, secondary_type: r.secondaryType,
          ability_sum: Math.round(abilitySum(r.abilities)),
        });
      }
    }

    const n = g.riders.length;
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    out[key] = {
      label: g.label,
      riders: n,
      ability_rows_total: rowsTotal,
      frozen_rows_db: frozen.db,
      frozen_rows_model_a: frozen.modelA,
      pct_frozen_db: rowsTotal ? +(100 * frozen.db / rowsTotal).toFixed(1) : 0,
      pct_frozen_model_a: rowsTotal ? +(100 * frozen.modelA / rowsTotal).toFixed(1) : 0,
      frozen_both: frozen.both,
      frozen_only_model_a: frozen.onlyModelA,   // NYE frys som model A indfører
      frozen_only_db: frozen.onlyDb,            // frys model A LØSNER op
      headroom_lost_only_model_a: Math.round(headroomLostA),
      avg_frozen_abilities_per_rider_model_a: +mean(riderFrozenCountsA).toFixed(2),
      riders_fully_frozen_model_a: ridersFullyFrozenA.length,
      riders_fully_frozen_examples: ridersFullyFrozenA.slice(0, 10),
      frozen_by_role_model_a: byRole,
    };
  }
  return out;
}

// ── Simulering: ÉN rytter, ÉN model, ÉN sæsonlængde ─────────────────────────
// Kører fra rytterens NUVÆRENDE alder (sæson 1) til MAX_AGE_SIM (36), én "sæson"
// pr. alders-trin: daysPerSeasonActual daglige applyDailyTick-kald, derefter
// developRiderSeason(..., {skipGrowth:true}) (kun decline+retirement — daglig
// træning ER vækstmotoren, jf. options-kommentaren i lib/riderProgression.js).
//
// Kondition (fatigue=30/form=40) er BEVIDST rytterens fulde-karriere-tilstand
// (initialiseres ÉN gang, ikke nulstillet pr. sæson) — spec siger "Start
// fatigue=30, form=40" for rytteren, ikke pr. sæson. trainingRecalibrationCandidates.js
// nulstiller pr. sæson (en forsimpling i det scripts eget scope); her modelleres
// kontinuerlig fysiologi over en 20-årig karriere, hvilket er mere retvisende for
// en 16→36-kurve. Bonus-mønsteret ((d*7+s)%10<6) er UÆNDRET genbrugt derfra.
function simulateRider(rider, modelKey, daysPerSeasonActual, capSource = "db") {
  const riderId = `careersim:${rider.id}`;
  const program = resolveProgram(null, rider.primaryType); // smartDefaultFocus, intensity "normal"

  // #2471: loftet er enten statisk (db) eller en ren funktion af current (modelA).
  // For modelA genberegnes det HVER tick — samme kontrakt som dailyTrainingEngine.js
  // efter rebasen. Den ægte buildCapsForRider kaldes (ingen kopi af formlen her).
  const capsFor = (ab) => (capSource === "modelA"
    ? buildCapsForRider(ab, { potentiale: rider.potentiale }, rider.primaryType, rider.secondaryType)
    : rider.lifetimeCaps);

  let abilities = deepCopyAbilities(rider.abilities);
  let progress = { ...(rider.startProgress ?? {}) }; // #2471: prod-seedet, ikke {}
  let fatigue = 30, form = 40;
  let age = rider.startAge;
  let seasonIndex = 0;

  const initialAbilitySum = abilitySum(abilities);
  const initialGap = clampedGapSum(capsFor(abilities), abilities);
  const byAge = []; // { age, abilitySum, gapNow }
  let age21AbilitySum = null;
  let preAdultAbilitySum = null; // sum ved ADULT_MIN_AGE-1, til voksen-delta-målingen

  while (age <= MAX_AGE_SIM) {
    const inAcademy = isAcademyAge(age);
    const seasonStartAbilities = deepCopyAbilities(abilities);
    const hardDailyCap = hardDailyCapForModel(modelKey, inAcademy);
    const academyRateMult = academyRateMultForModel(modelKey, inAcademy);
    // Sæson-loftet (kun "current"-modellen) snapshottes ved sæsonstart mod det
    // loft der gælder dér — for modelA er det sæsonstartens genberegnede loft.
    const seasonLifetimeCaps = capsFor(seasonStartAbilities);
    const seasonTickCaps = tickCapsForModel(modelKey, {
      inAcademy, seasonStartAbilities, lifetimeCaps: seasonLifetimeCaps, age,
    });

    for (let d = 0; d < daysPerSeasonActual; d++) {
      const isRest = d % 7 === 0; // samme mønster som trainingRecalibrationCandidates.js
      const actualProg = isRest ? { focus: program.focus, intensity: "rest" } : program;
      const condMult = conditionMultiplier({ form, fatigue });
      const bonus = (d * 7 + seasonIndex) % 10 < 6; // uændret deterministisk mønster
      const dateStr = `s${seasonIndex}d${d}`;

      // modelA: loftet følger current inden for sæsonen (motoren genberegner hver tick).
      // "current"-modellen beholder sit sæson-snapshot — dét ER dens semantik.
      const tickCaps = (capSource === "modelA" && modelKey !== "current")
        ? capsFor(abilities)
        : seasonTickCaps;

      const tickResult = applyDailyTick({
        riderId, dateStr, age, abilities, caps: tickCaps,
        progress, program: actualProg, conditionMult: condMult, bonus,
        potentiale: rider.potentiale, hardDailyCap, academyRateMult,
      });
      abilities = tickResult.abilities;
      progress = tickResult.progress;
      fatigue = nextFatigue({ fatigue, intensity: actualProg.intensity, recoveryAbility: abilities.recovery ?? 50 });
      form = nextForm({ form, fatigue });
    }

    const riderObj = { id: riderId, primary_type: rider.primaryType, potentiale: rider.potentiale, age };
    const { next, retirement } = developRiderSeason(
      riderObj, abilities, capsFor(abilities), seasonIndex + 1, undefined, null, { skipGrowth: true },
    );
    abilities = next;

    const sum = abilitySum(abilities);
    byAge.push({ age, abilitySum: sum, gapNow: clampedGapSum(capsFor(abilities), abilities) });
    if (age === ACADEMY.MAX_AGE) age21AbilitySum = sum;
    if (age === ADULT_MIN_AGE - 1) preAdultAbilitySum = sum;

    if (retirement.retire) break;
    age += 1;
    seasonIndex += 1;
  }

  return {
    potentiale: rider.potentiale,
    startAge: rider.startAge,
    initialAbilitySum,
    initialGap,
    age21AbilitySum,
    preAdultAbilitySum,
    byAge,
  };
}

// ── Aggregering: mange rytter-trajectories → pr.-alder gnsn. for én (model, sæsonlængde, kohorte) ──
function aggregateCohort(riderResults) {
  const byAgeMap = new Map(); // age -> { sumAbility, sumPct, n }
  let academyGainSum = 0, academySeasonsSum = 0, academyRiders = 0;

  for (const r of riderResults) {
    for (const entry of r.byAge) {
      const bucket = byAgeMap.get(entry.age) ?? { sumAbility: 0, sumPct: 0, n: 0 };
      bucket.sumAbility += entry.abilitySum;
      bucket.sumPct += r.initialGap > 0 ? (r.initialGap - entry.gapNow) / r.initialGap : 0;
      bucket.n += 1;
      byAgeMap.set(entry.age, bucket);
    }
    if (r.age21AbilitySum != null) {
      academyGainSum += r.age21AbilitySum - r.initialAbilitySum;
      academySeasonsSum += (ACADEMY.MAX_AGE - r.startAge + 1);
      academyRiders += 1;
    }
  }

  const byAge = [];
  for (let age = MIN_AGE; age <= MAX_AGE_SIM; age++) {
    const b = byAgeMap.get(age);
    byAge.push({
      age,
      avg_ability_sum: b ? Math.round((b.sumAbility / b.n) * 100) / 100 : 0,
      avg_pct_gap_closed: b ? Math.round((b.sumPct / b.n) * 1000) / 1000 : 0,
      n: b ? b.n : 0,
    });
  }

  let peak = byAge[0];
  for (const row of byAge) if (row.avg_ability_sum > peak.avg_ability_sum) peak = row;

  return {
    byAge,
    peakAge: peak.age,
    peakAbilitySum: peak.avg_ability_sum,
    academyRiders,
    avgPtsPerDayPerRider: academySeasonsSum > 0
      ? academyGainSum / academySeasonsSum / 28 // 28 = akademi-årenes reference-sæsonlængde (nøgletal-krav pkt. 3)
      : null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== Karriere-kurve-simulering (#2437 + #2471) — READ-ONLY, ingen prod-mutation ===\n");

  let rawRows, rawAdultRows, rawVeteranRows;
  try {
    // Ét kald pr. aldersgruppe (fødselsårs-filteret er en perf-optimering, se fetchPopulation).
    [rawRows, rawAdultRows, rawVeteranRows] = await Promise.all([
      fetchPopulation(MIN_AGE, MAX_AGE_POP),
      fetchPopulation(ADULT_MIN_AGE, ADULT_MAX_AGE),
      fetchPopulation(VETERAN_MIN_AGE, VETERAN_MAX_AGE),
    ]);
  } catch (err) {
    console.error("❌ DB-adgang fejlede — ingen tal er fabrikeret. Fejl:", err.message ?? err);
    process.exit(1);
  }

  const counters = { nullCapsSkipped: 0 };
  const population = [];
  for (const row of rawRows) {
    const r = toSimRider(row, MIN_AGE, MAX_AGE_POP, counters);
    if (r) population.push(r);
  }
  const adultCounters = { nullCapsSkipped: 0 };
  const adultPopulation = [];
  for (const row of rawAdultRows) {
    const r = toSimRider(row, ADULT_MIN_AGE, ADULT_MAX_AGE, adultCounters);
    if (r) adultPopulation.push(r);
  }
  const veteranCounters = { nullCapsSkipped: 0 };
  const veteranPopulation = [];
  for (const row of rawVeteranRows) {
    const r = toSimRider(row, VETERAN_MIN_AGE, VETERAN_MAX_AGE, veteranCounters);
    if (r) veteranPopulation.push(r);
  }
  const nullCapsSkipped = counters.nullCapsSkipped;

  console.log(`Rå rækker hentet (16-21, rigtige hold): ${rawRows.length}`);
  console.log(`Sprunget over (ability_caps IS NULL): ${nullCapsSkipped}`);
  console.log(`Population efter filtrering (16-21): ${population.length}`);
  console.log(`Voksen-population (22-28, #2471): ${adultPopulation.length} (skippet: ${adultCounters.nullCapsSkipped})`);
  console.log(`Veteran-population (29-36, #2471): ${veteranPopulation.length} (skippet: ${veteranCounters.nullCapsSkipped})\n`);

  const cohorts = {};
  for (const pot of COHORT_POTENTIALS) {
    const members = population.filter((p) => p.potentiale === pot);
    cohorts[pot] = members;
    console.log(`Kohorte ${COHORT_LABELS[pot]}: n=${members.length}`);
  }
  const otherPot = population.length - COHORT_POTENTIALS.reduce((s, pot) => s + cohorts[pot].length, 0);
  console.log(`(uden for de 3 kohorter, potentiale ∉ {4,5,6}: ${otherPot} — ikke simuleret)\n`);

  if (population.every((p) => !COHORT_POTENTIALS.includes(p.potentiale))) {
    console.error("❌ Ingen ryttere i nogen af de 3 kohorter (potentiale 4/5/6) — kan ikke simulere. Ingen tal fabrikeret.");
    process.exit(1);
  }

  // series[scenario][seasonLength][potentiale] = aggregeret resultat
  const series = [];
  const t0 = Date.now();
  for (const { model: modelKey, capSource } of SCENARIOS) {
    for (const seasonLength of SEASON_LENGTHS) {
      for (const pot of COHORT_POTENTIALS) {
        const members = cohorts[pot];
        if (members.length === 0) {
          series.push({
            model: modelKey, cap_source: capSource, season_length: seasonLength, potentiale: pot,
            by_age: Array.from({ length: MAX_AGE_SIM - MIN_AGE + 1 }, (_, i) => (
              { age: MIN_AGE + i, avg_ability_sum: 0, avg_pct_gap_closed: 0, n: 0 }
            )),
            peak_age: 0, peak_ability_sum: 0,
          });
          continue;
        }
        const riderResults = members.map((rider) => simulateRider(rider, modelKey, seasonLength, capSource));
        const agg = aggregateCohort(riderResults);
        series.push({
          model: modelKey, cap_source: capSource, season_length: seasonLength, potentiale: pot,
          by_age: agg.byAge, peak_age: agg.peakAge, peak_ability_sum: agg.peakAbilitySum,
          _avgPtsPerDayPerRider: agg.avgPtsPerDayPerRider, // internt felt, ikke del af det offentlige skema
        });
      }
    }
  }
  console.log(`Simulering færdig på ${((Date.now() - t0) / 1000).toFixed(1)}s (${SCENARIOS.length} scenarier × ${SEASON_LENGTHS.length} sæsonlængder × ${COHORT_POTENTIALS.length} kohorter).\n`);

  const seriesLookup = (model, seasonLength, pot, capSource = "db") =>
    series.find((s) => s.model === model && s.season_length === seasonLength
      && s.potentiale === pot && s.cap_source === capSource);

  // ── 1) Konsol-tabel pr. model (sæsonlængde=28): alder × kohorte → gnsn. ability-sum ──
  for (const modelKey of MODELS) {
    console.log("─".repeat(90));
    console.log(MODEL_LABELS[modelKey]);
    console.log(`\n${padE("Alder", 8)}${COHORT_POTENTIALS.map((p) => padS(COHORT_LABELS[p], 16)).join("")}`);
    for (let age = MIN_AGE; age <= MAX_AGE_SIM; age++) {
      const cells = COHORT_POTENTIALS.map((pot) => {
        const s = seriesLookup(modelKey, 28, pot);
        const row = s?.by_age.find((r) => r.age === age);
        return padS(row && row.n > 0 ? fmt1(row.avg_ability_sum) : "-", 16);
      });
      console.log(`${padE(age, 8)}${cells.join("")}`);
    }
    const peaks = COHORT_POTENTIALS.map((pot) => {
      const s = seriesLookup(modelKey, 28, pot);
      return `${COHORT_LABELS[pot]}: peak age=${s.peak_age} (sum=${fmt1(s.peak_ability_sum)})`;
    });
    console.log(`\nPeak-alder (sæsonlængde 28): ${peaks.join("  |  ")}\n`);
  }

  // ── Sæsonlængde-sweep: peak ability-sum pr. model × kohorte × sæsonlængde ────────
  console.log("═".repeat(90));
  console.log("SÆSONLÆNGDE-SWEEP — peak ability-sum pr. model × kohorte × sæsonlængde");
  console.log("(afslører om modellen EKSPLODERER (loft-fri, vokser med flere ticks) eller er STABIL");
  console.log(" (sæson-budget-loftet, mætter uanset ticks) ved lange/ingen-slutdato-sæsoner)\n");
  for (const pot of COHORT_POTENTIALS) {
    console.log(`── Kohorte ${COHORT_LABELS[pot]} ──`);
    console.log(`${padE("Model", 10)}${SEASON_LENGTHS.map((d) => padS(`${d}d`, 12)).join("")}`);
    for (const modelKey of MODELS) {
      const cells = SEASON_LENGTHS.map((sl) => {
        const s = seriesLookup(modelKey, sl, pot);
        return padS(fmt1(s.peak_ability_sum), 12);
      });
      console.log(`${padE(modelKey, 10)}${cells.join("")}`);
    }
    console.log("");
  }

  // ── 3) Nøgletal ved sæsonlængde 28: peak-alder pr. kohorte + pt/dag/rytter (16-21) ──
  console.log("═".repeat(90));
  console.log("NØGLETAL VED SÆSONLÆNGDE 28 (28 dage — den frosne DAILY_TRAINING_CONFIG-konstant)\n");
  console.log(`${padE("Model", 10)}${COHORT_POTENTIALS.map((p) => padS(`peak-alder ${p}`, 14)).join("")}${COHORT_POTENTIALS.map((p) => padS(`pt/dag/rytter ${p}`, 18)).join("")}`);
  for (const modelKey of MODELS) {
    const peakCells = COHORT_POTENTIALS.map((pot) => padS(seriesLookup(modelKey, 28, pot).peak_age, 14));
    const rateCells = COHORT_POTENTIALS.map((pot) => {
      const s = seriesLookup(modelKey, 28, pot);
      return padS(s._avgPtsPerDayPerRider != null ? s._avgPtsPerDayPerRider.toFixed(3) : "-", 18);
    });
    console.log(`${padE(modelKey, 10)}${peakCells.join("")}${rateCells.join("")}`);
  }

  // Hvilken rate/N lander peak tættest på 28 (PROGRESSION_CONFIG.peakAge)?
  let closest = null;
  for (const modelKey of ["rate/2", "rate/3", "rate/4"]) {
    const diffs = COHORT_POTENTIALS.map((pot) => Math.abs(seriesLookup(modelKey, 28, pot).peak_age - 28));
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    if (!closest || avgDiff < closest.avgDiff) closest = { modelKey, avgDiff };
  }
  console.log(`\nTættest på peakAge=28 på tværs af kohorter: ${closest.modelKey} (gnsn. afvigelse ${fmt1(closest.avgDiff)} år)\n`);

  // ══ #2471 — SPØRGSMÅL 2: springet ved alder 22 (akademi-knappen slukker) ═══════
  // Springet = ability-sum-tilvæksten i sæsonen ved alder 22, holdt op mod den
  // forudgående sæson (ved 21). Et stort spring = en klippe: rytteren "eksploderer"
  // på sin 22-års fødselsdag, hvilket er ludisk utroværdigt.
  //
  // LÅST KOHORTE: by_age-gennemsnittene midles over ryttere med FORSKELLIG startAge
  // (en 20-årig bidrager først fra alder 20), så en difference mellem to alders-
  // gennemsnit blander to forskellige populationer og måler dels sammensætning, dels
  // vækst. Springet beregnes derfor PR RYTTER og midles kun over dem der har ALLE
  // tre datapunkter (20, 21, 22) — dvs. startAge ≤ 20. Samme ryttere i tæller og nævner.
  console.log("═".repeat(96));
  console.log("#2471 — 22-ÅRS-SPRINGET (sæsonlængde 28, LÅST kohorte: startAge ≤ 20)\n");
  console.log(`${padE("Scenarie", 18)}${padE("Kohorte", 16)}${padS("n", 5)}${padS("Δ20→21", 10)}${padS("Δ21→22", 10)}${padS("Δ22→23", 10)}${padS("spring-faktor", 16)}`);
  const jumpRows = [];
  for (const { model: modelKey, capSource } of SCENARIOS) {
    if (modelKey !== "current" && modelKey !== "rate/3") continue; // før-#2470, efter-#2470, og modelA
    for (const pot of COHORT_POTENTIALS) {
      const locked = cohorts[pot].filter((r) => r.startAge <= 20);
      if (!locked.length) continue;
      const per = locked.map((r) => {
        const res = simulateRider(r, modelKey, 28, capSource);
        const at = (a) => res.byAge.find((b) => b.age === a)?.abilitySum ?? null;
        return { s20: at(20), s21: at(21), s22: at(22), s23: at(23) };
      }).filter((x) => x.s20 != null && x.s21 != null && x.s22 != null);
      if (!per.length) continue;
      const avg = (f) => per.reduce((a, x) => a + f(x), 0) / per.length;
      const d2021 = avg((x) => x.s21 - x.s20);
      const d2122 = avg((x) => x.s22 - x.s21);
      const withS23 = per.filter((x) => x.s23 != null);
      const d2223 = withS23.length
        ? withS23.reduce((a, x) => a + (x.s23 - x.s22), 0) / withS23.length : 0;
      const factor = d2021 > 0 ? d2122 / d2021 : null;
      jumpRows.push({
        scenario: scenarioKey(modelKey, capSource), potentiale: pot, n_locked: per.length,
        delta_20_21: +d2021.toFixed(1), delta_21_22: +d2122.toFixed(1), delta_22_23: +d2223.toFixed(1),
        jump_factor: factor != null ? +factor.toFixed(1) : null,
      });
      console.log(`${padE(scenarioKey(modelKey, capSource), 18)}${padE(COHORT_LABELS[pot], 16)}${padS(per.length, 5)}${padS(fmt1(d2021), 10)}${padS(fmt1(d2122), 10)}${padS(fmt1(d2223), 10)}${padS(factor != null ? `${fmt1(factor)}×` : "-", 16)}`);
    }
  }
  console.log("");

  // ══ #2471 — SPØRGSMÅL 1: voksen-effekten (22-28) ══════════════════════════════
  // PR #2472's scorecard måler HOVEDRUM (83 → 250 evne-point/rytter). Hovedrum er
  // ikke vækst: dagsraten er ∝ gappet, men growthFraction/decline afgør hvor meget
  // der realiseres. Her simuleres de ægte 22-28-årige under begge loft-kilder, så
  // den REALISEREDE forskel kan ses. Hovedrummet beregnes også — som krydstjek af
  // at denne sim og capSemanticsComparison.js er enige om udgangspunktet.
  console.log("═".repeat(96));
  console.log(`#2471 — VOKSEN-EFFEKT (${ADULT_MIN_AGE}-${ADULT_MAX_AGE} år, n=${adultPopulation.length}) — realiseret vækst, ikke kun hovedrum\n`);
  const adultOut = {};
  if (adultPopulation.length === 0) {
    console.log("(ingen voksne i populationen — intet at måle)\n");
  } else {
    const headroomSum = { db: 0, modelA: 0 };
    for (const r of adultPopulation) {
      headroomSum.db += clampedGapSum(r.lifetimeCaps, r.abilities);
      headroomSum.modelA += clampedGapSum(
        buildCapsForRider(r.abilities, { potentiale: r.potentiale }, r.primaryType, r.secondaryType),
        r.abilities,
      );
    }
    const avgHeadroom = {
      db: headroomSum.db / adultPopulation.length,
      modelA: headroomSum.modelA / adultPopulation.length,
    };
    console.log(`Hovedrum ved start (evne-point/rytter, sum over 15 evner) — krydstjek mod PR-scorecardets 83 → 250:`);
    console.log(`  db (i dag): ${fmt1(avgHeadroom.db)}   |   modelA (#2472): ${fmt1(avgHeadroom.modelA)}   |   faktor: ${fmt1(avgHeadroom.modelA / (avgHeadroom.db || 1))}×\n`);

    // Realiseret vækst: simulér 22-28-årige med rate/3 (voksne rammes ikke af rate-mult,
    // så modellen er reelt kun loft-kilden) over den frosne 28-dages sæsonlængde.
    const adultSim = {};
    for (const capSource of ["db", "modelA"]) {
      const results = adultPopulation.map((r) => simulateRider(r, "rate/3", 28, capSource));
      // Gevinst pr. dag pr. rytter i de FØRSTE 28 dage (én sæson) fra deres nuværende alder.
      const firstSeasonGain = results.map((r) => (r.byAge[0]?.abilitySum ?? 0) - r.initialAbilitySum);
      const peakSums = results.map((r) => Math.max(...r.byAge.map((b) => b.abilitySum)));
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      adultSim[capSource] = {
        avg_first_season_gain: +avg(firstSeasonGain).toFixed(2),
        avg_pts_per_day: +(avg(firstSeasonGain) / 28).toFixed(3),
        avg_peak_ability_sum: +avg(peakSums).toFixed(1),
        avg_headroom_start: +avgHeadroom[capSource].toFixed(1),
      };
    }
    console.log(`${padE("Loft-kilde", 12)}${padS("hovedrum/rytter", 18)}${padS("gevinst/sæson(28d)", 20)}${padS("pt/dag/rytter", 16)}${padS("peak ability-sum", 18)}`);
    for (const capSource of ["db", "modelA"]) {
      const a = adultSim[capSource];
      console.log(`${padE(capSource, 12)}${padS(fmt1(a.avg_headroom_start), 18)}${padS(fmt1(a.avg_first_season_gain), 20)}${padS(a.avg_pts_per_day.toFixed(3), 16)}${padS(fmt1(a.avg_peak_ability_sum), 18)}`);
    }
    const rateFactor = adultSim.db.avg_pts_per_day > 0
      ? adultSim.modelA.avg_pts_per_day / adultSim.db.avg_pts_per_day : null;
    console.log(`\n→ Realiseret voksen-dagsrate ændres med faktor: ${rateFactor != null ? `${fmt1(rateFactor)}×` : "n/a"} (hovedrums-faktoren var ${fmt1(avgHeadroom.modelA / (avgHeadroom.db || 1))}×)\n`);
    adultOut.n = adultPopulation.length;
    adultOut.by_cap_source = adultSim;
    adultOut.realised_rate_factor = rateFactor != null ? +rateFactor.toFixed(2) : null;
    adultOut.headroom_factor = +(avgHeadroom.modelA / (avgHeadroom.db || 1)).toFixed(2);
  }

  // ══ #2471 — VETERANER (29-36): ophæver model A aldringen? ═════════════════════
  // Tovtrækning: daglig træning vokser HVER dag i alle aldre (dailyAbilityDelta har
  // ingen aldersgate; growthFractionForAge(29+) = 0,10), mens decline kun sker 1×
  // pr. sæson via developRiderSeason. Model A's højere loft genåbner gappet →
  // væksten kan overhale declinen og aldringen stopper i praksis.
  console.log("═".repeat(96));
  console.log(`#2471 — VETERANER (${VETERAN_MIN_AGE}-${VETERAN_MAX_AGE} år, n=${veteranPopulation.length}) — vokser de i stedet for at ældes?\n`);
  const veteranOut = {};
  if (veteranPopulation.length === 0) {
    console.log("(ingen veteraner i populationen — intet at måle)\n");
  } else {
    console.log(`${padE("Loft-kilde", 12)}${padS("hovedrum", 11)}${padS("start-sum", 11)}${padS(`slut-sum (${VETERAN_SEASONS} sæs)`, 18)}${padS("netto", 10)}${padS("% forbedret", 13)}`);
    for (const capSource of ["db", "modelA"]) {
      let startSum = 0, endSum = 0, headroom = 0, improved = 0;
      for (const r of veteranPopulation) {
        const capsFor = (a) => (capSource === "modelA"
          ? buildCapsForRider(a, { potentiale: r.potentiale }, r.primaryType, r.secondaryType)
          : r.lifetimeCaps);
        headroom += clampedGapSum(capsFor(r.abilities), r.abilities);
        const s0 = abilitySum(r.abilities);
        // Samme tick-kontrakt som motoren: voksne får hverken hardDailyCap eller rate-mult.
        let abilities = deepCopyAbilities(r.abilities);
        let progress = { ...(r.startProgress ?? {}) };
        let fatigue = 30, form = 40, age = r.startAge;
        const program = resolveProgram(null, r.primaryType);
        for (let s = 0; s < VETERAN_SEASONS && age <= MAX_AGE_SIM; s++) {
          for (let d = 0; d < 28; d++) {
            const isRest = d % 7 === 0;
            const prog = isRest ? { focus: program.focus, intensity: "rest" } : program;
            const t = applyDailyTick({
              riderId: `vet:${r.id}`, dateStr: `s${s}d${d}`, age, abilities, caps: capsFor(abilities),
              progress, program: prog, conditionMult: conditionMultiplier({ form, fatigue }),
              bonus: (d * 7 + s) % 10 < 6, potentiale: r.potentiale,
              hardDailyCap: undefined, academyRateMult: 1.0,
            });
            abilities = t.abilities; progress = t.progress;
            fatigue = nextFatigue({ fatigue, intensity: prog.intensity, recoveryAbility: abilities.recovery ?? 50 });
            form = nextForm({ form, fatigue });
          }
          const { next, retirement } = developRiderSeason(
            { id: r.id, primary_type: r.primaryType, potentiale: r.potentiale, age },
            abilities, capsFor(abilities), s + 1, undefined, null, { skipGrowth: true },
          );
          abilities = next;
          if (retirement.retire) break;
          age += 1;
        }
        const s1 = abilitySum(abilities);
        startSum += s0; endSum += s1;
        if (s1 > s0) improved++;
      }
      const n = veteranPopulation.length;
      const rec = {
        avg_headroom: +(headroom / n).toFixed(1),
        avg_start_sum: +(startSum / n).toFixed(1),
        avg_end_sum: +(endSum / n).toFixed(1),
        avg_net: +((endSum - startSum) / n).toFixed(1),
        pct_improved: +(100 * improved / n).toFixed(1),
      };
      veteranOut[capSource] = rec;
      console.log(`${padE(capSource, 12)}${padS(fmt1(rec.avg_headroom), 11)}${padS(fmt1(rec.avg_start_sum), 11)}${padS(fmt1(rec.avg_end_sum), 18)}${padS(rec.avg_net > 0 ? `+${fmt1(rec.avg_net)}` : fmt1(rec.avg_net), 10)}${padS(`${rec.pct_improved}%`, 13)}`);
    }
    console.log(`\n→ Aldring: i dag falder veteranerne ${fmt1(Math.abs(veteranOut.db.avg_net))} evne-point over ${VETERAN_SEASONS} sæsoner (${veteranOut.db.pct_improved}% forbedres).`);
    console.log(`  Under model A: ${veteranOut.modelA.avg_net > 0 ? "+" : ""}${fmt1(veteranOut.modelA.avg_net)} point (${veteranOut.modelA.pct_improved}% forbedres) — vækst vs. decline tipper.\n`);
  }

  // ══ #2471 — SPØRGSMÅL 3: frosne evne-rækker ═══════════════════════════════════
  console.log("═".repeat(96));
  console.log("#2471 — FROSNE EVNE-RÆKKER (gap = 0 → evnen kan aldrig stige igen)\n");
  const freeze = analyseFreeze([...population, ...adultPopulation, ...veteranPopulation]);
  console.log(`${padE("Gruppe", 10)}${padS("ryttere", 9)}${padS("evne-rækker", 13)}${padS("frosne db", 12)}${padS("frosne A", 12)}${padS("kun A (nye)", 13)}${padS("kun db (løst)", 14)}`);
  for (const key of ["all", "age_16_21", "age_22_28", "age_29_36"]) {
    const f = freeze[key];
    console.log(`${padE(f.label, 10)}${padS(f.riders, 9)}${padS(f.ability_rows_total, 13)}${padS(`${f.frozen_rows_db} (${f.pct_frozen_db}%)`, 12)}${padS(`${f.frozen_rows_model_a} (${f.pct_frozen_model_a}%)`, 12)}${padS(f.frozen_only_model_a, 13)}${padS(f.frozen_only_db, 14)}`);
  }
  console.log(`\nFrosne rækker under model A fordelt på anlægs-rolle (16-36) — årsagen er det`);
  console.log(`ABSOLUTTE lofts kalibrering (loft(pot) × rolle-faktor), IKKE gulvet (algebraisk no-op):`);
  for (const [role, v] of Object.entries(freeze.all.frozen_by_role_model_a)) {
    console.log(`  ${padE(role, 12)} ${padS(v.modelA, 6)} rækker  (heraf ${v.db} allerede frosne i dag → ${v.modelA - v.db} nye)`);
  }
  console.log(`\nRyttere HELT frosne under model A (alle 15 evner, kan aldrig udvikle sig igen): ${freeze.all.riders_fully_frozen_model_a}`);
  for (const r of freeze.all.riders_fully_frozen_examples.slice(0, 5)) {
    console.log(`  • ${r.id} — ${r.age} år, pot ${r.potentiale}, ${r.primary_type}/${r.secondary_type ?? "-"}, ability-sum ${r.ability_sum}`);
  }
  console.log(`\nGnsn. frosne evner pr. rytter under model A: ${freeze.all.avg_frozen_abilities_per_rider_model_a} af ${VISIBLE_ABILITIES.length}`);
  console.log(`Hovedrum der forsvinder ved de NYE frys (kun-A-rækker): ${freeze.all.headroom_lost_only_model_a} evne-point\n`);

  // ── JSON-output ──────────────────────────────────────────────────────────────
  // NY fil: #2437's før-billede (2026-07-15-academy-career-curves.json) bevares URØRT,
  // fordi det er ejerens sammenlignings-reference. Denne fil er efter-billedet.
  const outDir = join(__dirname, "../../docs/audits");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "2026-07-15-cap-consolidation-curves.json");
  const jsonOut = {
    generated_for: "#2471 (PR #2472 rebaset på #2470-interim)",
    generated_at: new Date().toISOString(),
    before_picture: "docs/audits/2026-07-15-academy-career-curves.json (#2437, samme harness, cap_source=db)",
    note: "dailyAbilityDelta dividerer INTERNT altid med den frosne DAILY_TRAINING_CONFIG.daysPerSeason=28 — sæsonlængde-sweepet varierer ANTAL TICKS pr. simuleret sæson, ikke selve konstanten. Det er en pointe i modellen, ikke en fejl.",
    cap_sources: CAP_SOURCE_LABELS,
    season_lengths: SEASON_LENGTHS,
    cohorts: Object.fromEntries(COHORT_POTENTIALS.map((pot) => [String(pot), { n: cohorts[pot].length, label: COHORT_LABELS[pot] }])),
    population: {
      raw_fetched: rawRows.length, null_caps_skipped: nullCapsSkipped, simulated: population.length,
      adult_raw_fetched: rawAdultRows.length, adult_simulated: adultPopulation.length,
      veteran_raw_fetched: rawVeteranRows.length, veteran_simulated: veteranPopulation.length,
      cohort_coverage_note: `Kurve-kohorterne dækker kun potentiale ∈ {4,5,6} = ${COHORT_POTENTIALS.reduce((s, p) => s + cohorts[p].length, 0)} af ${population.length} unge (potentiale er fraktionelt i prod; pot 3,5 er største enkelt-bucket og er IKKE med). 22-springet er målt på låst kohorte (startAge ≤ 20).`,
    },
    age_22_jump: jumpRows,
    adult_effect_22_28: adultOut,
    veteran_effect_29_36: { n: veteranPopulation.length, seasons: VETERAN_SEASONS, by_cap_source: veteranOut },
    freeze_analysis: freeze,
    series: series.map(({ _avgPtsPerDayPerRider, ...s }) => s),
  };
  writeFileSync(outPath, JSON.stringify(jsonOut, null, 2), "utf8");
  console.log(`\nJSON skrevet til: ${outPath}`);
  console.log("Færdig. READ-ONLY — intet skrevet til prod/DB.\n");
}

main().catch((err) => {
  console.error("❌ Simulering fejlede:", err);
  process.exit(1);
});
