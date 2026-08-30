#!/usr/bin/env node
// scripts/check-eslint-disable-count.mjs
// ============================================================
// Ratchet-guard mod stille vaekst i antallet af eslint-disable-direktiver
// (#4332). Samme moenster som scripts/lint-ui-slop.mjs: en per-fil baseline
// i scripts/eslint-disable-baseline.json der KUN maa skrumpe. Guarden fejler
// paa en NY fil med >0 direktiver, eller flere direktiver i en kendt fil end
// baseline tillader.
//
// Naerpunkt (#4332, verificeret 30/8): 42 direktiver i frontend/src (alle
// `eslint-disable-next-line react-hooks/exhaustive-deps` linje-scopede) + 1 i
// backend (backend/lib/proxyBidding.js, no-unused-vars). Ingen file-wide/
// blanket-disables. DENNE guard laaser blot det nuvaerende tal — den
// gennemgaar IKKE om nogen af de 42 exhaustive-deps-disables skjuler en
// reel dependency-bug. Den gennemgang er sit eget stykke arbejde (se #4332)
// og udestaar bevidst her.
//
// Kun REELLE direktiver taeller (`eslint-disable`, `eslint-disable-line`,
// `eslint-disable-next-line` i direktiv-position foerst i en kommentar).
// Prosa-omtale af ordet i en almindelig kommentar (fx
// frontend/src/pages/ResultaterPage.jsx:179: "... genindfoerer et
// eslint-disable.") taeller IKKE med, fordi direktiv-syntaksen kraever at
// noegleordet efterfoelges af whitespace/komma/kommentar-slut — ikke af et
// punktum.
//
// Brug:
//   node scripts/check-eslint-disable-count.mjs                  # check (CI)
//   node scripts/check-eslint-disable-count.mjs --update-baseline # regenerér
//
// Exit codes:
//   0 — ingen nye direktiver ud over baseline
//   1 — nye/flere direktiver end baseline tillader
//
// Refs #4332.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "eslint-disable-baseline.json");
const SCAN_DIRS = ["frontend/src", "backend"];
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

// --- Detektor (ren funktion paa kildestrenge) ------------------------------

// Direktiv-noeglord skal staa foerst i en kommentar (`//` eller `/*`, evt.
// med whitespace foran) og efterfoelges af whitespace, komma, `*` (tæt
// block-kommentar-lukning: `/* eslint-disable-line*/`) eller linjeslut —
// ALDRIG af et andet tegn (fx punktum), hvilket er praecis det der
// adskiller den reelle syntaks fra prosa-omtale af samme ord.
const DIRECTIVE_RE = /(\/\/|\/\*)[ \t]*(eslint-disable(?:-next-line|-line)?)(?=[\s,*]|$)/g;

/**
 * Taeller reelle eslint-disable-direktiver i kildeteksten (line-baseret,
 * samme praecisions-niveau som de andre lint-*.mjs-guards i repoet — ikke en
 * fuld parser, men robust nok til den kodestil der faktisk bruges her).
 * @param {string} src
 * @returns {number}
 */
export function countDisableDirectives(src) {
  let n = 0;
  for (const line of src.split("\n")) {
    DIRECTIVE_RE.lastIndex = 0;
    let m;
    while ((m = DIRECTIVE_RE.exec(line)) !== null) n++;
  }
  return n;
}

// --- Fuld-repo-scan --------------------------------------------------------

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p, acc);
    } else if (SCAN_EXTS.has(extname(e))) {
      acc.push(p);
    }
  }
  return acc;
}

// Returnér { "<rel-sti>": count } for filer med >0 reelle direktiver.
export function scanRepo() {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const n = countDisableDirectives(readFileSync(file, "utf8"));
      if (n > 0) counts[rel] = n;
    }
  }
  return counts;
}

// --- Baseline-ratchet (kun stigninger fejler) ------------------------------

export function compareAgainstBaseline(findings, baseline) {
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, cur] of Object.entries(findings)) {
    const allowed = base[file] || 0;
    if (cur > allowed) {
      newViolations.push(`${file}: ${cur} (baseline tillader ${allowed}, +${cur - allowed} ny(e))`);
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const cur = findings[file] || 0;
    if (cur < allowed) {
      stale.push(`${file}: ${cur}/${allowed} tilbage (baseline kan strammes)`);
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = {};
  for (const file of Object.keys(findings).sort()) files[file] = findings[file];
  return {
    $comment:
      "Kendte eslint-disable-direktiver (ratchet — maa kun skrumpe). Genereret af scripts/check-eslint-disable-count.mjs --update-baseline. Refs #4332. Nye direktiver maa IKKE tilfoejes her uden en begrundelse i selve koden (hvorfor kan afhaengigheden ikke rettes i stedet) — den er som udgangspunkt et forward-guard, ikke en godkendelse af de eksisterende 42+1. Gennemgangen af om de eksisterende exhaustive-deps-disables skjuler en reel bug staar stadig aaben (#4332).",
    files,
  };
}

// --- Main -------------------------------------------------------------------

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findings = scanRepo();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    const total = Object.values(findings).reduce((s, c) => s + c, 0);
    console.log(`✅ Baseline skrevet til scripts/eslint-disable-baseline.json (${Object.keys(findings).length} filer, ${total} direktiver).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`ℹ️  ${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (fjernet disable) — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   → node scripts/check-eslint-disable-count.mjs --update-baseline");
  }

  if (newViolations.length) {
    console.error(`\n❌ ${newViolations.length} NY(T/E) eslint-disable-direktiv(er) (ikke i baseline):`);
    for (const v of newViolations) console.error(`   - ${v}`);
    console.error(`
Fix:
  - Ret den underliggende dependency-advarsel i stedet for at undertrykke den.
  - Legitim undtagelse? -> begrund i en kommentar ved direktivet, og opdatér
    baseline eksplicit: node scripts/check-eslint-disable-count.mjs --update-baseline
Baseline maa IKKE udvides stiltiende (ratchet, Refs #4332).`);
    process.exit(1);
  }

  const total = Object.values(findings).reduce((s, c) => s + c, 0);
  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\n✅ eslint-disable-guard: ingen nye direktiver (${total} i alt, ${knownFiles} kendte baseline-filer).`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
