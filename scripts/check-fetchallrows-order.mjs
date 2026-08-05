#!/usr/bin/env node
// scripts/check-fetchallrows-order.mjs
// ============================================================
// Forward-guard: every fetchAllRows(...) call MUST carry a stable .order().
//
// Origin: fetchAllRows (backend/lib/supabasePagination.js) documents its own
// contract inline:
//   "VIGTIGT: buildQuery SKAL inkludere en stabil .order() (fx .order("id")),
//    ellers kan PostgREST returnere rækker i forskellig rækkefølge mellem
//    sider -> gaps eller dubletter på tværs af sider."
// Without a stable sort, Postgres/PostgREST is free to return rows in a
// different order between .range()-paged requests. That doesn't throw — it's
// SILENT data loss: rows can appear twice or not at all, page to page. The
// exact same bug class cost 88% and 38% data loss in #2951/#2962. #3391 found
// 15 call sites still violating the contract — a comment-only requirement
// drifts, so this guard enforces it mechanically at CI time (owner-chosen
// option (a) over enforcing inside fetchAllRows itself, #3391).
//
// This lint flags any `fetchAllRows(...)` call whose argument span contains a
// `.from(` (i.e. it wraps a real Supabase query builder, not e.g. a test mock
// with no real query) but no `.order(`. Tokenises first (strip comments,
// preserve strings) exactly like lint-pagination-guard.mjs /
// lint-postgrest-in-cap.mjs, so it never trips on the pattern inside a
// comment or string literal.
//
// Deliberately scoped to the literal `fetchAllRows(` identifier — NOT
// `fetchAllRowsChunkedIn(`, which delegates to fetchAllRows internally per
// chunk and is a related-but-separate contract to guard (see PR #3391 body
// for related fetchAllRowsChunkedIn(...) call sites found during the same
// sweep). No escape hatch: unlike lint-pagination-guard's deny-list (which has
// genuinely row-bounded exceptions), a stable .order() on a paginated,
// range()-split read has no legitimate exception — fetchAllRows only exists to
// load MORE than one page, so its buildQuery must always sort deterministically.
//
// Usage:
//   node scripts/check-fetchallrows-order.mjs                 # default dirs
//   node scripts/check-fetchallrows-order.mjs path/to/file.js # explicit files
//   npm run check:fetchallrows-order
//
// Exit codes:
//   0 — no findings
//   1 — at least one fetchAllRows(...) call with .from(...) but no .order(...)
//   2 — internal error
//
// Refs #3391 #2951 #2962.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRS = ['backend', 'frontend/src'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;
const MAX_CALL_SCAN = 4000; // char cap so an unbalanced call can't runaway-scan a whole file

/**
 * Blank // line-comments and /* *​/ block-comments while PRESERVING string
 * literals (a table name argument to `.from(...)` IS a string) and newlines
 * (so line numbers stay accurate). Same approach as lint-pagination-guard.mjs
 * (each lint stays standalone per repo convention).
 *
 * @param {string} src
 * @returns {string} same-length source with comments blanked
 */
export function stripCommentsKeepStrings(src) {
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
      if (c === "'") { state = 3; out += c; i++; continue; }
      if (c === '"') { state = 4; out += c; i++; continue; }
      if (c === '`') { state = 5; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 1) { // line comment
      if (c === '\n') { state = 0; out += '\n'; } else out += ' ';
      i++; continue;
    }
    if (state === 2) { // block comment
      if (c2 === '*/') { state = 0; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    // string states 3/4/5 — preserve chars, honour backslash escapes
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) {
      state = 0;
    }
    out += c; i++; continue;
  }
  return out;
}

/**
 * Return the index of the paren/bracket/brace matching the opener at
 * `openIdx` (which must point AT the opening char), or -1 if unbalanced.
 */
function matchingClose(code, openIdx) {
  const open = code[openIdx];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Literal `fetchAllRows(` only — `\b` before AND the lack of further
// identifier chars after `Rows` before the paren means `fetchAllRowsChunkedIn(`
// does NOT match (it has "ChunkedIn" between "Rows" and "(").
const FETCH_ALL_ROWS_CALL = /\bfetchAllRows\s*\(/g;
const FROM_RE = /\.from\s*\(/;
const ORDER_RE = /\.order\s*\(/;

/**
 * Scan one source for `fetchAllRows(...)` calls whose argument wraps a real
 * `.from(...)` query builder but never chains `.order(...)`.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,snippet:string}>}
 */
export function scan(source, filename = '<source>') {
  const code = stripCommentsKeepStrings(source);
  const srcLines = source.split('\n');
  const findings = [];

  FETCH_ALL_ROWS_CALL.lastIndex = 0;
  let m;
  while ((m = FETCH_ALL_ROWS_CALL.exec(code)) !== null) {
    const openIdx = m.index + m[0].length - 1; // index of the '('
    const closeIdx = matchingClose(code, openIdx);
    const span = closeIdx !== -1
      ? code.slice(openIdx, closeIdx + 1)
      : code.slice(openIdx, Math.min(code.length, openIdx + MAX_CALL_SCAN));

    if (!FROM_RE.test(span)) continue; // no real query builder in here — out of scope
    if (ORDER_RE.test(span)) continue; // stable sort present — safe

    const callLine = code.slice(0, m.index).split('\n').length; // 1-based
    findings.push({
      file: filename,
      line: callLine,
      snippet: (srcLines[callLine - 1] || '').trim().slice(0, 120),
    });
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
    else if (st.isFile() && SCAN_EXTS.has(extname(p)) && !TEST_FILE_RE.test(p)) acc.push(p);
  }
  return acc;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const explicitFiles = process.argv.slice(2);
  const files = explicitFiles.length > 0 ? explicitFiles : DEFAULT_DIRS.flatMap((d) => walk(d, []));

  const findings = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    findings.push(...scan(src, f));
  }

  if (findings.length > 0) {
    process.stderr.write(`\n🔴 fetchAllRows order guard blocked: ${findings.length} call(s) missing a stable .order():\n`);
    for (const f of findings) process.stderr.write(`   ${f.file}:${f.line}: ${f.snippet}\n`);
    process.stderr.write(`
Background: fetchAllRows (backend/lib/supabasePagination.js) pages through a
table with .range(). Without a stable .order() (e.g. .order("id")), Postgres
can return rows in a different order between pages — SILENT data loss (rows
duplicated or dropped), not a thrown error. This exact class cost 88%/38% data
loss in #2951/#2962; #3391 found 15 more call sites.

Fix: chain a stable, unique sort key onto the query passed to fetchAllRows,
e.g. .order("id") for a table with an id primary key.

No escape hatch — a fetchAllRows(...) call has no legitimate reason to omit
this; it exists specifically to page through more than one page of rows.

Refs #3391 #2951 #2962.
`);
    process.exit(1);
  }

  console.log(`\n✅ fetchAllRows order guard: no violations (${files.length} files scanned).`);
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`check-fetchallrows-order: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
