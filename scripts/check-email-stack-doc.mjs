#!/usr/bin/env node
// Forward-guard for docs/EMAIL_STACK.md (#5048).
//
// PROBLEM: EMAIL_STACK.md er SSOT for mail, og dens §2-tabel er den eneste
// samlede oversigt over hvilke mailtyper der findes og hvilket app_config-flag
// hver af dem haenger paa. Tilfoejes en fjerde type i koden (fx `winback`)
// uden at §2 opdateres, driver dokumentet stille fra virkeligheden, og den
// naeste laeser tror listen er komplet.
//
// FIX: laes sandheden fra koden og kraev at hver vaerdi er naevnt i §2.
//   - TEMPLATE_TYPES fra backend/lib/emailTemplates.js
//   - EMAIL_LOOP_TYPE_KEYS' vaerdier + EMAIL_LOOP_FLAG_KEY fra
//     backend/lib/emailLoopFlag.js
//
// Begge filer laeses som TEKST og parses med regex. De importeres bevidst
// IKKE: emailTemplates.js importerer emailWordmarkAsset.js, som er genereret
// og forudsaetter et bygget asset, og et docs-tjek maa aldrig kunne fejle paa
// en byggeartefakt. Ingen netvaerk, ingen database.
//
// Exit 0 = alt naevnt. Exit 1 = drift (eller en fil/afsnit der ikke kunne
// laeses, hvilket ogsaa er drift: saa er guarden selv forkert).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOC_PATH = join(repoRoot, "docs", "EMAIL_STACK.md");
const TEMPLATES_PATH = join(repoRoot, "backend", "lib", "emailTemplates.js");
const FLAG_PATH = join(repoRoot, "backend", "lib", "emailLoopFlag.js");

const errors = [];

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    errors.push(`Kunne ikke laese ${label} (${path}): ${err.message}`);
    return null;
  }
}

/** Alle strengliterals i den foerste [...] efter et navn. */
function extractArrayStrings(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=[^[]*\\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Alle vaerdier i den foerste {...} efter et navn (nøgle: "vaerdi"). */
function extractObjectValues(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=[^{]*\\{([^}]*)\\}`));
  if (!match) return null;
  return [...match[1].matchAll(/:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** En enkelt strengkonstant: NAME = "value". */
function extractStringConst(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`));
  return match ? match[1] : null;
}

/** §2-afsnittet: fra "## 2." til naeste "## " paa linjestart. */
function extractSection2(doc) {
  const start = doc.search(/^## 2\..*$/m);
  if (start === -1) return null;
  const rest = doc.slice(start + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

const templatesSource = read(TEMPLATES_PATH, "emailTemplates.js");
const flagSource = read(FLAG_PATH, "emailLoopFlag.js");
const doc = read(DOC_PATH, "docs/EMAIL_STACK.md");

const templateTypes = templatesSource ? extractArrayStrings(templatesSource, "TEMPLATE_TYPES") : null;
if (templatesSource && (!templateTypes || templateTypes.length === 0)) {
  errors.push("Kunne ikke finde TEMPLATE_TYPES i backend/lib/emailTemplates.js");
}

const flagKeys = flagSource ? extractObjectValues(flagSource, "EMAIL_LOOP_TYPE_KEYS") : null;
if (flagSource && (!flagKeys || flagKeys.length === 0)) {
  errors.push("Kunne ikke finde EMAIL_LOOP_TYPE_KEYS i backend/lib/emailLoopFlag.js");
}
const legacyKey = flagSource ? extractStringConst(flagSource, "EMAIL_LOOP_FLAG_KEY") : null;
if (flagSource && !legacyKey) {
  errors.push("Kunne ikke finde EMAIL_LOOP_FLAG_KEY i backend/lib/emailLoopFlag.js");
}

const section2 = doc ? extractSection2(doc) : null;
if (doc && !section2) {
  errors.push('Kunne ikke finde "## 2." i docs/EMAIL_STACK.md (mailtype-afsnittet)');
}

if (section2) {
  const allFlagKeys = [...(flagKeys || []), ...(legacyKey ? [legacyKey] : [])];
  for (const type of templateTypes || []) {
    if (!section2.includes(type)) {
      errors.push(`Mailtypen "${type}" (TEMPLATE_TYPES) er ikke naevnt i EMAIL_STACK.md §2`);
    }
  }
  for (const key of allFlagKeys) {
    if (!section2.includes(key)) {
      errors.push(`Flag-noeglen "${key}" (emailLoopFlag.js) er ikke naevnt i EMAIL_STACK.md §2`);
    }
  }
}

if (errors.length) {
  console.error("check-email-stack-doc: drift mellem kode og docs/EMAIL_STACK.md\n");
  for (const line of errors) console.error(`  - ${line}`);
  console.error("\nRet §2-tabellen i docs/EMAIL_STACK.md, saa den daekker alle typer og flag-noegler.");
  process.exit(1);
}

console.log(
  `check-email-stack-doc: OK. ${(templateTypes || []).length} mailtype(r) og ` +
    `${(flagKeys || []).length + (legacyKey ? 1 : 0)} flag-noegle(r) er daekket af EMAIL_STACK.md §2.`
);
