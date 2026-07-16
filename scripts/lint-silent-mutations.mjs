#!/usr/bin/env node
// scripts/lint-silent-mutations.mjs
// ============================================================
// Forward-guard mod NYE tavse fejl fra de 6 feedback-kontrakt-hooks (#2465).
//
// WHY (#2465 — UI/UX-audit 15/7, greb 3):
//   useTraining / useAcademy / useFacilities / usePlanner / useScouting /
//   useScoutingCentral returnerer alle eksplicit { ok, error } fra deres
//   mutations-funktioner. Flere kaldesteder kaldte dem uden `await` og læste
//   aldrig svaret — ved fejl (udløbet session, netværksblip, backend-afvisning)
//   skete der visuelt INGENTING. #2465 fixede de 4 verificerede kaldesteder;
//   denne guard forhindrer at mønstret driver tilbage.
//
// REGEL:
//   Et kald til en af de navngivne mutations-funktioner (bare `setPlan(...)`
//   eller member-form `training.setPlan(...)`) skal enten
//     (a) være `await`'et, ELLER
//     (b) være `return`'et (delegeres til en opkalder der læser resultatet), ELLER
//     (c) have `.then(` umiddelbart efter kaldet (promise-kæde håndteret).
//   Alt andet flages.
//
// HEURISTIK (regex/AST-let, samme trade-off som lint-swallowed-catches.mjs /
// lint-ui-slop.mjs): strenge + kommentarer blankes til whitespace før scan, så
// funktionsnavne i kommentarer/strenge ikke matcher. Funktionsnavnene er til
// dels almindelige ord (fx `hire`, `fire`, `upgrade`) — en fil der definerer
// sin EGEN lokale funktion med samme navn (fx lib/trafficBeacon.js' fire())
// kan false-positive'e. Det er en KENDT afvejning (samme som de andre lint-*
// scripts i repoet) og håndteres af baseline-ratchet'en nedenfor: eksisterende
// (falske eller ægte) fund fryses i BASELINE, kun NYE fund over baseline fejler.
//
// Usage:
//   node scripts/lint-silent-mutations.mjs            # check (CI + pre-commit)
//   node scripts/lint-silent-mutations.mjs --warn     # rapport-only (exit 0)
//
// Refs #2465.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC_DIR = join(ROOT, "frontend", "src");

// De 6 hooks' mutations-funktioner (#2465). Rene getters/refresh er UDELADT
// (de returnerer ikke {ok,error} og er harmløse at fyre-og-glemme).
const TARGET_FUNCTIONS = [
  // useTraining.js
  "setPlan", "clearPlan", "setPlanBulk", "setWeekPlan", "clearWeekPlan",
  "setRiderWeekPlan", "clearRiderWeekPlan", "runToday",
  // useAcademy.js
  "signCandidate", "rejectCandidate", "signFreeAgent", "resolveGraduate",
  "promoteRider", "demoteRider",
  // useFacilities.js
  "upgrade", "hire", "fire",
  // usePlanner.js
  "createPeak", "retargetPeak", "deletePeak", "acceptTraining",
  // useScouting.js / useScoutingCentral.js
  "scout", "scoutLegacy", "startTargetJob", "startTarget", "startMission",
  "cancelAssignment",
];

// Hook-definitionsfilerne selv: her er funktionerne DEFINERET (og evt. kaldt
// internt via deres egen mutate()-wrapper) — ikke kaldesteder i #2465-forstand.
export const EXEMPT_FILES = new Set([
  "frontend/src/lib/useTraining.js",
  "frontend/src/lib/useAcademy.js",
  "frontend/src/lib/useFacilities.js",
  "frontend/src/lib/usePlanner.js",
  "frontend/src/lib/useScouting.js",
  "frontend/src/lib/useScoutingCentral.js",
]);

// ── Fil-udvælgelse ───────────────────────────────────────────────────────────
function collectFiles() {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|mjs)$/.test(entry)) continue;
      if (/\.test\.(jsx?|mjs)$/.test(entry)) continue; // tests må gerne fyre-og-glemme
      files.push(full);
    }
  };
  walk(SRC_DIR);
  return files;
}

// ── Blank strenge + kommentarer til whitespace (bevar længde + newlines) ──────
function blankStringsAndComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

function lineAt(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}

// Find den matchende lukke-parentes for en åbne-parentes ved index `openIdx`
// (src[openIdx] === "("). Returnerer index af den matchende ")", eller -1.
function matchParen(src, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    if (src[k] === "(") depth++;
    else if (src[k] === ")") { depth--; if (depth === 0) return k; }
  }
  return -1;
}

const FUNC_RE = new RegExp(
  `\\b(?:(\\w+)\\.)?(${TARGET_FUNCTIONS.join("|")})\\s*\\(`,
  "g"
);

// ── Find ikke-håndterede kald i én fil (arbejder på den blankede kilde) ───────
export function findSilentMutations(rawSrc) {
  const src = blankStringsAndComments(rawSrc);
  const findings = [];
  FUNC_RE.lastIndex = 0;
  let m;
  while ((m = FUNC_RE.exec(src)) !== null) {
    const matchStart = m.index;
    const openParenIdx = matchStart + m[0].length - 1; // index af "("
    // Forudgående ikke-whitespace-tegn/ord: safe hvis await'et eller return'et.
    const before = src.slice(0, matchStart);
    const beforeTrim = before.replace(/\s+$/, "");
    const precededByAwait = /\bawait$/.test(beforeTrim);
    const precededByReturn = /\breturn$/.test(beforeTrim);
    if (precededByAwait || precededByReturn) continue;

    // Efterfølgende: safe hvis kaldet er kædet med .then(.
    const closeParenIdx = matchParen(src, openParenIdx);
    if (closeParenIdx !== -1) {
      const after = src.slice(closeParenIdx + 1);
      const afterTrim = after.replace(/^\s+/, "");
      if (afterTrim.startsWith(".then(")) continue;
    }

    findings.push({ line: lineAt(rawSrc, matchStart), fn: m[2] });
  }
  return findings;
}

// ── Baseline (ratchet) ─────────────────────────────────────────────────────────
// Kendte fund på det tidspunkt guarden blev indført (#2465, målt 16/7 EFTER
// #2465-fixet af de 4 verificerede kaldesteder). Nogle er formodede false
// positives fra generiske funktionsnavne (fx lib/trafficBeacon.js' lokale
// fire() — intet med useFacilities at gøre); resten er reelle pre-eksisterende
// kaldesteder #2465 ikke rørte (uden for issuets verificerede scope). Guarden
// er en RATCHET: en fil må aldrig OVERSTIGE sit baseline-tal → net-nye tavse
// kald fejler CI. Ryd op i en fil? Sænk dens tal her.
//
// Begge nedenfor er VERIFICEREDE false positives (målt 16/7), ikke ægte bugs:
//   - trafficBeacon.js: egen lokale fire()-funktion (analytics-beacon), intet
//     med useFacilities' fire() at gøre — navnekollision.
//   - SeasonPlannerPage.jsx: createPeak/retargetPeak/deletePeak/acceptTraining
//     kaldes via en thunk (`() => planner.createPeak(...)`) der sendes til
//     runMutation(fn), som selv gør `await fn()` — reelt håndteret, men scanneren
//     følger ikke funktionskald på tværs af grænser (regex/AST-let, jf. #2465).
const BASELINE = {
  "frontend/src/lib/trafficBeacon.js": 3,
  "frontend/src/pages/SeasonPlannerPage.jsx": 4,
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
    if (EXEMPT_FILES.has(rel)) continue;
    const rawSrc = readFileSync(file, "utf8");
    const findings = findSilentMutations(rawSrc);
    const base = BASELINE[rel] ?? 0;
    liveTotal += findings.length;
    for (const f of findings) allReport.push(`  ${rel}:${f.line} — ${f.fn}(...)`);
    if (findings.length > base) overBaseline.push({ rel, count: findings.length, base, findings });
    else if (findings.length < base) underBaseline.push({ rel, count: findings.length, base });
  }

  if (warnOnly) {
    console.log(`lint:silent-mutations (--warn) — ${liveTotal} kald i alt:`);
    console.log(allReport.join("\n"));
    process.exit(0);
  }

  if (underBaseline.length) {
    console.log("i lint:silent-mutations — disse filer er UNDER baseline (sænk tallet i BASELINE):");
    for (const u of underBaseline) console.log(`  ${u.rel}: ${u.count} (baseline ${u.base})`);
  }

  if (overBaseline.length === 0) {
    console.log(`OK lint:silent-mutations — ingen net-nye uhaandterede mutations-kald (baseline-total ${liveTotal})`);
    process.exit(0);
  }

  console.error("FEJL lint:silent-mutations — NET-NYE uhaandterede mutations-kald over baseline:");
  for (const o of overBaseline) {
    console.error(`  ${o.rel}: ${o.count} (baseline ${o.base})`);
    for (const f of o.findings) console.error(`    :${f.line} — ${f.fn}(...)`);
  }
  console.error(
    "\nEt kald til en af de 6 feedback-kontrakt-hooks' mutations-funktioner " +
    "(useTraining/useAcademy/useFacilities/usePlanner/useScouting/useScoutingCentral)\n" +
    "skal enten (a) await'es, (b) return'es til en opkalder der læser resultatet, " +
    "eller (c) kædes med .then(...).\nUhåndteret betyder: en fejl (udløbet session, " +
    "netværk, backend-afvisning) forsvinder tavst i UI'et. Refs #2465."
  );
  process.exit(1);
}

if (isMain()) main();
