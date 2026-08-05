#!/usr/bin/env node
// scripts/lint-pagination-guard.mjs
// ============================================================
// Forward-guard for the PostgREST silent-1000-row-cap truncation class.
//
// Origin: the exact same bug shipped twice, months apart —
//   2026-05-30  .claude/learnings/2026-05-30-pcm-matcher-1000-row-pagination.md
//               PCM rider-matcher only indexed the first 1000 of 8.699 riders
//               → 88% of riders invisible to matching, lost points/prizes.
//   2026-08-04  .claude/learnings/2026-08-04-sponsor-race-results-unpaginated-query.md
//               (#3315) sponsorRaceDayIncome underpaid a human team ~94% because
//               a >1000-row race_results query silently dropped stage-win/podium
//               rows. Caught by a player, not a test, either time.
//
// PostgREST returns AT MOST 1000 rows per select unless you page with
// `.range()`. A naive `.from(<big table>).select(...)` lies silently: no error,
// just a truncated result, so counts/aggregates/matches read falsely low.
//
// This lint flags any `.from(<table>)` against a DENY-listed (known-unbounded)
// table whose call is NOT provably bounded:
//   - no `.limit(`, `.single(`, `.maybeSingle(`, or `.range(` chained anywhere
//     in the same statement, AND
//   - not delegated to a `fetchAll*(...)` pagination helper (fetchAllRows,
//     fetchAllRowsChunkedIn, fetchAllRowsOrThrow, fetchAllPaged, fetchAll, …
//     — any identifier starting with "fetchAll" whose argument list the
//     `.from(` call lives inside; see backend/lib/supabasePagination.js).
//
// Escape hatch: a `pagination-safe: <reason>` comment anywhere in the same
// statement (same line, line above, or trailing on a chain line) when the row
// cap is PROVABLY unreachable for this query (e.g. filtered to a single row
// by a unique key, or a table that structurally cannot exceed ~1000 rows).
// The reason is mandatory in spirit — this is a deny-list break-glass, not a
// blanket opt-out — but only the marker text itself is mechanically checked.
//
// DENY_TABLES is deliberately a hard-coded allowlist-of-risk, not a directory
// scan of every Supabase table: only tables that are known to grow past 1000
// rows in a live season. Extend it (never shrink it silently) as new tables
// prove unbounded — see docs/GAME_INVARIANTS.md.
//
// This lint tokenises first so it never trips on the pattern inside a //
// comment or /* */ block. Unlike lint-getuser-guard/lint-postgrest-in-cap, it
// PRESERVES string contents (stripCommentsKeepStrings, same approach as
// lint-rankings-raceresults-fetch) because the forbidden `.from("race_results")`
// argument IS a string literal.
//
// Usage:
//   node scripts/lint-pagination-guard.mjs                 # default dirs (backend, frontend/src)
//   node scripts/lint-pagination-guard.mjs path/to/file.js  # explicit files
//   npm run lint:pagination-guard
//
// Exit codes:
//   0 — no findings
//   1 — at least one unbounded select against a deny-listed table
//   2 — internal error
//
// Refs #3331 #3315 #770. Learnings:
//   .claude/learnings/2026-05-30-pcm-matcher-1000-row-pagination.md
//   .claude/learnings/2026-08-04-sponsor-race-results-unpaginated-query.md

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Known-unbounded tables (grow past 1000 rows in a live season). "At least
// these" per #3331 — extend as new tables prove unbounded, never shrink
// silently. Kept in sync with docs/GAME_INVARIANTS.md.
export const DENY_TABLES = [
  'race_results',
  'riders',
  'race_entries',
  'race_stage_schedule',
  'race_stage_profiles',
  'finance_transactions',
  'notifications',
];

const DEFAULT_DIRS = ['backend', 'frontend/src'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const BASELINE_PATH = 'scripts/pagination-guard-baseline.json';
const OPT_OUT = 'pagination-safe:';
const MAX_STATEMENT_SCAN = 4000; // char cap so a missing ';' can't runaway-scan a whole file
const ESCAPE_LOOKBACK_LINES = 6; // how far above the `.from(` line an opt-out comment may sit

/**
 * Blank // line-comments and /* *​/ block-comments while PRESERVING string
 * literals (the forbidden `.from("race_results")` argument IS a string) and
 * newlines (so line numbers stay accurate). Copied from
 * lint-rankings-raceresults-fetch.mjs (each lint stays standalone).
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

// Any identifier starting "fetchAll" immediately followed by a call — the
// established pagination-delegation convention across the codebase
// (fetchAllRows, fetchAllRowsChunkedIn, fetchAllRowsOrThrow, fetchAllPaged,
// fetchAllRaceRows, fetchAllScheduleRows, fetchAllStageProfiles, fetchAll, …).
const FETCH_ALL_CALL = /\bfetchAll[A-Za-z]*\s*\(/g;

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FROM_CALL = new RegExp(
  `\\.from\\(\\s*(['"\`])(${DENY_TABLES.map(reEsc).join('|')})\\1\\s*\\)`,
  'g',
);
const GUARD_RE = /\.(?:limit|single|maybeSingle|range)\s*\(/;

/**
 * Scan one source for `.from(<deny-table>)` selects that are neither bounded
 * (.limit/.single/.maybeSingle/.range in the same statement) nor delegated to
 * a fetchAll*(...) pagination helper.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,table:string,snippet:string}>}
 */
export function scan(source, filename = '<source>') {
  const code = stripCommentsKeepStrings(source);
  const srcLines = source.split('\n');
  const findings = [];

  // Pre-compute fetchAll*(...) argument ranges once per file.
  const fetchAllRanges = [];
  FETCH_ALL_CALL.lastIndex = 0;
  let fm;
  while ((fm = FETCH_ALL_CALL.exec(code)) !== null) {
    const openIdx = fm.index + fm[0].length - 1; // position of the '('
    const closeIdx = matchingClose(code, openIdx);
    if (closeIdx !== -1) fetchAllRanges.push([openIdx, closeIdx]);
  }
  const isWrappedByFetchAll = (idx) =>
    fetchAllRanges.some(([s, e]) => idx > s && idx < e);

  FROM_CALL.lastIndex = 0;
  let m;
  while ((m = FROM_CALL.exec(code)) !== null) {
    const table = m[2];
    const callIdx = m.index; // index of the leading '.'

    // Scope to genuine READS: `.select(` must be the call chained IMMEDIATELY
    // after `.from(table)` (Supabase's query-builder shape). This excludes
    // .from(table).update(...)/.insert(...)/.delete(...)/.upsert(...) — those
    // are mutations, not the "load N rows into memory" read pattern the two
    // postmortems are about. An `.insert(rows).select()` mutation-with-echo is
    // a materially different, much lower-risk shape (the write itself is never
    // row-capped; only its returned confirmation payload could be) and is out
    // of scope here — matches the literal pattern in #3331's own wording.
    const afterFrom = code.slice(m.index + m[0].length);
    const selectMatch = /^\s*\.select\s*\(/.exec(afterFrom);
    if (!selectMatch) continue;

    // `.select(cols, { head: true })` (with or without count: "exact") never
    // returns row data at all — it's a HEAD-style request answered from the
    // Content-Range header, so it structurally cannot hit the row cap.
    // Mechanically safe, no annotation needed (unlike the `count`-without-
    // `head` shape, which DOES return up to page-size rows alongside the
    // header and stays in scope).
    const selectOpenIdx = m.index + m[0].length + selectMatch[0].length - 1;
    const selectClose = matchingClose(code, selectOpenIdx);
    if (selectClose !== -1) {
      const selectArgs = code.slice(selectOpenIdx + 1, selectClose);
      if (/\bhead\s*:\s*true\b/.test(selectArgs)) continue;
    }

    if (isWrappedByFetchAll(callIdx)) continue; // delegated to a pagination helper — safe

    // Backward statement start: walk left tracking bracket depth (mirrors the
    // forward scan) so a destructuring LHS on the SAME statement (`const {
    // data, error } = await supabase.from(...)`) is correctly treated as
    // BALANCED — not a block boundary — while an unmatched opening bracket
    // (the enclosing function/block's '{', or a preceding call's '(') OR a
    // top-level ';' correctly stops the walk. Plain lastIndexOf('{'/';') would
    // either misfire on the destructure's own braces or miss a statement that
    // opens a function body with no preceding ';'.
    const backWindowStart = Math.max(0, callIdx - MAX_STATEMENT_SCAN);
    let bDepth = 0;
    let stmtStartIdx = backWindowStart;
    for (let i = callIdx - 1; i >= backWindowStart; i--) {
      const c = code[i];
      if (c === ')' || c === ']' || c === '}') bDepth++;
      else if (c === '(' || c === '[' || c === '{') {
        if (bDepth === 0) { stmtStartIdx = i + 1; break; }
        bDepth--;
      } else if (c === ';' && bDepth === 0) { stmtStartIdx = i + 1; break; }
    }

    // Forward statement span: track bracket depth from callIdx until it
    // returns to 0 at a top-level ';', or a char cap as a runaway guard.
    let depth = 0;
    let endIdx = Math.min(code.length, callIdx + MAX_STATEMENT_SCAN);
    for (let i = callIdx; i < code.length; i++) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth <= 0) { endIdx = i; break; }
      if (i - callIdx >= MAX_STATEMENT_SCAN) break;
    }
    const span = code.slice(callIdx, endIdx);
    if (GUARD_RE.test(span)) continue; // bounded directly — safe

    // Deferred query-building: `let query = supabase.from(table).select(...);`
    // followed LATER (a separate statement, possibly after conditional
    // re-assignment) by `return query.limit(1)` / `query = query.range(...)`.
    // If this statement's own text is exactly a `(let|const|var) <name> = …`
    // declaration, look further forward (past this statement) for a guard
    // token chained specifically onto that variable.
    const declMatch = /^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(
      code.slice(stmtStartIdx, callIdx),
    );
    if (declMatch) {
      const varName = declMatch[1];
      // Any later occurrence of the variable followed (within a short window,
      // allowing intervening chained calls like `.eq(...)`/`.order(...)`) by a
      // guard token counts — covers both reassignment (`query = query.order
      // (...).range(...)`) and a direct read (`await query.order(...)
      // .range(...)`).
      const varRe = new RegExp(`\\b${varName}\\b[\\s\\S]{0,300}?\\.(?:limit|single|maybeSingle|range)\\s*\\(`);
      const extendedEnd = Math.min(code.length, endIdx + MAX_STATEMENT_SCAN);
      if (varRe.test(code.slice(endIdx, extendedEnd))) continue; // bounded later via the reassigned/returned query var — safe
    }

    const callLine = code.slice(0, callIdx).split('\n').length; // 1-based

    const endLine = code.slice(0, endIdx).split('\n').length;   // 1-based

    // Escape hatch: "pagination-safe:" anywhere from ESCAPE_LOOKBACK_LINES
    // above the call through the end of the statement — deliberately a fixed
    // LINE window, not statement-boundary math, so it isn't fooled by braces
    // that belong to a destructuring LHS on the same statement (`const {
    // data, error } = await supabase.from(...)`). Covers same-line, above the
    // chain, above the enclosing declaration (e.g. above a JSDoc-style intro
    // comment before `async function …`), and trailing-on-chain placements.
    const escapeWindow = srcLines.slice(Math.max(0, callLine - 1 - ESCAPE_LOOKBACK_LINES), endLine).join('\n');
    if (escapeWindow.includes(OPT_OUT)) continue;

    findings.push({
      file: filename,
      line: callLine,
      table,
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
    else if (st.isFile() && SCAN_EXTS.has(extname(p))) acc.push(p);
  }
  return acc;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

// --- Baseline-ratchet (kun stigninger fejler) ------------------------------
//
// #3331's backwards-check found ~120 pre-existing findings against tables
// that ARE provably safe by construction TODAY (single-team/single-race
// scoping verified against prod row counts — see the PR body / audit for the
// numbers), but annotating all of them with individual `pagination-safe:`
// comments in one PR was deprioritised vs. shipping the forward-guard itself
// (#3331 explicitly ranks the guard over exhaustive call-site fixes). A
// baseline — same ratchet shape as scripts/lint-ui-slop.mjs — lets the guard
// go live TODAY against every NEW call site while the known backlog is
// tracked and shrinks over time, instead of either (a) blocking this PR on
// annotating ~120 sites, or (b) not shipping the guard at all.
//
// Counted per FILE × TABLE (not a flat per-file count) so a regression in one
// table can't hide behind an unrelated fix in another table in the same file.

function countsByFile(findings) {
  const byFile = {};
  for (const f of findings) {
    byFile[f.file] ??= {};
    byFile[f.file][f.table] = (byFile[f.file][f.table] || 0) + 1;
  }
  return byFile;
}

export function compareAgainstBaseline(findings, baseline) {
  const cur = countsByFile(findings);
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, tables] of Object.entries(cur)) {
    const allowed = base[file] || {};
    for (const table of DENY_TABLES) {
      const n = tables[table] || 0;
      const max = allowed[table] || 0;
      if (n > max) {
        newViolations.push(`${file} — ${table}: ${n} (baseline tillader ${max}, +${n - max} ny(e))`);
      }
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const tables = cur[file] || {};
    for (const table of DENY_TABLES) {
      const max = allowed[table] || 0;
      if (max > 0 && (tables[table] || 0) < max) {
        stale.push(`${file} — ${table}: ${tables[table] || 0}/${max} tilbage (baseline kan strammes)`);
      }
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = countsByFile(findings);
  const sorted = {};
  for (const file of Object.keys(files).sort()) sorted[file] = files[file];
  return {
    $comment:
      'Kendte upaginerede selects mod deny-listede tabeller (ratchet — maa kun skrumpe). '
      + 'De fleste er verificeret sikre pr. 2026-08-05 (single-team/single-race-scoping, se PR-body '
      + 'for #3331-audittens rækketal), men ikke alle er annoteret inline endnu. '
      + 'Genereret af scripts/lint-pagination-guard.mjs --update-baseline. Refs #3331. '
      + 'Nye overtrædelser må IKKE tilføjes her — paginér med fetchAllRows, eller tilføj en '
      + '"pagination-safe: <begrundelse>"-kommentar og fjern entryen herfra.',
    files: sorted,
  };
}

function run() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const explicitFiles = args.filter((a) => a !== '--update-baseline');
  const usingDefaultDirs = explicitFiles.length === 0;
  const files = usingDefaultDirs ? DEFAULT_DIRS.flatMap((d) => walk(d, [])) : explicitFiles;

  const findings = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    findings.push(...scan(src, f));
  }

  // Baseline only applies to the default whole-repo scan (mirrors
  // lint-ui-slop.mjs) — an explicit-file invocation (ad-hoc dev check, or a
  // single-file CI/test assertion) always reports raw findings, unratcheted.
  if (!usingDefaultDirs) {
    for (const fnd of findings) {
      process.stderr.write(`${fnd.file}:${fnd.line}: unbounded select against deny-listed table "${fnd.table}": ${fnd.snippet}\n`);
    }
    if (findings.length > 0) process.exit(1);
    process.exit(0);
  }

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + '\n');
    console.log(`✅ Baseline skrevet til ${BASELINE_PATH} (${findings.length} kendte overtrædelser).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`ℹ️  ${stale.length} baseline-entr${stale.length === 1 ? 'y' : 'ies'} skrumpet (fixet) — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log('   → node scripts/lint-pagination-guard.mjs --update-baseline');
  }

  if (newViolations.length > 0) {
    process.stderr.write(`\n🔴 Pagination guard blocked: ${newViolations.length} NY(E) unbounded select(s) against a deny-listed table (ikke i baseline):\n`);
    for (const v of newViolations) process.stderr.write(`   - ${v}\n`);
    process.stderr.write(`
Background: PostgREST silently caps a response at 1000 rows. This exact class
shipped twice (PCM rider-matcher 2026-05-30, sponsor race-results #3315
2026-08-04) — both caught by a player, not a test.

Deny-listed tables: ${DENY_TABLES.join(', ')}.

Fix: paginate with fetchAllRows / fetchAllRowsChunkedIn
(backend/lib/supabasePagination.js), or add .limit()/.single()/.maybeSingle()
if the result is provably bounded.

Provably safe some other way (e.g. filtered to a unique row by a key the DB
enforces unique)? Add a "${OPT_OUT} <reason>" comment on the call line, the
line above, or trailing on the chain.

Baseline må IKKE udvides med nye overtrædelser (ratchet, Refs #3331).

Refs #3331 #3315.
`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\n✅ Pagination guard: ingen nye overtrædelser (${knownFiles} kendte baseline-filer, ${findings.length} baseline-fund tilbage).`);
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`lint-pagination-guard: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
