#!/usr/bin/env node
// backend/scripts/v4DescentIncidents.js
// Race Engine v4 (#4905, M3+M11): maal NEDKOERSELS-UHELD pr. 100 nedkoersels-
// angreb, opdelt paa vejr.
//
// MAALT PROBLEM: `mechanics/descent.ts`'s styrt-risiko (beslutning 7) daempede
// risikoen SUBTRAKTIVT af descending-evnen (`incidentRiskDescendingDampening`)
// og naaede PRAECIS 0 for enhver descending-evne >= ~67 — men `findAttackers`
// vaelger altid de reelt BEDSTE descendere i gruppen som angribere, saa
// nedkoerselsstyrt blev statistisk usynlige ved produktions-tuningen: 40 loeb
// x 120 angreb gav 0 uheld, ogsaa i regn (M11's weatherAdjustedRiskBase
// forstaerker basis-risikoen, men naar frem til den samme 0-daempede evne).
// Fixet (samme PR) erstatter daempningen MULTIPLIKATIVT med et gulv
// (DESCENT_EXTRA_TUNING.incidentRiskFloorFraction) i tuning.ts.
//
// Dette script er MAALEREDSKABET: kør det FOER og EFTER fixet (fx via
// `git checkout HEAD~1 -- backend/lib/engine/v4/tuning.ts
// backend/lib/engine/v4/mechanics/descent.ts` for "foer", `git checkout HEAD
// -- <samme filer>` for "efter") og sammenlign incidents-pr-100-angreb-tallet
// pr. vejrtype. Se PR-bodyen for #4905 for den faktiske foer/efter-tabel.
//
// 100% READ-ONLY og DB-FRIT — samme moenster som v4TailSpread.js: population
// laeses fra en committede snapshot, etaper fra en --stages-fil (headToHeadV4-
// formatet, fx backend/scripts/out/baseline/season-3-stages.json) eller en
// offline proxy-kalender (genbruger v4TailSpread.js's buildProxyCalendar —
// IKKE en kopi, saa de to scripts' kalendere aldrig kan drive fra hinanden).
//
// Usage:
//   node backend/scripts/v4DescentIncidents.js
//   node backend/scripts/v4DescentIncidents.js --stages=<fil> --seeds=s1,s2,s3
//   node backend/scripts/v4DescentIncidents.js --weather=rain   # tving ALLE etaper til ét vejr (kontrolleret sammenligning)
//   node backend/scripts/v4DescentIncidents.js --json=<fil>     # skriv raa maalinger

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { sampleField } from "./lib/headToHeadStats.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { stableSeed } from "../lib/raceSimulator.js";
import { buildProxyCalendar } from "./v4TailSpread.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_POPULATION = join(REPO_ROOT, "backend", "scripts", "baselines", "population-snapshot-2026-07-11.json");
const DEFAULT_SEEDS = ["descent-incidents-1", "descent-incidents-2", "descent-incidents-3"];
const DEFAULT_FIELD_SIZE = 180; // samme laaste feltstoerrelse som headToHeadV4.LOCKED_FIELD_SIZE
const DEFAULT_RACE_COUNT = 24;
// De tre vejrtyper der giver forskellige risiko-multiplikatorer i weather.ts
// (WEATHER_EXTRA_TUNING). "overcast" deler multiplikator med "sun" (baade
// 1.0, se weather.ts's MULTIPLIER_KEY_BY_WEATHER_KIND) og er derfor ikke med
// som en tredje forskellig celle her, men optraeder naturligt i den
// U-forcerede (naturlige vejr-)maaling.
const WEATHER_KINDS = Object.freeze(["sun", "overcast", "rain"]);

// ---------------------------------------------------------------------------
// Maaling (rene funktioner, direkte testet i v4DescentIncidents.test.js)
// ---------------------------------------------------------------------------

/**
 * Taeller nedkoersels-angreb (finale_attack, direction: "descent") og
 * nedkoersels-uheld (incident, cause: "descent_attack") i ÉT StageOutputs
 * tidslinje. "angreb" taelles PR. ANGRIBER (rider_ids.length), ikke pr.
 * finale_attack-event — incidentProbability rulles individuelt pr. angriber
 * i descent.ts, saa det er den rigtige naevner for "uheld pr. 100 angreb".
 *
 * `crashes` (#4934) er den raa post pr. uheld, som trappen (M10's
 * `resolveCrashIncident`) afgjorde den: alvorstrin, udfald, tidstab og
 * skadedage. Foer #4934 baerte descent-uheldets event kun `rider_id` + `cause`
 * — uden konsekvens fandtes der intet at rapportere pr. sværhedsgrad.
 * @returns {{attacks:number, incidents:number, crashes:Array<{severity:(string|null), outcome:(string|null), timeLossSeconds:(number|null), injuryDays:(number|null)}>}}
 */
export function measureDescentIncidents(stageOutput) {
  let attacks = 0;
  let incidents = 0;
  const crashes = [];
  for (const event of stageOutput.timeline.events) {
    if (event.type === "finale_attack" && event.params?.direction === "descent") {
      const riderIds = event.params?.rider_ids;
      attacks += Array.isArray(riderIds) ? riderIds.length : 1;
    } else if (event.type === "incident" && event.params?.cause === "descent_attack") {
      incidents += 1;
      crashes.push({
        severity: event.params?.severity ?? null,
        outcome: event.params?.outcome ?? null,
        timeLossSeconds: event.params?.time_loss_seconds ?? null,
        injuryDays: event.params?.injury_days ?? null,
      });
    }
  }
  return { attacks, incidents, crashes };
}

/** Overskriver ruteens vejr til én bestemt kind (kontrolleret sammenligning). Bevarer wind_exposure. */
export function withForcedWeather(route, weatherKind) {
  if (!weatherKind) return route;
  return { ...route, weather: { kind: weatherKind, wind_exposure: route.weather?.wind_exposure ?? 0.2 } };
}

function entrantsForField(fieldRiders) {
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, () => ({ role: "free_role", effort: "normal", condition: 1 }));
}

/**
 * Koerer v4 over kalenderen for hvert seed og returnerer én maaling pr.
 * (etape, seed). Ingen console-output — testbar.
 * @returns {Array<{seed:string, stageNumber:number, profileType:string, weatherKind:string, attacks:number, incidents:number}>}
 */
export function runDescentIncidents({
  population,
  stages,
  seeds = DEFAULT_SEEDS,
  fieldSize = DEFAULT_FIELD_SIZE,
  forceWeatherKind = null,
  tuning = RACE_V4_TUNING,
}) {
  if (!population?.riders?.length) throw new Error("population.riders mangler eller er tom");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("stages mangler eller er tom");

  const measurements = [];
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const stageSeedStr = `${seed}:${stageRow.stage_number ?? 1}`;
      let fieldRiders = population.riders;
      if (fieldSize) {
        const rng = makeRng(stableSeed(`${stageSeedStr}:field`));
        fieldRiders = sampleField(rng, population.riders, fieldSize);
      }
      const route = withForcedWeather(routeFromStageProfileRow(stageRow), forceWeatherKind);
      const output = simulateStageV4({
        route,
        startlist: entrantsForField(fieldRiders),
        orders: [],
        seed: stageSeedStr,
        tuning,
      });
      const { attacks, incidents, crashes } = measureDescentIncidents(output);
      measurements.push({
        seed,
        stageNumber: stageRow.stage_number,
        profileType: stageRow.profile_type ?? "?",
        weatherKind: route.weather?.kind ?? "?",
        attacks,
        incidents,
        crashes,
      });
    }
  }
  return measurements;
}

/**
 * Aggregerer maalinger til attacks/incidents/uheld-pr-100-angreb pr. noegle
 * (typisk vejrtype). `incidentsPer100Attacks` er `null` naar der ingen angreb
 * var i cellen (kan ikke sige noget om raten).
 * @returns {Array<{key:string, n:number, attacks:number, incidents:number, incidentsPer100Attacks:(number|null)}>}
 */
export function summarizeDescentIncidents(measurements, keyFn = (m) => m.weatherKind) {
  const groups = new Map();
  for (const m of measurements) {
    const key = keyFn(m);
    if (!groups.has(key)) groups.set(key, { n: 0, attacks: 0, incidents: 0 });
    const g = groups.get(key);
    g.n += 1;
    g.attacks += m.attacks;
    g.incidents += m.incidents;
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      n: g.n,
      attacks: g.attacks,
      incidents: g.incidents,
      incidentsPer100Attacks: g.attacks > 0 ? (g.incidents / g.attacks) * 100 : null,
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/**
 * TIDSTAB PR. SVAERHEDSGRAD (#4934). Efter at nedkoersels-styrtet blev koblet
 * paa M10's trappe er "uheld pr. 100 angreb" ikke laengere hele historien —
 * det afgoerende er hvad et uheld KOSTER. Denne aggregering svarer paa det pr.
 * alvorstrin (light/hard/serious).
 *
 * `meanTimeLossSeconds` regnes KUN over uheld der faktisk kostede tid
 * (`outcome === "time_loss"`): et 3-km-beskyttet styrt har intet tidstab, og et
 * alvorligt styrt har ingen etapetid at tabe — begge ville traekke gennemsnittet
 * mod 0 og skjule hvad trinnet reelt koster. De taelles i deres egne kolonner.
 * @returns {Array<{severity:string, n:number, share:(number|null), timeLossN:number, meanTimeLossSeconds:(number|null), minTimeLossSeconds:(number|null), maxTimeLossSeconds:(number|null), abandoned:number, protected:number, injuryN:number, meanInjuryDays:(number|null)}>}
 */
export function summarizeDescentSeverity(measurements) {
  const groups = new Map();
  let total = 0;
  for (const m of measurements) {
    for (const crash of m.crashes ?? []) {
      total += 1;
      const key = crash.severity ?? "?";
      if (!groups.has(key)) {
        groups.set(key, { n: 0, timeLossN: 0, timeLossSum: 0, min: null, max: null, abandoned: 0, protected: 0, injuryN: 0, injurySum: 0 });
      }
      const g = groups.get(key);
      g.n += 1;
      if (crash.outcome === "abandoned") g.abandoned += 1;
      if (crash.outcome === "protected_three_km_rule") g.protected += 1;
      if (crash.outcome === "time_loss" && Number.isFinite(crash.timeLossSeconds)) {
        g.timeLossN += 1;
        g.timeLossSum += crash.timeLossSeconds;
        g.min = g.min === null ? crash.timeLossSeconds : Math.min(g.min, crash.timeLossSeconds);
        g.max = g.max === null ? crash.timeLossSeconds : Math.max(g.max, crash.timeLossSeconds);
      }
      if (Number.isFinite(crash.injuryDays) && crash.injuryDays !== null) {
        g.injuryN += 1;
        g.injurySum += crash.injuryDays;
      }
    }
  }
  return [...groups.entries()]
    .map(([severity, g]) => ({
      severity,
      n: g.n,
      share: total > 0 ? g.n / total : null,
      timeLossN: g.timeLossN,
      meanTimeLossSeconds: g.timeLossN > 0 ? g.timeLossSum / g.timeLossN : null,
      minTimeLossSeconds: g.min,
      maxTimeLossSeconds: g.max,
      abandoned: g.abandoned,
      protected: g.protected,
      injuryN: g.injuryN,
      meanInjuryDays: g.injuryN > 0 ? g.injurySum / g.injuryN : null,
    }))
    .sort((a, b) => a.severity.localeCompare(b.severity));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fmt(v, decimals = 3) {
  return v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(decimals);
}

function formatTable(title, rows) {
  const lines = [title, "vejr\tn_etaper\tangreb\tuheld\tuheld_pr_100_angreb"];
  for (const r of rows) {
    lines.push([r.key, r.n, r.attacks, r.incidents, fmt(r.incidentsPer100Attacks)].join("\t"));
  }
  return lines.join("\n");
}

function formatSeverityTable(rows) {
  const lines = [
    "-- Tidstab pr. svaerhedsgrad for NEDKOERSELS-uheld (#4934, M10-trappen) --",
    "trin\tn\tandel\tm_tidstab\tmin\tmax\tudgaaet\t3km_beskyttet\tskadede\tm_skadedage",
  ];
  for (const r of rows) {
    lines.push([
      r.severity,
      r.n,
      fmt(r.share, 3),
      fmt(r.meanTimeLossSeconds, 1),
      fmt(r.minTimeLossSeconds, 1),
      fmt(r.maxTimeLossSeconds, 1),
      r.abandoned,
      r.protected,
      r.injuryN,
      fmt(r.meanInjuryDays, 2),
    ].join("\t"));
  }
  if (rows.length === 0) lines.push("(ingen nedkoersels-uheld i denne koersel)");
  return lines.join("\n");
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const populationPath = argValue("population", DEFAULT_POPULATION);
  const stagesPath = argValue("stages");
  const seeds = String(argValue("seeds", DEFAULT_SEEDS.join(",")))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fieldSizeArg = argValue("field-size");
  const fieldSize = fieldSizeArg === "all" ? null : Number(fieldSizeArg ?? DEFAULT_FIELD_SIZE);
  const raceCount = Number(argValue("races", String(DEFAULT_RACE_COUNT)));
  const forcedWeather = argValue("weather"); // enkelt kind, eller udeladt => sweep sun/overcast/rain
  const jsonOut = argValue("json");

  const population = readJson(populationPath);
  let stages;
  if (stagesPath) {
    const file = readJson(stagesPath);
    stages = Array.isArray(file) ? file : file.stages;
  } else {
    stages = buildProxyCalendar({ raceCount });
  }

  console.log(
    `Population: ${population.riders?.length ?? 0} ryttere (${populationPath}). ` +
      `Etaper: ${stages.length}${stagesPath ? "" : " (offline proxy-kalender)"}. ` +
      `Seeds: ${seeds.join(", ")}. Feltstoerrelse: ${fieldSize ?? "hele populationen"}.`,
  );
  console.log(
    "\"angreb\" = ét descent-angreb-rider (finale_attack, direction:descent) — hver angriber ruller sin egen " +
      "incidentProbability. \"uheld\" = incident-events med cause:descent_attack. Acceptkriterie (#4905): " +
      ">0 uheld pr. 100 angreb i regn.",
  );
  console.log("");

  const kindsToRun = forcedWeather ? [forcedWeather] : WEATHER_KINDS;
  const allMeasurements = [];
  for (const kind of kindsToRun) {
    const measurements = runDescentIncidents({ population, stages, seeds, fieldSize, forceWeatherKind: kind });
    allMeasurements.push(...measurements);
  }

  console.log(formatTable("-- Uheld pr. 100 angreb, pr. vejrtype (vejret TVUNGET pr. kørsel — kontrolleret sammenligning) --", summarizeDescentIncidents(allMeasurements, (m) => m.weatherKind)));
  console.log("");
  console.log(formatTable("-- Samme, pr. etapetype x vejrtype --", summarizeDescentIncidents(allMeasurements, (m) => `${m.profileType} | ${m.weatherKind}`)));
  console.log("");
  console.log(formatTable("-- I alt (alle vejrtyper) --", summarizeDescentIncidents(allMeasurements, () => "alle")));
  console.log("");
  console.log(formatSeverityTable(summarizeDescentSeverity(allMeasurements)));

  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, JSON.stringify({ seeds, fieldSize, forcedWeather: forcedWeather ?? null, measurements: allMeasurements }, null, 2));
    console.log("");
    console.log(`Raa maalinger skrevet til ${jsonOut}`);
  }
}

if (process.argv[1]?.endsWith("v4DescentIncidents.js")) {
  main();
}
