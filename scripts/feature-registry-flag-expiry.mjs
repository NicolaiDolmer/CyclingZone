#!/usr/bin/env node
// scripts/feature-registry-flag-expiry.mjs
// ============================================================
// CI-gate: en post der ikke er live skal have en plan og en frist (#6701).
//
// HVORFOR: "Vi skal helst ikke have funktioner gemt, som endnu ikke er live."
// Slukkede flag og halvfaerdigt arbejde blev liggende uden at nogen havde
// besluttet hvad der skulle ske. Hver post i building/dormant/beta skal derfor
// have `decision` (taend | goer-faerdigt | fjern | noedbremse | ejer-beslutning)
// og `decide_by` (YYYY-MM-DD) i docs/FEATURE_REGISTRY.yml.
//
// REGLEN: state building/dormant/beta (med eller uden flag) kraever begge felter.
//
// BASELINE (skralde, maa kun skrumpe): scripts/feature-registry-flag-expiry-baseline.json
// lister de eksisterende poster der mangler felterne da gaten kom. Ejeren
// beslutter dem een ad gangen; de fejler ikke, men:
//   - en post der ikke laengere mangler felterne (udfyldt, gaaet live, retired,
//     slettet) SKAL fjernes fra baseline, ellers fejler gaten;
//   - med --base-ref <ref> sammenlignes baseline med samme fil paa <ref>, og
//     nye id'er i baseline fejler (CI henter origin/main til formaalet).
//
// OVERSKREDNE FRISTER: poster med decide_by i fortiden LISTES (advarsel), men
// fejler ikke - ellers ville en forsinket ejer-beslutning blokere alle PR'er.
//
// Brug:
//   node scripts/feature-registry-flag-expiry.mjs                     # gate
//   node scripts/feature-registry-flag-expiry.mjs --base-ref origin/main
//   node scripts/feature-registry-flag-expiry.mjs --update-baseline   # fjern kun forældede id'er
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_PATH, parseRegistry } from "./generate-feature-status.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const BASELINE_PATH = join(HERE, "feature-registry-flag-expiry-baseline.json");
const BASELINE_GIT_PATH = "scripts/feature-registry-flag-expiry-baseline.json";

export const NOT_LIVE_STATES = ["building", "dormant", "beta"];

/** @param {Record<string, string>} e */
export function needsExpiry(e) {
  return NOT_LIVE_STATES.includes(e.state);
}

/** @param {Record<string, string>} e */
export function hasExpiry(e) {
  return Boolean(e.decision && e.decide_by);
}

/** Id'er paa ikke-live poster uden decision + decide_by, sorteret. */
export function missingExpiry(entries) {
  return entries
    .filter((e) => needsExpiry(e) && !hasExpiry(e))
    .map((e) => e.id)
    .sort();
}

/**
 * Ikke-live poster hvis decide_by er overskredet (strengt foer i dag), aeldste foerst.
 * @param {Array<Record<string, string>>} entries
 * @param {string} today YYYY-MM-DD
 */
export function overdue(entries, today) {
  return entries
    .filter((e) => needsExpiry(e) && e.decide_by && e.decide_by < today)
    .map((e) => ({ id: e.id, decision: e.decision || "-", decide_by: e.decide_by }))
    .sort((a, b) => a.decide_by.localeCompare(b.decide_by) || a.id.localeCompare(b.id));
}

/**
 * @param {Array<Record<string, string>>} entries
 * @param {string[]} baselineIds
 * @param {string} today YYYY-MM-DD
 * @returns {{ missing: string[], baselined: string[], stale: string[], overdue: Array<{id: string, decision: string, decide_by: string}> }}
 *   missing   = ikke-live, mangler felter og staar ikke i baseline (fejl)
 *   baselined = ikke-live, mangler felter, men staar i baseline (tilladt indtil videre)
 *   stale     = staar i baseline, men mangler ikke laengere felterne (fejl: fjern dem)
 *   overdue   = frist overskredet (advarsel, aldrig fejl)
 */
export function checkExpiry(entries, baselineIds, today) {
  const base = new Set(baselineIds);
  const lacking = missingExpiry(entries);
  const lackingSet = new Set(lacking);
  return {
    missing: lacking.filter((id) => !base.has(id)),
    baselined: lacking.filter((id) => base.has(id)),
    stale: [...base].filter((id) => !lackingSet.has(id)).sort(),
    overdue: overdue(entries, today),
  };
}

/** Id'er der er kommet TIL i baseline i forhold til base-ref'ens udgave. */
export function baselineGrowth(currentIds, previousIds) {
  const prev = new Set(previousIds);
  return currentIds.filter((id) => !prev.has(id)).sort();
}

export function parseBaseline(raw) {
  const json = JSON.parse(raw);
  if (!json || !Array.isArray(json.ids) || json.ids.some((id) => typeof id !== "string")) {
    throw new Error("baseline skal vaere { \"ids\": [string, ...] }");
  }
  return json.ids;
}

export function serializeBaseline(ids, comment) {
  return `${JSON.stringify({ _comment: comment, ids: [...ids].sort() }, null, 2)}\n`;
}

export function formatResult({ missing, baselined, stale, growth, overdue: late = [] }) {
  const lines = [];
  if (missing.length) {
    lines.push(`Ikke-live poster uden decision + decide_by (${missing.length}):`);
    lines.push(...missing.map((id) => `  - ${id}`));
    lines.push("  Fix: saet decision (taend | goer-faerdigt | fjern | noedbremse | ejer-beslutning) og decide_by");
    lines.push("  (YYYY-MM-DD) paa posten i docs/FEATURE_REGISTRY.yml.");
  }
  if (stale.length) {
    lines.push(`Baseline indeholder poster der ikke laengere mangler felterne (${stale.length}):`);
    lines.push(...stale.map((id) => `  - ${id}`));
    lines.push("  Fix: node scripts/feature-registry-flag-expiry.mjs --update-baseline");
  }
  if (growth && growth.length) {
    lines.push(`Baseline er vokset (${growth.length}) - den maa kun skrumpe:`);
    lines.push(...growth.map((id) => `  - ${id}`));
    lines.push("  Fix: saet decision + decide_by i stedet for at tilfoeje posten til baseline.");
  }
  if (!lines.length) {
    lines.push(`Udloebsregel OK. Baseline: ${baselined.length} post(er) uden decision/decide_by endnu.`);
  }
  if (late.length) {
    lines.push(`Advarsel (fejler ikke): frist overskredet (${late.length}):`);
    lines.push(...late.map((o) => `  - ${o.id}: ${o.decision}, decide_by ${o.decide_by}`));
    lines.push("  Beslut posten (taend, goer faerdig, fjern eller nodbremse) og opdater registret.");
  }
  return lines.join("\n");
}

function readBaselineAtRef(ref) {
  try {
    const raw = execFileSync("git", ["show", `${ref}:${BASELINE_GIT_PATH}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseBaseline(raw);
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const out = { baseRef: null, update: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--update-baseline") out.update = true;
    else if (a === "--base-ref") out.baseRef = argv[(i += 1)] || null;
    else if (a.startsWith("--base-ref=")) out.baseRef = a.slice("--base-ref=".length) || null;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return out;
}

const BASELINE_COMMENT =
  "Ikke-live poster uden decision/decide_by da gaten kom (#6701). Maa kun skrumpe: " +
  "node scripts/feature-registry-flag-expiry.mjs --update-baseline fjerner forældede id'er.";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  const baselineIds = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  const result = checkExpiry(entries, baselineIds, today);

  if (args.update) {
    if (result.missing.length) {
      console.error(formatResult({ ...result, stale: [] }));
      console.error("Naegter at opdatere baseline: den maa kun skrumpe.");
      process.exit(1);
    }
    writeFileSync(BASELINE_PATH, serializeBaseline(result.baselined, BASELINE_COMMENT), "utf8");
    console.log(`Baseline skrevet: ${result.baselined.length} id'er (${result.stale.length} fjernet).`);
    return;
  }

  let growth = [];
  if (args.baseRef) {
    const previous = readBaselineAtRef(args.baseRef);
    if (previous === null) {
      console.log(`Bemaerk: baseline findes ikke paa ${args.baseRef}; vaekst-tjekket springes over.`);
    } else {
      growth = baselineGrowth(baselineIds, previous);
    }
  }

  console.log(formatResult({ ...result, growth }));
  if (result.missing.length || result.stale.length || growth.length) process.exit(1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`feature-registry-flag-expiry fejlede: ${err.message}`);
    process.exit(1);
  }
}
