#!/usr/bin/env node
// #4850 · SIMULERING: udbytte paa loebsdagen, variant A (spec
// docs/drafts/spec-lobsdag-udbytte-2026-09-24.md, spor C3).
//
// Ejeren skal se tallene FOER race_day_development_enabled flippes 28/9 (ejer
// 24/9: "tallene simuleres og vises ejeren før merge").
//
// Koerer PRODUKTIONSSTIEN (`applyDailyTick` / `applyRaceDevelopmentTick` fra
// backend/lib/dailyTraining.js), ikke en genimplementering. Kun input-siden er
// lokal: et READ-ONLY prod-udtraek af ryttere med deres S3-loebsdage og
// etape-profiler. Scriptet skriver ALDRIG til en database.
//
// SCENARIER (samme rytter, samme seed, samme 140 loebsdage, samme plan paa
// traeningsdage; kun loebsdagene er forskellige):
//   S0  loebsdag = hvile (i dag, flag off)
//   S1  variant A: mellem-pas paa etapens profil-evner, off-fokus 0,35   (anbefalet)
//   S2  som S1, men kun profil-evnerne (ingen off-fokus)
//   S3  som S1 med alle rater x1,15 (den gamle D2-devMult)
//   S4  gammel D2: rytterens PLAN som input, fordelt paa profil-evnerne (afvist af ejeren)
// Alle loebsdage har +1-loftet (hardDailyCap 1) og carry-over.
//
// FORENKLINGER (staar ogsaa i rapporten):
//   · Antal loebsdage pr. rytter = hans antal koerte etaper i S3. Antallet af loeb
//     pr. division er uroert i S4 (ejer 15/9), saa det er det bedste skoen.
//   · Loebsdagene fordeles jaevnt over de 140; profilerne i S3-forholdet.
//   · Loebets egen traethed (raceRunner.applyRaceFatigue) er ikke med i nogen
//     scenarier; traening/hvile-traetheden er med.
//   · S3's x1,15 er lagt paa rate-tabellen (focusGrowthMult + offFocusMult),
//     saa traeningsscoren ser ogsaa den hoejere rate. Effekten paa scoren er lille.
//
// KOERSEL (fra repo-roden):
//   node backend/scripts/dev/raceDayYieldSim4850.mjs <population.json> [--json]
//
// <population.json> er et array af
//   { potentiale, birthYear, primary_type, secondary_type, is_academy,
//     form, fatigue, focus, intensity, abilities: {<evne>: <tal>},
//     raceDays: <antal koerte etaper i S3>, profiles: {<profile_type>: <antal>} }

import { readFileSync } from "node:fs";
import { applyDailyTick, applyRaceDevelopmentTick, resolveProgram } from "../../lib/dailyTraining.js";
import { raceDayProgram } from "../../lib/raceDayYield.js";
import { TRAINING_CONFIG } from "../../lib/training.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { nextFatigue, nextForm, conditionMultiplier } from "../../lib/riderCondition.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { riderLevelBand } from "../../lib/staffAbilityConstants.js";
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";
import { raceDayBudgetDivisor, resolveRaceDayBudgetDivisor, TRAINING_RACE_DAY_CONFIG } from "../../lib/trainingRaceDayTick.js";

export const RACE_DAYS_PER_SEASON = 140;
export const SEASON_NUMBER = 4;
const HARD_DAILY_CAP = TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay;
const DEV_MULT_OLD = 1.15;

const SCALED_CFG = Object.freeze({
  ...TRAINING_CONFIG,
  focusGrowthMult: Object.freeze(Object.fromEntries(
    Object.entries(TRAINING_CONFIG.focusGrowthMult).map(([k, v]) => [k, v * DEV_MULT_OLD]),
  )),
  offFocusMult: TRAINING_CONFIG.offFocusMult * DEV_MULT_OLD,
});

export const SCENARIOS = Object.freeze([
  { key: "S0", label: "Hvile (i dag)" },
  { key: "S1", label: "A: mellem-pas + off-fokus" },
  { key: "S2", label: "A: kun profil-evner" },
  { key: "S3", label: "A med x1,15" },
  { key: "S4", label: "Gammel D2 (planen som input)" },
]);

/** Er løbsdag `day` (0-baseret) en dag rytteren kører? Jævnt fordelt. */
export function isRaceDay(day, raceDays, total = RACE_DAYS_PER_SEASON) {
  const r = Math.max(0, Math.min(total, Math.round(Number(raceDays) || 0)));
  return Math.floor(((day + 1) * r) / total) > Math.floor((day * r) / total);
}

/** Rytterens etape-profiler i S3-forholdet, udfoldet til en fast raekkefoelge. */
export function profileSequence(profiles) {
  const entries = Object.entries(profiles ?? {}).filter(([, n]) => Number(n) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const seq = [];
  for (const [profile, n] of entries) for (let i = 0; i < n; i += 1) seq.push(profile);
  // Fletning: A B A B ... i stedet for alle A foerst, saa en saeson ikke starter
  // med samtlige bjergetaper.
  const out = [];
  const buckets = entries.map(([profile, n]) => ({ profile, left: Number(n) }));
  while (out.length < seq.length) {
    for (const b of buckets) if (b.left > 0) { out.push(b.profile); b.left -= 1; }
  }
  return out.length > 0 ? out : ["rolling"];
}

function totalPoints(abilities) {
  let sum = 0;
  for (const k of VISIBLE_ABILITIES) sum += Number(abilities[k] ?? 0);
  return sum;
}

/** Én rytters sæson under ét scenarie. */
export function simulateRider(rider, scenarioKey, { days = RACE_DAYS_PER_SEASON, budgetDivisor = raceDayBudgetDivisor() } = {}) {
  const birthYear = Number(rider.birthYear ?? LAUNCH_REFERENCE_YEAR - 25);
  const age = LAUNCH_REFERENCE_YEAR + (SEASON_NUMBER - 1) - birthYear;
  let abilities = {};
  // Evner udtraekket ikke har (fx teamwork/leadership, som ikke er kolonner i
  // rider_derived_abilities), holdes FASTE: ellers ville de "vokse" fra 0 og
  // forurene alle scenarier ens.
  const missing = VISIBLE_ABILITIES.filter((k) => !Number.isFinite(Number(rider.abilities?.[k])));
  for (const k of VISIBLE_ABILITIES) abilities[k] = Number(rider.abilities?.[k] ?? 0);
  const start = totalPoints(abilities);
  let progress = {};
  let form = Number(rider.form ?? 50);
  let fatigue = Number(rider.fatigue ?? 0);
  const plan = resolveProgram(
    rider.focus && rider.intensity ? { focus: rider.focus, intensity: rider.intensity } : null,
    rider.primary_type,
  );
  const profiles = profileSequence(rider.profiles);
  let raceIdx = 0;
  let raceDayGain = 0;
  let tickedDays = 0;
  let capBoundDays = 0;
  const raceGainsByProfile = {};

  for (let day = 0; day < days; day += 1) {
    const racing = isRaceDay(day, rider.raceDays, days);
    const profile = racing ? profiles[raceIdx++ % profiles.length] : null;
    const caps = buildCapsForRider(
      abilities,
      { potentiale: rider.potentiale, is_academy: rider.is_academy, age },
      rider.primary_type,
      rider.secondary_type,
    );
    for (const k of missing) caps[k] = abilities[k];
    const shared = {
      riderId: `sim-${rider.id ?? `${birthYear}-${rider.primary_type}-${start}`}`,
      dateStr: "2026-09-28",
      tickSeedKey: `sim4850#gd${day + 1}`,
      age,
      abilities,
      caps,
      progress,
      conditionMult: conditionMultiplier({ form, fatigue }),
      bonus: false,
      potentiale: rider.potentiale,
      primaryType: rider.primary_type,
      secondaryType: rider.secondary_type,
      riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
      budgetDivisor,
      hardDailyCap: HARD_DAILY_CAP,
    };

    let result = null;
    let intensity = plan.intensity;
    if (!racing) {
      result = applyDailyTick({ ...shared, program: plan });
    } else if (scenarioKey === "S0") {
      intensity = "rest";
    } else {
      intensity = "race";
      if (scenarioKey === "S1") result = applyDailyTick({ ...shared, program: raceDayProgram(profile) });
      else if (scenarioKey === "S2") result = applyDailyTick({ ...shared, program: raceDayProgram(profile, { includeOffFocus: false }) });
      else if (scenarioKey === "S3") result = applyDailyTick({ ...shared, program: raceDayProgram(profile), trainingCfg: SCALED_CFG });
      else if (scenarioKey === "S4") result = applyRaceDevelopmentTick({ ...shared, program: plan, profileType: profile });
    }

    if (result) {
      tickedDays += 1;
      if (racing) {
        // Loebsdagens bidrag maales i RAA fremdrift (summen af evne-deltaer,
        // applyDailyTick's `score`), ikke i hele point: en broekdel af et point
        // fra en loebsdag bliver ofte foerst til et helt point paa en senere dag.
        raceDayGain += Number(result.score) || 0;
        const bucket = (raceGainsByProfile[profile] ??= {});
        for (const [ability, n] of Object.entries(result.gains)) bucket[ability] = (bucket[ability] ?? 0) + n;
      }
      // +1-loftet "binder" en dag hvor en evne fik sit ene point og der stadig
      // staar mindst ét helt point paa baren (carry-over til naeste dag).
      if (Object.keys(result.gains).some((a) => Number(result.progress[a] ?? 0) >= 1)) capBoundDays += 1;
      abilities = result.abilities;
      progress = result.progress;
    }
    fatigue = nextFatigue({ fatigue, intensity, recoveryAbility: abilities.recovery ?? 50 });
    form = nextForm({ form, fatigue });
  }

  return { age, gained: totalPoints(abilities) - start, raceDayGain, tickedDays, capBoundDays, raceGainsByProfile };
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}

function ageBand(age) {
  if (age <= 19) return "≤19";
  if (age <= 22) return "20-22";
  if (age <= 25) return "23-25";
  return "26+";
}

function raceBand(n) {
  const r = Number(n) || 0;
  if (r === 0) return "0";
  if (r <= 30) return "1-30";
  if (r <= 60) return "31-60";
  return "61+";
}

/** Hele rapporten som data. */
export function runSimulation(population, { budgetDivisor = raceDayBudgetDivisor() } = {}) {
  const results = {};
  for (const { key } of SCENARIOS) {
    results[key] = population.map((rider) => ({ rider, ...simulateRider(rider, key, { budgetDivisor }) }));
  }
  const groupTable = (groupFn, groups) => groups.map((g) => {
    const row = { group: g };
    for (const { key } of SCENARIOS) {
      const vals = results[key].filter((r) => groupFn(r) === g).map((r) => r.gained);
      row[key] = { n: vals.length, median: quantile(vals, 0.5), p90: quantile(vals, 0.9) };
    }
    return row;
  });
  const capShare = Object.fromEntries(SCENARIOS.map(({ key }) => {
    const ticked = results[key].reduce((s, r) => s + r.tickedDays, 0);
    const bound = results[key].reduce((s, r) => s + r.capBoundDays, 0);
    return [key, ticked === 0 ? 0 : Number(((bound / ticked) * 100).toFixed(2))];
  }));
  const profileAbilities = {};
  for (const r of results.S1) {
    for (const [profile, gains] of Object.entries(r.raceGainsByProfile)) {
      const bucket = (profileAbilities[profile] ??= {});
      for (const [ability, n] of Object.entries(gains)) bucket[ability] = (bucket[ability] ?? 0) + n;
    }
  }
  const totals = Object.fromEntries(SCENARIOS.map(({ key }) => [key, {
    median: quantile(results[key].map((r) => r.gained), 0.5),
    raceDayMedian: Number((quantile(results[key].map((r) => r.raceDayGain), 0.5) ?? 0).toFixed(2)),
  }]));
  return {
    population: population.length,
    budgetDivisor: Number(budgetDivisor.toFixed(3)),
    racersMedianRaceDays: quantile(population.map((r) => Number(r.raceDays) || 0), 0.5),
    totals,
    byAge: groupTable((r) => ageBand(r.age), ["≤19", "20-22", "23-25", "26+"]),
    byRaceDays: groupTable((r) => raceBand(r.rider.raceDays), ["0", "1-30", "31-60", "61+"]),
    byPotential: groupTable((r) => String(r.rider.potentiale ?? "?"), ["1", "2", "3", "4", "5", "6"]),
    capBoundPctOfTickDays: capShare,
    s1RaceDayAbilitiesByProfile: Object.fromEntries(Object.entries(profileAbilities).map(([p, g]) => [
      p, Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 4),
    ])),
  };
}

function fmt(cell) {
  return cell?.n ? `${cell.median} / ${cell.p90}` : "–";
}

function toMarkdown(report) {
  const head = `| | ${SCENARIOS.map((s) => `${s.key} ${s.label}`).join(" | ")} |\n|---|${SCENARIOS.map(() => "---:").join("|")}|`;
  const table = (rows, label) => [
    `**${label}** (evnepoint pr. sæson, median / p90)`,
    head,
    ...rows.map((row) => `| ${row.group} (n=${row.S0.n}) | ${SCENARIOS.map((s) => fmt(row[s.key])).join(" | ")} |`),
  ].join("\n");
  return [
    `# Løbsdags-udbytte, simulering (#4850)`,
    ``,
    `Population: ${report.population} ryttere · median ${report.racersMedianRaceDays} løbsdage af ${RACE_DAYS_PER_SEASON}.`,
    ``,
    `| Scenarie | Median evnepoint pr. sæson | Fremdrift fra løbsdage (median, point-ækvivalent) | +1-loftet binder (% af dage med tick) |`,
    `|---|---:|---:|---:|`,
    ...SCENARIOS.map((s) => `| ${s.key} ${s.label} | ${report.totals[s.key].median} | ${report.totals[s.key].raceDayMedian} | ${report.capBoundPctOfTickDays[s.key]} % |`),
    ``,
    table(report.byRaceDays, "Efter antal løbsdage"),
    ``,
    table(report.byAge, "Efter alder"),
    ``,
    table(report.byPotential, "Efter potentiale"),
    ``,
    `**S1: hvilke evner vokser på løbsdagen, pr. profil** (sum af point, top 4)`,
    ``,
    ...Object.entries(report.s1RaceDayAbilitiesByProfile).map(([p, list]) => `- ${p}: ${list.map(([a, n]) => `${a} ${n}`).join(", ")}`),
    ``,
    `Forenklinger: løbsdage = S3's kørte etaper, jævnt fordelt; løbets egen træthed er ikke med; S3's x1,15 ligger på rate-tabellen.`,
  ].join("\n");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error("brug: node backend/scripts/dev/raceDayYieldSim4850.mjs <population.json> [--json]");
    process.exit(2);
  }
  const population = JSON.parse(readFileSync(path, "utf8"));
  // Samme deler som motoren paa loebsdags-stien (S4 = 140 loebsdage).
  const budgetDivisor = await resolveRaceDayBudgetDivisor({ seasonNumber: SEASON_NUMBER });
  const report = runSimulation(population, { budgetDivisor });
  console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : toMarkdown(report));
}
