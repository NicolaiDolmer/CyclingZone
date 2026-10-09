// scripts/lint-migration-locks.test.mjs
// ============================================================
// Tests for the migration lock-safety forward-guard (#6342).
//
// Run:  node --test scripts/lint-migration-locks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  scanMigration,
  scanRefresh,
  scanFile,
  privObjects,
  loadBaseline,
  isBaselined,
} from './lint-migration-locks.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const rules = (src) => scanMigration(src, 't.sql').map((f) => f.rule);

// --- rule 1: lock-timeout --------------------------------------------------
test('lock-timeout: ALTER TABLE on existing table without SET lock_timeout is flagged', () => {
  assert.deepEqual(rules('ALTER TABLE riders ADD COLUMN IF NOT EXISTS x int;'), ['lock-timeout']);
});

test('lock-timeout: passes with SET lock_timeout (also SET LOCAL)', () => {
  assert.deepEqual(rules("SET lock_timeout = '3s';\nALTER TABLE riders ADD COLUMN IF NOT EXISTS x int;"), []);
  assert.deepEqual(rules("BEGIN;\nSET LOCAL lock_timeout = '3s';\nALTER TABLE riders DROP COLUMN IF EXISTS x;\nCOMMIT;"), []);
});

test('lock-timeout: table created in the same file is exempt', () => {
  const src = 'CREATE TABLE IF NOT EXISTS fresh (id int);\nALTER TABLE fresh ADD COLUMN IF NOT EXISTS y int;';
  assert.deepEqual(rules(src), []);
});

test('lock-timeout: policy / trigger / drop table / truncate on existing table', () => {
  assert.deepEqual(rules('DROP POLICY IF EXISTS p ON teams;'), ['lock-timeout']);
  assert.deepEqual(rules('CREATE TRIGGER trg BEFORE INSERT ON teams FOR EACH ROW EXECUTE FUNCTION f();'), ['lock-timeout']);
  assert.deepEqual(rules('DROP TABLE IF EXISTS old_things;'), ['lock-timeout']);
  assert.deepEqual(rules('TRUNCATE TABLE scratch;'), ['lock-timeout']);
});

test('lock-timeout: ALTER TABLE inside a DO block is flagged', () => {
  assert.deepEqual(rules('DO $$ BEGIN ALTER TABLE riders ADD COLUMN z int; END $$;'), ['lock-timeout']);
});

test('lock-timeout: comments mentioning ALTER TABLE are ignored', () => {
  assert.deepEqual(rules('-- ALTER TABLE riders ADD COLUMN x int;\nSELECT 1;'), []);
});

// --- rule 2: index-concurrently -------------------------------------------
test('index-concurrently: plain CREATE INDEX on existing table is flagged', () => {
  assert.deepEqual(rules('CREATE INDEX IF NOT EXISTS i ON riders (a);'), ['index-concurrently']);
  assert.deepEqual(rules('CREATE UNIQUE INDEX IF NOT EXISTS i ON public.riders (a);'), ['index-concurrently']);
});

test('index-concurrently: CONCURRENTLY passes', () => {
  assert.deepEqual(rules('CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON riders (a);'), []);
});

test('index-concurrently: index on table created in the same file passes', () => {
  const src = 'CREATE TABLE IF NOT EXISTS fresh (a int);\nCREATE INDEX IF NOT EXISTS i ON fresh (a);';
  assert.deepEqual(rules(src), []);
});

// --- rule 3: refresh-concurrently -----------------------------------------
test('refresh-concurrently: bare REFRESH is flagged, CONCURRENTLY passes', () => {
  assert.equal(scanRefresh('REFRESH MATERIALIZED VIEW mv_a;', 'a.sql').length, 1);
  assert.equal(scanRefresh('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_a;', 'a.sql').length, 0);
});

test('refresh-concurrently: statement split across lines, comments ignored', () => {
  assert.equal(scanRefresh('REFRESH MATERIALIZED VIEW\n  CONCURRENTLY mv_a;', 'a.sql').length, 0);
  assert.equal(scanRefresh('REFRESH MATERIALIZED VIEW\n  mv_a;', 'a.sql').length, 1);
  assert.equal(scanRefresh('-- REFRESH MATERIALIZED VIEW mv_a;\n// REFRESH MATERIALIZED VIEW mv_b', 'a.sql').length, 0);
  assert.equal(scanRefresh('/* REFRESH MATERIALIZED VIEW mv_a; */', 'a.sql').length, 0);
});

test('refresh-concurrently: applies to backend code, not to other paths', () => {
  const bad = 'await db.query("REFRESH MATERIALIZED VIEW mv_a");';
  assert.equal(scanFile('backend/lib/x.js', bad).length, 1);
  assert.equal(scanFile('database/2026-10-09-x.sql', 'REFRESH MATERIALIZED VIEW mv_a;').some((f) => f.rule === 'refresh-concurrently'), true);
  assert.equal(scanFile('frontend/src/x.js', bad).length, 0);
});

// --- rule 4: grant-atomic --------------------------------------------------
test('grant-atomic: REVOKE and GRANT as separate autocommit statements are flagged', () => {
  const src = 'REVOKE ALL ON TABLE consents FROM anon;\nGRANT SELECT ON TABLE consents TO authenticated;';
  assert.deepEqual(rules(src), ['grant-atomic']);
});

test('grant-atomic: same BEGIN..COMMIT passes', () => {
  const src = 'BEGIN;\nREVOKE ALL ON TABLE consents FROM anon;\nGRANT SELECT ON TABLE consents TO authenticated;\nCOMMIT;';
  assert.deepEqual(rules(src), []);
});

test('grant-atomic: REVOKE and GRANT in different transactions are flagged', () => {
  const src = 'BEGIN;\nREVOKE ALL ON consents FROM anon;\nCOMMIT;\nBEGIN;\nGRANT SELECT ON consents TO authenticated;\nCOMMIT;';
  assert.deepEqual(rules(src), ['grant-atomic']);
});

test('grant-atomic: both inside one DO block passes', () => {
  const src = 'DO $$ BEGIN REVOKE ALL ON consents FROM anon; GRANT SELECT ON consents TO authenticated; END $$;';
  assert.deepEqual(rules(src), []);
});

test('grant-atomic: REVOKE alone, or different objects, passes', () => {
  assert.deepEqual(rules('REVOKE ALL ON TABLE a FROM anon;'), []);
  assert.deepEqual(rules('REVOKE ALL ON TABLE a FROM anon;\nGRANT SELECT ON TABLE b TO authenticated;'), []);
});

test('grant-atomic: object created in the same file is exempt', () => {
  const src = 'CREATE TABLE IF NOT EXISTS fresh (a int);\nREVOKE ALL ON fresh FROM anon;\nGRANT SELECT ON fresh TO authenticated;';
  assert.deepEqual(rules(src), []);
});

test('privObjects: functions drop arg lists, schema prefix is stripped', () => {
  assert.deepEqual(privObjects('REVOKE ALL ON FUNCTION public.f(int, text) FROM anon'), ['function:f']);
  assert.deepEqual(privObjects('GRANT SELECT ON public.Riders, teams TO authenticated'), ['table:riders', 'table:teams']);
  assert.deepEqual(privObjects('GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated'), ['all tables in schema:public']);
});

// --- baseline + whole tree -------------------------------------------------
test('baseline: entries carry a reason and lookup is per file + rule', () => {
  const baseline = loadBaseline(join(HERE, 'lint-migration-locks-baseline.json'));
  const files = Object.keys(baseline);
  assert.ok(files.length > 0);
  for (const f of files) {
    for (const [rule, reason] of Object.entries(baseline[f])) {
      assert.ok(typeof reason === 'string' && reason.length > 10, `${f}:${rule} needs a reason`);
    }
  }
  assert.equal(isBaselined({ 'a.sql': { 'lock-timeout': 'r' } }, 'a.sql', 'lock-timeout'), true);
  assert.equal(isBaselined({ 'a.sql': { 'lock-timeout': 'r' } }, 'a.sql', 'grant-atomic'), false);
});

test('current tree: CLI exits 0 (all existing findings grandfathered)', () => {
  const out = execFileSync(process.execPath, [join(HERE, 'lint-migration-locks.mjs')], { encoding: 'utf8' });
  assert.match(out, /no new violations/);
});
