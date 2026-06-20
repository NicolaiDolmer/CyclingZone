// scripts/lint-migration-idempotency.test.mjs
// ============================================================
// Tests for the migration idempotency forward-guard (#401).
//
// Run:  node --test scripts/lint-migration-idempotency.test.mjs
//
// Coverage:
//   1. Flags bare CREATE TABLE / INDEX / SEQUENCE / TYPE / POLICY / TRIGGER.
//   2. Passes the idempotent forms (IF NOT EXISTS, DROP ... IF EXISTS first,
//      CREATE OR REPLACE TRIGGER, DO-block guards).
//   3. ADD COLUMN / ADD CONSTRAINT handling (per-add IF NOT EXISTS; file-level
//      DROP CONSTRAINT IF EXISTS coverage).
//   4. Comments + dollar-quoted bodies are not mis-scanned.
//   5. Zero NEW findings on the current database/2026-*.sql tree (whitelist +
//      idempotent migrations only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitStatements,
  countDropIfExists,
  scanMigration,
  WHITELIST,
} from './lint-migration-idempotency.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DB_DIR = join(HERE, '..', 'database');

// --- CREATE TABLE -----------------------------------------------------------

test('flags bare CREATE TABLE', () => {
  const f = scanMigration('CREATE TABLE foo (id int);', 'x.sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'CREATE TABLE');
});

test('passes CREATE TABLE IF NOT EXISTS', () => {
  assert.equal(scanMigration('CREATE TABLE IF NOT EXISTS foo (id int);', 'x.sql').length, 0);
});

test('passes UNLOGGED / TEMP table with IF NOT EXISTS', () => {
  assert.equal(scanMigration('CREATE UNLOGGED TABLE IF NOT EXISTS foo (id int);', 'x.sql').length, 0);
});

// --- CREATE INDEX -----------------------------------------------------------

test('flags bare CREATE INDEX and CREATE UNIQUE INDEX', () => {
  assert.equal(scanMigration('CREATE INDEX i ON t (c);', 'x.sql').length, 1);
  assert.equal(scanMigration('CREATE UNIQUE INDEX i ON t (c);', 'x.sql').length, 1);
});

test('passes CREATE [UNIQUE] INDEX IF NOT EXISTS', () => {
  assert.equal(scanMigration('CREATE INDEX IF NOT EXISTS i ON t (c);', 'x.sql').length, 0);
  assert.equal(
    scanMigration('CREATE UNIQUE INDEX IF NOT EXISTS i ON t (lower(name)) WHERE x;', 'x.sql').length,
    0
  );
});

// --- CREATE SEQUENCE --------------------------------------------------------

test('flags bare CREATE SEQUENCE, passes IF NOT EXISTS', () => {
  assert.equal(scanMigration('CREATE SEQUENCE s;', 'x.sql').length, 1);
  assert.equal(scanMigration('CREATE SEQUENCE IF NOT EXISTS s;', 'x.sql').length, 0);
});

// --- CREATE TYPE ------------------------------------------------------------

test('flags top-level CREATE TYPE (no native IF NOT EXISTS)', () => {
  const f = scanMigration("CREATE TYPE mood AS ENUM ('a','b');", 'x.sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'CREATE TYPE');
});

test('passes CREATE TYPE wrapped in a DO-block', () => {
  const src = `DO $$ BEGIN
    CREATE TYPE mood AS ENUM ('a','b');
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;`;
  assert.equal(scanMigration(src, 'x.sql').length, 0);
});

// --- CREATE POLICY ----------------------------------------------------------

test('flags CREATE POLICY without a preceding DROP POLICY IF EXISTS (#401 shape)', () => {
  const src = 'CREATE POLICY p ON t FOR SELECT TO authenticated USING (true);';
  const f = scanMigration(src, 'x.sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'CREATE POLICY');
});

test('passes CREATE POLICY when DROP POLICY IF EXISTS precedes it', () => {
  const src =
    'DROP POLICY IF EXISTS p ON t;\nCREATE POLICY p ON t FOR SELECT TO authenticated USING (true);';
  assert.equal(scanMigration(src, 'x.sql').length, 0);
});

test('flags the SECOND CREATE POLICY when only one DROP IF EXISTS is present', () => {
  const src = [
    'DROP POLICY IF EXISTS a ON t;',
    'CREATE POLICY a ON t FOR SELECT USING (true);',
    'CREATE POLICY b ON t FOR SELECT USING (true);',
  ].join('\n');
  const f = scanMigration(src, 'x.sql');
  assert.equal(f.length, 1, 'second un-dropped policy is a finding');
});

// --- CREATE TRIGGER ---------------------------------------------------------

test('flags bare CREATE TRIGGER, passes CREATE OR REPLACE TRIGGER', () => {
  assert.equal(
    scanMigration('CREATE TRIGGER tg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();', 'x.sql')
      .length,
    1
  );
  assert.equal(
    scanMigration(
      'CREATE OR REPLACE TRIGGER tg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();',
      'x.sql'
    ).length,
    0
  );
});

test('passes CREATE TRIGGER when DROP TRIGGER IF EXISTS precedes it', () => {
  const src =
    'DROP TRIGGER IF EXISTS tg ON t;\nCREATE TRIGGER tg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();';
  assert.equal(scanMigration(src, 'x.sql').length, 0);
});

// --- ALTER TABLE ADD COLUMN -------------------------------------------------

test('flags ADD COLUMN without IF NOT EXISTS, passes with it', () => {
  assert.equal(scanMigration('ALTER TABLE t ADD COLUMN c int;', 'x.sql').length, 1);
  assert.equal(scanMigration('ALTER TABLE t ADD COLUMN IF NOT EXISTS c int;', 'x.sql').length, 0);
});

test('flags ADD COLUMN when only one of several adds is guarded', () => {
  const src = 'ALTER TABLE t ADD COLUMN IF NOT EXISTS a int, ADD COLUMN b int;';
  assert.equal(scanMigration(src, 'x.sql').length, 1);
});

// --- ALTER TABLE ADD CONSTRAINT ---------------------------------------------

test('flags ADD CONSTRAINT without a preceding DROP CONSTRAINT IF EXISTS', () => {
  const f = scanMigration('ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);', 'x.sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'ALTER TABLE ADD CONSTRAINT');
});

test('passes ADD CONSTRAINT when DROP CONSTRAINT IF EXISTS precedes it', () => {
  const src =
    'ALTER TABLE t DROP CONSTRAINT IF EXISTS c;\nALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);';
  assert.equal(scanMigration(src, 'x.sql').length, 0);
});

test('passes ADD CONSTRAINT inside a DO-block guard', () => {
  const src = `DO $$ BEGIN
    ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;`;
  assert.equal(scanMigration(src, 'x.sql').length, 0);
});

// --- idempotent-by-default DDL passes --------------------------------------

test('CREATE OR REPLACE FUNCTION / VIEW are not flagged', () => {
  assert.equal(scanMigration('CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;', 'x.sql').length, 0);
  assert.equal(scanMigration('CREATE OR REPLACE VIEW v AS SELECT 1;', 'x.sql').length, 0);
  assert.equal(scanMigration('CREATE EXTENSION IF NOT EXISTS pgcrypto;', 'x.sql').length, 0);
});

// --- comments + strings are not mis-scanned --------------------------------

test('ignores DDL keywords inside comments', () => {
  assert.equal(scanMigration('-- CREATE TABLE foo (id int);\nSELECT 1;', 'x.sql').length, 0);
  assert.equal(scanMigration('/* CREATE INDEX i ON t (c); */\nSELECT 1;', 'x.sql').length, 0);
});

test('ignores DDL keywords inside string literals', () => {
  assert.equal(scanMigration("INSERT INTO log (msg) VALUES ('CREATE TABLE foo');", 'x.sql').length, 0);
});

// --- tokeniser internals ----------------------------------------------------

test('splitStatements splits on top-level semicolons and tracks line numbers', () => {
  const src = 'SELECT 1;\nCREATE TABLE foo (id int);\nSELECT 2;';
  const stmts = splitStatements(src);
  assert.equal(stmts.length, 3);
  assert.equal(stmts[1].line, 2);
  assert.match(stmts[1].text, /CREATE TABLE/);
});

test('splitStatements does not split on a semicolon inside a dollar-quoted body', () => {
  const src = 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; PERFORM 2; END $$ LANGUAGE plpgsql;';
  const stmts = splitStatements(src);
  assert.equal(stmts.length, 1, 'the inner ; must not split the statement');
  assert.equal(stmts[0].inDollar, true);
});

test('countDropIfExists tallies POLICY / TRIGGER / CONSTRAINT drops', () => {
  const stmts = splitStatements(
    'DROP POLICY IF EXISTS p ON t;\nDROP TRIGGER IF EXISTS tg ON t;\nALTER TABLE t DROP CONSTRAINT IF EXISTS c;'
  );
  const counts = countDropIfExists(stmts);
  assert.deepEqual(counts, { POLICY: 1, TRIGGER: 1, CONSTRAINT: 1 });
});

// --- corpus regression (the load-bearing test) ------------------------------

test('zero NEW non-idempotent findings on the current database/2026-*.sql tree', () => {
  const files = readdirSync(DB_DIR)
    .filter((f) => /^2026-.*\.sql$/.test(f))
    .filter((f) => statSync(join(DB_DIR, f)).isFile());
  assert.ok(files.length > 100, `expected the full migration corpus, got ${files.length}`);

  const offenders = [];
  for (const f of files) {
    if (WHITELIST[f]) continue; // legitimately non-idempotent (historical)
    const findings = scanMigration(readFileSync(join(DB_DIR, f), 'utf8'), f);
    for (const fnd of findings) offenders.push(`${fnd.file}:${fnd.line} ${fnd.kind} — ${fnd.snippet}`);
  }
  assert.equal(
    offenders.length,
    0,
    `New non-idempotent DDL (run \`node scripts/lint-migration-idempotency.mjs\`):\n${offenders.join('\n')}`
  );
});

test('every whitelisted file still exists in database/ (no stale entries)', () => {
  for (const name of Object.keys(WHITELIST)) {
    const p = join(DB_DIR, name);
    assert.ok(
      statSync(p).isFile(),
      `WHITELIST entry ${name} no longer exists — remove the stale whitelist line.`
    );
    assert.equal(basename(p), name);
  }
});
