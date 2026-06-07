#!/usr/bin/env node
// i18n page-untranslated guard — Refs #678.
//
// Fanger den bug-klasse hvor en HEL player-facing side render hardkodet dansk
// fordi den slet ikke bruger `useTranslation` — og dermed er USYNLIG for
// `i18n-check-namespace-inline.mjs` (som kun verificerer at namespaces der
// ALLEREDE er useTranslation'et er inlinet) og for `i18n-check-keys.mjs` (som
// kun sammenligner en/da JSON-parity).
//
// Det var nøjagtigt hullet der lod RacePointsPage/RacesPage/RaceDetailPage/
// RaceHistoryPage lække 100% dansk i EN-mode helt frem til #678 — alle fire
// scripts var grønne fordi siderne aldrig kaldte t().
//
// Heuristik: en fil i frontend/src/pages/ der IKKE importerer useTranslation
// men indeholder danske tegn (æ/ø/å) i ikke-kommentar-kode = sandsynlig leak.
//
// Brug:
//   node scripts/i18n-check-page-untranslated.mjs
//
// CI: .github/workflows/i18n-check.yml (advisory i første omgang — der findes
// kendte pre-eksisterende leaks der konverteres separat; promotes til required
// når EXEMPT-listen kun rummer legitimt-dansk indhold).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PAGES_DIR = join(ROOT, "frontend", "src", "pages");

// Sider der LEGITIMT må indeholde dansk uden useTranslation. Tilføj med begrundelse.
const EXEMPT = new Map([
  ["AdminPage.jsx",              "Admin-only værktøj bag admin-guard — ikke player-facing."],
  ["AdminSprintMetricsPage.jsx", "Admin-only intern metrics-side — ikke player-facing."],
  ["AdminWaitlistPage.jsx",      "Admin-only waitlist-værktøj — ikke player-facing."],
  ["PrivacyPolicyPage.jsx",      "DA-udgaven i dual-page-mønster (separat PrivacyPolicyPageEn.jsx til EN)."],
  ["PrivacyPolicyPageEn.jsx",    "EN-udgaven i dual-page-mønster — engelsk indhold, ingen t() nødvendig."],
]);

// Kendte, endnu-ikke-konverterede player-facing leaks (#678 follow-up). Listet
// her så de er SYNLIGE i guard-output i stedet for tavst at slippe igennem.
// Fjern efterhånden som hver side konverteres til useTranslation.
//
// TOM — alle #678-follow-up-sider (Resultater/SeasonEnd/Founder) er nu
// konverteret til useTranslation. Jobbet i i18n-check.yml er derfor promoted
// fra continue-on-error til required.
const KNOWN_TODO = new Map([]);

// Fjern // line- og /* block */-kommentarer (groft, godt nok til en guard).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const DANISH = /[æøåÆØÅ]/;

const files = readdirSync(PAGES_DIR).filter(f => /\.jsx?$/.test(f));

const leaks = [];   // non-exempt, ukendte → guard-fejl
const todos = [];   // kendte follow-up leaks → vises men fejler ikke alene

for (const file of files) {
  const full = join(PAGES_DIR, file);
  if (!statSync(full).isFile()) continue;
  const src = readFileSync(full, "utf8");
  if (/useTranslation/.test(src)) continue;          // bruger i18n → ikke denne bug-klasse
  if (!DANISH.test(stripComments(src))) continue;    // ingen dansk i kode → fint (fx ren EN-side)

  if (EXEMPT.has(file)) continue;                    // legitimt dansk
  if (KNOWN_TODO.has(file)) { todos.push(file); continue; }
  leaks.push(file);
}

if (todos.length > 0) {
  console.warn(`⚠ ${todos.length} kendt(e) player-facing side(r) mangler stadig i18n (#678 follow-up):`);
  for (const f of todos) console.warn(`    - frontend/src/pages/${f} — ${KNOWN_TODO.get(f)}`);
  console.warn("");
}

if (leaks.length === 0) {
  console.log(`✓ i18n page-untranslated OK — ingen NYE player-facing sider uden useTranslation med dansk tekst (${EXEMPT.size} exempt, ${todos.length} kendt-TODO).`);
  process.exit(0);
}

console.error(`✗ i18n page-untranslated FAILED — ${leaks.length} side(r) uden useTranslation indeholder dansk tekst:\n`);
for (const f of leaks) console.error(`  • frontend/src/pages/${f}`);
console.error(`\nFix: tilføj useTranslation + flyt strings til et namespace (se races.json/#678),`);
console.error(`     ELLER — hvis siden legitimt er dansk-only (admin/juridisk) — tilføj den til`);
console.error(`     EXEMPT i ${relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, "/")} med begrundelse.`);
process.exit(1);
