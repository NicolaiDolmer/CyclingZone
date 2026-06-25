#!/usr/bin/env node
// scripts/lint-postgrest-in-cap.mjs
// ============================================================
// Forward-guard for the PostgREST 1000-row-cap truncation class.
//
// Origin: the same bug shipped THREE times —
//   #1798  autofill "57% fuldt" — falsk lave tal fra trunkeret .in()
//   #1839  entry-generator — tavs 1000-rækkers trunkering
//   #1841  distribution-tidslinje buildTimeline — race_stage_profiles glyffer
//
// The shape is always the same: a Supabase/PostgREST `.in("col", ids)` filter
// whose id-list is built with `ids.slice(0, N)`. PostgREST silently caps a
// response at 1000 rows, and slicing the id-list to a fixed N caps the INPUT —
// either way you get a TRUNCATED result with no error, so counts/aggregates
// read falsely low. The fix is always range-pagination + id-chunking (see
// fetchAllRows in backend/lib/supabasePagination.js, or fetchAllScheduleRows /
// fetchAllStageProfiles in backend/routes/api.js).
//
// This lint flags `.in( ... .slice(0, <number>) ... )` in backend + frontend
// source. It tokenises first so it never trips on the pattern when it appears
// inside a // comment, a /* */ block, or a string literal (the api.js docstring
// "Det gamle .in(race_ids.slice(0,1000))" must NOT be flagged).
//
// Escape hatch: put `postgrest-cap-ok` in a comment on the same line or the
// line directly above when a fixed slice is genuinely intentional (e.g. you
// truly want only the first N and N < 1000 cannot truncate the intent).
//
// Usage:
//   node scripts/lint-postgrest-in-cap.mjs                 # default globs
//   node scripts/lint-postgrest-in-cap.mjs path/to/file.js # explicit files
//   npm run lint:postgrest-cap
//
// Exit codes:
//   0 — no findings
//   1 — at least one truncating .in(...slice) found
//   2 — internal error
//
// Refs #1798 #1839 #1841. Memory: reference_postgrest_1000_row_cap_in_scripts.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRS = ['backend', 'frontend/src'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const OPT_OUT = 'postgrest-cap-ok';

/**
 * Replace // line comments, block comments and string/template literals with
 * blanks of equal length, preserving newlines so line numbers stay accurate.
 * Deliberately small: good enough to keep the .in()/.slice() regex from
 * matching inside comments and strings. Not a full JS parser.
 *
 * @param {string} src
 * @returns {string} same-length scrubbed source
 */
export function stripCommentsAndStrings(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // 0 code · 1 line-comment · 2 block-comment · 3 '..' · 4 ".." · 5 `..`
  let state = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 0) {
      if (c2 === '//') { state = 1; out += '  '; i += 2; continue; }
      if (c2 === '/*') { state = 2; out += '  '; i += 2; continue; }
      if (c === "'") { state = 3; out += ' '; i++; continue; }
      if (c === '"') { state = 4; out += ' '; i++; continue; }
      if (c === '`') { state = 5; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (c === '\n') { if (state === 1) state = 0; out += '\n'; i++; continue; }
    if (state === 1) { out += ' '; i++; continue; }
    if (state === 2) {
      if (c2 === '*/') { state = 0; out += '  '; i += 2; continue; }
      out += ' '; i++; continue;
    }
    // string states 3/4/5 — honour backslash escapes, blank everything out
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) {
      state = 0; out += ' '; i++; continue;
    }
    out += ' '; i++; continue;
  }
  return out;
}

/**
 * Return the substring inside the balanced parentheses that start at openIdx
 * (which must point AT the '('). Null on imbalance.
 */
function balancedArgs(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return code.slice(openIdx + 1, i); }
  }
  return null;
}

const SLICE_CAP = /\.slice\s*\(\s*0\s*,\s*\d+\s*\)/;
const IN_CALL = /\.in\s*\(/g;

/**
 * Scan one source for truncating `.in( ... .slice(0, N) ... )` patterns.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,snippet:string}>}
 */
export function scan(source, filename = '<source>') {
  const code = stripCommentsAndStrings(source);
  const srcLines = source.split('\n');
  const findings = [];
  IN_CALL.lastIndex = 0;
  let m;
  while ((m = IN_CALL.exec(code)) !== null) {
    const openIdx = code.indexOf('(', m.index);
    if (openIdx === -1) continue;
    const args = balancedArgs(code, openIdx);
    if (args === null || !SLICE_CAP.test(args)) continue;
    const line = code.slice(0, m.index).split('\n').length;
    // Escape hatch: opt-out marker on this line or the line directly above.
    const here = srcLines[line - 1] || '';
    const above = srcLines[line - 2] || '';
    if (here.includes(OPT_OUT) || above.includes(OPT_OUT)) continue;
    findings.push({ file: filename, line, snippet: (srcLines[line - 1] || '').trim().slice(0, 120) });
  }
  return findings;
}

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === 'build' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && SCAN_EXTS.has(extname(p))) acc.push(p);
  }
  return acc;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const args = process.argv.slice(2);
  const files = args.length ? args : DEFAULT_DIRS.flatMap((d) => walk(d, []));
  let bad = 0;
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const fnd of scan(src, f)) {
      bad++;
      process.stderr.write(`${fnd.file}:${fnd.line}: .in() id-list truncated by .slice(0, N): ${fnd.snippet}\n`);
    }
  }
  if (bad > 0) {
    process.stderr.write(`
🔴 PostgREST cap guard blocked: ${bad} truncating .in(...).slice(0, N) call(s).

Background: this exact bug shipped 3× (#1798, #1839, #1841). PostgREST silently
caps at 1000 rows and a fixed .slice(0, N) caps the id-list — counts/aggregates
read falsely low with NO error.

Fix: range-paginate + id-chunk instead. Reuse fetchAllRows
(backend/lib/supabasePagination.js) or the fetchAll* helpers in api.js.

Intentional fixed slice? Add a "${OPT_OUT}" comment on the line (or the line
above) with a one-line reason.

Refs #1798 #1839 #1841.
`);
    process.exit(1);
  }
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`lint-postgrest-in-cap: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
