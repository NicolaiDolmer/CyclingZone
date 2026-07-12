#!/usr/bin/env node
// scripts/lint-riders-column-grant.mjs
// ============================================================
// Forward-guard for #2241 — a new column on a column-privilege-gated table
// (riders, rider_derived_abilities) must be GRANTed to anon/authenticated in
// the SAME migration file, or it's silently invisible to the client.
//
// Origin (#2238, postmortem .claude/learnings/2026-07-07-riders-column-grant-
// new-column-invisible-to-client.md): `public.riders` and
// `public.rider_derived_abilities` do NOT use table-level SELECT grants.
// 2026-06-10-riders-potentiale-column-privilege.sql (#1162) REVOKEd table-level
// SELECT from anon/authenticated and re-GRANTed it column-by-column (to hide
// `potentiale`/`hidden_potential` from scouting-oracle attacks). That migration
// warns explicitly:
//   "FAIL-CLOSED for fremtidige kolonner: en senere ALTER TABLE riders ADD
//    COLUMN ... er IKKE automatisk klient-læsbar."
// A new column does NOT inherit the column-grant set — it needs its own
// `GRANT SELECT (col) ON public.<table> TO anon, authenticated;`. Forgetting
// it doesn't error at migration-apply time; it silently 403s any PostgREST
// query that selects the column, and because PostgREST rejects the WHOLE
// request on a single denied column, it can blank an entire page. This
// shipped THREE times: contract_length/contract_end_season (#1309),
// ability_progress (2026-06-12, fixed 2026-06-29), and owner_is_ai (#2238,
// the incident that spawned this guard).
//
// SELF-EXTENDING SCOPE (not hardcoded to riders): a table becomes "gated" the
// moment this scanner sees a table-wide `REVOKE SELECT ON public.<table> FROM
// anon/authenticated` anywhere in the corpus (including inside a DO $$ ... $$
// block executing it as a literal string — see the #1162 migration). Every
// ADD COLUMN / CREATE TABLE column on a gated table from that point onward
// must carry a matching same-file column grant. Today that's exactly `riders`
// + `rider_derived_abilities` (verified live via column_privileges, #2241
// baseline) — every OTHER client-read table (teams, season_standings,
// race_results, users, races, ...) still carries a full table-level SELECT
// grant, so a new column there is automatically client-readable and this
// guard correctly leaves it alone. If a future migration REVOKEs table-level
// SELECT from some other table to adopt the same fail-closed pattern, this
// guard starts covering it with zero code changes.
//
// SCOPE BOUNDARY (documented, not a gap to "fix"): this guard only catches
// the "new column on an ALREADY-gated table" class — the exact #2238/#1309
// bug shape. It does NOT try to detect "a brand-new client-read table
// entirely missing its first GRANT" (that requires knowing which tables the
// frontend actually queries, a much fuzzier static problem outside #2241's
// scope). It also can't resolve the DYNAMIC `format('GRANT SELECT (%s) ON
// ...', cols)` pattern used by the one-time #1162 seeding migration itself —
// that pattern computes its column list from live information_schema, so a
// human/DB read is needed to audit it; it is the seed of the gating set, not
// a place new columns get silently added.
//
// Usage:
//   node scripts/lint-riders-column-grant.mjs                  # all migrations
//   node scripts/lint-riders-column-grant.mjs database/foo.sql # specific files
//   npm run lint:riders-column-grant
//
// Opt-out (last resort, for a genuinely-fine case the whitelist model doesn't
// fit): a `-- riders-column-grant-ok: <reason>` comment on the line directly
// above the ALTER TABLE / CREATE TABLE statement.
//
// Exit codes:
//   0 — no findings
//   1 — at least one ungranted new column on a gated table
//   2 — internal error
//
// Refs #2241 #2238 #1309.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lint-migration-idempotency.mjs';

const OPT_OUT = 'riders-column-grant-ok';

// ---------------------------------------------------------------------------
// Historical whitelist: migrations that added a column to an already-gated
// table WITHOUT a same-file grant, shipped before this guard existed. Every
// entry below was a REAL gap at the time (#1309, the #2238 incident itself,
// or an apply-order ambiguity) and was fixed by a follow-up migration — the
// live baseline (#2241 SQL audit, 2026-07-12) confirms all affected columns
// are granted in prod today. Forward-guard, not retroactive: do NOT add new
// migrations here — fix the DDL (add the GRANT in the same file) instead.
// ---------------------------------------------------------------------------
export const WHITELIST_FILES = {
  '2026-06-10-value-cutover-base-value.sql':
    'DROP+ADD market_value/salary same calendar day as the #1162 gating migration ' +
    '(2026-06-10-riders-potentiale-column-privilege.sql); real apply order between ' +
    'the two same-day files is ambiguous from filename sort alone. Live baseline ' +
    '(#2241) confirms both columns are currently granted to anon/authenticated.',
  '2026-06-12-daily-training.sql':
    'Added rider_derived_abilities.ability_progress without a same-file grant — a ' +
    'real historical gap, fixed 17 days later by ' +
    '2026-06-29-ability-progress-client-select-grant.sql. Live baseline (#2241) ' +
    'confirms the column is currently granted.',
  '2026-06-13-contract-data-fields.sql':
    '#1309 — added riders.contract_length/contract_end_season without a same-file ' +
    'grant; fixed same day by 2026-06-13-grant-select-contract-columns.sql (hotfix). ' +
    'Live baseline (#2241) confirms both columns are currently granted.',
  '2026-07-07-riders-owner-is-ai.sql':
    '#2238 — the incident that spawned this guard. Added riders.owner_is_ai without ' +
    'a same-file grant; fixed same day by 2026-07-07-riders-owner-is-ai-grant.sql ' +
    '(hotfix, applied directly to prod during the incident). Live baseline (#2241) ' +
    'confirms the column is currently granted.',
};

// ---------------------------------------------------------------------------
// Columns that are INTENTIONALLY never granted to anon/authenticated (fail-
// closed by design — the whole point of #1162's column-privilege model).
// Keyed `table.column`. Every entry must carry a reason. Live baseline
// (#2241, 2026-07-12) confirms these are exactly the ungranted columns on the
// two currently-gated tables — no undocumented gap exists.
// ---------------------------------------------------------------------------
export const ALLOWLIST_HIDDEN_COLUMNS = {
  'riders.potentiale':
    '#1162 — raw scouting potential. Client gets a fuzzy server-computed estimate ' +
    '(POST /api/scouting/estimates) instead; the raw value is an oracle for cheating ' +
    'the scouting economy.',
  'rider_derived_abilities.hidden_potential':
    '#1162 — exactly invertible to riders.potentiale (same 0.60·potentiale+... ' +
    'formula), so it is the same leak under a different name.',
  'rider_derived_abilities.ability_caps':
    '#2098 — exact ability ceiling is invertible to the hidden potentiale via the ' +
    'known headroom formula (riderProgression.js); revoked 2026-07-02 after a ' +
    'scouting-economy leak was found live.',
  'rider_derived_abilities.season_budget_baseline':
    '#2082/#1938 — pure backend bookkeeping (season training-budget snapshot); no ' +
    'player-facing surface reads it. Migration header ' +
    '(2026-07-05-daily-training-season-budget-cap.sql) documents "BEVIDST INGEN ' +
    'grant (fail-closed)".',
  'rider_derived_abilities.season_budget_season':
    '#2082/#1938 — same as season_budget_baseline (paired bookkeeping column, same ' +
    'migration, same documented fail-closed rationale).',
};

// ---------------------------------------------------------------------------
// Statement-level extraction helpers. Operate on already-comment-stripped
// statement text from splitStatements (scripts/lint-migration-idempotency.mjs)
// so example DDL quoted inside `--`/`/* */` comments (this codebase's
// migrations are full of exactly that, e.g. "kræver et eksplicit GRANT SELECT
// (ny_kolonne) ON public.riders ...") can never be mistaken for real DDL.
// ---------------------------------------------------------------------------

const IDENT = '(?:"?[A-Za-z_][A-Za-z0-9_]*"?)';

/** Strip surrounding double-quotes from an identifier. */
function unquote(id) {
  return id.replace(/^"|"$/g, '');
}

/**
 * Find table-wide `REVOKE SELECT ON [public.]<table> FROM ...` occurrences
 * (NOT the column-scoped `REVOKE SELECT (col) ON ...` form — that revokes a
 * single already-granted column, e.g. #2098's ability_caps revoke, and does
 * not change the table's gated status). Only counts when the FROM clause
 * mentions anon or authenticated.
 *
 * @param {string} text
 * @returns {string[]} lowercased table names newly gated by this text
 */
export function findTableRevokes(text) {
  const found = [];
  const re = new RegExp(
    `REVOKE\\s+SELECT\\s+ON\\s+(?:public\\.)?(${IDENT})\\s+FROM\\s+([^;]*)`,
    'gi'
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const roles = m[2].toLowerCase();
    if (roles.includes('anon') || roles.includes('authenticated')) {
      found.push(unquote(m[1]).toLowerCase());
    }
  }
  return found;
}

/**
 * Find `GRANT SELECT (col1, col2) ON [public.]<table> TO ...` occurrences.
 * Only counts when the TO clause mentions anon or authenticated. Does NOT
 * match table-wide `GRANT SELECT ON <table> TO ...` (no column list) — that
 * shape only appears in the dynamic #1162 seed (`format('GRANT SELECT (%s)
 * ON ...', cols)`), which is out of scope (see header).
 *
 * @param {string} text
 * @returns {Map<string, Set<string>>} table -> set of granted column names
 */
export function findColumnGrants(text) {
  const grants = new Map();
  const re = new RegExp(
    `GRANT\\s+SELECT\\s*\\(([^)]+)\\)\\s*ON\\s+(?:public\\.)?(${IDENT})\\s+TO\\s+([^;]*)`,
    'gi'
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const roles = m[3].toLowerCase();
    if (!roles.includes('anon') && !roles.includes('authenticated')) continue;
    const table = unquote(m[2]).toLowerCase();
    const cols = m[1].split(',').map((c) => unquote(c.trim()).toLowerCase());
    if (!grants.has(table)) grants.set(table, new Set());
    for (const c of cols) grants.get(table).add(c);
  }
  return grants;
}

/**
 * Find `ALTER TABLE [ONLY] [public.]<table> ADD COLUMN [IF NOT EXISTS] <col>`
 * occurrences, one statement possibly adding several columns
 * (comma-separated `ADD COLUMN` clauses all apply to the same table).
 *
 * @param {string} stmtText - a single top-level statement (from splitStatements)
 * @returns {Array<{table: string, column: string}>}
 */
export function findAddColumns(stmtText) {
  const head = stmtText.match(
    new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?(${IDENT})`, 'i')
  );
  if (!head) return [];
  const table = unquote(head[1]).toLowerCase();
  const out = [];
  const colRe = new RegExp(`ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`, 'gi');
  let m;
  while ((m = colRe.exec(stmtText)) !== null) {
    out.push({ table, column: unquote(m[1]).toLowerCase() });
  }
  return out;
}

/**
 * Return the substring inside the balanced parentheses starting at openIdx
 * (must point AT the '('). Mirrors scripts/lint-postgrest-in-cap.mjs.
 */
function balancedParen(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Find `CREATE TABLE [IF NOT EXISTS] [public.]<table> (col1 ..., col2 ..., ...)`
 * column definitions. Best-effort: splits the balanced body on top-level
 * commas and skips table-level constraint clauses (PRIMARY/FOREIGN/UNIQUE/
 * CHECK/CONSTRAINT/EXCLUDE). Only matters for a table that is ALREADY gated
 * (re-created after a REVOKE) — no case in the current corpus, but kept for
 * completeness per #2241's "CREATE TABLE" wording.
 *
 * @param {string} stmtText
 * @returns {Array<{table: string, column: string}>}
 */
export function findCreateTableColumns(stmtText) {
  const head = stmtText.match(
    new RegExp(
      `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?(${IDENT})\\s*(\\()`,
      'i'
    )
  );
  if (!head) return [];
  const table = unquote(head[1]).toLowerCase();
  const openIdx = head.index + head[0].length - 1;
  const body = balancedParen(stmtText, openIdx);
  if (body === null) return [];

  const skipLead =
    /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i;
  const parts = splitTopLevelCommas(body);
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || skipLead.test(trimmed)) continue;
    const colMatch = trimmed.match(new RegExp(`^(${IDENT})`));
    if (colMatch) out.push({ table, column: unquote(colMatch[1]).toLowerCase() });
  }
  return out;
}

/** Split a string on top-level commas (ignoring commas inside nested parens). */
function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Check the raw source for an opt-out marker on the line above (or the same
 * line as) the given 1-based statement start line.
 */
function hasOptOut(sourceLines, line) {
  const here = sourceLines[line - 1] || '';
  const above = sourceLines[line - 2] || '';
  return here.includes(OPT_OUT) || above.includes(OPT_OUT);
}

// ---------------------------------------------------------------------------
// Corpus scan: processes files in the given order, threading gatedTables
// across files (and within a file, gating detected before ADD COLUMN checks
// run against it) so the guard self-extends to any table that later adopts
// the fail-closed column-privilege pattern.
// ---------------------------------------------------------------------------

/**
 * @param {Array<{file: string, source: string}>} sources - in intended scan order
 * @returns {{findings: Array<{file:string,line:number,table:string,column:string}>, gatedTables: Set<string>}}
 */
export function scanCorpus(sources) {
  const gatedTables = new Set();
  const findings = [];

  for (const { file, source } of sources) {
    const base = basename(file);
    const sourceLines = source.split('\n');
    const statements = splitStatements(source);

    // Pass 1: table-wide REVOKEs gate tables (same-file self-gating allowed).
    for (const stmt of statements) {
      for (const table of findTableRevokes(stmt.text)) gatedTables.add(table);
    }

    if (WHITELIST_FILES[base]) continue; // historical, already reconciled — see WHITELIST_FILES

    // Pass 2: same-file column grants.
    const fileGrants = new Map();
    for (const stmt of statements) {
      const g = findColumnGrants(stmt.text);
      for (const [table, cols] of g) {
        if (!fileGrants.has(table)) fileGrants.set(table, new Set());
        for (const c of cols) fileGrants.get(table).add(c);
      }
    }

    // Pass 3: new columns on gated tables need a matching grant or allowlist entry.
    for (const stmt of statements) {
      const added = [...findAddColumns(stmt.text), ...findCreateTableColumns(stmt.text)];
      for (const { table, column } of added) {
        if (!gatedTables.has(table)) continue;
        const key = `${table}.${column}`;
        if (ALLOWLIST_HIDDEN_COLUMNS[key]) continue;
        if (fileGrants.get(table)?.has(column)) continue;
        if (hasOptOut(sourceLines, stmt.line)) continue;
        findings.push({ file: base, line: stmt.line, table, column });
      }
    }
  }

  return { findings, gatedTables };
}

// ---------------------------------------------------------------------------
// File discovery + CLI (mirrors scripts/lint-migration-idempotency.mjs)
// ---------------------------------------------------------------------------
function expandGlob(pattern) {
  const m = pattern.match(/^(.*?)([/\\])([^/\\*]*)\*([^*]*)$/);
  if (!m) return [pattern];
  const [, dir, sep, prefix, suffix] = m;
  const dirPath = dir || '.';
  try {
    return readdirSync(dirPath)
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix))
      .map((entry) => `${dirPath}${sep}${entry}`)
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [pattern];
  }
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

function main() {
  let files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (files.length === 0) {
    files = expandGlob('database/2026-*.sql');
  } else {
    files = files.flatMap((p) => (p.includes('*') ? expandGlob(p) : [p]));
  }
  files = files.filter((f) => /^2026-.*\.sql$/.test(basename(f))).sort();

  const sources = [];
  for (const f of files) {
    try {
      sources.push({ file: f, source: readFileSync(f, 'utf8') });
    } catch {
      continue; // lint-staged only passes existing files
    }
  }

  const { findings, gatedTables } = scanCorpus(sources);

  for (const fnd of findings) {
    process.stderr.write(
      `${fnd.file}:${fnd.line}: new column ${fnd.table}.${fnd.column} on a column-privilege-gated table with no matching GRANT SELECT (${fnd.column}) in this file\n`
    );
  }

  if (findings.length > 0) {
    process.stderr.write(`
🔴 Riders column-grant guard blocked: ${findings.length} ungranted new column(s) on
a column-privilege-gated table (${[...gatedTables].sort().join(', ') || 'none'}).

Background (#2238, #1309, #2241): riders + rider_derived_abilities use
column-level SELECT grants, not table-level — a new column is invisible to
anon/authenticated until explicitly granted. Forgetting the grant doesn't
error at apply time; it silently 403s any client query touching the column,
which can blank an entire page (#2238: RidersPage showed 0 riders for every
user). See .claude/learnings/2026-07-07-riders-column-grant-new-column-
invisible-to-client.md.

Fix: add \`GRANT SELECT (<column>) ON public.<table> TO anon, authenticated;\`
in the SAME migration file as the ADD COLUMN / CREATE TABLE.

Intentionally hidden column (fail-closed by design)? Add it to
ALLOWLIST_HIDDEN_COLUMNS in scripts/lint-riders-column-grant.mjs with a
reason, or use a \`-- riders-column-grant-ok: <reason>\` comment on the line
above the statement.

Refs #2241 #2238 #1309.
`);
    process.exit(1);
  }

  process.stdout.write(
    `✅ Riders column-grant guard: ${sources.length} migration(s) scanned, ` +
      `${gatedTables.size} gated table(s) tracked (${[...gatedTables].sort().join(', ') || 'none'}), no ungranted new columns.\n`
  );
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`lint-riders-column-grant: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
