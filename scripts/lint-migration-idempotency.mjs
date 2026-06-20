#!/usr/bin/env node
// scripts/lint-migration-idempotency.mjs
// ============================================================
// Migration-drift forward-guard for #401 — require idempotent DDL.
//
// WHY (owner decision, #401):
//   `database/schema.sql` + `database/supabase_setup.sql` are kept as
//   bootstrap / disaster-recovery snapshots. The forward-state of prod is
//   built by replaying `database/2026-*.sql` migrations (auto-migrate.yml,
//   tracked in schema_migrations). A migration that is NOT idempotent crashes
//   on any re-run — manual recovery replay, a partial-failure re-apply, or a
//   fresh DB rebuilt from the migration log. The 2026-05-22 RLS lockdown
//   migration already hit this: a `CREATE POLICY` without a preceding
//   `DROP POLICY IF EXISTS` failed on its first replay, schema_migrations row
//   never landed, drift sat for days (docs/MIGRATIONS_AUDIT_2026-05.md §1).
//
// RULE (single source of truth — also documented in docs/MIGRATIONS.md):
//   Every new `database/2026-*.sql` migration must use idempotent DDL so a
//   re-run is a no-op rather than an error. Concretely:
//     CREATE TABLE            → CREATE TABLE IF NOT EXISTS
//     CREATE INDEX            → CREATE INDEX IF NOT EXISTS
//     CREATE TYPE             → guard in a DO $$ block (Postgres has no
//                               `CREATE TYPE IF NOT EXISTS`): check pg_type,
//                               or wrap in EXCEPTION WHEN duplicate_object.
//     CREATE SEQUENCE         → CREATE SEQUENCE IF NOT EXISTS
//     CREATE POLICY           → DROP POLICY IF EXISTS first (RLS policies have
//                               no IF NOT EXISTS).
//     CREATE TRIGGER          → CREATE OR REPLACE TRIGGER, or DROP TRIGGER
//                               IF EXISTS first.
//     ALTER TABLE ADD COLUMN  → ADD COLUMN IF NOT EXISTS
//     ALTER TABLE ADD CONSTRAINT
//                             → guard in a DO $$ block (check pg_constraint),
//                               or DROP CONSTRAINT IF EXISTS first (Postgres
//                               has no `ADD CONSTRAINT IF NOT EXISTS`).
//
//   `CREATE OR REPLACE FUNCTION/VIEW/...`, `CREATE VIEW IF NOT EXISTS`,
//   `CREATE EXTENSION IF NOT EXISTS` etc. are already idempotent and pass.
//
// FORWARD-GUARD, not retroactive: a small set of historical migrations are
// legitimately non-idempotent (one-shot data backfills, intentional DROP+
// recreate, guarded inside a DO-block this scanner can't fully prove). Those
// are listed in WHITELIST below with a reason. We do NOT rewrite history in
// this PR (owner decision). New migrations may NOT be added to the whitelist
// without an explicit reason — fix the DDL instead.
//
// Heuristic-vs-parser trade-off:
//   Postgres' own grammar is authoritative but needs a live DB. This is a
//   tokeniser + statement-level heuristic (same engine as
//   scripts/lint-sql-strings.mjs): it strips comments + dollar-quoted bodies,
//   splits on top-level `;`, and inspects the leading DDL keyword of each
//   statement. DDL emitted *inside* a DO $$ ... $$ block is treated as
//   already-guarded (the block is the author's idempotency mechanism), so we
//   never false-positive on `DO $$ ... CREATE/ALTER ... $$`.
//
// Usage:
//   node scripts/lint-migration-idempotency.mjs                  # all migrations
//   node scripts/lint-migration-idempotency.mjs database/foo.sql # specific files
//   npm run lint:migrations                                      # same as default
//
// Exit codes:
//   0 — no findings
//   1 — at least one migration has non-idempotent DDL
//
// Refs #401 #639.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Whitelist: historical migrations that are legitimately non-idempotent.
// Keyed by basename. Each entry MUST carry a reason. Do NOT add new
// migrations here — fix the DDL instead (see RULE above). This list only
// exists so the guard runs green on the current tree without rewriting
// shipped history (#401 owner decision).
// ---------------------------------------------------------------------------
export const WHITELIST = {
  // Calibrated 2026-06-20 against the full database/2026-*.sql corpus (#401).
  // Each was shipped + applied before this guard existed; the owner decision
  // is to NOT rewrite shipped history, so they're parked here with a reason.
  // Re-runnability today is moot for these: they already live in
  // schema_migrations (auto-migrate skips applied files). The guard protects
  // NEW migrations from this point forward.
  '2026-04-24-board-parallel-plans.sql':
    'DROP CONSTRAINT (no IF EXISTS) + ADD CONSTRAINT — pre-guard one-shot key swap; already applied.',
  '2026-04-25-economy-scale-4000x.sql':
    'ALTER TABLE riders ADD COLUMN price (no IF NOT EXISTS) — pre-guard one-shot economy rescale; already applied.',
  '2026-04-26-window-pending-transfers.sql':
    'DROP/ADD CONSTRAINT (no IF EXISTS) on transfer_offers + swap_offers — pre-guard CHECK widen; already applied.',
  '2026-05-04-salary-generated-column.sql':
    'ADD COLUMN salary GENERATED (no IF NOT EXISTS) — pre-guard generated-column intro; already applied.',
  '2026-06-10-value-cutover-base-value.sql':
    'ADD COLUMN market_value/salary GENERATED + CREATE INDEX (no IF [NOT] EXISTS) — value-model cutover, one-shot; already applied.',
  '2026-06-13-academy-mvp.sql':
    'CREATE POLICY academy_intake_owner_read with no DROP POLICY IF EXISTS — same #401 failure shape; already applied. Constraints in this file ARE guarded.',
  '2026-06-13-contract-data-fields.sql':
    'ALTER TABLE riders ADD COLUMN contract_length/contract_end_season (no IF NOT EXISTS) — pre-guard; already applied.',
};

// DDL statement leads we require to be idempotent, with the per-kind check
// for "is this occurrence already guarded?". Each entry:
//   match(stmtUpper) → true if the statement is of this kind
//   ok(stmtUpper)    → true if it carries an idempotency guard
const RULES = [
  {
    kind: 'CREATE TABLE',
    // not CREATE TABLE AS (a query, idempotency handled differently) — but
    // `IF NOT EXISTS` still applies, so we treat both the same.
    match: (s) => /^CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+|GLOBAL\s+|LOCAL\s+)*TABLE\b/.test(s),
    ok: (s) => /\bIF\s+NOT\s+EXISTS\b/.test(s),
    fix: 'CREATE TABLE IF NOT EXISTS ...',
  },
  {
    kind: 'CREATE INDEX',
    match: (s) => /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/.test(s),
    ok: (s) => /\bIF\s+NOT\s+EXISTS\b/.test(s),
    fix: 'CREATE [UNIQUE] INDEX IF NOT EXISTS ...',
  },
  {
    kind: 'CREATE SEQUENCE',
    match: (s) => /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?SEQUENCE\b/.test(s),
    ok: (s) => /\bIF\s+NOT\s+EXISTS\b/.test(s),
    fix: 'CREATE SEQUENCE IF NOT EXISTS ...',
  },
  {
    kind: 'CREATE TYPE',
    match: (s) => /^CREATE\s+TYPE\b/.test(s),
    // Postgres has no `CREATE TYPE IF NOT EXISTS`. The idempotent form wraps
    // it in a DO-block (handled by isInsideDoBlock before we get here). A bare
    // top-level CREATE TYPE is never idempotent on its own.
    ok: () => false,
    fix: 'wrap in DO $$ ... check pg_type ... $$ (no native CREATE TYPE IF NOT EXISTS)',
  },
  {
    kind: 'CREATE POLICY',
    match: (s) => /^CREATE\s+POLICY\b/.test(s),
    // RLS policies have no IF NOT EXISTS. Idempotency = a matching
    // DROP POLICY IF EXISTS earlier in the same file (checked at file level).
    ok: () => false,
    fix: 'add DROP POLICY IF EXISTS "<name>" ON <table>; before CREATE POLICY',
    fileLevelDrop: 'POLICY',
  },
  {
    kind: 'CREATE TRIGGER',
    match: (s) => /^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/.test(s) && !/^CREATE\s+OR\s+REPLACE\b/.test(s),
    // CREATE OR REPLACE TRIGGER is idempotent (PG14+). A plain CREATE TRIGGER
    // needs a matching DROP TRIGGER IF EXISTS earlier in the file.
    ok: () => false,
    fix: 'use CREATE OR REPLACE TRIGGER, or DROP TRIGGER IF EXISTS first',
    fileLevelDrop: 'TRIGGER',
  },
  {
    kind: 'ALTER TABLE ADD COLUMN',
    match: (s) => /^ALTER\s+TABLE\b/.test(s) && /\bADD\s+COLUMN\b/.test(s),
    // Every ADD COLUMN in the statement must carry IF NOT EXISTS. A single
    // ALTER TABLE may add several columns; require the guard on each ADD COLUMN.
    ok: (s) => {
      const adds = s.match(/\bADD\s+COLUMN\b/g) || [];
      const guarded = s.match(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/g) || [];
      return adds.length === guarded.length;
    },
    fix: 'ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...',
  },
  {
    kind: 'ALTER TABLE ADD CONSTRAINT',
    match: (s) => /^ALTER\s+TABLE\b/.test(s) && /\bADD\s+CONSTRAINT\b/.test(s),
    // Postgres has no `ADD CONSTRAINT IF NOT EXISTS`. Idempotency = a matching
    // DROP CONSTRAINT IF EXISTS earlier in the file, or a DO-block guard.
    ok: () => false,
    fix: 'DROP CONSTRAINT IF EXISTS first, or guard in DO $$ ... check pg_constraint ... $$',
    fileLevelDrop: 'CONSTRAINT',
  },
];

// ---------------------------------------------------------------------------
// Tokeniser: walk the source, classify each character region, and emit
// top-level statements (text + 1-based start line) while recording which
// regions were inside a DO $$ ... $$ / dollar-quoted block (already-guarded).
//
// State machine (mirrors scripts/lint-sql-strings.mjs):
//   0 normal SQL   1 line comment (-- to EOL)   2 block comment (/* ... */)
//   3 single-quoted string   4 dollar-quoted string ($tag$ ... $tag$)
// ---------------------------------------------------------------------------
const APOST = "'";

/**
 * Split a SQL source into top-level statements, tracking dollar-quote depth so
 * a statement that lives inside a DO $$ ... $$ block is flagged `inDollar`.
 *
 * @param {string} source
 * @returns {Array<{text: string, line: number, inDollar: boolean}>}
 */
export function splitStatements(source) {
  const statements = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let state = 0;
  let dquoteTag = '';

  // Accumulator for the current top-level statement.
  let buf = '';
  let bufStartLine = line;
  // Whether ANY character of the current statement was inside a dollar-quote.
  let bufTouchedDollar = false;

  const pushStatement = () => {
    const text = buf.trim();
    if (text.length > 0) {
      statements.push({ text, line: bufStartLine, inDollar: bufTouchedDollar });
    }
    buf = '';
    bufTouchedDollar = false;
    bufStartLine = line;
  };

  while (i < n) {
    const c = source[i];
    const c2 = source.slice(i, i + 2);

    if (c === '\n') {
      if (state === 1) state = 0; // line comment ends at EOL
      buf += c;
      line++;
      i++;
      // a statement can't start on a blank/comment-only prefix; bufStartLine
      // is advanced lazily below when we hit the first non-space char.
      if (buf.trim().length === 0) bufStartLine = line;
      continue;
    }

    if (state === 1) {
      // line comment — drop from buf so leading comments don't pollute the
      // statement keyword detection.
      i++;
      continue;
    }

    if (state === 2) {
      if (c2 === '*/') {
        state = 0;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === 3) {
      // single-quoted string literal — copy verbatim (it's part of the stmt)
      buf += c;
      if (c === APOST) {
        const nxt = i + 1 < n ? source[i + 1] : '';
        if (nxt === APOST) {
          buf += nxt;
          i += 2;
          continue;
        }
        state = 0;
      }
      i++;
      continue;
    }

    if (state === 4) {
      const closeMarker = `$${dquoteTag}$`;
      if (source.slice(i, i + closeMarker.length) === closeMarker) {
        buf += closeMarker;
        state = 0;
        dquoteTag = '';
        i += closeMarker.length;
        continue;
      }
      buf += c;
      bufTouchedDollar = true;
      i++;
      continue;
    }

    // state 0 — normal SQL
    if (c2 === '--') {
      state = 1;
      i += 2;
      continue;
    }
    if (c2 === '/*') {
      state = 2;
      i += 2;
      continue;
    }
    if (c === '$') {
      // dollar-quote opener: $tag$ where tag is [A-Za-z0-9_]*
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (j < n && source[j] === '$') {
        dquoteTag = source.slice(i + 1, j);
        buf += source.slice(i, j + 1);
        bufTouchedDollar = true;
        state = 4;
        i = j + 1;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === APOST) {
      buf += c;
      state = 3;
      i++;
      continue;
    }
    if (c === ';') {
      pushStatement();
      i++;
      continue;
    }
    // first meaningful char of a fresh statement → lock in its start line
    if (buf.trim().length === 0 && !/\s/.test(c)) {
      bufStartLine = line;
    }
    buf += c;
    i++;
  }

  pushStatement(); // trailing statement without a closing ;
  return statements;
}

/**
 * Normalise a statement for keyword matching: collapse whitespace, uppercase.
 * @param {string} text
 */
function normalise(text) {
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Collect the file-level "DROP ... IF EXISTS" coverage so a CREATE POLICY /
 * CREATE TRIGGER / ADD CONSTRAINT that has a matching drop earlier in the same
 * file is treated as idempotent.
 *
 * We don't try to match exact object names (that needs a real parser). A file
 * that drops at least as many objects of a kind as it creates is treated as
 * idempotent for that kind — the #401 failure mode is a *missing* DROP, not a
 * subtly mismatched name. This matches the documented rule "DROP IF EXISTS
 * before CREATE" and is calibrated green against the corpus.
 *
 * @param {Array<{text:string}>} statements
 * @returns {{POLICY:number, TRIGGER:number, CONSTRAINT:number}}
 */
export function countDropIfExists(statements) {
  const counts = { POLICY: 0, TRIGGER: 0, CONSTRAINT: 0 };
  for (const { text } of statements) {
    const u = normalise(text);
    if (/^DROP\s+POLICY\s+IF\s+EXISTS\b/.test(u)) counts.POLICY++;
    if (/^DROP\s+TRIGGER\s+IF\s+EXISTS\b/.test(u)) counts.TRIGGER++;
    // ALTER TABLE ... DROP CONSTRAINT IF EXISTS — may appear inline.
    const dropCons = u.match(/\bDROP\s+CONSTRAINT\s+IF\s+EXISTS\b/g);
    if (dropCons) counts.CONSTRAINT += dropCons.length;
  }
  return counts;
}

/**
 * Scan a single migration source for non-idempotent DDL.
 *
 * @param {string} source
 * @param {string} filename - basename for diagnostics
 * @returns {Array<{file:string, line:number, kind:string, fix:string, snippet:string}>}
 */
export function scanMigration(source, filename = '<source>') {
  const statements = splitStatements(source);
  const drops = countDropIfExists(statements);
  // Tally CREATE counts per file-level-drop kind so we only require N drops for
  // N creates (the first create after a single drop is covered; a second
  // un-dropped create is a finding).
  const created = { POLICY: 0, TRIGGER: 0, CONSTRAINT: 0 };
  const findings = [];

  for (const stmt of statements) {
    // DDL inside a DO $$ ... $$ block is the author's own idempotency
    // mechanism (EXCEPTION WHEN duplicate_object / IF NOT FOUND checks) — the
    // scanner can't prove the guard so it trusts the block, matching how the
    // 2026-05 audit accepted DO-block guards. Never flag those.
    if (stmt.inDollar) continue;

    const u = normalise(stmt.text);
    for (const rule of RULES) {
      if (!rule.match(u)) continue;

      if (rule.fileLevelDrop) {
        const kind = rule.fileLevelDrop;
        created[kind]++;
        // idempotent iff we've seen at least as many DROP ... IF EXISTS of
        // this kind as creates so far.
        if (created[kind] <= drops[kind]) break; // covered
        findings.push(makeFinding(filename, stmt, rule));
        break;
      }

      if (!rule.ok(u)) {
        findings.push(makeFinding(filename, stmt, rule));
      }
      break; // one rule per statement (first lead keyword wins)
    }
  }

  return findings;
}

function makeFinding(filename, stmt, rule) {
  const firstLine = stmt.text.split('\n')[0].trim();
  const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return { file: filename, line: stmt.line, kind: rule.kind, fix: rule.fix, snippet };
}

// ---------------------------------------------------------------------------
// File discovery + CLI
// ---------------------------------------------------------------------------
function expandGlob(pattern) {
  // Minimal glob: support `database/2026-*.sql` literal pattern. Zero-dep
  // (same approach as scripts/lint-sql-strings.mjs).
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

  let total = 0;
  let scanned = 0;
  for (const f of files) {
    const base = basename(f);
    // Only ever guard timestamped migrations; never schema.sql / setup snapshots.
    if (!/^2026-.*\.sql$/.test(base)) continue;
    if (WHITELIST[base]) continue; // legitimately non-idempotent (historical)

    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch {
      continue; // lint-staged only passes existing files
    }
    scanned++;
    const findings = scanMigration(src, base);
    for (const fnd of findings) {
      total++;
      process.stderr.write(
        `${fnd.file}:${fnd.line}: non-idempotent ${fnd.kind} — ${fnd.snippet}\n` +
          `    fix: ${fnd.fix}\n`
      );
    }
  }

  if (total > 0) {
    process.stderr.write(`
🔴 Migration idempotency guard blocked: ${total} non-idempotent DDL statement(s).

Background (#401): prod's forward-state is replayed from database/2026-*.sql
(auto-migrate.yml). A migration that is not idempotent crashes on any re-run —
recovery replay, partial-failure re-apply, or a fresh DB rebuilt from the log.
The 2026-05-22 RLS lockdown migration already hit this (a CREATE POLICY without
DROP POLICY IF EXISTS failed on replay; drift sat for days). See
docs/MIGRATIONS.md for the full rule + idempotent recipes.

Override (LAST RESORT, with a reason): add the basename to WHITELIST in
scripts/lint-migration-idempotency.mjs. New migrations should be FIXED, not
whitelisted.

Refs #401 #639.
`);
    process.exit(1);
  }

  process.stdout.write(
    `✅ Migration idempotency guard: ${scanned} migration(s) scanned, no non-idempotent DDL.\n`
  );
}

if (isMain()) main();
