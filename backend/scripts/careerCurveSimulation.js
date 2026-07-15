#!/usr/bin/env node
// #2437 — Fuld karriere-kurve-simulering (16→36 år) for akademi-population. READ-ONLY:
// kun SELECT mod prod-DB, INGEN writes/migrations/mutationer. Beslutningsstøtte til
// ejer-review FØR en model vælges — genbruger de ÆGTE motor-funktioner (ingen
// reimplementeret tick-matematik), se import-listen nedenfor.
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
import { developRiderSeason } from "../lib/riderProgression.js";
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
// Ægte prod-population: ryttere 16-21 år på RIGTIGE hold (ikke AI/test/frosne/bank).
// Fødselsårs-intervallet er en ren perf-optimering (matcher ageInSeason1 præcist for
// hele kalenderår) — den autoritative alders-sandhed er stadig ageInSeason1() i JS.
async function fetchPopulation() {
  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const minBirthYear = SEASON1_YEAR - MAX_AGE_POP; // 2005
  const maxBirthYear = SEASON1_YEAR - MIN_AGE;     // 2010
  const rows = await fetchAllRows(() => supabase
    .from("riders")
    .select(`id, potentiale, primary_type, birthdate,
      team:team_id!inner(is_ai, is_test_account, is_frozen, is_bank),
      rider_derived_abilities!inner(ability_caps, ${abilityCols})`)
    .eq("is_retired", false)
    .eq("team.is_ai", false)
    .eq("team.is_test_account", false)
    .eq("team.is_frozen", false)
    .gte("birthdate", `${minBirthYear}-01-01`)
    .lte("birthdate", `${maxBirthYear}-12-31`)
    .order("id"));
  return rows;
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
function simulateRider(rider, modelKey, daysPerSeasonActual) {
  const riderId = `careersim:${rider.id}`;
  const program = resolveProgram(null, rider.primaryType); // smartDefaultFocus, intensity "normal"
  const lifetimeCaps = rider.lifetimeCaps;

  let abilities = deepCopyAbilities(rider.abilities);
  let progress = {};
  let fatigue = 30, form = 40;
  let age = rider.startAge;
  let seasonIndex = 0;

  const initialAbilitySum = abilitySum(abilities);
  const initialGap = clampedGapSum(lifetimeCaps, abilities);
  const byAge = []; // { age, abilitySum, gapNow }
  let age21AbilitySum = null;

  while (age <= MAX_AGE_SIM) {
    const inAcademy = isAcademyAge(age);
    const seasonStartAbilities = deepCopyAbilities(abilities);
    const tickCaps = tickCapsForModel(modelKey, { inAcademy, seasonStartAbilities, lifetimeCaps, age });
    const hardDailyCap = hardDailyCapForModel(modelKey, inAcademy);
    const academyRateMult = academyRateMultForModel(modelKey, inAcademy);

    for (let d = 0; d < daysPerSeasonActual; d++) {
      const isRest = d % 7 === 0; // samme mønster som trainingRecalibrationCandidates.js
      const actualProg = isRest ? { focus: program.focus, intensity: "rest" } : program;
      const condMult = conditionMultiplier({ form, fatigue });
      const bonus = (d * 7 + seasonIndex) % 10 < 6; // uændret deterministisk mønster
      const dateStr = `s${seasonIndex}d${d}`;

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
      riderObj, abilities, lifetimeCaps, seasonIndex + 1, undefined, null, { skipGrowth: true },
    );
    abilities = next;

    const sum = abilitySum(abilities);
    byAge.push({ age, abilitySum: sum, gapNow: clampedGapSum(lifetimeCaps, abilities) });
    if (age === ACADEMY.MAX_AGE) age21AbilitySum = sum;

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
  console.log("\n=== Karriere-kurve-simulering (#2437) — READ-ONLY, ingen prod-mutation ===\n");

  let rawRows;
  try {
    rawRows = await fetchPopulation();
  } catch (err) {
    console.error("❌ DB-adgang fejlede — ingen tal er fabrikeret. Fejl:", err.message ?? err);
    process.exit(1);
  }

  let nullCapsSkipped = 0;
  const population = [];
  for (const row of rawRows) {
    const age = ageInSeason1(row.birthdate);
    if (age == null || age < MIN_AGE || age > MAX_AGE_POP) continue; // JS-alder er den autoritative sandhed
    const abRow = row.rider_derived_abilities;
    if (!abRow || abRow.ability_caps == null || typeof abRow.ability_caps !== "object") {
      nullCapsSkipped++;
      continue;
    }
    if (row.team?.is_bank === true) continue; // COALESCE(is_bank,false)=false semantik (nullable kolonne)
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    population.push({
      id: row.id,
      primaryType: row.primary_type,
      potentiale: row.potentiale,
      startAge: age,
      abilities,
      lifetimeCaps: abRow.ability_caps,
    });
  }

  console.log(`Rå rækker hentet (16-21, rigtige hold): ${rawRows.length}`);
  console.log(`Sprunget over (ability_caps IS NULL): ${nullCapsSkipped}`);
  console.log(`Population efter filtrering: ${population.length}\n`);

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

  // series[model][seasonLength][potentiale] = aggregeret resultat
  const series = [];
  const t0 = Date.now();
  for (const modelKey of MODELS) {
    for (const seasonLength of SEASON_LENGTHS) {
      for (const pot of COHORT_POTENTIALS) {
        const members = cohorts[pot];
        if (members.length === 0) {
          series.push({
            model: modelKey, season_length: seasonLength, potentiale: pot,
            by_age: Array.from({ length: MAX_AGE_SIM - MIN_AGE + 1 }, (_, i) => (
              { age: MIN_AGE + i, avg_ability_sum: 0, avg_pct_gap_closed: 0, n: 0 }
            )),
            peak_age: 0, peak_ability_sum: 0,
          });
          continue;
        }
        const riderResults = members.map((rider) => simulateRider(rider, modelKey, seasonLength));
        const agg = aggregateCohort(riderResults);
        series.push({
          model: modelKey, season_length: seasonLength, potentiale: pot,
          by_age: agg.byAge, peak_age: agg.peakAge, peak_ability_sum: agg.peakAbilitySum,
          _avgPtsPerDayPerRider: agg.avgPtsPerDayPerRider, // internt felt, ikke del af det offentlige skema
        });
      }
    }
  }
  console.log(`Simulering færdig på ${((Date.now() - t0) / 1000).toFixed(1)}s (${MODELS.length} modeller × ${SEASON_LENGTHS.length} sæsonlængder × ${COHORT_POTENTIALS.length} kohorter).\n`);

  const seriesLookup = (model, seasonLength, pot) =>
    series.find((s) => s.model === model && s.season_length === seasonLength && s.potentiale === pot);

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

  // ── JSON-output ──────────────────────────────────────────────────────────────
  const outDir = join(__dirname, "../../docs/audits");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "2026-07-15-academy-career-curves.json");
  const jsonOut = {
    generated_for: "#2437",
    generated_at: new Date().toISOString(),
    note: "dailyAbilityDelta dividerer INTERNT altid med den frosne DAILY_TRAINING_CONFIG.daysPerSeason=28 — sæsonlængde-sweepet varierer ANTAL TICKS pr. simuleret sæson, ikke selve konstanten. Det er en pointe i modellen, ikke en fejl.",
    season_lengths: SEASON_LENGTHS,
    cohorts: Object.fromEntries(COHORT_POTENTIALS.map((pot) => [String(pot), { n: cohorts[pot].length, label: COHORT_LABELS[pot] }])),
    population: { raw_fetched: rawRows.length, null_caps_skipped: nullCapsSkipped, simulated: population.length },
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
