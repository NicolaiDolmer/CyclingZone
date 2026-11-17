// #7685 (#6110 Udvikling 2.0): tændingens backfill af de gemte potentiale-skøn.
//
// HVORFOR: med potential_estimate_display tændt viser alle flader kun gemte skøn
// (potentialEstimateRead.js). Uden rækker ser hver rytter "Ikke scoutet" ud, og
// søndagskørslen fylder først tabellen næste søndag. Dette script regner skønnet for
// alle ryttere på én gang, så tabellen er fyldt, før visningen tændes.
//
// HVAD DET SKRIVER: præcis det, søndagskørslen ville skrive for et par uden række.
// Samme rytter-udvalg (loadEstimateRiders), samme viden og samme sande tal
// (potentialEstimateWriter.js), trigger "backfill": en række oprettes kun, hvor
// intet er gemt, og en gemt række overskrives aldrig. Derfor:
//   - IDEMPOTENT: anden kørsel skriver 0 rækker.
//   - Ingen backup nødvendig: intet eksisterende ændres. Rul tilbage ved at slette
//     rækker med write_reason = 'backfill' og computed_at = kørslens tidsstempel,
//     som scriptet skriver ud.
//
// SIKKERHED
//   - DRY-RUN er default og skriver intet. Den kan køres, før noget er tændt:
//     kalibreringen og XP-tallene kan gives som private filer (--params-file,
//     --xp-params-file), eller XP-tallene kan læses fra private_config med --assume-xp.
//   - --apply kræver --owner-go OG samme tilstand som søndagskørslen:
//     potential_estimate_writes tændt, potential_estimate_params gyldig, og
//     XP-modellen gældende for datoen (development_xp_model on, startdato nået,
//     gyldige XP-tal). Private filer er forbudt med --apply: der skrives kun med det,
//     prod selv læser.
//   - Output på skærmen er kun tællinger og gate-status. Tal fra gaterne (fejl pr.
//     ord osv.) er private (hard rule 17) og skrives kun til --out, som skal ligge i
//     balance-internals/.
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/potential-estimate-backfill.mjs --assume-xp --gates-file=<privat> --out=<balance-internals/...>
//   infisical run --env=prod -- node scripts/potential-estimate-backfill.mjs --apply --owner-go     # KUN efter ejerens "kør"
//
// Gaterne (spec 2026-10-23 §9, genkørt mod det nye sande tal efter spec 2026-11-06 §8):
//   H1 præcision pr. ord, H2 stabilitet (en søndag uden ny viden skriver intet),
//   H3 monotoni i forventning, H4 ingen lækage i den offentlige visning,
//   H6 inversion (to vidensniveauer og sammenlægning på tværs af hold).
//   H5 (alle flader viser samme tal) er en egenskab ved læse-siden og dækkes af
//   potentialEstimateRead.test.js. Grænserne er private og gives med --gates-file.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CERTAINTY_WORDS, estimatePotential, publicEstimateView, uncertaintyFor, validateParams,
} from "../lib/potentialEstimate.js";
import {
  POTENTIAL_ESTIMATE_PARAMS_KEY, loadEstimateDevelopmentXp, loadEstimateTeamIds, loadEstimateWriteConfig,
  planTeamEstimates, planTeamEstimatesFromDb, writeTeamEstimates,
} from "../lib/potentialEstimateWriter.js";
import { loadEstimateRiders } from "../lib/sundayPotentialEstimateSweep.js";
import { privateConfigHash, readPrivateConfig } from "../lib/privateConfig.ts";
import { readDevelopmentXpParams } from "../lib/developmentXpFlag.ts";
import { validateDevelopmentXpParams } from "../lib/developmentXp.ts";

export const BACKFILL_TRIGGER = "backfill";

// De eneste felter, der må forlade serveren (gate H4, publicEstimateView).
export const PUBLIC_VIEW_KEYS = Object.freeze(["hidden", "value", "certainty", "previousValue", "previousCertainty", "changedAt"]);

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

/**
 * Hvad backfill'en regner med. { ok: true, config, truth } eller { ok: false, reason }.
 *
 * apply: præcis søndagskørslens konfiguration (loadEstimateWriteConfig) og kun med
 * XP-modellen gældende, fordi det sande tal under XP er det forventede topniveau.
 * dry-run: må køre før tænding; private filer vinder over private_config.
 */
export async function resolveBackfillConfig(supabase, {
  apply = false, now = new Date(), params = null, developmentXp = null, assumeXp = false, log = console,
} = {}) {
  if (apply) {
    if (params || developmentXp || assumeXp) return { ok: false, reason: "private_files_not_allowed_with_apply" };
    const config = await loadEstimateWriteConfig(supabase, { now });
    if (!config.enabled) return { ok: false, reason: config.reason };
    if (!config.developmentXp) return { ok: false, reason: "xp_not_live" };
    return { ok: true, truth: "expected_top", config: { ...config, truthCache: new Map() } };
  }

  let estimateParams = params;
  if (estimateParams) {
    try { validateParams(estimateParams); } catch (err) { return { ok: false, reason: "params_invalid", detail: err.message }; }
  } else {
    estimateParams = await readPrivateConfig(supabase, POTENTIAL_ESTIMATE_PARAMS_KEY);
    if (!estimateParams) return { ok: false, reason: "params_missing" };
  }

  let xp = null;
  if (developmentXp) {
    xp = validateDevelopmentXpParams(developmentXp);
    if (!xp) return { ok: false, reason: "xp_params_invalid" };
  } else {
    xp = await loadEstimateDevelopmentXp(supabase, { now, log });
    if (!xp && assumeXp) xp = await readDevelopmentXpParams({ supabase, log });
    if (!xp && assumeXp) return { ok: false, reason: "xp_params_missing" };
  }

  const config = { enabled: true, params: estimateParams, paramsVersion: privateConfigHash(estimateParams), truthCache: new Map() };
  return { ok: true, truth: xp ? "expected_top" : "talent_ceiling", config: xp ? { ...config, developmentXp: xp } : config };
}

// ---------------------------------------------------------------------------
// Gaterne (rene funktioner)
// ---------------------------------------------------------------------------

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : null;
  return { n: sorted.length, mean, p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.at(-1) ?? null };
}

const status = (pass, hasLimit) => (!hasLimit ? "no_limit" : pass ? "green" : "red");

// Videns-stigen for H3 og H6: kig med standardscout, derefter egne afregnede datoer.
function knowledgeLadder(params) {
  const ladder = [];
  for (let looks = 1; looks <= params.scout.maxLooks; looks++) {
    ladder.push({ key: `scout${looks}`, knowledge: { own: false, looks, bestScoutTier: params.scout.defaultTier } });
  }
  for (const step of params.own.steps) {
    const dates = Math.max(step.fromDates, params.own.firstEstimateDates);
    ladder.push({ key: `own${dates}`, knowledge: { own: true, trainingDates: dates, staffSpeed: 0 } });
  }
  return ladder;
}

/**
 * Gaterne på de planlagte rækker. `rows` er rækker som planEstimateWrite giver dem
 * (ceiling_at_write = det sande tal). `h2Writes` er antallet af rækker, en søndag
 * uden ny viden ville skrive oven på dem. `limits` er private (kan være null: så
 * måles der, men intet dømmes).
 *
 * limits:
 *   h1: { [ord]: { p90Max } }
 *   h6: { attackMinRatio, poolMinRatio }   angrebets/sammenlægningens p50-fejl
 *                                          mod bedste enkelt-skøns p50-fejl
 */
export function evaluateEstimateGates(rows, { params, limits = null, h2Writes = 0 } = {}) {
  const list = rows ?? [];
  const errorOf = (row) => Math.abs(Number(row.value) - Number(row.ceiling_at_write));

  // H1
  const h1 = {};
  let h1Pass = true;
  let h1HasLimit = false;
  for (const word of CERTAINTY_WORDS) {
    const stats = summarize(list.filter((row) => row.certainty === word).map(errorOf));
    const max = limits?.h1?.[word]?.p90Max;
    const hasLimit = typeof max === "number";
    const pass = !hasLimit || stats.n === 0 || stats.p90 <= max;
    h1HasLimit ||= hasLimit;
    h1Pass &&= pass;
    h1[word] = { ...stats, status: status(pass, hasLimit) };
  }

  // H2
  const h2 = { writes: h2Writes, status: h2Writes === 0 ? "green" : "red" };

  // H3: samme (rytter, hold, sandt tal) op ad videns-stigen.
  const ladder = knowledgeLadder(params);
  const errorsByStep = ladder.map(() => []);
  let wordRegressions = 0;
  const rank = { unsure: 0, fair: 1, sure: 2 };
  for (const row of list) {
    let lastRank = -1;
    ladder.forEach((step, i) => {
      const est = estimatePotential({
        truePot: row.ceiling_at_write, currentRating: 1, riderId: row.rider_id, teamId: row.team_id, knowledge: step.knowledge,
      }, params);
      if (est.hidden) return;
      errorsByStep[i].push(Math.abs(est.value - row.ceiling_at_write));
      // Inden for kig og inden for egne datoer må ordet aldrig blive mindre sikkert.
      const sameTrack = i > 0 && ladder[i - 1].knowledge.own === step.knowledge.own;
      if (sameTrack && rank[est.certainty] < lastRank) wordRegressions += 1;
      lastRank = rank[est.certainty];
    });
  }
  const meanByStep = ladder.map((step, i) => ({ step: step.key, ...summarize(errorsByStep[i]) }));
  let meanIncreases = 0;
  for (let i = 1; i < ladder.length; i++) {
    const sameTrack = ladder[i - 1].knowledge.own === ladder[i].knowledge.own;
    const prev = meanByStep[i - 1].mean;
    const cur = meanByStep[i].mean;
    if (sameTrack && prev != null && cur != null && cur > prev + 1e-9) meanIncreases += 1;
  }
  const h3 = { meanByStep, meanIncreases, wordRegressions, status: meanIncreases === 0 && wordRegressions === 0 ? "green" : "red" };

  // H4: den offentlige visning af hver række.
  let leaks = 0;
  for (const row of list) {
    const view = publicEstimateView(row, { currentRating: 1 });
    if (Object.keys(view).some((key) => !PUBLIC_VIEW_KEYS.includes(key))) leaks += 1;
  }
  const h4 = { leaks, status: leaks === 0 ? "green" : "red" };

  // H6a: to-niveau-angrebet E = T + z·u løst for T med et kig og fulde kig.
  const low = { own: false, looks: 1, bestScoutTier: params.scout.defaultTier };
  const high = { own: false, looks: params.scout.maxLooks, bestScoutTier: params.scout.defaultTier };
  const u1 = uncertaintyFor(low, params);
  const u2 = uncertaintyFor(high, params);
  const attack = [];
  const best = [];
  if (u1 != null && u2 != null && u1 !== u2) {
    for (const row of list) {
      const args = { truePot: row.ceiling_at_write, currentRating: 1, riderId: row.rider_id, teamId: row.team_id };
      const e1 = estimatePotential({ ...args, knowledge: low }, params).value;
      const e2 = estimatePotential({ ...args, knowledge: high }, params).value;
      attack.push(Math.abs((e1 * u2 - e2 * u1) / (u2 - u1) - row.ceiling_at_write));
      best.push(Math.abs(e2 - row.ceiling_at_write));
    }
  }
  // H6b: sammenlægning af flere holds gemte skøn på samme rytter.
  const byRider = new Map();
  for (const row of list) {
    if (!byRider.has(row.rider_id)) byRider.set(row.rider_id, []);
    byRider.get(row.rider_id).push(row);
  }
  const pooled = [];
  const bestSingle = [];
  for (const group of byRider.values()) {
    if (group.length < 2) continue;
    const truth = Number(group[0].ceiling_at_write);
    const mean = group.reduce((sum, row) => sum + Number(row.value), 0) / group.length;
    pooled.push(Math.abs(mean - truth));
    bestSingle.push(Math.min(...group.map(errorOf)));
  }
  const attackStats = summarize(attack);
  const bestStats = summarize(best);
  const pooledStats = summarize(pooled);
  const singleStats = summarize(bestSingle);
  const ratio = (a, b) => (a.p50 == null || b.p50 == null || b.p50 === 0 ? null : a.p50 / b.p50);
  const attackRatio = ratio(attackStats, bestStats);
  const poolRatio = ratio(pooledStats, singleStats);
  const attackMin = limits?.h6?.attackMinRatio;
  const poolMin = limits?.h6?.poolMinRatio;
  const h6HasLimit = typeof attackMin === "number" || typeof poolMin === "number";
  const h6Pass = (typeof attackMin !== "number" || attackRatio == null || attackRatio >= attackMin)
    && (typeof poolMin !== "number" || poolRatio == null || poolRatio >= poolMin);
  const h6 = {
    attack: attackStats, bestSingleLevel: bestStats, attackRatio,
    pooled: pooledStats, bestSingleTeam: singleStats, poolRatio,
    status: status(h6Pass, h6HasLimit),
  };

  return {
    h1: { byWord: h1, status: status(h1Pass, h1HasLimit) },
    h2, h3, h4,
    h5: { status: "covered_by_tests", note: "potentialEstimateRead.test.js" },
    h6,
  };
}

// ---------------------------------------------------------------------------
// Kørslen
// ---------------------------------------------------------------------------

/**
 * Regner skønnet for alle ryttere på alle menneskehold. Dry-run skriver intet.
 * Returnerer en rapport med tællinger; `rows` og `gates` er private og skrives kun
 * til --out af CLI'en.
 */
export async function runPotentialEstimateBackfill({
  supabase, apply = false, now = new Date(), params = null, developmentXp = null, assumeXp = false,
  limits = null, withGates = false, log = console, clock = () => performance.now(),
}) {
  const startedAt = clock();
  const mode = apply ? "apply" : "dry-run";
  const resolved = await resolveBackfillConfig(supabase, { apply, now, params, developmentXp, assumeXp, log });
  if (!resolved.ok) return { ran: false, mode, reason: resolved.reason, ...(resolved.detail ? { detail: resolved.detail } : {}) };
  const { config, truth } = resolved;
  const xp = Boolean(config.developmentXp);

  const teamIds = await loadEstimateTeamIds(supabase);
  const totals = { riders: 0, written: 0, changed: 0, kept: 0, noKnowledge: 0, noCeiling: 0 };
  const byCertainty = Object.fromEntries(CERTAINTY_WORDS.map((word) => [word, 0]));
  const plannedRows = [];
  let h2Writes = 0;
  let failedTeams = 0;
  let firstError = null;

  for (const teamId of teamIds) {
    try {
      const riders = await loadEstimateRiders(supabase, teamId, { xp });
      totals.riders += riders.length;
      if (apply) {
        const counts = await writeTeamEstimates({ supabase, teamId, riders, trigger: BACKFILL_TRIGGER, config, now });
        for (const key of ["written", "changed", "kept", "noKnowledge", "noCeiling"]) totals[key] += counts[key];
        continue;
      }
      const { rows, counts, context } = await planTeamEstimatesFromDb({ supabase, teamId, riders, trigger: BACKFILL_TRIGGER, config, now });
      for (const key of ["written", "changed", "kept", "noKnowledge", "noCeiling"]) totals[key] += counts[key];
      for (const row of rows) byCertainty[row.certainty] += 1;
      if (withGates && context) {
        plannedRows.push(...rows);
        // H2: en søndag lige efter, uden ny viden og med samme sande tal, skriver intet.
        const storedByRider = new Map(context.storedByRider);
        for (const row of rows) storedByRider.set(row.rider_id, row);
        h2Writes += planTeamEstimates({ ...context, storedByRider, trigger: "sunday" }).counts.written;
      }
    } catch (err) {
      // best-effort: ét hold må ikke vælte resten; fejlen tælles, og en ny kørsel
      // tager holdet igen (idempotent).
      failedTeams += 1;
      firstError ??= err.message;
      log?.error?.(`  potential estimate backfill failed for team ${teamId}: ${err.message}`);
    }
  }

  const report = {
    ran: true, mode, truth, paramsVersion: config.paramsVersion, computedAt: now.toISOString(),
    teams: teamIds.length, ...totals, byCertainty: apply ? null : byCertainty,
    failedTeams, ...(firstError ? { firstError } : {}),
    seconds: Math.round((clock() - startedAt) / 100) / 10,
  };
  if (withGates && !apply) {
    report.gates = evaluateEstimateGates(plannedRows, { params: config.params, limits, h2Writes });
    report.rows = plannedRows;
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => !a.includes("=")));
  const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  return {
    apply: flags.has("--apply"),
    ownerGo: flags.has("--owner-go"),
    assumeXp: flags.has("--assume-xp"),
    paramsFile: value("params-file"),
    xpParamsFile: value("xp-params-file"),
    gatesFile: value("gates-file"),
    out: value("out"),
  };
}

/** --out skal ligge i balance-internals/ (gitignoreret, hard rule 17). */
export function isPrivateOutDir(dir) {
  if (!dir) return false;
  return resolve(dir).split(sep).includes("balance-internals");
}

// En privat fil er JSON eller et modul. Et modul kan eksportere tallene som default
// eller, for XP-tallene, som XP_PRIVATE.xp (formen i balance-internals/6110/xp-params.mjs).
async function readPrivateFile(file) {
  if (!file) return null;
  if (extname(file) === ".json") return JSON.parse(readFileSync(file, "utf8"));
  const mod = await import(pathToFileURL(resolve(file)).href);
  return mod.default ?? mod.XP_PRIVATE?.xp ?? null;
}

const GATE_KEYS = ["h1", "h2", "h3", "h4", "h5", "h6"];

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(here, "..", ".env"), quiet: true });
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.ownerGo) {
    console.error("--apply kræver --owner-go (ejerens ordrette \"kør\" efter at have set dry-run'et).");
    process.exit(2);
  }
  if (args.out && !isPrivateOutDir(args.out)) {
    console.error("--out skal ligge i balance-internals/ (private tal, hard rule 17).");
    process.exit(2);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const report = await runPotentialEstimateBackfill({
    supabase,
    apply: args.apply,
    params: await readPrivateFile(args.paramsFile),
    developmentXp: await readPrivateFile(args.xpParamsFile),
    assumeXp: args.assumeXp,
    limits: await readPrivateFile(args.gatesFile),
    withGates: !args.apply && Boolean(args.out),
  });
  if (!report.ran) {
    console.error(`#7685 backfill (${report.mode}) kørte ikke: ${report.reason}${report.detail ? ` (${report.detail})` : ""}`);
    process.exit(1);
  }
  const { rows, gates, byCertainty, ...summary } = report;
  console.log(`#7685 backfill af potentiale-skøn (${report.mode.toUpperCase()}), sandt tal: ${report.truth}`);
  console.log(JSON.stringify(summary, null, 2));
  if (gates) console.log(`Gater: ${GATE_KEYS.map((key) => `${key.toUpperCase()} ${gates[key].status}`).join(" · ")}`);
  if (args.apply) console.log(`Rul tilbage: slet rækker med write_reason = '${BACKFILL_TRIGGER}' og computed_at = '${report.computedAt}'.`);
  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    const file = join(args.out, `potential-estimate-backfill-${report.computedAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ ...summary, byCertainty, gates, rows }, null, 2));
    console.log(`Privat rapport: ${file}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}
