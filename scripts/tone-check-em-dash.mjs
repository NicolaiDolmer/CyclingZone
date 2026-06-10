#!/usr/bin/env node
// Tone-guard: ingen em-dash i player-facing copy — Refs #1172 / #671.
//
// Reglen (docs/TONE_OF_VOICE.md §Punktuation): em-dash (—) er forbudt i
// player-facing tekst; brug komma, punktum, kolon eller parentes.
// Undtagelse: et enkeltstående `—` som tom-værdi-glyf (tabel-celler,
// dropdowns, locale-nøgler som rankNone/salaryNone/dash/noBuyOption).
//
// Reglen har bidt 2x: 2026-06-04-audit registrerede den fejlagtigt som
// overholdt; 2026-06-09 fandt tone-sweepen (PR #1193) 229 live em-dashes i
// 39 locale-filer + 522 i PatchNotes-historikken. Dette script fryser den
// sweepede tilstand, så regressioner blokerer i CI i stedet for at kræve
// en ny manuel audit.
//
// Scope = de flader sweepen dækkede (player-facing prosa, ikke kodekommentarer):
//   1. frontend/public/locales/**/*.json — alle string-værdier rekursivt.
//      Tilladt: værdi der (trimmet) er præcis `—` (tom-værdi-glyffen).
//   2. Prosa-sider med hardkodet player-facing tekst (PatchNotes + privacy).
//      Scanner kun string-literals (kommentarer strippes). Tilladt: glyf-
//      CITATION `'—'` inde i prosa (fx "viste '—' i Løn-kolonnen") og
//      literals der i sig selv kun er glyffen.
//
// Brug:
//   node scripts/tone-check-em-dash.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = "frontend/public/locales";
const PROSE_FILES = [
  "frontend/src/pages/PatchNotesPage.jsx",
  "frontend/src/pages/PrivacyPolicyPage.jsx",
  "frontend/src/pages/PrivacyPolicyPageEn.jsx",
];

const EM_DASH = "—";

const violations = [];

// ---------- 1. Locale-JSON ----------

function walkJson(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function checkValue(value, path, file) {
  if (typeof value === "string") {
    if (value.includes(EM_DASH) && value.trim() !== EM_DASH) {
      violations.push(`${file} → ${path}: ${JSON.stringify(value.slice(0, 80))}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(v, `${path}[${i}]`, file));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) checkValue(v, path ? `${path}.${k}` : k, file);
  }
}

for (const file of walkJson(join(ROOT, LOCALES_DIR))) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  checkValue(JSON.parse(readFileSync(file, "utf8")), "", rel);
}

// ---------- 2. Prosa-sider (string-literals, ikke kommentarer) ----------

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

for (const relFile of PROSE_FILES) {
  const src = stripComments(readFileSync(join(ROOT, relFile), "utf8"));
  src.split("\n").forEach((line, i) => {
    const literals = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || [];
    for (const lit of literals) {
      const content = lit.slice(1, -1);
      if (content.trim() === EM_DASH) continue; // standalone tom-værdi-glyf
      // Fjern glyf-citationer ('—') før check — prosa der OMTALER glyffen er ok.
      const remaining = content.replaceAll(`'${EM_DASH}'`, "");
      if (remaining.includes(EM_DASH)) {
        violations.push(`${relFile}:${i + 1}: ${lit.slice(0, 80)}`);
      }
    }
  });
}

// ---------- Resultat ----------

if (violations.length) {
  console.error(`tone-check-em-dash: ${violations.length} em-dash-fund i player-facing copy:\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\nRegel: docs/TONE_OF_VOICE.md §Punktuation — brug komma, punktum, kolon" +
      "\neller parentes. Enkeltstående `—` som tom-værdi-glyf er tilladt."
  );
  process.exit(1);
}

console.log("tone-check-em-dash: OK — ingen em-dash i player-facing copy (locales + prosa-sider).");
