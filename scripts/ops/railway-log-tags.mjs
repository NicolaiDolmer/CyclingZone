#!/usr/bin/env node
/**
 * Cycling Zone - inventar over strukturerede log-tags i backendens runtime (#4453)
 * ================================================================================
 * Scanner backendens runtime-kode for `console.<niveau>("[tag] ...")` og
 * returnerer de distinkte tags. ALLE console-niveauer taeller: `classifyLine` i
 * railway-log-watch.mjs bucketer enhver linje der starter med `[tag]` uanset
 * niveau, saa en scanner der kun saa warn/error ville melde groent for tags der
 * fint kan udloese et fund. Review af PR #4469 fandt praecis den blinde vinkel:
 * `[discord-dm:stdout]` (console.log) og `[discord-dm:muted]` (console.info)
 * var usynlige for guarden og havde hverken taerskel eller ignore.
 *
 * Formaal (forward-guard): #4453 blev oprettet fordi flere issues investerede i
 * at goere en tavs fejlgren SYNLIG (#2817, #4165, #4369, #4451) og alle landede
 * i en logstroem uden modtager. Uden en guard gentager det sig hver gang nogen
 * tilfoejer et nyt `[tag]`. `railway-log-watch.test.mjs` fejler derfor hvis et
 * runtime-tag hverken har en taerskel eller staar paa ignore-listen i
 * `railway-log-thresholds.json`.
 *
 * Kun runtime-mapper scannes. `backend/scripts/` koerer via CLI/GitHub Actions
 * og naar aldrig Railways logstroem - fx findes `[fatal]` KUN der (issue-teksten
 * paastod at det var et runtime-signal; det er maalt forkert).
 *
 * Usage:
 *   node scripts/ops/railway-log-tags.mjs          # liste + antal kaldsteder
 *   node scripts/ops/railway-log-tags.mjs --json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

/**
 * Mapper/filer hvis output faktisk havner i Railways logstroem.
 * `backend/railway.json` starter processen som
 * `node --import ./instrument.mjs server.js`, og server.js importerer
 * `startCron` fra ./cron.js - begge filers output gaar direkte i logstroemmen.
 * Hver post SKAL findes; se assertRuntimePathsExist.
 */
export const RUNTIME_PATHS = [
  path.join("backend", "lib"),
  path.join("backend", "routes"),
  path.join("backend", "server.js"),
  path.join("backend", "cron.js"),
  path.join("backend", "instrument.mjs"),
];

/**
 * `console.<niveau>(` efterfulgt af en streng-literal der starter med `[tag]`.
 * `\s*` daekker at praefikset ofte staar paa naeste linje efter et linjebrud
 * fra prettier. Bemaerk: KUN en streng-literal som FOERSTE argument fanges -
 * `console.warn(PREFIX, "[tag] ...")` er usynlig for scanneren, saa skriv
 * altid tagget direkte i foerste argument.
 */
const CALL_RE = /console\.(?:warn|error|log|info|debug)\(\s*[`'"]\[([a-zA-Z0-9_:.\- ]{1,40})\]/g;

/**
 * En sti der ikke findes gav foer nul filer i stilhed, og en tom liste af tags
 * fik forward-guarden i railway-log-watch.test.mjs til at melde groent uden at
 * have scannet noget (bevist i review af PR #4469: de fire filer koert i et
 * traee uden backend/ gav 25/25 groent). Samme fejlklasse som resten af #4453:
 * et tomt maaleresultat maa aldrig kunne fremstaa som et sundt nul.
 * @param {string} root
 */
function assertRuntimePathsExist(root) {
  const missing = RUNTIME_PATHS.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (missing.length) {
    throw new Error(
      `RUNTIME_PATHS peger paa stier der ikke findes under ${root}: ${missing.join(", ")}. `
      + "Er backend-koden flyttet, saa opdatér RUNTIME_PATHS i scripts/ops/railway-log-tags.mjs - "
      + "ellers scanner tag-guarden mindre end den tror.",
    );
  }
}

function walk(target, out) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.(mjs|js)$/.test(target) && !/\.test\.(mjs|js)$/.test(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "tests") continue;
    walk(path.join(target, entry.name), out);
  }
  return out;
}

/**
 * @param {string} [root]
 * @returns {{tag:string, count:number}[]} sorteret efter antal kaldsteder
 */
export function collectRuntimeTags(root = REPO_ROOT) {
  assertRuntimePathsExist(root);
  const files = RUNTIME_PATHS.flatMap((rel) => walk(path.join(root, rel), []));
  const counts = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const match of src.matchAll(CALL_RE)) {
      const tag = match[1].trim();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function isMain() {
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

if (isMain()) {
  const tags = collectRuntimeTags();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(tags, null, 2));
  } else {
    for (const t of tags) console.log(`${String(t.count).padStart(3)}  ${t.tag}`);
    console.log(`\n${tags.length} distinkte tags, ${tags.reduce((n, t) => n + t.count, 0)} kaldsteder.`);
  }
}
