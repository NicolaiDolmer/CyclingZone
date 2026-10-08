#!/usr/bin/env node
// scripts/lint-migration-locks.mjs
// ============================================================
// Migration lock-safety forward-guard for #6342.
//
// WHY:
//   Lock/statement timeouts on player reads (55P03 / 57014) were traced to
//   migrations and index builds hitting live traffic, and a failed consent
//   save burst came from a REVOKE/GRANT window. auto-migrate applies each
//   file with `psql -f` (autocommit, NO surrounding transaction), so every
//   statement is its own transaction unless the file says BEGIN/COMMIT.
//
// RULES (documented in docs/MIGRATIONS.md):
//   lock-timeout        Strong-lock DDL on an EXISTING table (ALTER TABLE,
//                       DROP TABLE, TRUNCATE, CREATE/DROP POLICY, CREATE/DROP
//                       TRIGGER) requires `SET lock_timeout` somewhere in the
//                       file, so the migration fails fast instead of queueing
//                       behind (and blocking) live traffic.
//   index-concurrently  CREATE INDEX on an existing table requires
//                       CONCURRENTLY. Tables created in the same file are
//                       exempt (nobody can be using them yet).
//   refresh-concurrently  REFRESH MATERIALIZED VIEW without CONCURRENTLY is
//                       forbidden in database/2026-*.sql and in backend/ code.
//   grant-atomic        REVOKE and GRANT on the same object must be in the
//                       same transaction (explicit BEGIN..COMMIT, or inside one
//                       DO block). Otherwise there is a window where the object
//                       has no privileges. Objects created in the same file are
//                       exempt.
//
// FORWARD-GUARD, not retroactive: existing violations are grandfathered in
// scripts/lint-migration-locks-baseline.json (per file + rule, with a reason).
// New files are enforced. Do NOT add new files to the baseline; fix the
// migration instead.
//
// Same tokeniser as scripts/lint-migration-idempotency.mjs (splitStatements).
//
// Usage:
//   node scripts/lint-migration-locks.mjs                   # whole tree
//   node scripts/lint-migration-locks.mjs path/a.sql ...    # specific files
//   node scripts/lint-migration-locks.mjs --print-baseline  # list raw findings
//
// Exit codes: 0 clean, 1 at least one non-baselined finding.
//
// Refs #6342.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lint-migration-idempotency.mjs';

export const RULE_IDS = [
  'lock-timeout',
  'index-concurrently',
  'refresh-concurrently',
  'grant-atomic',
];

const FIXES = {
  'lock-timeout': "add `SET lock_timeout = '3s';` before the DDL (auto-migrate can be re-triggered)",
  'index-concurrently': 'use CREATE INDEX CONCURRENTLY IF NOT EXISTS (or create the table in the same file)',
  'refresh-concurrently': 'use REFRESH MATERIALIZED VIEW CONCURRENTLY (needs a unique index on the view)',
  'grant-atomic': 'wrap the REVOKE and GRANT of the object in one BEGIN; ... COMMIT; (or one DO block)',
};

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/** Normalise an object name: strip quotes, schema `public.`, lowercase. */
export function normName(raw) {
  return raw
    .replace(/"/g, '')
    .trim()
    .replace(/^public\./i, '')
    .toLowerCase();
}

const NAME = '((?:"[^"]+"|[A-Za-z_][\\w$]*)(?:\\.(?:"[^"]+"|[A-Za-z_][\\w$]*))?)';

/** Tables created anywhere in the file (incl. inside DO blocks). */
export function createdTables(statements) {
  const re = new RegExp(
    `\\bCREATE\\s+(?:(?:UNLOGGED|TEMP|TEMPORARY|GLOBAL|LOCAL)\\s+)*TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`,
    'gi'
  );
  const set = new Set();
  for (const { text } of statements) {
    for (const m of collapse(text).matchAll(re)) set.add(normName(m[1]));
  }
  return set;
}

function hasLockTimeout(statements) {
  return statements.some(({ text }) =>
    /\bSET\s+(?:LOCAL\s+|SESSION\s+)?lock_timeout\b/i.test(text) ||
    /set_config\s*\(\s*'lock_timeout'/i.test(text)
  );
}

// Lead patterns that take a strong lock on an existing table. group 1 = table.
const STRONG_LEADS = [
  new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}`, 'i'),
  new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${NAME}`, 'i'),
  new RegExp(`^TRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?${NAME}`, 'i'),
  new RegExp(`^CREATE\\s+POLICY\\s+.+?\\s+ON\\s+${NAME}`, 'i'),
  new RegExp(`^DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?.+?\\s+ON\\s+${NAME}`, 'i'),
  new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+.+?\\s+ON\\s+${NAME}`, 'i'),
  new RegExp(`^DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?.+?\\s+ON\\s+${NAME}`, 'i'),
];
const ALTER_IN_BODY = new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}`, 'gi');

const INDEX_LEAD = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${NAME}\\s+)?ON\\s+(?:ONLY\\s+)?${NAME}`,
  'i'
);

function snip(text) {
  const first = text.split('\n')[0].trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

function finding(file, line, rule, snippet) {
  return { file, line, rule, fix: FIXES[rule], snippet };
}

// REVOKE/GRANT object extraction -------------------------------------------
const PRIV_LEAD = /^(REVOKE|GRANT)\b/i;
const PRIV_TARGET =
  /\bON\s+(ALL\s+(?:TABLES|SEQUENCES|FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA|TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|SCHEMA|DOMAIN|TYPE)?\s*(.+?)\s+(?:FROM|TO)\b/i;

/** @returns {string[]} normalised object keys a REVOKE/GRANT statement touches */
export function privObjects(text) {
  const c = collapse(text);
  const m = c.match(PRIV_TARGET);
  if (!m) return [];
  const kind = (m[1] || 'TABLE').toUpperCase().replace(/\s+/g, ' ');
  // drop function arg lists so `f(int, text)` is one object
  const body = m[2].replace(/\([^)]*\)/g, '');
  return body
    .split(',')
    .map((s) => normName(s))
    .filter(Boolean)
    .map((n) => `${kind === 'TABLE' ? 'table' : kind.toLowerCase()}:${n}`);
}

/**
 * Scan a migration source with rules lock-timeout, index-concurrently,
 * grant-atomic. (refresh-concurrently is scanRefresh, applies to code too.)
 */
export function scanMigration(source, filename = '<source>') {
  const statements = splitStatements(source);
  const created = createdTables(statements);
  const out = [];

  // lock-timeout
  if (!hasLockTimeout(statements)) {
    for (const stmt of statements) {
      const c = collapse(stmt.text);
      if (stmt.inDollar && /^DO\b/i.test(c)) {
        for (const m of c.matchAll(ALTER_IN_BODY)) {
          if (!created.has(normName(m[1]))) {
            out.push(finding(filename, stmt.line, 'lock-timeout', snip(stmt.text)));
            break;
          }
        }
        continue;
      }
      if (stmt.inDollar) continue; // CREATE FUNCTION bodies etc. are not run now
      for (const re of STRONG_LEADS) {
        const m = c.match(re);
        if (!m) continue;
        if (!created.has(normName(m[1]))) {
          out.push(finding(filename, stmt.line, 'lock-timeout', snip(stmt.text)));
        }
        break;
      }
    }
  }

  // index-concurrently
  for (const stmt of statements) {
    if (stmt.inDollar) continue;
    const m = collapse(stmt.text).match(INDEX_LEAD);
    if (!m) continue;
    const table = normName(m[3]);
    if (!m[1] && !created.has(table)) {
      out.push(finding(filename, stmt.line, 'index-concurrently', snip(stmt.text)));
    }
  }

  // grant-atomic: assign each statement a transaction id
  let txCounter = 0;
  let openTx = null;
  const byObj = new Map(); // key -> {revokes: [{tx,line,snippet}], grants: [txIds]}
  for (const stmt of statements) {
    const c = collapse(stmt.text);
    if (/^(BEGIN|START\s+TRANSACTION)\b/i.test(c)) {
      openTx = ++txCounter;
      continue;
    }
    if (/^(COMMIT|END|ROLLBACK)\b/i.test(c)) {
      openTx = null;
      continue;
    }
    const tx = openTx ?? ++txCounter; // autocommit => unique tx per statement
    const units = [];
    if (stmt.inDollar && /^DO\b/i.test(c)) {
      // every REVOKE/GRANT inside one DO block shares that block's tx
      for (const m of c.matchAll(/\b(REVOKE|GRANT)\b[^;]*?\bON\b[^;]*?\b(?:FROM|TO)\b[^;]*;?/gi)) {
        units.push(m[0]);
      }
    } else if (!stmt.inDollar && PRIV_LEAD.test(c)) {
      units.push(c);
    }
    for (const u of units) {
      const kindWord = u.match(PRIV_LEAD)?.[1]?.toUpperCase();
      if (!kindWord) continue;
      for (const key of privObjects(u)) {
        const bare = key.replace(/^[^:]+:/, '');
        if (created.has(bare)) continue; // brand-new object: nobody to lock out
        if (!byObj.has(key)) byObj.set(key, { revokes: [], grants: [] });
        const rec = byObj.get(key);
        if (kindWord === 'REVOKE') rec.revokes.push({ tx, line: stmt.line, snippet: snip(stmt.text) });
        else rec.grants.push(tx);
      }
    }
  }
  const seen = new Set();
  for (const rec of byObj.values()) {
    if (rec.grants.length === 0) continue;
    for (const r of rec.revokes) {
      if (rec.grants.includes(r.tx)) continue;
      const k = `${r.line}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(finding(filename, r.line, 'grant-atomic', r.snippet));
    }
  }

  return out.sort((a, b) => a.line - b.line);
}

/**
 * refresh-concurrently: works on SQL or code text. Ignores `--`/`//`/`*`
 * comment lines and /* ... *​/ blocks.
 */
export function scanRefresh(source, filename = '<source>') {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /\bREFRESH\s+MATERIALIZED\s+VIEW\s+(?!CONCURRENTLY\b)/gi;
  const lines = stripped.split('\n');
  lines.forEach((lineText, idx) => {
    const t = lineText.trim();
    if (t.startsWith('--') || t.startsWith('//') || t.startsWith('*')) return;
    // statement split across lines: join with next line for the lookahead
    const probe = `${lineText} ${lines[idx + 1] ?? ''}`;
    re.lastIndex = 0;
    if (re.test(lineText) || /\bREFRESH\s+MATERIALIZED\s+VIEW\s*$/i.test(lineText) && !/^\s*CONCURRENTLY\b/i.test(lines[idx + 1] ?? '')) {
      out.push(finding(filename, idx + 1, 'refresh-concurrently', snip(lineText.trim() || probe)));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------
export function loadBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).entries ?? {};
  } catch (err) {
    // A missing/broken baseline must not silently turn every grandfathered
    // finding into a "new" violation with no hint why.
    throw new Error(`Failed to load migration lock baseline "${path}": ${err.message}`, { cause: err });
  }
}

export function isBaselined(baseline, relPath, rule) {
  return Boolean(baseline[relPath]?.[rule]);
}

// ---------------------------------------------------------------------------
// File discovery + CLI
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const CODE_EXT = /\.(?:js|mjs|cjs|ts|tsx|sql)$/;

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (CODE_EXT.test(e)) acc.push(p);
  }
  return acc;
}

const toPosix = (p) => p.split('\\').join('/');
const isMigration = (rel) => /^database\/2026-[^/]*\.sql$/.test(rel);

export function scanFile(rel, source) {
  const base = basename(rel);
  const found = [];
  if (isMigration(rel)) found.push(...scanMigration(source, base));
  if (isMigration(rel) || rel.startsWith('backend/')) {
    found.push(...scanRefresh(source, base));
  }
  return found.map((f) => ({ ...f, file: rel }));
}

function isMain() {
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const printBaseline = args.includes('--print-baseline');
  const explicit = args.filter((a) => !a.startsWith('-'));
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const baseline = loadBaseline(join(root, 'scripts', 'lint-migration-locks-baseline.json'));

  let files;
  if (explicit.length > 0) {
    files = explicit.map((p) => toPosix(relative(root, resolve(p))));
  } else {
    files = [
      ...walk(join(root, 'database')).filter((p) => isMigration(toPosix(relative(root, p)))),
      ...walk(join(root, 'backend')),
    ]
      .map((p) => toPosix(relative(root, p)))
      .sort();
  }

  let total = 0;
  let scanned = 0;
  let grandfathered = 0;
  const raw = {};
  for (const rel of files) {
    if (!isMigration(rel) && !rel.startsWith('backend/')) continue;
    let src;
    try {
      src = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    scanned++;
    for (const f of scanFile(rel, src)) {
      (raw[rel] ??= {})[f.rule] = true;
      if (isBaselined(baseline, rel, f.rule)) {
        grandfathered++;
        continue;
      }
      total++;
      if (!printBaseline) {
        process.stderr.write(`${rel}:${f.line}: ${f.rule} — ${f.snippet}\n    fix: ${f.fix}\n`);
      }
    }
  }

  if (printBaseline) {
    process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`);
    return;
  }

  if (total > 0) {
    process.stderr.write(`
Migration lock guard blocked: ${total} finding(s).

Background (#6342): lock/statement timeouts on player reads were traced to
migrations and index builds. auto-migrate runs \`psql -f\` per file with no
surrounding transaction. See docs/MIGRATIONS.md ("Lock safety") for the rules.

Existing files are grandfathered in scripts/lint-migration-locks-baseline.json
(per file + rule, with a reason). New files must be FIXED, not baselined.

Refs #6342.
`);
    process.exit(1);
  }

  process.stdout.write(
    `Migration lock guard: ${scanned} file(s) scanned, ${grandfathered} grandfathered finding(s), no new violations.\n`
  );
}

if (isMain()) main();
