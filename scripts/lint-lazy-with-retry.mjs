#!/usr/bin/env node
// scripts/lint-lazy-with-retry.mjs
// ============================================================
// Forward-guard: intet bart `lazy(...)` (React.lazy) i frontend/src udenfor
// lazyWithRetry.js selv (#5014).
//
// WHY: App.jsx importerer allerede `lazyWithRetry as lazy` fra
// lib/lazyWithRetry.js for ALLE route-chunks (#881) — men tre
// komponent-niveau lazy-loads (FeedbackModal, TimelineFilmPlayer,
// FinalKilometrePlayback) importerede stadig `lazy` direkte fra "react".
// Uden retry-vaernet efterlader React.lazy sig i en tilstand hvor et
// stale-chunk-load efter deploy (hash roteret væk) kaster en opak
// "Cannot read properties of undefined (reading 'default')" i stedet for en
// genkendelig ChunkLoadError — SentryBoundary klassificerer den som
// render_error, ikke chunk_load_error, og #4595's auto-reload/cache-purge
// trigges aldrig. Ramte spillere i prod (Sentry CYCLINGZONE-5H, 5/9,
// /races/:id).
//
// REGEL: intet bart `React.lazy(` og ingen kald til et lokalt navn der er
// bundet til det NAVNGIVNE `lazy`-eksport fra modulet "react" (uanset
// lokal alias, fx `import { lazy as foo } from "react"`). Import af
// lazyWithRetry FRA lib/lazyWithRetry.js er altid ok, uanset lokalt navn —
// det er netop derfor App.jsx må hedde den lokale binding `lazy`
// (`import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js"`).
//
// Ingen baseline/ratchet: #5014 rettede de sidste tre kendte forekomster,
// så tolerancen er nul net-nye.
//
// HEURISTIK (regex/AST-let — samme trade-off som de øvrige lint-*.mjs):
// strenge + kommentarer blankes via scripts/lib/js-source-scan.mjs, så
// import-parsing og kald-scanning kun ser ægte kode.
//
// Usage:
//   node scripts/lint-lazy-with-retry.mjs
//   npm run lint:lazy-with-retry
//
// Exit codes:
//   0 — ingen bart lazy()/React.lazy() fundet
//   1 — mindst ét fund
//
// Refs #5014, #4595, #881. Sentry: CYCLINGZONE-5H.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankStringsAndComments, lineAt } from "./lib/js-source-scan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Selve wrapperen: definerer lazy(...) internt fra "react" — det ER pointen.
const WHITELIST_SUFFIXES = ["frontend/src/lib/lazyWithRetry.js"];

export function collectFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry)) continue;
      const rel = full.slice(root.length + 1).replace(/\\/g, "/");
      if (WHITELIST_SUFFIXES.some((s) => rel.endsWith(s))) continue;
      files.push(full);
    }
  };
  walk(join(root, "frontend", "src"));
  return files;
}

// Matcher `import <clause> from "<module>"` — clause kan indeholde en default
// import og/eller en `{ ... }`-liste og/eller `* as X`.
const IMPORT_RE = /import\s+([^;]+?)\s+from\s*["']([^"']+)["']/g;

/**
 * Find lokale navne i denne fil der er bundet direkte til React's rå
 * `lazy`-eksport (importeret fra modulet "react", uanset alias).
 * @returns {Set<string>}
 */
function findRawLazyBindings(src) {
  const rawNames = new Set();
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const [, clause, modulePath] = m;
    if (modulePath !== "react") continue;
    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (!namedMatch) continue;
    for (const rawEntry of namedMatch[1].split(",")) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      const asMatch = entry.match(/^lazy\s+as\s+([\w$]+)$/);
      if (asMatch) {
        rawNames.add(asMatch[1]);
      } else if (entry === "lazy") {
        rawNames.add("lazy");
      }
    }
  }
  return rawNames;
}

// `React.lazy(` er altid mistænkeligt i denne kodebase — der er ingen
// legitim grund til at kalde member-formen direkte i stedet for wrapperen.
const REACT_LAZY_MEMBER_RE = /\bReact\s*\.\s*lazy\s*\(/g;

export function findBareLazyCalls(rawSrc) {
  const src = blankStringsAndComments(rawSrc);
  const findings = [];

  REACT_LAZY_MEMBER_RE.lastIndex = 0;
  let m;
  while ((m = REACT_LAZY_MEMBER_RE.exec(src)) !== null) {
    findings.push({ line: lineAt(rawSrc, m.index), snippet: "React.lazy(" });
  }

  // Import-parsing kører på den blankede kilde MED kommentarer/strenge fjernet,
  // men modulspecifikationen ("react") er selv en streng — den må IKKE blankes
  // her, ellers matcher IMPORT_RE aldrig modulepath'en. Brug derfor rawSrc til
  // import-parsing (importsætninger indeholder ikke andet der kan forveksles),
  // og den blankede src kun til selve kalds-scanningen nedenfor.
  const rawNames = findRawLazyBindings(rawSrc);
  for (const name of rawNames) {
    // Alias-navnet kan i teorien indeholde regex-metategn (fx `$`, lovligt i et
    // JS-identifikatornavn) — escap dem før interpolation, ellers kan et alias
    // som `lazy$` blive læst som slut-af-input-anker og aldrig matche et kald.
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const callRe = new RegExp(`(?<![.\\w$])${escapedName}\\s*\\(`, "g");
    callRe.lastIndex = 0;
    while ((m = callRe.exec(src)) !== null) {
      findings.push({ line: lineAt(rawSrc, m.index), snippet: `${name}(` });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

function main() {
  const files = collectFiles();
  const report = [];

  for (const file of files) {
    const rawSrc = readFileSync(file, "utf8");
    if (!rawSrc.includes("lazy")) continue;
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const findings = findBareLazyCalls(rawSrc);
    for (const f of findings) report.push({ rel, ...f });
  }

  if (report.length === 0) {
    console.log("OK lint:lazy-with-retry — ingen bart lazy()/React.lazy() fundet i frontend/src");
    process.exit(0);
  }

  console.error("FEJL lint:lazy-with-retry — bart lazy()/React.lazy() fundet (brug lazyWithRetry):");
  for (const f of report) console.error(`  ${f.rel}:${f.line} (${f.snippet})`);
  console.error(
    "\nBrug lazyWithRetry fra frontend/src/lib/lazyWithRetry.js i stedet for React's\n" +
    "rå lazy(). Uden retry-vaernet klassificeres et stale-chunk-load efter deploy\n" +
    "som render_error i stedet for chunk_load_error, og #4595's auto-reload/\n" +
    "cache-purge trigges aldrig (Sentry CYCLINGZONE-5H, #5014).\n" +
    "  import { lazyWithRetry } from \"<path>/lib/lazyWithRetry.js\";\n" +
    "  const Foo = lazyWithRetry(() => import(\"./Foo\"));\n" +
    "(App.jsx importerer den som `lazyWithRetry as lazy` for route-chunks — det er ok,\n" +
    "det ER wrapperen, bare med et lokalt alias.)"
  );
  process.exit(1);
}

if (isMain()) main();
