#!/usr/bin/env node
// i18n lib/components-strings guard — Refs #1170.
//
// Fanger den bug-klasse hvor player-facing tekst hardcodes som DANSKE
// string-literals i frontend/src/lib/ eller frontend/src/components/ — usynligt
// for i18n-check-page-untranslated.mjs (som kun scanner pages/) og for
// keys/namespace-checkene (som kun ser på locale-JSON og t()-brug).
//
// Det var nøjagtigt hullet der lod CookieBanner (vist for ALLE nye brugere),
// formatBidWarning (squad-cap-advarslen i bud-flowet) og autobud-fallback-
// fejlen rendere ren dansk i EN-mode, mens hele batteriet var grønt.
//
// Heuristik: en streng-literal med danske tegn (æ/ø/å) i ikke-kommentar-kode =
// sandsynlig leak. Admin-flader er policy-exempt (ikke player-facing).
//
// Brug:
//   node scripts/i18n-check-lib-strings.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIRS = ["frontend/src/lib", "frontend/src/components"];

// Mapper/filer der LEGITIMT må indeholde dansk. Tilføj med begrundelse.
const EXEMPT_DIRS = [
  "frontend/src/components/admin", // Admin-only værktøjer bag admin-guard — ikke player-facing.
];
const EXEMPT_FILES = new Map([
  ["frontend/src/lib/uciRaceClasses.js", "Bruges KUN af admin-sider (RacePoolSection/AdminDataTab/AdminPage)."],
  ["frontend/src/components/WaitlistConsentText.jsx", "Dual-sprog-komponent med eksplicit lang-prop — dansk gren er bevidst."],
]);

// Kendte, endnu-ikke-konverterede player-facing leaks (#1170 slice B). Listet
// her så de er SYNLIGE i guard-output i stedet for tavst at slippe igennem.
// Fjern efterhånden som hver fil konverteres.
const KNOWN_TODO = new Map([
  ["frontend/src/lib/waitlistForm.js", "#1170 slice B — founder-waitlist-form (stor flade, egen slice)."],
  ["frontend/src/components/waitlist/FounderSupporterWaitlistForm.jsx", "#1170 slice B — founder-waitlist-form."],
  ["frontend/src/lib/sentry.jsx", "#1170 slice B — error-boundary-tekster; kræver beslutning (i18n kan være nede når boundary rammer)."],
]);

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
      const strings = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || [];
      if (strings.some((s) => DANISH.test(s))) hits.push(i + 1);
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
  console.log(`ℹ️  ${todos.length} kendte slice-B-leaks (KNOWN_TODO — fejler ikke):`);
  for (const t of todos) console.log(`   - ${t}`);
}

if (leaks.length) {
  console.error(`\n❌ ${leaks.length} fil(er) i lib/components har danske string-literals uden i18n:`);
  for (const l of leaks) console.error(`   - ${l}`);
  console.error("\nFix: keyificér via useTranslation/t-parameter, eller tilføj til EXEMPT med begrundelse.");
  process.exit(1);
}

console.log("✅ i18n lib/components-strings: ingen ukendte danske string-literals.");
