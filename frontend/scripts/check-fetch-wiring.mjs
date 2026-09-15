#!/usr/bin/env node
// frontend/scripts/check-fetch-wiring.mjs
// ============================================================
// apiFetch forward-guard — #5242 (opfoelger #5089/#5233).
//
// REGEL: nye fetch-kaldsteder i frontend/src skal bruge apiFetch
// (frontend/src/lib/apiFetch.ts), ikke et bart `fetch(\`${API}...\`)`.
// apiFetch respekterer Retry-After paa 429 (stille backoff, intet nyt
// netvaerkskald foer vinduet er udloebet) og afleverer 401 ÉT sted til
// networkErrorGuards' session-rejected-kaede i stedet for at hvert
// kaldsted opfinder sin egen 401-haandtering.
//
// Praecis samme ratchet-form som scripts/lint-ui-slop.mjs og
// scripts/i18n-check-leaks.mjs: guarden er FORWARD-only. #5242 migrerede
// et foerste saet kaldsteder (dashboard, traening, auktioner, transfers,
// loebssiden, Layout.jsx); resten af de ca. 84 filer staar stadig i
// baseline'en og migreres i opfoelgende PR'er (se PR-body for #5242 PR 1/2).
// Guarden fejler KUN hvis en fil faar FLERE raa fetch(`${API}-kald end sin
// baseline tillader, eller en helt ny fil dukker op med saadanne kald.
//
// Tre kaldsteder er BEVIDST i baseline uden plan om at flytte dem: deres
// load()-funktioner skelner "parse"-fejl (malformet 200-krop) fra
// "network"-fejl til Sentry-telemetrien (#4165) — apiFetch sluger den
// skelnen (den parser altid selv og giver `data: null` for begge). At
// konvertere dem ville taebe en aegte fejlkategori, ikke kun tilfoeje
// backoff+401 (se RaceHubBoard.jsx/SeasonMatrix.jsx/SeasonView.jsx's
// egne #4165-kommentarer ved deres load()).
//
// Brug:
//   node scripts/check-fetch-wiring.mjs                  # check (lint + CI)
//   node scripts/check-fetch-wiring.mjs --update-baseline # regenerér baseline
//
// Refs #5242, #5089.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = join(FRONTEND_ROOT, "..");
const BASELINE_PATH = join(FRONTEND_ROOT, "scripts", "fetch-wiring-baseline.json");
const SRC_DIR = join(FRONTEND_ROOT, "src");

// Raw `fetch(`${API}` — ikke `apiFetch(`${API}` (negativ lookbehind på et
// ord-tegn foran "fetch" udelukker det uden at afhænge af caps).
const RAW_FETCH_RE = /(?<![A-Za-z0-9_])fetch\(`\$\{API\}/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "dist-ssr") continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry) && !/\.(test|spec)\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scanRepo() {
  const findings = {};
  for (const file of walk(SRC_DIR)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    const src = readFileSync(file, "utf8");
    const matches = src.match(RAW_FETCH_RE);
    if (matches && matches.length) findings[rel] = matches.length;
  }
  return findings;
}

function compareAgainstBaseline(findings, baseline) {
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, count] of Object.entries(findings)) {
    const allowed = base[file] || 0;
    if (count > allowed) {
      newViolations.push(`${file} — ${count} raw fetch(\`\${API}-kald (baseline tillader ${allowed}, +${count - allowed} ny(e))`);
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const cur = findings[file] || 0;
    if (cur < allowed) {
      stale.push(`${file} — ${cur}/${allowed} tilbage (baseline kan strammes — endnu et kaldsted er migreret til apiFetch)`);
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = {};
  for (const file of Object.keys(findings).sort()) files[file] = findings[file];
  return {
    $comment:
      "Kendte raw fetch(`${API}-kaldsteder (ratchet — maa kun skrumpe, aldrig vokse). Genereret af frontend/scripts/check-fetch-wiring.mjs --update-baseline. Nye kaldsteder skal bruge apiFetch (frontend/src/lib/apiFetch.ts) — se scriptets fil-header. Refs #5242, #5089.",
    files,
  };
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findings = scanRepo();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    const total = Object.values(findings).reduce((s, c) => s + c, 0);
    console.log(`✅ Baseline skrevet til frontend/scripts/fetch-wiring-baseline.json (${Object.keys(findings).length} filer, ${total} kaldsteder).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`ℹ️  ${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (migreret til apiFetch) — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   → node scripts/check-fetch-wiring.mjs --update-baseline");
  }

  if (newViolations.length) {
    console.error(`\n❌ ${newViolations.length} NY(T/E) raw fetch(\`\${API}-kaldsted(er) (ikke i baseline):`);
    for (const v of newViolations) console.error(`   - ${v}`);
    console.error(`
Fix:
  - Brug apiFetch i stedet for et bart fetch(\`\${API}...\`) — se
    frontend/src/lib/apiFetch.ts's fil-header for kontrakten (Retry-After-
    respekt paa 429, centraliseret 401-vej via networkErrorGuards).
  - Bevidst undtagelse (fx en load()-funktion der skelner parse-/network-
    fejl til Sentry, #4165)? → kald frontend/scripts/check-fetch-wiring.mjs
    --update-baseline for at fastfryse den, MED en kommentar i koden der
    forklarer hvorfor (se RaceHubBoard.jsx/SeasonMatrix.jsx/SeasonView.jsx).
Baseline maa IKKE udvides uden begrundelse (ratchet, Refs #5242).`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\n✅ apiFetch-forward-guard: ingen nye raw fetch(\`\${API}-kaldsteder (${knownFiles} kendte baseline-filer).`);
}

main();
