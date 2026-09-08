#!/usr/bin/env node
// scripts/lint-sql-policy-grants.mjs
// ============================================================
// Forward-guard for #4943 — a `CREATE POLICY ... FOR <op> ... TO authenticated`
// (or `FOR ALL`) requires a matching table-level `GRANT <op> ... TO
// authenticated` SOMEWHERE in database/ (same file, or an earlier/later
// migration for the same table). Without it, Postgres rejects the statement
// with 42501 BEFORE the policy is ever evaluated — the policy can be perfectly
// correct and still never run.
//
// ── Hændelsen (8/9, #4943) ────────────────────────────────────────────────
//
// 2026-09-07-4943-in-app-survey.sql creates INSERT/UPDATE/DELETE policies on
// public.survey_responses and an INSERT policy on public.survey_completions,
// all `TO authenticated`, but never GRANTs those privileges to the role. The
// survey opened, 241 managers were invited, and nobody could save an answer:
// every write hit 42501 before RLS ever ran. Fixed live via GRANT (owner-go),
// written back as database/2026-09-08-4943-survey-grants-hotfix.sql.
//
// ── Hvorfor eksisterende vagter ikke fangede det ──────────────────────────
//
// scripts/check-secdef-revoke-lint.mjs dækker SECURITY DEFINER-funktioner
// (REVOKE EXECUTE fra anon/authenticated) — irrelevant her, ingen funktion er
// involveret. security-grants-audit.yml's "Live grant-tjek mod prod"-job
// kører KUN uden for pull_request (`if: github.event_name != 'pull_request'`
// — trigges af schedule/dispatch), så det er altid "skipping" på en PR og
// ville først have fanget dette ved sin næste 6-timers-kørsel efter merge,
// dvs. EFTER spillerne allerede havde fået invitationen. Det er en bevidst
// arkitektur-grænse (samme fordeling som resten af workflowet: lint på PR,
// live-tjek på cron), ikke en paths-/label-fejl — men den betyder at et
// tabel-grant-hul på en NY tabel aldrig blev spærret ved review-tid, kun
// opdaget efter merge. scripts/lint-riders-column-grant.mjs dækker kun
// kolonne-privilegier på riders/rider_derived_abilities. Intet lint tjekkede
// at en RLS-policy rent faktisk kan nås via et tabel-grant.
//
// ── #2830-nuancen: hvorfor SELECT er udelukket, og hvorfor kun POST-cutover-
//    tabeller tjekkes for skrive-ops ─────────────────────────────────────────
//
// database/2026-08-14-2830-revoke-truncate-og-default-privileges.sql ændrede
// Supabase' `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` til
// at REVOKE INSERT/UPDATE/DELETE/TRUNCATE/... fra anon+authenticated for
// FREMTIDIGE tabeller. Filens egen post-verify siger eksplicit: "SELECT
// revokes ikke — frontend-læsninger fortsætter uændret." Det betyder:
//
//   1. SELECT er og bliver auto-grantet til authenticated for ENHVER tabel,
//      før og efter cutover. At kræve et eksplicit `GRANT SELECT` ville være
//      permanent støj — hver eneste fremtidige migration med en SELECT-policy
//      ville fejle uden grund. SELECT er derfor UDENFOR scope for dette lint.
//   2. En tabel oprettet FØR 2026-08-14 arvede fuld INSERT/UPDATE/DELETE som
//      default ved sin CREATE TABLE — uden at det nogensinde stod som et
//      eksplicit GRANT i filen. At kræve et eksplicit GRANT for sådan en
//      tabel ville også være støj (målt: 8 pre-cutover admin-write-policies i
//      dette repo har ALDRIG haft et eksplicit skrive-grant og virker fint).
//   3. En tabel oprettet PÅ ELLER EFTER 2026-08-14 får IKKE default write-
//      privilegier — nøjagtig #4943's tilstand. Kun disse tabeller tjekkes for
//      INSERT/UPDATE/DELETE.
//
// Tabellens oprettelsesfil findes ved at scanne HELE korpus i filnavns-
// (dvs. kronologisk) rækkefølge efter `CREATE TABLE [IF NOT EXISTS]
// [public.]<table>` og tage den FØRSTE forekomst. Findes tabellen slet ikke i
// 2026-*.sql-korpus (dvs. den stammer fra database/schema.sql / bootstrap),
// antages den ældre end cutover og springes over — det er den samme retning
// som fejlen kan gå (false negative på en meget gammel tabel), aldrig støj.
//
// ── Hvad denne vagt IKKE gør ───────────────────────────────────────────────
//
// Den validerer ikke policy-LOGIKKEN (USING/WITH CHECK), kun at rollen har
// lov til at forsøge operationen overhovedet. Den tjekker heller ikke `anon`
// — kun `authenticated`, fordi det er den rolle #4943 ramte. En "FOR ALL"-
// policy med et BEVIDST snævrere grant (fx SELECT+INSERT+DELETE uden UPDATE,
// et toggle-mønster set i forum_reactions/forum_category_mutes) er stadig et
// fund her — det ER teknisk sandt at den ene op er utilgængelig for rollen —
// men er ofte tilsigtet defense-in-depth, ikke en gentagelse af #4943. Brug
// opt-out-markøren til at dokumentere den slags.
//
// Brug:
//   node scripts/lint-sql-policy-grants.mjs --all             # hele database/
//   node scripts/lint-sql-policy-grants.mjs a.sql b.sql       # kun disse filers
//                                                              # policies, men
//                                                              # GRANT + CREATE
//                                                              # TABLE slås op i
//                                                              # HELE database/
//
// Exit codes:
//   0 — no findings
//   1 — at least one policy without a matching grant on a post-cutover table
//   2 — internal error
//
// Refs #4943.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lint-migration-idempotency.mjs';

const TARGET_ROLE = 'authenticated';
// SELECT is deliberately excluded — see the #2830 header comment above.
const WRITE_OPS = ['INSERT', 'UPDATE', 'DELETE'];
const IDENT = '(?:"?[A-Za-z_][A-Za-z0-9_]*"?)';
const OPT_OUT = 'policy-grant-ok';
// database/2026-08-14-2830-revoke-truncate-og-default-privileges.sql — the
// migration that revoked default write-privilege inheritance for future
// tables. A table first CREATEd on this date or later gets no default
// INSERT/UPDATE/DELETE and needs an explicit GRANT.
const CUTOVER_DATE = '2026-08-14';

function unquote(id) {
  return id.replace(/^"|"$/g, '');
}

function roleListIncludesTarget(roleText) {
  const words = roleText
    .toLowerCase()
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  return words.includes(TARGET_ROLE);
}

function fileDate(base) {
  const m = base.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

/**
 * Find `CREATE POLICY "<name>" ON [public.]<table> FOR <op> TO <roles> ...`
 * occurrences. Only counts policies scoped `TO` a role list that includes
 * TARGET_ROLE. `FOR ALL` (or an omitted FOR clause, which defaults to ALL per
 * Postgres semantics) expands to every op in WRITE_OPS — SELECT is never
 * checked (see header).
 *
 * @param {string} stmtText - a single top-level statement (comments/semicolon
 *   already stripped by splitStatements)
 * @returns {Array<{table: string, ops: string[], policyName: string}>}
 */
export function findPolicies(stmtText) {
  const re = new RegExp(
    `CREATE\\s+POLICY\\s+"([^"]+)"\\s+ON\\s+(?:public\\.)?(${IDENT})` +
      `(?:\\s+FOR\\s+(INSERT|UPDATE|DELETE|SELECT|ALL))?` +
      `\\s+TO\\s+([\\s\\S]*?)(?=\\bUSING\\b|\\bWITH\\s+CHECK\\b|$)`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(stmtText)) !== null) {
    const [, policyName, tableRaw, opRaw, rolesRaw] = m;
    if (!roleListIncludesTarget(rolesRaw)) continue;
    const table = unquote(tableRaw).toLowerCase();
    const op = (opRaw || 'ALL').toUpperCase();
    const ops = op === 'ALL' ? [...WRITE_OPS] : WRITE_OPS.includes(op) ? [op] : [];
    if (ops.length === 0) continue; // SELECT-only policy — out of scope
    out.push({ table, ops, policyName });
  }
  return out;
}

/**
 * Find `GRANT <ops> ON [TABLE] [public.]<table> TO <roles>` occurrences
 * (table-level only — a column-scoped `GRANT SELECT (col) ON ...` never
 * matches because "ON" doesn't immediately follow the ops list there). The
 * optional `TABLE` keyword is real Postgres syntax and appears in this
 * codebase (e.g. `GRANT SELECT, INSERT, UPDATE ON TABLE forum_thread_reads
 * TO authenticated;`).
 *
 * @param {string} stmtText
 * @returns {Array<{table: string, ops: string[]}>}
 */
export function findGrants(stmtText) {
  const re = new RegExp(
    `GRANT\\s+(ALL(?:\\s+PRIVILEGES)?|(?:SELECT|INSERT|UPDATE|DELETE)` +
      `(?:\\s*,\\s*(?:SELECT|INSERT|UPDATE|DELETE))*)\\s+ON\\s+(?:TABLE\\s+)?(?:public\\.)?(${IDENT})` +
      `\\s+TO\\s+([^;]*)`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(stmtText)) !== null) {
    const [, opsRaw, tableRaw, rolesRaw] = m;
    if (!roleListIncludesTarget(rolesRaw)) continue;
    const table = unquote(tableRaw).toLowerCase();
    const ops = /^ALL/i.test(opsRaw.trim())
      ? [...WRITE_OPS]
      : opsRaw
          .split(',')
          .map((o) => o.trim().toUpperCase())
          .filter((o) => WRITE_OPS.includes(o));
    out.push({ table, ops });
  }
  return out;
}

/**
 * Find `CREATE TABLE [IF NOT EXISTS] [public.]<table>` occurrences (table
 * name only — column definitions don't matter here).
 *
 * @param {string} stmtText
 * @returns {string[]} lowercased table names
 */
export function findCreateTables(stmtText) {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?(${IDENT})`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(stmtText)) !== null) {
    out.push(unquote(m[1]).toLowerCase());
  }
  return out;
}

function hasOptOut(sourceLines, line) {
  const here = sourceLines[line - 1] || '';
  const above = sourceLines[line - 2] || '';
  return here.includes(OPT_OUT) || above.includes(OPT_OUT);
}

/**
 * @param {Array<{file: string, source: string}>} allSources - every
 *   database/*.sql migration file (sorted chronologically by filename),
 *   used to build the corpus-wide grant map and table-creation dates.
 * @param {Array<{file: string, source: string}>} checkSources - the subset to
 *   actually report findings for (PR mode: only changed files).
 * @returns {{findings: Array<{file:string,line:number,table:string,op:string,policyName:string}>}}
 */
export function scanCorpus(allSources, checkSources) {
  // Corpus-wide: table -> set of granted write-ops (TO authenticated).
  const grantedOps = new Map();
  // Corpus-wide: table -> date (YYYY-MM-DD) of the file containing its FIRST
  // CREATE TABLE. Sources must already be in chronological (filename) order.
  const createdOn = new Map();

  for (const { file, source } of allSources) {
    const date = fileDate(basename(file));
    for (const stmt of splitStatements(source)) {
      for (const { table, ops } of findGrants(stmt.text)) {
        if (!grantedOps.has(table)) grantedOps.set(table, new Set());
        for (const op of ops) grantedOps.get(table).add(op);
      }
      if (date) {
        for (const table of findCreateTables(stmt.text)) {
          if (!createdOn.has(table)) createdOn.set(table, date);
        }
      }
    }
  }

  const findings = [];
  for (const { file, source } of checkSources) {
    const base = basename(file);
    const sourceLines = source.split('\n');
    for (const stmt of splitStatements(source)) {
      for (const { table, ops, policyName } of findPolicies(stmt.text)) {
        const createdDate = createdOn.get(table);
        // Unknown creation date (bootstrap/schema.sql table, predates the
        // 2026-*.sql corpus) → assume pre-cutover, skip (false-negative-safe).
        if (!createdDate || createdDate < CUTOVER_DATE) continue;
        const granted = grantedOps.get(table) ?? new Set();
        for (const op of ops) {
          if (granted.has(op)) continue;
          if (hasOptOut(sourceLines, stmt.line)) continue;
          findings.push({ file: base, line: stmt.line, table, op, policyName });
        }
      }
    }
  }
  return { findings };
}

// ---------------------------------------------------------------------------
// File discovery + CLI
// ---------------------------------------------------------------------------
function repoRoot() {
  return resolve(fileURLToPath(import.meta.url), '..', '..');
}

function allMigrationFiles() {
  const dbDir = resolve(repoRoot(), 'database');
  return readdirSync(dbDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-.*\.sql$/.test(f)) // excludes schema.sql / supabase_setup.sql
    .map((f) => resolve(dbDir, f))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort(); // filenames are date-prefixed → sorted == chronological
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

function loadSources(files) {
  const sources = [];
  for (const f of files) {
    try {
      sources.push({ file: f, source: readFileSync(f, 'utf8') });
    } catch {
      continue;
    }
  }
  return sources;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const wantAll = process.argv.includes('--all') || args.length === 0;

  const allFiles = allMigrationFiles();
  const allSources = loadSources(allFiles);

  const checkFiles = wantAll ? allFiles : args.map((p) => resolve(p));
  const checkSources = loadSources(checkFiles);

  const { findings } = scanCorpus(allSources, checkSources);

  for (const fnd of findings) {
    process.stderr.write(
      `${fnd.file}:${fnd.line}: policy "${fnd.policyName}" grants ${TARGET_ROLE} ${fnd.op} ` +
        `on ${fnd.table} (created on/after ${CUTOVER_DATE}), but no ` +
        `\`GRANT ${fnd.op} ON public.${fnd.table} TO ${TARGET_ROLE}\` (or GRANT ALL) exists ` +
        `anywhere in database/\n`
    );
  }

  if (findings.length > 0) {
    process.stderr.write(`
🔴 SQL policy-grant guard blocked: ${findings.length} polic(y/ies) scope ${TARGET_ROLE} to a
write operation with no matching table GRANT, on a table created on/after
${CUTOVER_DATE} (no default write-privilege inheritance — see #2830 in the
script header).

Background (#4943): Postgres checks table-level privileges BEFORE it
evaluates RLS policies. A CREATE POLICY ... TO ${TARGET_ROLE} that is not
backed by a same-scope GRANT is unreachable — every request fails 42501
before the policy logic ever runs. This shipped once already: the 2026-09
in-app survey opened to 241 managers with working RLS policies and no
table grants, so nobody could save an answer.

Fix: add \`GRANT <op> ON public.<table> TO ${TARGET_ROLE};\` (or GRANT ALL)
in the same migration file, or confirm it already exists in an earlier
migration for the same table.

Intentionally narrower than the policy (e.g. a toggle table with no UPDATE
use case, or a table whose only write path is service_role)? Add a
\`-- ${OPT_OUT}: <reason>\` comment on the line above the CREATE POLICY
statement.

Refs #4943.
`);
    process.exit(1);
  }

  process.stdout.write(
    `✅ SQL policy-grant guard: ${checkSources.length} file(s) checked against ` +
      `${allSources.length} migration(s) in database/, no ungranted ${TARGET_ROLE} write-policies ` +
      `on post-${CUTOVER_DATE} tables.\n`
  );
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`lint-sql-policy-grants: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
