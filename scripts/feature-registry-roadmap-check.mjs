#!/usr/bin/env node
// scripts/feature-registry-roadmap-check.mjs
// ============================================================
// CI-gate: et spillervendt flag skal have roadmap-tekst i registret (#6693).
//
// HVORFOR: stage_page_v2 og training_bulk_day gik i beta i prod uden et
// roadmap-punkt, saa spillerne kunne ikke se dem. Teksten skal derfor skrives
// (og godkendes af ejeren) i SAMME PR som flaget; roadmap-sync-registry.mjs
// opretter punktet efter merge, og triggeren paa app_config flytter det til
// beta/shipped naar flaget flippes.
//
// REGLEN "spillervendt" (afledt af registrets eksisterende felter):
//   flag er sat                      - der findes en kontakt der kan gaa i beta
//   area er ikke ops                 - ops = intern drift, spillerne ser den ikke
//   state er building/dormant/beta   - paa vej ud til spillerne, eller ude i beta
// live/retired er undtaget: de er allerede ude (eller vaek), og et nyt punkt
// for dem ville kun fylde "Faerdigt"-listen. Et flag der ikke er spillervendt,
// hoerer under area: ops.
//
// HVORNAAR teksten KRAEVES: foerst ved state: beta (flippet er ejer-only, og
// registret opdateres i samme PR, hard rule 30e). For building/dormant giver
// gaten kun en ADVARSEL: et krav allerede ved byg ville presse agenter til at
// skrive spillertekst, ejeren ikke har godkendt. Sync opretter punktet skjult
// uanset state; det bliver synligt naar flaget gaar i beta eller on.
//
// BASELINE (skralde, maa kun skrumpe): scripts/feature-registry-roadmap-baseline.json
// lister de poster der manglede tekst da gaten kom. De fejler ikke, men:
//   - en post der ikke laengere mangler tekst (tekst skrevet, gaaet live,
//     slettet) SKAL fjernes fra baseline, ellers fejler gaten;
//   - med --base-ref <ref> sammenlignes baseline med samme fil paa <ref>, og
//     nye id'er i baseline fejler (CI henter origin/main til formaalet).
//
// Brug:
//   node scripts/feature-registry-roadmap-check.mjs                     # gate
//   node scripts/feature-registry-roadmap-check.mjs --base-ref origin/main
//   node scripts/feature-registry-roadmap-check.mjs --update-baseline   # fjern kun forældede id'er
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_PATH, parseRegistry } from "./generate-feature-status.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const BASELINE_PATH = join(HERE, "feature-registry-roadmap-baseline.json");
const BASELINE_GIT_PATH = "scripts/feature-registry-roadmap-baseline.json";

export const NON_PLAYER_AREAS = ["ops"];
export const PRE_LIVE_STATES = ["building", "dormant", "beta"];
/** States hvor teksten kraeves (fejl); de oevrige PRE_LIVE_STATES giver kun en advarsel. */
export const REQUIRED_STATES = ["beta"];

/** @param {Record<string, string>} e */
export function isPlayerFacingFlag(e) {
  return Boolean(e.flag) && !NON_PLAYER_AREAS.includes(e.area) && PRE_LIVE_STATES.includes(e.state);
}

/** @param {Record<string, string>} e */
export function requiresRoadmapText(e) {
  return isPlayerFacingFlag(e) && REQUIRED_STATES.includes(e.state);
}

/** @param {Record<string, string>} e */
export function hasRoadmapText(e) {
  return Boolean(e.roadmap_en && e.roadmap_da);
}

/** Id'er paa spillervendte flag i beta uden roadmap-tekst, sorteret. */
export function missingRoadmapText(entries) {
  return entries
    .filter((e) => requiresRoadmapText(e) && !hasRoadmapText(e))
    .map((e) => e.id)
    .sort();
}

/** Id'er paa spillervendte flag under byg (building/dormant) uden tekst endnu: kun advarsel. */
export function upcomingWithoutText(entries) {
  return entries
    .filter((e) => isPlayerFacingFlag(e) && !requiresRoadmapText(e) && !hasRoadmapText(e))
    .map((e) => e.id)
    .sort();
}

/**
 * @param {Array<Record<string, string>>} entries
 * @param {string[]} baselineIds
 * @returns {{ missing: string[], baselined: string[], stale: string[], warnings: string[] }}
 *   missing   = i beta, mangler tekst og staar ikke i baseline (fejl)
 *   baselined = i beta, mangler tekst, men staar i baseline (tilladt indtil videre)
 *   stale     = staar i baseline, men kraever ikke laengere tekst (fejl: fjern dem)
 *   warnings  = under byg uden tekst endnu (advarsel, aldrig fejl)
 */
export function checkRoadmapText(entries, baselineIds) {
  const base = new Set(baselineIds);
  const lacking = missingRoadmapText(entries);
  const lackingSet = new Set(lacking);
  return {
    missing: lacking.filter((id) => !base.has(id)),
    baselined: lacking.filter((id) => base.has(id)),
    stale: [...base].filter((id) => !lackingSet.has(id)).sort(),
    warnings: upcomingWithoutText(entries),
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

export function formatResult({ missing, baselined, stale, growth, warnings = [] }) {
  const lines = [];
  if (missing.length) {
    lines.push(`Spillervendte flag i beta uden roadmap-tekst (${missing.length}):`);
    lines.push(...missing.map((id) => `  - ${id}`));
    lines.push("  Fix: saet roadmap_en + roadmap_da (og evt. roadmap_horizon: next|later) paa posten i");
    lines.push("  docs/FEATURE_REGISTRY.yml, med teksten godkendt af ejeren. Er flaget ikke spillervendt: area: ops.");
  }
  if (stale.length) {
    lines.push(`Baseline indeholder poster der ikke laengere mangler tekst (${stale.length}):`);
    lines.push(...stale.map((id) => `  - ${id}`));
    lines.push("  Fix: node scripts/feature-registry-roadmap-check.mjs --update-baseline");
  }
  if (growth && growth.length) {
    lines.push(`Baseline er vokset (${growth.length}) - den maa kun skrumpe:`);
    lines.push(...growth.map((id) => `  - ${id}`));
    lines.push("  Fix: skriv roadmap-teksten i stedet for at tilfoeje posten til baseline.");
  }
  if (!lines.length) {
    lines.push(`Roadmap-tekst OK. Baseline: ${baselined.length} post(er) uden tekst endnu.`);
  }
  if (warnings.length) {
    lines.push(`Advarsel (fejler ikke): flag under byg uden roadmap-tekst endnu (${warnings.length}):`);
    lines.push(...warnings.map((id) => `  - ${id}`));
    lines.push("  Teksten kraeves foerst naar posten gaar i state: beta. Skriv den kun med ejerens godkendelse.");
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
  "Spillervendte flag i beta uden roadmap-tekst da gaten kom (#6693). Maa kun skrumpe: " +
  "node scripts/feature-registry-roadmap-check.mjs --update-baseline fjerner forældede id'er.";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  const baselineIds = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  const result = checkRoadmapText(entries, baselineIds);

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
    console.error(`feature-registry-roadmap-check fejlede: ${err.message}`);
    process.exit(1);
  }
}
