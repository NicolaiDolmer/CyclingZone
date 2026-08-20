#!/usr/bin/env node
// #4000 — sim-harness + scorecard: "typen skal fylde mindre i værdiformlen".
//
// READ-ONLY MÅLING. Rører ALDRIG den live model (riderValuationModelV4.json)
// eller nogen DB-række — se typeDampeningScenarios4000.mjs's header. Kører
// udelukkende mod et DATERET, allerede hentet snapshot af hele den aktive
// rytter-population (docs/snapshots/4000/, hentet read-only via Supabase MCP
// execute_sql — samme mønster som docs/snapshots/3591/README.md).
//
// Baggrund (issue #4000, ejer-godkendt 20/8): V4-modellens offset[type] er fittet
// på meget skæve stikprøvestørrelser — puncheur (7,9x, n=19), gc (1,6x, n=34) vs.
// tt (n=2.622). 214 puncheurs i prod, 87 på menneskehold. alpha=1,0 betyder O
// regnes KUN på speciale-evner.
//
// Bindende rækkefølge (kommentar på #3353): niveaukorrektionen (#3449) appliceres
// FØR denne dæmpning flippes i produktion. Dette script ÆNDRER intet — det måler.
//
// Usage:
//   node scripts/dev/typeDampeningHarness4000.mjs
//   node scripts/dev/typeDampeningHarness4000.mjs --snapshot=../docs/snapshots/4000/population.json.gz
//   node scripts/dev/typeDampeningHarness4000.mjs --json=../docs/snapshots/4000/scorecard-results.json
//
// Refs #4000 #3353 #3449 #3345 #3732

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { predictBaseValueV4 } from "../../lib/riderCareerNpv.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import {
  buildScenarioCatalog,
  buildScenarioModel,
  median,
  quantile,
  mean,
  pctDelta,
  normalizationFactor,
  checkTypeMonotonicity,
} from "./lib/typeDampeningScenarios4000.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "..");

function arg(name, def = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const SNAPSHOT_PATH = resolve(
  process.cwd(),
  arg("snapshot", join(REPO_ROOT, "docs/snapshots/4000/population.json.gz"))
);
const JSON_OUT = arg("json", join(REPO_ROOT, "docs/snapshots/4000/scorecard-results.json"));
const V4_MODEL_PATH = join(BACKEND_ROOT, "lib/riderValuationModelV4.json");

// #3345 frozen-type-kæden: samme fallback som produktionen (riderValueRefresh.js).
const NAME_LIMIT = 20; // "de 20 største enkelt-udslag"

function loadSnapshot(path) {
  if (!existsSync(path)) {
    throw new Error(`Snapshot ikke fundet: ${path}. Kør population-hentningen først (se docs/snapshots/4000/README.md).`);
  }
  const raw = path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path);
  return JSON.parse(raw.toString("utf8"));
}

function toRiderAndAbilities(row, seasonNumber) {
  const age = ageForSeason(row.birthdate, seasonNumber);
  const rider = {
    id: row.id,
    name: `${row.firstname ?? ""} ${row.lastname ?? ""}`.trim(),
    valuation_type: row.valuation_type,
    primary_type: row.primary_type,
    potentiale: row.potentiale,
    age,
    team_id: row.team_id,
    owner_is_ai: row.owner_is_ai,
    is_academy: row.is_academy,
  };
  const abilities = {};
  for (const k of VISIBLE_ABILITIES) if (row[k] != null) abilities[k] = Number(row[k]);
  return { rider, abilities };
}

function summarizeDeltas(pctDeltas) {
  return {
    n: pctDeltas.length,
    median: median(pctDeltas),
    p10: quantile(pctDeltas, 0.1),
    p90: quantile(pctDeltas, 0.9),
    mean: mean(pctDeltas),
  };
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

async function main() {
  console.log("=== #4000 type-dæmpnings-harness (READ-ONLY, ingen DB-skrivning) ===\n");

  const snapshot = loadSnapshot(SNAPSHOT_PATH);
  const seasonNumber = snapshot.active_season;
  console.log(`Snapshot: ${snapshot.n} ryttere, sæson ${seasonNumber}, hentet ${snapshot.captured_at}`);

  const baseModel = JSON.parse(readFileSync(V4_MODEL_PATH, "utf8"));

  const population = snapshot.riders
    .map((row) => toRiderAndAbilities(row, seasonNumber))
    .filter((p) => p.rider.age != null);
  console.log(`Værdisætbare (gyldig alder): ${population.length}/${snapshot.n}\n`);

  const humanPuncheurs = population.filter(
    (p) => (p.rider.valuation_type ?? p.rider.primary_type) === "puncheur" && p.rider.team_id && !p.rider.owner_is_ai
  );
  const humanGc = population.filter(
    (p) => (p.rider.valuation_type ?? p.rider.primary_type) === "gc" && p.rider.team_id && !p.rider.owner_is_ai
  );
  console.log(`Menneskehold-puncheurs: ${humanPuncheurs.length} · menneskehold-gc: ${humanGc.length}\n`);

  const scenarios = buildScenarioCatalog();

  // ── Baseline-værdier (én gang) ──────────────────────────────────────────────
  const baselineValues = new Map(); // rider.id -> value
  for (const { rider, abilities } of population) {
    const v = predictBaseValueV4(rider, abilities, baseModel);
    if (v != null) baselineValues.set(rider.id, v);
  }
  const baselineSum = [...baselineValues.values()].reduce((s, v) => s + v, 0);
  console.log(`Baseline: ${baselineValues.size} værdisat, total ${Math.round(baselineSum).toLocaleString("da-DK")}\n`);

  // ── Monotoni-sanity (per scenarie, per type) ────────────────────────────────
  const monotonicityFailures = [];

  const scorecard = [];
  for (const scenario of scenarios) {
    const model = buildScenarioModel(baseModel, scenario);

    // Monotoni-sanity for scenariet.
    for (const type of RIDER_TYPE_KEYS) {
      const result = checkTypeMonotonicity(predictBaseValueV4, VISIBLE_ABILITIES, model, type);
      if (!result.ok) {
        monotonicityFailures.push({ scenario: scenario.id, type, values: result.values, levels: result.levels });
      }
    }

    if (scenario.id === "baseline") {
      scorecard.push({
        id: scenario.id,
        label: scenario.label,
        offsetK: scenario.offsetK,
        alpha: scenario.alpha,
        rawTotal: Math.round(baselineSum),
        rawTotalDeltaPct: 0,
        normalizationFactor: 1,
        normalizedTotal: Math.round(baselineSum),
        normalizedTotalDeltaPct: 0,
        byType: {},
        topMovers: [],
        humanPuncheurs: null,
        humanGc: null,
      });
      continue;
    }

    const rawValues = new Map();
    for (const { rider, abilities } of population) {
      const v = predictBaseValueV4(rider, abilities, model);
      if (v != null) rawValues.set(rider.id, v);
    }
    const rawSum = [...rawValues.values()].reduce((s, v) => s + v, 0);
    const rawTotalDeltaPct = pctDelta(baselineSum, rawSum);
    // #4000 pkt. 2: "bør være ~neutral — det er FORDELINGEN der skal ændres, ikke
    // niveauet; hvis sum flytter sig markant, normalisér med en global faktor og
    // rapportér den." normFactor skalerer HVER rytters værdi ens, så den samlede
    // sum matcher baseline igen — rapporterede pr.-type/topMovers/menneskehold-tal
    // er DERFOR normaliserede (den faktiske fordelingsændring), rawTotalDeltaPct +
    // normalizationFactor er selve "regningen" for hvor stor korrektionen var.
    const normFactor = normalizationFactor(baselineSum, rawSum) ?? 1;
    const scenarioValues = new Map([...rawValues].map(([id, v]) => [id, v * normFactor]));
    const normalizedSum = [...scenarioValues.values()].reduce((s, v) => s + v, 0);

    // Pr.-rytter deltas (NORMALISEREDE værdier), grupperet pr. type.
    const deltasByType = {};
    const allDeltas = [];
    for (const { rider } of population) {
      const before = baselineValues.get(rider.id);
      const after = scenarioValues.get(rider.id);
      if (before == null || after == null) continue;
      const type = rider.valuation_type ?? rider.primary_type ?? "ukendt";
      const d = pctDelta(before, after);
      if (d == null) continue;
      (deltasByType[type] ??= []).push(d);
      allDeltas.push({ id: rider.id, name: rider.name, type, before, after, pctDelta: d, absDelta: after - before });
    }

    const byType = {};
    for (const type of Object.keys(deltasByType)) {
      byType[type] = summarizeDeltas(deltasByType[type]);
    }

    // "Største enkelt-udslag" = størst CZ$-udslag (absolut), ikke størst %-udslag —
    // %-udslag er næsten KONSTANT inden for en type (offset er en fælles additiv
    // konstant i eksponenten), så en %-sortering ville bare liste 20 puncheurs i
    // vilkårlig rækkefølge. Absolut CZ$-sortering viser hvor de REELLE
    // markedsværdi-udsving lander (typisk høj-værdi individer, ikke nødvendigvis
    // højest-%-type).
    allDeltas.sort((a, b) => Math.abs(b.absDelta) - Math.abs(a.absDelta));
    const topMovers = allDeltas.slice(0, NAME_LIMIT).map((m) => ({
      id: m.id, name: m.name, type: m.type,
      before: Math.round(m.before), after: Math.round(m.after),
      pctDelta: round2(m.pctDelta), absDelta: Math.round(m.absDelta),
    }));

    const humanPuncheurDeltas = humanPuncheurs
      .map((p) => pctDelta(baselineValues.get(p.rider.id), scenarioValues.get(p.rider.id)))
      .filter((d) => d != null);
    const humanGcDeltas = humanGc
      .map((p) => pctDelta(baselineValues.get(p.rider.id), scenarioValues.get(p.rider.id)))
      .filter((d) => d != null);

    scorecard.push({
      id: scenario.id,
      label: scenario.label,
      offsetK: scenario.offsetK,
      alpha: scenario.alpha,
      rawTotal: Math.round(rawSum),
      rawTotalDeltaPct: round2(rawTotalDeltaPct),
      normalizationFactor: Math.round(normFactor * 10000) / 10000,
      normalizedTotal: Math.round(normalizedSum),
      normalizedTotalDeltaPct: round2(pctDelta(baselineSum, normalizedSum)),
      byType,
      topMovers,
      humanPuncheurs: summarizeDeltas(humanPuncheurDeltas),
      humanGc: summarizeDeltas(humanGcDeltas),
    });

    console.log(
      `${scenario.id.padEnd(20)} raw ${round2(rawTotalDeltaPct)}%`.padEnd(38) +
      `norm×${Math.round(normFactor * 1000) / 1000}`.padEnd(14) +
      `puncheur-median ${round2(byType.puncheur?.median)}%  gc-median ${round2(byType.gc?.median)}%`
    );
  }

  console.log(`\nMonotoni-sanity: ${monotonicityFailures.length} inversioner fundet på tværs af ${scenarios.length} scenarier × ${RIDER_TYPE_KEYS.length} typer.`);
  if (monotonicityFailures.length) {
    console.log("❌ INVERSION FUNDET:", JSON.stringify(monotonicityFailures, null, 2));
  } else {
    console.log("✅ Ingen inversion i noget scenarie/type — bedre evner giver altid ≥ værdi.");
  }

  const result = {
    measured_at: new Date().toISOString(),
    snapshot: { captured_at: snapshot.captured_at, n: snapshot.n, active_season: seasonNumber },
    population: { total: snapshot.n, valued: baselineValues.size, humanPuncheurs: humanPuncheurs.length, humanGc: humanGc.length },
    monotonicity: { ok: monotonicityFailures.length === 0, failures: monotonicityFailures },
    scenarios: scorecard,
  };

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
    console.log(`\n✅ Skrev ${JSON_OUT}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
