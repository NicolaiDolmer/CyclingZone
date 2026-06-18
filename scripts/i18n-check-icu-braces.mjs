#!/usr/bin/env node
// i18n ICU-brace-guard — Refs #1451/#1455/#1305.
//
// Projektet bruger i18next-icu (frontend/src/i18n/index.js: .use(ICU)) — ICU
// MessageFormat med ENKELT-klamme `{var}`. Standard-i18next dobbelt-klamme
// `{{var}}` interpoleres IKKE af ICU og rendres bogstaveligt i UI'et.
//
// Denne bug-klasse har bidt 3x på én dag (2026-06-18): board-timeline #1455
// ({{met}}/{{total}}), traenings-rapport #1305 ({{from}}->{{to}}), og en backwards-
// sweep fandt yderligere live/latente fund i transfers.json (Final Whistle
// "Season {{number}}") + rider.json (condition.injured). Learnings-filen
// 2026-06-18-i18next-icu-single-brace-interpolation.md foreslog netop denne guard.
//
// Regel: ingen `{{ident}}`-antipattern i locale-vaerdier. ICU-vaerdier med
// inline plural/select undtages (de er haand-authored ICU hvor `{{` kan optraede
// legitimt som submessage+placeholder, fx `{n, plural, other {{n}}}`).
//
// Brug:
//   node scripts/i18n-check-icu-braces.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = "frontend/public/locales";

// i18next dobbelt-klamme-antipattern: `{{ identifier }}` (evt. med dot-path).
const DOUBLE_BRACE_RE = /\{\{\s*[\w.]+\s*\}\}/;
// Inline ICU-konstruktioner — vaerdier med disse undtages (legitim nesting).
const ICU_CONSTRUCT_RE = /,\s*(plural|select|selectordinal)\s*,/;

export function valueHasDoubleBrace(value) {
  if (typeof value !== "string") return false;
  if (ICU_CONSTRUCT_RE.test(value)) return false; // haand-authored ICU — undtag
  return DOUBLE_BRACE_RE.test(value);
}

function checkValue(value, path, file, violations) {
  if (typeof value === "string") {
    if (valueHasDoubleBrace(value)) {
      violations.push(`${file} → ${path}: ${JSON.stringify(value.slice(0, 80))}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(v, `${path}[${i}]`, file, violations));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      checkValue(v, path ? `${path}.${k}` : k, file, violations);
    }
  }
}

// Pure: returnér liste af `path: value`-fund i ét parset locale-objekt.
export function findDoubleBraceViolations(value, file) {
  const violations = [];
  checkValue(value, "", file, violations);
  return violations;
}

function walkJson(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function runCheck() {
  const violations = [];
  for (const file of walkJson(join(ROOT, LOCALES_DIR))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    violations.push(...findDoubleBraceViolations(JSON.parse(readFileSync(file, "utf8")), rel));
  }

  if (violations.length) {
    console.error(`i18n-check-icu-braces: ${violations.length} dobbelt-klamme-fund (ICU interpolerer dem IKKE):\n`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      "\nRegel: projektet bruger i18next-icu (enkelt-klamme). Brug `{x}`, ikke `{{x}}`." +
      "\nTjek en nabo-noegle i samme namespace. Se .claude/learnings/2026-06-18-i18next-icu-single-brace-interpolation.md.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("i18n-check-icu-braces: OK — ingen dobbelt-klamme i locale-vaerdier (ICU enkelt-klamme).");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCheck();
}
