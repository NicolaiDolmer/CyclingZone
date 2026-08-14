#!/usr/bin/env node
// scripts/lint-unguarded-fetch-in-handler.mjs
// ============================================================
// Forward-guard mod NYE `await fetch(...)` uden try/catch i frontend-runtime
// (#3628 / #3619 / #2719).
//
// WHY (rodårsagen, nu fundet tre gange):
//   `fetch()` REJECTER ved netværksudfald — den returnerer ikke en fejl-status.
//   Mobil-WebKit kaster "TypeError: Load failed", Firefox "NetworkError". Sker
//   det midt i en spiller-handler der lige har sat en loading-tilstand:
//
//     setSaving(true);
//     const res = await fetch(url, { method: "POST" });   // ← kaster
//     setSaving(false);                                   // ← kører ALDRIG
//
//   ...så bliver rejection'en unhandled, `setSaving(false)` springes over, og
//   knappen står i "Gemmer..." for evigt — typisk også `disabled`, så spilleren
//   hverken kan se hvad der gik galt eller prøve igen.
//
//   #2719 lukkede det for ÉT af tre kald i useAuctionBidding.js. De to naboer i
//   SAMME fil overlevede i tre uger, indtil en spiller ramte dem i prod
//   (CYCLINGZONE-4E, 10/8) → #3619. #3628 er backwards-checket efter dét, og
//   fandt seks flere. Fejlklassen er altså sluppet igennem to backwards-checks
//   i træk. Denne guard er svaret: bunken må ikke vokse igen.
//
// REGEL:
//   Et `await fetch(...)` skal ligge i en `try`-blok inde i den funktion det står
//   i. Det er IKKE nok at en kalder et sted højere oppe fanger — det er præcis
//   den antagelse der fejlede i #3619, hvor AuctionsPage/RiderStatsPage regnede
//   med at hooket fangede, og hooket regnede med at siderne gjorde.
//
//     x  try { const res = await fetch(url); } catch { ...ryd loading... }
//     -  const res = await fetch(url);                              // FLAGES
//
//   Escape-hatch: en markør-kommentar (`// best-effort`, `// error-ok`,
//   `// catch-ok`, `// swallow-ok`) på linjen, når kaldet BEVIDST må boble op til
//   en kalder der fanger. Skriv HVEM der fanger. Samme token-familie som de
//   øvrige lint-*.mjs.
//
// SCOPE: frontend/src/**/*.{js,jsx} — hele træet walkes (ingen hardkodet
//   fil-liste; den fælde bed os 25/7). Tests, preview-mocks og entry-server er
//   undtaget: de rammer ikke en spiller.
//
// HEURISTIK (regex/AST-let — samme trade-off som de øvrige lint-*.mjs):
//   Strenge + kommentarer blankes via scripts/lib/js-source-scan.mjs. Derefter
//   walkes kilden én gang med en blok-stak: hver `{` klassificeres som `try`,
//   `function` eller almindelig blok ud fra teksten lige før den. Et
//   `await fetch(` er DÆKKET hvis der ligger en `try`-blok på stakken FØR den
//   nærmeste funktionsgrænse. Bevidst konservativ: en blok vi ikke kan
//   klassificere tælles som almindelig blok, hvilket kun kan give FÆRRE flag.
//
// IKKE dækket (bevidst):
//   - `fetch(...).then(...)` uden await — findes ikke i denne kodebase.
//   - Om catch-grenen faktisk RYDDER loading-tilstanden. Det kræver dataflow-
//     analyse; regressionsværnet for de konkrete handlere ligger i
//     frontend/src/lib/networkErrorGuards.test.js.
//
// Usage:
//   node scripts/lint-unguarded-fetch-in-handler.mjs          # check (CI), fail-hard
//   node scripts/lint-unguarded-fetch-in-handler.mjs --warn   # rapport-only (exit 0)
//   npm run lint:unguarded-fetch                              # samme som default
//
// Exit codes:
//   0 — ingen net-nye ubeskyttede fetch-kald (eller --warn)
//   1 — mindst én fil OVER sin baseline
//
// Refs #3628, #3619, #2719.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankStringsAndComments, lineAt } from "./lib/js-source-scan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Fil-udvælgelse ───────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["preview", "tests", "__mocks__", "node_modules"]);

export function collectFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry)) continue;
      if (/\.test\.jsx?$/.test(entry)) continue; // tests må gerne kaste
      if (entry === "entry-server.jsx") continue; // SSR-prerender, ingen spiller
      files.push(full);
    }
  };
  walk(join(root, "frontend", "src"));
  return files;
}

// Bevidst-ignoreret-markør (samme token-familie som lint-unchecked-supabase-mutation.mjs).
const MARKER_RE = /best[-\s]?effort|swallow-ok|catch-ok|error-ok/i;
// Nøgleord hvis `( ... )` foran en `{` IKKE gør blokken til en funktionskrop.
const NON_FN_PAREN_HEAD_RE = /\b(?:if|for|while|catch|switch|with)$/;

/**
 * Klassificér blokken der åbnes af `{` på index `braceIdx`.
 * @returns {"try"|"function"|"block"}
 */
function classifyBlock(src, braceIdx) {
  const before = src.slice(0, braceIdx).replace(/\s+$/, "");
  if (/\btry$/.test(before)) return "try";
  if (before.endsWith("=>")) return "function";
  if (before.endsWith(")")) {
    // Find den matchende `(` og se på ordet lige før den.
    let depth = 0;
    let k = before.length - 1;
    for (; k >= 0; k--) {
      const c = before[k];
      if (c === ")") depth++;
      else if (c === "(") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (k < 0) return "block";
    const head = before.slice(0, k).replace(/\s+$/, "");
    if (NON_FN_PAREN_HEAD_RE.test(head)) return "block";
    return "function";
  }
  return "block";
}

const AWAIT_FETCH_RE = /\bawait\s+fetch\s*\(/g;

// ── Detektion ────────────────────────────────────────────────────────────────
export function findUnguardedFetches(rawSrc) {
  const src = blankStringsAndComments(rawSrc);

  // 1) Byg blok-stakken op ved at walke kilden én gang og notere, for hvert
  //    `await fetch(`, om der ligger en try-blok mellem den og funktionsgrænsen.
  const hits = [];
  AWAIT_FETCH_RE.lastIndex = 0;
  let m;
  while ((m = AWAIT_FETCH_RE.exec(src)) !== null) hits.push(m.index);
  if (hits.length === 0) return [];

  const stack = [];
  const guarded = new Map(); // offset → boolean
  let hitIdx = 0;
  for (let i = 0; i < src.length && hitIdx < hits.length; i++) {
    // Afgør status for alle hits der ligger før/på denne position.
    while (hitIdx < hits.length && hits[hitIdx] === i) {
      let covered = false;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s] === "function") break;
        if (stack[s] === "try") { covered = true; break; }
      }
      guarded.set(hits[hitIdx], covered);
      hitIdx++;
    }
    const c = src[i];
    if (c === "{") stack.push(classifyBlock(src, i));
    else if (c === "}") stack.pop();
  }
  // Hits efter sidste `{`/`}` (tail) — samme beregning med den endelige stak.
  while (hitIdx < hits.length) {
    let covered = false;
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s] === "function") break;
      if (stack[s] === "try") { covered = true; break; }
    }
    guarded.set(hits[hitIdx], covered);
    hitIdx++;
  }

  const findings = [];
  for (const offset of hits) {
    if (guarded.get(offset)) continue;
    // Markør-kommentar på den RÅ linje kaldet står på.
    let lineStart = offset;
    while (lineStart > 0 && rawSrc[lineStart - 1] !== "\n") lineStart--;
    let lineEnd = offset;
    while (lineEnd < rawSrc.length && rawSrc[lineEnd] !== "\n") lineEnd++;
    if (MARKER_RE.test(rawSrc.slice(lineStart, lineEnd))) continue;
    findings.push({ line: lineAt(rawSrc, offset) });
  }
  return findings;
}

// ── Baseline (ratchet) ────────────────────────────────────────────────────────
// Antal TILBAGEVÆRENDE ubeskyttede `await fetch(` pr. fil da guarden blev indført
// (#3628, målt 14/8 EFTER at denne PR rettede de seks handlere med fastlåst
// loading-tilstand). Guarden er en RATCHET: en fil må aldrig OVERSTIGE sit tal.
// Tallet kan kun gå NED — retter du et site, så sænk baseline (guarden minder om
// det). Nye filer har implicit baseline 0.
//
// Formålet er IKKE at legitimere de tilbageværende. De 16 herunder er hver især
// gennemgået manuelt i #3628 og faldt i to grupper:
//   (a) DÆKKET AF KALDEREN — riderContractActions.js (alle 8 kaldesteder i
//       RiderManageActions/TeamPage har try/catch), AdminForumTab (action()-
//       wrapperen har try/catch/finally), ForumPostPage.submitReport
//       (ReportModal.handleSubmit har try/catch/finally), og auktions-handlerne
//       i AuctionsPage/RiderStatsPage (useAuctionBidding fanger efter #3619).
//       Guarden flager dem alligevel, fordi netop "kalderen fanger vel" var den
//       antagelse der fejlede i #3619. De er baseline, ikke undtagelser.
//   (b) ÆGTE, MEN ANDET SYMPTOM — ForumPostPage.handleAdminPin/handleAdminDelete
//       (admin-only) og WatchlistPage.startAuction har slet ingen loading-
//       tilstand, så et tabt net giver tavshed frem for en fastlåst knap.
//       Udestående, se #3628.
const BASELINE = {
  "frontend/src/pages/ForumPostPage.jsx": 4,
  "frontend/src/pages/AuctionsPage.jsx": 3,
  "frontend/src/pages/RiderStatsPage.jsx": 3,
  "frontend/src/pages/admin/AdminForumTab.jsx": 3,
  "frontend/src/lib/riderContractActions.js": 2,
  "frontend/src/pages/WatchlistPage.jsx": 1,
};

// ── Main ──────────────────────────────────────────────────────────────────────
function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

function main() {
  const warnOnly = process.argv.includes("--warn");
  const files = collectFiles();
  const overBaseline = [];
  const underBaseline = [];
  let liveTotal = 0;
  const allReport = [];

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const rawSrc = readFileSync(file, "utf8");
    if (!rawSrc.includes("fetch")) continue;
    const findings = findUnguardedFetches(rawSrc);
    const base = BASELINE[rel] ?? 0;
    liveTotal += findings.length;
    for (const f of findings) allReport.push(`  ${rel}:${f.line}`);
    if (findings.length > base) overBaseline.push({ rel, count: findings.length, base, findings });
    else if (findings.length < base) underBaseline.push({ rel, count: findings.length, base });
  }

  if (warnOnly) {
    console.log(`lint:unguarded-fetch (--warn) — ${liveTotal} ubeskyttede await fetch() i alt:`);
    console.log(allReport.join("\n"));
    process.exit(0);
  }

  if (underBaseline.length) {
    console.log("i lint:unguarded-fetch — disse filer er UNDER baseline (saenk tallet i BASELINE):");
    for (const u of underBaseline) console.log(`  ${u.rel}: ${u.count} (baseline ${u.base})`);
  }

  if (overBaseline.length === 0) {
    console.log(`OK lint:unguarded-fetch — ingen net-nye ubeskyttede fetch-kald (baseline-total ${liveTotal})`);
    process.exit(0);
  }

  console.error("FEJL lint:unguarded-fetch — NET-NYE ubeskyttede await fetch() over baseline:");
  for (const o of overBaseline) {
    console.error(`  ${o.rel}: ${o.count} (baseline ${o.base})`);
    for (const f of o.findings) console.error(`    :${f.line}`);
  }
  console.error(
    "\nfetch() REJECTER ved netvaerksudfald — mobil-WebKit kaster 'TypeError: Load failed'.\n" +
    "Staar kaldet efter en setLoading(true) uden try/catch, koeres oprydningen aldrig:\n" +
    "knappen bliver staaende i 'Gemmer...' og er typisk disabled, saa spilleren\n" +
    "hverken ser fejlen eller kan proeve igen. Det var #2719, #3619 og #3628.\n" +
    "Laeg kaldet i en try/catch der (1) rydder loading-tilstanden, (2) viser\n" +
    "t('errors:generic.networkError') og (3) kalder reportActionFailure(..., \n" +
    "{ reason: 'network', cause }) — eller saet en '// best-effort'-kommentar der\n" +
    "siger HVEM der fanger i stedet.\n" +
    "Ryddede du op i en fil med vilje? Saenk dens tal i BASELINE i denne fil (#3628)."
  );
  process.exit(1);
}

if (isMain()) main();
