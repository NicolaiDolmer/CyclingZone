#!/usr/bin/env node
// i18n hardcoded-Danish guard (lib/components/hooks/pages) — Refs #1170.
//
// Fanger den bug-klasse hvor player-facing tekst hardcodes som DANSK i
// frontend/src — usynligt for i18n-check-page-untranslated.mjs (som kun
// flagger sider HELT uden useTranslation) og for keys/namespace-checkene
// (som kun ser på locale-JSON og t()-brug).
//
// Historik:
//   • Slice A (#1170): string-literal-scan af lib/+components/ — fandt
//     CookieBanner (vist for ALLE nye brugere), formatBidWarning og
//     autobud-fallback-fejlen, mens hele batteriet var grønt.
//   • Fuld-site audit (#1170): udvidet til pages/+hooks/ og fra string-
//     literals til HELE ikke-kommentar-linjer. Det lukkede to blinde
//     vinkler: (1) JSX-tekst-noder er ikke string-literals (ConfettiModal
//     "Klik for at lukke", RacePriceModal), (2) sider MED useTranslation
//     kan stadig have hardcodet dansk (DeadlineDayBoard, SeasonPreviewPage).
//
// Heuristik: danske tegn (æ/ø/å) i ikke-kommentar-kode = sandsynlig leak.
// Identifiers/interne keys med æøå flagges også — fixet er at omdøbe dem til
// engelsk (interne keys skal alligevel ikke være danske; jf. ManagerProfilePage
// tab-keys). Admin-flader er policy-exempt (ikke player-facing).
//
// Brug:
//   node scripts/i18n-check-lib-strings.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIRS = [
  "frontend/src/lib",
  "frontend/src/components",
  "frontend/src/hooks",
  "frontend/src/pages",
];

// Mapper/filer der LEGITIMT må indeholde dansk. Tilføj med begrundelse.
const EXEMPT_DIRS = [
  "frontend/src/components/admin", // Admin-only værktøjer bag admin-guard — ikke player-facing.
  "frontend/src/pages/admin",      // Admin-only tabs bag admin-guard — ikke player-facing.
];
const EXEMPT_FILES = new Map([
  ["frontend/src/lib/legacyFinanceMessage.js", "Parser-only matching of Danish prose already stored in legacy finance rows; recognized text resolves to locale keys before display."],
  ["frontend/src/lib/uciRaceClasses.js", "Bruges KUN af admin-sider (RacePoolSection/AdminDataTab/AdminPage)."],
  ["frontend/src/components/WaitlistConsentText.jsx", "Dual-sprog-komponent med eksplicit lang-prop — dansk gren er bevidst."],
  ["frontend/src/lib/sentry.jsx", "Error-boundary: statisk EN+DA med EN-default — må IKKE afhænge af i18n-runtime (kan være nede/uinitialiseret når boundary rammer). #1170 slice B-beslutning."],
  ["frontend/src/pages/PatchNotesPage.jsx", "Patch notes er bevidst tosprogede (en+da felter side om side) — dansk indhold er data, ikke leak."],
  ["frontend/src/pages/PrivacyPolicyPage.jsx", "DA-udgaven i dual-page-mønster (separat PrivacyPolicyPageEn.jsx til EN)."],
  ["frontend/src/pages/AdminSprintMetricsPage.jsx", "Admin-only intern metrics-side — ikke player-facing."],
  ["frontend/src/pages/AdminWaitlistPage.jsx", "Admin-only waitlist-værktøj — ikke player-facing."],
]);

// Kendte, endnu-ikke-konverterede player-facing leaks. Listet her så de er
// SYNLIGE i guard-output i stedet for tavst at slippe igennem. Fjern
// efterhånden som hver fil konverteres. Format: [sti, "#issue — begrundelse"].
const KNOWN_TODO = new Map([]);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const DANISH = /[æøåÆØÅ]/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f)) out.push(p);
  }
  return out;
}

const leaks = [];
const todos = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_DIRS.some((d) => rel.startsWith(d + "/"))) continue;
    if (EXEMPT_FILES.has(rel)) continue;

    const src = stripComments(readFileSync(file, "utf8"));
    const hits = [];
    src.split("\n").forEach((line, i) => {
      if (DANISH.test(line)) hits.push(i + 1);
    });
    if (!hits.length) continue;

    if (KNOWN_TODO.has(rel)) {
      todos.push(`${rel} (${hits.length} linjer) — ${KNOWN_TODO.get(rel)}`);
    } else {
      leaks.push(`${rel}:${hits.slice(0, 5).join(",")}${hits.length > 5 ? ` (+${hits.length - 5} flere)` : ""}`);
    }
  }
}

if (todos.length) {
  console.log(`ℹ️  ${todos.length} kendte leaks (KNOWN_TODO — fejler ikke):`);
  for (const t of todos) console.log(`   - ${t}`);
}

if (leaks.length) {
  console.error(`\n❌ ${leaks.length} fil(er) i frontend/src har dansk tekst i ikke-kommentar-kode uden i18n:`);
  for (const l of leaks) console.error(`   - ${l}`);
  console.error("\nFix: keyificér via useTranslation/t-parameter (en+da), omdøb danske identifiers/interne keys til engelsk, eller tilføj til EXEMPT med begrundelse.");
  process.exit(1);
}

console.log("✅ i18n hardcoded-Danish guard: ingen ukendte danske leaks i lib/components/hooks/pages.");
