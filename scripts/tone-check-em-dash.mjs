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
//   3. frontend/index.html — player-facing meta-tags (description, og/twitter)
//      + <title>. HTML-kommentarer strippes (samme princip som §2: kommentarer
//      er ikke player-facing). Tilføjet efter en em-dash slap forbi i
//      <meta name="description"> fordi guarden kun dækkede §1+§2.
//
// Brug:
//   node scripts/tone-check-em-dash.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = "frontend/public/locales";
const PROSE_FILES = [
  "frontend/src/pages/PatchNotesPage.jsx",
  "frontend/src/pages/PrivacyPolicyPage.jsx",
  "frontend/src/pages/PrivacyPolicyPageEn.jsx",
];
const HTML_FILES = ["frontend/index.html"];

const EM_DASH = "—";

// ---------- 1. Locale-JSON ----------

function walkJson(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function checkValue(value, path, file, violations) {
  if (typeof value === "string") {
    if (value.includes(EM_DASH) && value.trim() !== EM_DASH) {
      violations.push(
        `${file} → ${path}: ${JSON.stringify(value.slice(0, 80))}`,
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(v, `${path}[${i}]`, file, violations));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      checkValue(v, path ? `${path}.${k}` : k, file, violations);
    }
  }
}

export function findLocaleEmDashViolations(value, file) {
  const violations = [];
  checkValue(value, "", file, violations);
  return violations;
}

// ---------- 2. Prosa-sider (string-literals, ikke kommentarer) ----------

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function findProseEmDashViolations(source, file) {
  const violations = [];
  const src = stripComments(source);
  src.split("\n").forEach((line, i) => {
    const literals = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || [];
    for (const lit of literals) {
      const content = lit.slice(1, -1);
      if (content.trim() === EM_DASH) continue; // standalone tom-værdi-glyf
      // Fjern glyf-citationer ('—') før check — prosa der OMTALER glyffen er ok.
      const remaining = content.replaceAll(`'${EM_DASH}'`, "");
      if (remaining.includes(EM_DASH)) {
        violations.push(`${file}:${i + 1}: ${lit.slice(0, 80)}`);
      }
    }
  });
  return violations;
}

// ---------- 3. index.html (meta-tags, ikke HTML-kommentarer) ----------

// Erstat hver HTML-kommentar med blanktegn men bevar newlines, så
// linjenumre i fund-rapporten matcher kildefilen.
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

export function findHtmlEmDashViolations(source, file) {
  const violations = [];
  const src = stripHtmlComments(source);
  src.split("\n").forEach((line, i) => {
    if (line.includes(EM_DASH) && line.trim() !== EM_DASH) {
      violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
    }
  });
  return violations;
}

// ---------- Resultat ----------

function runToneCheck() {
  const violations = [];

  for (const file of walkJson(join(ROOT, LOCALES_DIR))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    violations.push(
      ...findLocaleEmDashViolations(
        JSON.parse(readFileSync(file, "utf8")),
        rel,
      ),
    );
  }

  for (const relFile of PROSE_FILES) {
    violations.push(
      ...findProseEmDashViolations(
        readFileSync(join(ROOT, relFile), "utf8"),
        relFile,
      ),
    );
  }

  for (const relFile of HTML_FILES) {
    violations.push(
      ...findHtmlEmDashViolations(
        readFileSync(join(ROOT, relFile), "utf8"),
        relFile,
      ),
    );
  }

  if (violations.length) {
    console.error(
      `tone-check-em-dash: ${violations.length} em-dash-fund i player-facing copy:\n`,
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      "\nRegel: docs/TONE_OF_VOICE.md §Punktuation — brug komma, punktum, kolon" +
        "\neller parentes. Enkeltstående `—` som tom-værdi-glyf er tilladt.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "tone-check-em-dash: OK — ingen em-dash i player-facing copy (locales + prosa-sider + index.html).",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runToneCheck();
}
