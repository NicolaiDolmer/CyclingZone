#!/usr/bin/env node
// scripts/check-maybesingle-unique-scope.mjs
// ============================================================
// Forward-guard: `.maybeSingle()` must be scoped by the FULL multi-column
// UNIQUE key of the table it queries.
//
// Origin (#4484, root cause of a 23-failed-sweep-runs night + a manager who
// could not use his own button):
//   .eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
// academy_graduation is UNIQUE (rider_id, season_id). The filter covered
// season_id — the ONE column that disambiguates rows — never. Two rows
// matched, PostgREST answered PGRST116 (multiple/no rows) AND `data: null`,
// and all four call sites read that as "no such row exists". Invisible in
// review (the line reads correctly), invisible to a naive mock (it returns
// the fixture regardless of filters, see #3620/PR #4494), and it only bites
// once a rider reaches a second academy season. Exactly the class a static
// guard is good at.
//
// This lint walks BACKWARD from every `.maybeSingle()` call to the nearest
// `.from("table")` in the same statement, collects the `.eq("col", …)`
// columns chained in between, and flags the call when the table has a known
// multi-column UNIQUE constraint that those columns do not fully cover.
// `.eq("id", …)` and any `.limit(…)` are treated as covered — filtering by
// primary key, or capping to one row, already guarantees at most one match
// regardless of any other composite key.
//
// Constraint source: database/schema-snapshot.json mirrors columns ONLY (no
// constraint metadata, confirmed 2/9 — see its own $comment). Per #4496's
// plan this guard therefore reads UNIQUE constraints straight out of the
// committed database/*.sql migrations (CREATE TABLE ... UNIQUE(...), ALTER
// TABLE ... ADD CONSTRAINT ... UNIQUE(...), and non-partial CREATE UNIQUE
// INDEX ... ON table(...)) — static, no DB access, and self-updating: a
// FUTURE migration that adds a composite UNIQUE is picked up automatically,
// no code change needed here. A handful of tables predate the database/*.sql
// migration-file convention and have no committed CREATE TABLE at all
// (verified 2/9: grep for their name across database/*.sql matches nothing
// but comments/DML) — those are listed in UNDOCUMENTED_TABLE_CONSTRAINTS
// below, sourced from the issue's own pg_constraint dump (#4496 comment,
// 2026-08-31) and cross-checked column-for-column against
// database/schema-snapshot.json.
//
// Per #4496: the snapshot is known-stale (#4142/#4326). Rather than silently
// skip a `.from("table")` this guard cannot place, it fails LOUDLY when the
// literal table name is missing from schema-snapshot.json entirely — that
// means the guard's own data may be stale, not that the call site is safe.
//
// Escape hatch: a `maybesingle-scope-ok: <reason>` comment on the call line,
// the line above, or trailing on the chain — same style as
// lint-pagination-guard's `pagination-safe:` (mandatory in spirit, only the
// marker text is mechanically checked).
//
// Usage:
//   node scripts/check-maybesingle-unique-scope.mjs                 # default dirs
//   node scripts/check-maybesingle-unique-scope.mjs path/to/file.js # explicit files
//   npm run check:maybesingle-unique-scope
//
// Exit codes:
//   0 — no findings
//   1 — at least one under-scoped .maybeSingle(), or a table this guard
//       could not resolve against database/schema-snapshot.json
//   2 — internal error
//
// Refs #4496 #4484. Learning:
//   .claude/learnings/2026-08-31-en-raekke-pr-saeson-laeste-som-ingen-raekke.md

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRS = ['backend', 'frontend/src'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;
const SQL_DIR = 'database';
const SNAPSHOT_PATH = 'database/schema-snapshot.json';
const OPT_OUT = 'maybesingle-scope-ok:';
const MAX_STATEMENT_SCAN = 4000; // char cap so a missing statement boundary can't runaway-scan a whole file
const ESCAPE_LOOKBACK_LINES = 6;

// Tables whose CREATE TABLE predates the database/*.sql migration-file
// convention (verified 2/9: no CREATE TABLE for these names anywhere under
// database/*.sql). Column sets sourced from the pg_constraint dump the issue
// author ran directly against prod on 2026-08-31 (#4496 comment) — NOT a
// live query this guard performs. Cross-checked 2/9 against
// database/schema-snapshot.json: every column below is a real column on that
// relation. Re-verify against pg_constraint if any of these tables' UNIQUE
// constraints ever change — this guard cannot detect that on its own.
const UNDOCUMENTED_TABLE_CONSTRAINTS = {
  manager_achievements: [['user_id', 'achievement_id']],
  rider_watchlist: [['user_id', 'rider_id']],
  prize_tables: [['race_type', 'result_type', 'rank']],
  loan_config: [['division', 'loan_type']],
};

/**
 * Blank // line-comments and /* *​/ block-comments while PRESERVING string
 * literals and newlines (so line numbers stay accurate). Same approach as
 * lint-pagination-guard.mjs / check-fetchallrows-order.mjs (each lint stays
 * standalone per repo convention).
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

// --- SQL constraint extraction ---------------------------------------------

/**
 * Strip `--` line comments and `/* *​/` block comments from a SQL source
 * (no string-literal awareness needed — DDL we care about never has a `--`
 * or `/*` inside a quoted identifier here).
 * @param {string} sql
 */
function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingParenClose(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const IDENT = '[a-z_][a-z0-9_]*';
const CREATE_TABLE_RE = new RegExp(
  `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:public\\.)?"?(${IDENT})"?\\s*\\(`, 'gi',
);
const TABLE_UNIQUE_RE = /(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(([^)]+)\)/gi;
const ALTER_ADD_UNIQUE_RE = new RegExp(
  `ALTER TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?"?(${IDENT})"?\\s+ADD CONSTRAINT\\s+\\w+\\s+UNIQUE\\s*\\(([^)]+)\\)`, 'gi',
);
const CREATE_UNIQUE_INDEX_RE = new RegExp(
  `CREATE UNIQUE INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF NOT EXISTS\\s+)?\\w+\\s+ON\\s+(?:public\\.)?"?(${IDENT})"?\\s*\\(([^)]+)\\)`, 'gi',
);
const PLAIN_COL_RE = /^[a-z_][a-z0-9_]*$/;

function splitCols(raw) {
  return raw.split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
}

/**
 * Extract multi-column UNIQUE constraints from one SQL source. Deliberately
 * conservative: only plain-column, non-partial constraints count — a
 * `CREATE UNIQUE INDEX ... WHERE ...` (partial index) only guarantees
 * uniqueness within its filter, not table-wide, so including it here would
 * let a genuinely under-scoped `.maybeSingle()` pass as "safe" (a false
 * negative for THIS guard, i.e. reduced coverage) rather than raise a false
 * alarm. #4496 explicitly ranks 0 false positives above exhaustive coverage.
 *
 * @param {string} sql
 * @returns {Array<{table:string, cols:string[]}>}
 */
export function parseUniqueConstraintsFromSql(sql) {
  const src = stripSqlComments(sql);
  const out = [];

  CREATE_TABLE_RE.lastIndex = 0;
  let m;
  while ((m = CREATE_TABLE_RE.exec(src)) !== null) {
    const table = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchingParenClose(src, openIdx);
    if (closeIdx === -1) continue;
    const body = src.slice(openIdx + 1, closeIdx);
    TABLE_UNIQUE_RE.lastIndex = 0;
    let um;
    while ((um = TABLE_UNIQUE_RE.exec(body)) !== null) {
      const cols = splitCols(um[1]);
      if (cols.length >= 2 && cols.every((c) => PLAIN_COL_RE.test(c))) out.push({ table, cols });
    }
  }

  ALTER_ADD_UNIQUE_RE.lastIndex = 0;
  while ((m = ALTER_ADD_UNIQUE_RE.exec(src)) !== null) {
    const cols = splitCols(m[2]);
    if (cols.length >= 2 && cols.every((c) => PLAIN_COL_RE.test(c))) out.push({ table: m[1], cols });
  }

  CREATE_UNIQUE_INDEX_RE.lastIndex = 0;
  while ((m = CREATE_UNIQUE_INDEX_RE.exec(src)) !== null) {
    const afterIdx = m.index + m[0].length;
    const semiIdx = src.indexOf(';', afterIdx);
    const stmtTail = src.slice(afterIdx, semiIdx === -1 ? afterIdx + 200 : semiIdx);
    if (/\bWHERE\b/i.test(stmtTail)) continue; // partial index — see doc comment above
    const cols = splitCols(m[2]);
    if (cols.length >= 2 && cols.every((c) => PLAIN_COL_RE.test(c))) out.push({ table: m[1], cols });
  }

  return out;
}

/**
 * Build table -> array-of-column-sets from every database/*.sql file, plus
 * UNDOCUMENTED_TABLE_CONSTRAINTS, filtered to tables/columns that actually
 * exist in the schema snapshot (drops stale entries silently — less
 * coverage, never a false alarm).
 *
 * @param {Record<string,string>} sqlSources filename -> file content
 * @param {Record<string,{columns:string[]}>} relations schema-snapshot relations
 */
export function buildUniqueConstraintMap(sqlSources, relations) {
  const map = {};
  const add = (table, cols) => {
    const rel = relations[table];
    if (!rel) return; // table not in snapshot — not this map's job to flag that
    if (!cols.every((c) => rel.columns.includes(c))) return; // stale constraint text — drop
    map[table] ??= [];
    const key = [...cols].sort().join(' ');
    if (!map[table].some((s) => [...s].sort().join(' ') === key)) map[table].push(cols);
  };

  for (const sql of Object.values(sqlSources)) {
    for (const { table, cols } of parseUniqueConstraintsFromSql(sql)) add(table, cols);
  }
  for (const [table, sets] of Object.entries(UNDOCUMENTED_TABLE_CONSTRAINTS)) {
    for (const cols of sets) add(table, cols);
  }
  return map;
}

// --- JS/TS call-site scan ----------------------------------------------------

const MAYBE_SINGLE_RE = /\.maybeSingle\s*\(\s*\)/g;
const FROM_LITERAL_RE = /\.from\(\s*(['"`])([a-z_][a-z0-9_]*)\1\s*\)/g;
const EQ_LITERAL_RE = /\.eq\(\s*(['"`])([a-z_][a-z0-9_]*)\1/g;
const LIMIT_RE = /\.limit\s*\(/;

/**
 * Scan one source for `.maybeSingle()` calls whose `.eq(...)` scope does not
 * fully cover a known multi-column UNIQUE constraint on the table it reads.
 *
 * @param {string} source
 * @param {string} filename
 * @param {Record<string,string[][]>} uniqueMap table -> array of column-sets
 * @param {Set<string>} knownTables every relation name in schema-snapshot.json
 * @returns {{findings:Array<object>, unknownTables:Array<object>}}
 */
export function scan(source, filename, uniqueMap, knownTables) {
  const code = stripCommentsKeepStrings(source);
  const srcLines = source.split('\n');
  const findings = [];
  const unknownTables = [];

  MAYBE_SINGLE_RE.lastIndex = 0;
  let m;
  while ((m = MAYBE_SINGLE_RE.exec(code)) !== null) {
    const callIdx = m.index;

    // Backward statement-start: walk left tracking bracket depth so a
    // destructuring LHS on the SAME statement (`const { data, error } =
    // await supabase.from(...)`) is treated as balanced, while an unmatched
    // opening bracket or a top-level ';' stops the walk. Same algorithm as
    // lint-pagination-guard.mjs.
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

    const segment = code.slice(stmtStartIdx, callIdx);

    // Nearest `.from("table")` — the LAST one before this .maybeSingle(),
    // mirrors the issue's own prototype ("go backwards to the nearest
    // .from(table)"). No .from(...) in this statement → out of scope (e.g.
    // chained off a query variable built elsewhere); same limitation the
    // prototype has, already verified 4/4 hits, 0 false positives.
    FROM_LITERAL_RE.lastIndex = 0;
    let fromMatch;
    let lastFrom = null;
    while ((fromMatch = FROM_LITERAL_RE.exec(segment)) !== null) lastFrom = fromMatch;
    if (!lastFrom) continue;

    const table = lastFrom[2];
    const afterFrom = segment.slice(lastFrom.index + lastFrom[0].length);

    if (!knownTables.has(table)) {
      unknownTables.push({
        file: filename,
        line: code.slice(0, stmtStartIdx + lastFrom.index).split('\n').length,
        table,
      });
      continue; // can't judge scope against a table this guard can't resolve
    }

    const sets = uniqueMap[table];
    if (!sets || sets.length === 0) continue; // no known composite UNIQUE on this table

    EQ_LITERAL_RE.lastIndex = 0;
    const eqCols = new Set();
    let eqMatch;
    while ((eqMatch = EQ_LITERAL_RE.exec(afterFrom)) !== null) eqCols.add(eqMatch[2]);

    if (eqCols.has('id')) continue; // PK filter — at most one row regardless of any other UNIQUE
    if (LIMIT_RE.test(afterFrom)) continue; // explicitly capped — same convention as the prototype

    const covered = sets.some((set) => set.every((c) => eqCols.has(c)));
    if (covered) continue;

    const callLine = code.slice(0, callIdx).split('\n').length; // 1-based
    const escapeWindow = srcLines.slice(Math.max(0, callLine - 1 - ESCAPE_LOOKBACK_LINES), callLine).join('\n');
    if (escapeWindow.includes(OPT_OUT)) continue;

    // Report the constraint set with the fewest missing columns — the most
    // actionable fix.
    let best = sets[0];
    let bestMissing = best.filter((c) => !eqCols.has(c));
    for (const set of sets.slice(1)) {
      const missing = set.filter((c) => !eqCols.has(c));
      if (missing.length < bestMissing.length) { best = set; bestMissing = missing; }
    }

    findings.push({
      file: filename,
      line: callLine,
      table,
      eq: [...eqCols].sort(),
      unique: best,
      missing: bestMissing,
      snippet: (srcLines[callLine - 1] || '').trim().slice(0, 120),
    });
  }

  return { findings, unknownTables };
}

// --- File-system plumbing ---------------------------------------------------

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

function loadSqlSources() {
  const sources = {};
  let entries;
  try { entries = readdirSync(SQL_DIR); } catch { return sources; }
  for (const e of entries) {
    if (!e.endsWith('.sql')) continue;
    try { sources[e] = readFileSync(join(SQL_DIR, e), 'utf8'); } catch { /* skip unreadable */ }
  }
  return sources;
}

function loadSnapshotRelations() {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  return raw.relations || {};
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const explicitFiles = process.argv.slice(2);
  const files = explicitFiles.length > 0 ? explicitFiles : DEFAULT_DIRS.flatMap((d) => walk(d, []));

  const relations = loadSnapshotRelations();
  const knownTables = new Set(Object.keys(relations));
  const uniqueMap = buildUniqueConstraintMap(loadSqlSources(), relations);

  const findings = [];
  const unknownTables = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const result = scan(src, f, uniqueMap, knownTables);
    findings.push(...result.findings);
    unknownTables.push(...result.unknownTables);
  }

  if (unknownTables.length > 0) {
    process.stderr.write(`\n🔴 maybeSingle unique-scope guard blocked: ${unknownTables.length} .from(...) table(s) missing from database/schema-snapshot.json:\n`);
    for (const u of unknownTables) process.stderr.write(`   ${u.file}:${u.line}: "${u.table}"\n`);
    process.stderr.write(`
Background: this guard checks .maybeSingle() scope against UNIQUE constraints
sourced from database/*.sql + database/schema-snapshot.json. A table it
cannot find in the snapshot at all means the snapshot may be stale
(#4142/#4326) — refreshing it silently could hide a real under-scoped
.maybeSingle(), so this fails loudly instead of skipping.

Fix: refresh the snapshot —
  node scripts/lint-schema-columns.mjs --update-snapshot
(requires SUPABASE_DB_URL via Infisical, local only).

Refs #4496.
`);
    process.exit(1);
  }

  if (findings.length > 0) {
    process.stderr.write(`\n🔴 maybeSingle unique-scope guard blocked: ${findings.length} call(s) not scoped to a full UNIQUE key:\n`);
    for (const f of findings) {
      process.stderr.write(`   ${f.file}:${f.line}  table "${f.table}"  UNIQUE(${f.unique.join(', ')})  mangler: ${f.missing.join(', ')}\n`);
      process.stderr.write(`     ${f.snippet}\n`);
    }
    process.stderr.write(`
Background (#4484): .maybeSingle() throws PGRST116 *and* returns data: null
when more than one row matches its filter. A filter that covers only PART of
a table's multi-column UNIQUE key can match more than one row — the caller
then reads "data is null" as "no such row exists", not "ambiguous query",
and silently takes the wrong branch. Cost a full night of failed sweeps and a
manager who could not use his own button.

Fix: add .eq(...) for every column in the UNIQUE key listed above (or filter
by "id" instead, or add an explicit .limit(1) if the ambiguity is provably
harmless).

Provably safe some other way? Add a "${OPT_OUT} <begrundelse>" comment on the
call line, the line above, or trailing on the chain.

Refs #4496 #4484.
`);
    process.exit(1);
  }

  console.log(`\n✅ maybeSingle unique-scope guard: no violations (${files.length} files scanned, ${Object.keys(uniqueMap).length} tables with a known composite UNIQUE).`);
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`check-maybesingle-unique-scope: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
