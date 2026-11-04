#!/usr/bin/env node
// scripts/check-locale-compare.mjs
// ============================================================
// Forward-guard (#1857): the race engines must not sort by the PROCESS locale.
//
// `a.localeCompare(b)` without a locale (and `new Intl.Collator()` without
// one) follows the machine's default locale. Railway collates as en-US; a
// Danish Windows machine collates as da-DK, where "aa" is read as "å" and
// sorts last. A replay of a real prod stage on such a machine swapped two
// riders whose UUIDs contained "aa", and the output hash no longer matched,
// although prod had computed correctly. The engines now sort through
// backend/lib/compareIds.ts (pinned to en-US); this guard keeps it that way.
//
// Scope (test files excluded):
//   - backend/lib/engine/**              (v4)
//   - backend/lib/race*.{js,ts,mjs}      (v3 simulator, v4 bridge, race pipeline)
// A call counts as "with a locale" when it passes a second argument that is
// not `undefined`. compareIds(a, b) is always fine.
//
// Ratchet: race*-files outside the engine path that still had argument-less
// calls when the guard landed are listed in KNOWN_DEBT with their count. The
// count may only fall; a NEW call anywhere in scope fails CI. When a count
// falls, lower it here in the same PR. The engine path itself (engine/**,
// raceSimulator.js, raceEngineV4Bridge.js) has no allowance.
//
// Comments are blanked and string contents masked before scanning, so the
// pattern in a comment or string never trips the guard.
//
// Usage:
//   node scripts/check-locale-compare.mjs                 # default scope
//   node scripts/check-locale-compare.mjs path/to/file.ts # explicit files
//
// Exit codes: 0 ok · 1 violations · 2 internal error
//
// Refs #1857.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;
const ENGINE_DIR = "backend/lib/engine";
const LIB_DIR = "backend/lib";
const RACE_FILE_RE = /^race[^/]*\.(?:[cm]?js|ts)$/;

/**
 * Argument-less calls that existed in race*-files outside the engine path
 * when the guard landed (#1857). Counts may only go down.
 */
export const KNOWN_DEBT = Object.freeze({
  "backend/lib/raceAutopick.js": 6,
  "backend/lib/raceAvailabilityNotifications.js": 2,
  "backend/lib/raceBinding.js": 1,
  "backend/lib/raceCalendar.js": 1,
  "backend/lib/raceCalendarLanePacker.js": 4,
  "backend/lib/raceClassifications.js": 4,
  "backend/lib/raceDayCoverageReminder.js": 1,
  "backend/lib/raceDistribution.js": 3,
  "backend/lib/raceDominanceMetrics.js": 1,
  "backend/lib/raceEntryGenerator.js": 2,
  "backend/lib/raceIncidents.js": 2,
  "backend/lib/raceNarrative.js": 1,
  "backend/lib/racePassages.js": 2,
  "backend/lib/racePeakPlans.js": 1,
  "backend/lib/raceSensitivity.js": 1,
  "backend/lib/raceStageRoles.js": 2,
  "backend/lib/raceStory.js": 4,
});

/**
 * Blank comments and mask string contents (same length, newlines kept) so
 * parens inside strings or comments never confuse the scanner.
 * @param {string} src
 * @returns {string}
 */
export function maskSource(src) {
  const n = src.length;
  let out = "";
  let i = 0;
  // 0 code · 1 line comment · 2 block comment · 3 '..' · 4 ".." · 5 `..`
  let state = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 0) {
      if (c2 === "//") { state = 1; out += "  "; i += 2; continue; }
      if (c2 === "/*") { state = 2; out += "  "; i += 2; continue; }
      if (c === "'") { state = 3; out += c; i++; continue; }
      if (c === '"') { state = 4; out += c; i++; continue; }
      if (c === "`") { state = 5; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 1) {
      if (c === "\n") { state = 0; out += "\n"; } else out += " ";
      i++; continue;
    }
    if (state === 2) {
      if (c2 === "*/") { state = 0; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (c === "\\") { out += "  "; i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === "`")) {
      state = 0; out += c; i++; continue;
    }
    out += c === "\n" ? "\n" : "x"; i++;
  }
  return out;
}

function matchingClose(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level comma-separated arguments of a masked argument span. */
function splitArgs(span) {
  const args = [];
  let depth = 0;
  let cur = "";
  for (const c of span) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() !== "") args.push(cur.trim());
  return args;
}

const NO_LOCALE = new Set(["", "undefined", "void 0", "[]"]);
const CALLS = [
  { re: /\.localeCompare\s*\(/g, localeArg: 1, label: "localeCompare without a locale" },
  { re: /\bIntl\.Collator\s*\(/g, localeArg: 0, label: "Intl.Collator without a locale" },
];

/**
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,kind:string,snippet:string}>}
 */
export function scan(source, filename = "<source>") {
  const code = maskSource(source);
  const srcLines = source.split("\n");
  const findings = [];
  for (const { re, localeArg, label } of CALLS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = matchingClose(code, openIdx);
      const span = closeIdx === -1 ? "" : code.slice(openIdx + 1, closeIdx);
      const args = splitArgs(span);
      const locale = args[localeArg];
      if (locale !== undefined && !NO_LOCALE.has(locale)) continue;
      const line = code.slice(0, m.index).split("\n").length;
      findings.push({ file: filename, line, kind: label, snippet: (srcLines[line - 1] || "").trim().slice(0, 120) });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Compare per-file counts against KNOWN_DEBT.
 * @param {Array<{file:string}>} findings
 * @param {Record<string, number>} debt
 */
export function evaluate(findings, debt = KNOWN_DEBT) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const violations = [];
  const shrunk = [];
  for (const [file, list] of byFile) {
    const allowed = debt[file] ?? 0;
    if (list.length > allowed) violations.push({ file, allowed, found: list });
  }
  for (const [file, allowed] of Object.entries(debt)) {
    const n = byFile.get(file)?.length ?? 0;
    if (n < allowed) shrunk.push({ file, allowed, n });
  }
  return { violations, shrunk };
}

/** True for a repo-relative posix path the guard covers. */
export function inScope(relPath) {
  if (TEST_FILE_RE.test(relPath)) return false;
  if (!SCAN_EXTS.has(extname(relPath))) return false;
  if (relPath.startsWith(`${ENGINE_DIR}/`)) return true;
  if (!relPath.startsWith(`${LIB_DIR}/`)) return false;
  return RACE_FILE_RE.test(relPath.slice(LIB_DIR.length + 1));
}

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile()) acc.push(p);
  }
  return acc;
}

const toRel = (p) => relative(REPO_ROOT, resolve(p)).replace(/\\/g, "/");

export function defaultFiles() {
  const engine = walk(join(REPO_ROOT, ENGINE_DIR), []);
  const lib = readdirSync(join(REPO_ROOT, LIB_DIR)).map((e) => join(REPO_ROOT, LIB_DIR, e));
  return [...engine, ...lib].map(toRel).filter(inScope).sort();
}

function isMain() {
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

function run() {
  const explicit = process.argv.slice(2).map(toRel);
  const files = explicit.length > 0 ? explicit.filter(inScope) : defaultFiles();
  const findings = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(join(REPO_ROOT, f), "utf8"); } catch { continue; }
    findings.push(...scan(src, f));
  }
  const { violations, shrunk } = evaluate(findings);
  for (const s of shrunk) {
    console.log(`note: ${s.file} has ${s.n}/${s.allowed} known calls left; lower KNOWN_DEBT in scripts/check-locale-compare.mjs`);
  }
  if (violations.length > 0) {
    process.stderr.write("\nlocale-compare guard blocked: sorting that follows the process locale (#1857):\n");
    for (const v of violations) {
      process.stderr.write(`  ${v.file} (${v.found.length} found, ${v.allowed} allowed)\n`);
      for (const f of v.found) process.stderr.write(`    ${f.line}: ${f.kind}: ${f.snippet}\n`);
    }
    process.stderr.write(`
Why: without a locale, the order follows the machine. Prod (Railway) collates
as en-US, a Danish machine as da-DK ("aa" = "å"), so a replay or local run
no longer matches prod.

Fix: import { compareIds } from backend/lib/compareIds.ts and use
compareIds(a, b), or pass the locale explicitly: a.localeCompare(b, "en-US").

Refs #1857.
`);
    process.exit(1);
  }
  console.log(`locale-compare guard: no new violations (${files.length} files scanned).`);
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`check-locale-compare: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
