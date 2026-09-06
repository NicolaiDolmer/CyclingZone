#!/usr/bin/env node
// scripts/generate-feature-status.mjs
// ============================================================
// Genererer docs/FEATURE_STATUS.md ud fra docs/FEATURE_REGISTRY.yml (#4921).
//
// FEJLKLASSEN: FEATURE_STATUS.md var 33 KB prosa organiseret efter slices og
// PR-numre - et changelog forklaedt som status. Den drev, fordi ingen gate
// tjekkede den og fordi tilstand blev FORTALT i stedet for AFLEDT. Maalt 6/9
// stod fire lukkede epics som "deferred", et flag stod som gated false mens
// prod sagde on, og en afviklet feature stod som live.
//
// Loesningen er samme moenster som database/schema-snapshot.json +
// check-database-types-drift.mjs: én maskinlaesbar kilde, ét genereret
// dokument, og en CI-gate der fejler hvis de to divergerer.
//
// Brug:
//   node scripts/generate-feature-status.mjs           # skriv docs/FEATURE_STATUS.md
//   node scripts/generate-feature-status.mjs --check   # exit 1 hvis committet != genereret
//
// Ingen ny dependency: registret er et FLADT skema (liste af objekter med kun
// skalar-felter), saa parseren nedenfor daekker praecis den form. Roden har
// ingen YAML-parser, og #4551's dependency-disciplin gaelder ogsaa her.
//
// Refs #4921.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const REGISTRY_PATH = join(ROOT, "docs", "FEATURE_REGISTRY.yml");
export const OUTPUT_PATH = join(ROOT, "docs", "FEATURE_STATUS.md");

/** Kanonisk raekkefoelge. Ukendt area = fejl (skemaet er lukket, ikke frit). */
export const AREAS = [
  "race-engine",
  "race-day",
  "market",
  "squad",
  "training",
  "academy",
  "season",
  "economy",
  "club",
  "board",
  "social",
  "stats",
  "onboarding",
  "comms",
  "billing",
  "ops",
];

/**
 * Sorteringsraekkefoelge: mest live foerst, retired sidst.
 *
 * `dormant` (#4928) staar lige efter `beta`: bygget faerdigt og flag-styret,
 * men bevidst slukket - taettere paa "klar" end `building` ("nogen koder paa
 * det endnu"), som staar lige efter.
 */
export const STATES = ["live", "beta", "dormant", "building", "spec", "idea", "retired"];

const REQUIRED_FIELDS = ["id", "area", "title_en", "title_da", "state", "verified"];
const KNOWN_FIELDS = new Set([...REQUIRED_FIELDS, "flag", "ssot", "epic", "note"]);

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Minimal parser for registrets flade skema.
 *
 * Bevidst IKKE en generel YAML-parser: den forstaar praecis
 *   features:
 *     - id: foo
 *       area: bar
 * og intet andet. Alt efter "key: " er vaerdien raat (trimmet) - vi stripper
 * IKKE trailing "#...", fordi noter lovligt indeholder issue-referencer som
 * "PR #4913". Kun linjer hvis foerste ikke-blanke tegn er "#" er kommentarer.
 *
 * @param {string} source rå YAML
 * @returns {Array<Record<string, string>>}
 */
export function parseRegistry(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let inFeatures = false;
  let current = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (!inFeatures) {
      if (trimmed === "features:") inFeatures = true;
      continue;
    }

    const itemMatch = raw.match(/^ {2}- ([a-z_]+):\s*(.*)$/);
    if (itemMatch) {
      flush();
      current = {};
      current[itemMatch[1]] = unquote(itemMatch[2]);
      continue;
    }

    const fieldMatch = raw.match(/^ {4}([a-z_]+):\s*(.*)$/);
    if (fieldMatch) {
      if (!current) {
        throw new Error(`FEATURE_REGISTRY.yml linje ${i + 1}: felt uden for en post`);
      }
      if (current[fieldMatch[1]] !== undefined) {
        throw new Error(`FEATURE_REGISTRY.yml linje ${i + 1}: feltet "${fieldMatch[1]}" er sat to gange`);
      }
      current[fieldMatch[1]] = unquote(fieldMatch[2]);
      continue;
    }

    throw new Error(`FEATURE_REGISTRY.yml linje ${i + 1}: uventet form (fladt skema forventet): ${raw}`);
  }
  flush();
  return entries;
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * @param {Array<Record<string, string>>} entries
 * @returns {string[]} fejlbeskeder, tom liste = gyldigt register
 */
export function validate(entries) {
  const errors = [];
  const seen = new Set();
  for (const e of entries) {
    const label = e.id || "(post uden id)";
    for (const field of REQUIRED_FIELDS) {
      if (!e[field]) errors.push(`${label}: mangler paakraevet felt "${field}"`);
    }
    for (const field of Object.keys(e)) {
      if (!KNOWN_FIELDS.has(field)) errors.push(`${label}: ukendt felt "${field}"`);
    }
    if (e.id && !ID_RE.test(e.id)) errors.push(`${label}: id skal vaere kebab-case`);
    if (e.id && seen.has(e.id)) errors.push(`${label}: id findes to gange`);
    if (e.id) seen.add(e.id);
    if (e.area && !AREAS.includes(e.area)) errors.push(`${label}: ukendt area "${e.area}"`);
    if (e.state && !STATES.includes(e.state)) errors.push(`${label}: ukendt state "${e.state}"`);
    if (e.verified && !DATE_RE.test(e.verified)) errors.push(`${label}: verified skal vaere YYYY-MM-DD`);
    if (e.epic && !/^\d+$/.test(e.epic)) errors.push(`${label}: epic skal vaere et issue-nummer uden #`);
    if (e.note && e.note.includes("|")) errors.push(`${label}: note maa ikke indeholde | (bryder tabellen)`);
    if (e.state === "dormant" && !e.note) {
      errors.push(`${label}: state dormant kraever en note om hvem/hvad der flipper den (#4928)`);
    }
  }
  if (entries.length === 0) errors.push("registret er tomt");
  return errors;
}

function cell(value) {
  return value && value.length > 0 ? value : "-";
}

function ssotCell(ssot) {
  if (!ssot) return "-";
  // FEATURE_STATUS.md ligger selv i docs/, saa docs/X.md linkes som X.md.
  const rel = ssot.startsWith("docs/") ? ssot.slice("docs/".length) : `../${ssot}`;
  const name = ssot.split("/").pop();
  return `[${name}](${rel})`;
}

// Bart "#N", ikke et fuldt issue-link: 40+ links a 54 tegn kostede alene ~590
// tokens og skubbede den genererede fil over 3.000-tok-budgettet (#4921).
// Headeren fortaeller hvor numrene hoerer hjemme.
function epicCell(epic) {
  return epic ? `#${epic}` : "-";
}

/**
 * @param {Array<Record<string, string>>} entries
 * @returns {string} markdown
 */
export function render(entries) {
  const sorted = [...entries].sort((a, b) => {
    const areaDiff = AREAS.indexOf(a.area) - AREAS.indexOf(b.area);
    if (areaDiff !== 0) return areaDiff;
    const stateDiff = STATES.indexOf(a.state) - STATES.indexOf(b.state);
    if (stateDiff !== 0) return stateDiff;
    return a.id.localeCompare(b.id, "en");
  });

  const byState = new Map(STATES.map((s) => [s, 0]));
  for (const e of sorted) byState.set(e.state, byState.get(e.state) + 1);
  const summary = STATES.filter((s) => byState.get(s) > 0)
    .map((s) => `${s} ${byState.get(s)}`)
    .join(" · ");

  const out = [];
  out.push("# FEATURE STATUS");
  out.push("");
  out.push("> **GENERERET FIL - rediger den ALDRIG i haanden.**");
  out.push("> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)");
  out.push("> Regenerér: `node scripts/generate-feature-status.mjs`");
  out.push("> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`");
  out.push("");
  out.push(`${sorted.length} poster: ${summary}. Tilstand afledes af kode og prod-flag, aldrig af prosa.`);
  out.push("");
  out.push("Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.");
  out.push("");

  let currentArea = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const e = sorted[i];
    if (e.area !== currentArea) {
      currentArea = e.area;
      out.push(`## ${currentArea}`);
      out.push("");
      out.push("| Feature | State | Flag | SSOT | Epic | Verified | Note |");
      out.push("| --- | --- | --- | --- | --- | --- | --- |");
    }
    const flag = e.flag ? `\`${e.flag}\`` : "-";
    out.push(
      `| ${e.title_en} (\`${e.id}\`) | ${e.state} | ${flag} | ${ssotCell(e.ssot)} | ${epicCell(e.epic)} | ${e.verified} | ${cell(e.note)} |`,
    );
    if (sorted[i + 1]?.area !== e.area) out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

export function generate() {
  const source = readFileSync(REGISTRY_PATH, "utf8");
  const entries = parseRegistry(source);
  const errors = validate(entries);
  if (errors.length > 0) {
    const message = ["FEATURE_REGISTRY.yml er ugyldig:", ...errors.map((e) => `  - ${e}`)].join("\n");
    throw new Error(message);
  }
  return render(entries);
}

function main() {
  const check = process.argv.includes("--check");
  let markdown;
  try {
    markdown = generate();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!check) {
    writeFileSync(OUTPUT_PATH, markdown, "utf8");
    console.log(`Skrev ${OUTPUT_PATH.replace(ROOT, "").replace(/^[\\/]/, "")}`);
    return;
  }

  let committed;
  try {
    committed = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    console.error("docs/FEATURE_STATUS.md findes ikke. Koer: node scripts/generate-feature-status.mjs");
    process.exit(1);
  }
  // core.autocrlf kan give committet indhold CRLF i et Windows-checkout; gaten
  // skal doemme paa INDHOLD, ikke paa line endings (samme praemis som
  // check-agent-token-hygiene.ps1's normalisering).
  if (committed.replace(/\r\n/g, "\n") !== markdown.replace(/\r\n/g, "\n")) {
    console.error("docs/FEATURE_STATUS.md er IKKE i sync med docs/FEATURE_REGISTRY.yml.");
    console.error("Fix: node scripts/generate-feature-status.mjs && git add docs/FEATURE_STATUS.md");
    process.exit(1);
  }
  console.log("docs/FEATURE_STATUS.md er i sync med registret.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
