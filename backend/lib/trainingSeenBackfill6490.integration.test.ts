import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { createTrainingSeenFixture, installFoundation, insertReport, report, A, B, C, counts } from './testFixtures/trainingSeen6490.ts';

let db: PGlite;
const sql = (name: string) => readFile(new URL(`../../database/manual/6490/training-seen-${name}.sql`, import.meta.url), 'utf8');
before(async () => {
  db = await createTrainingSeenFixture(); await installFoundation(db);
  await db.exec(await sql('parity')); await db.exec(await sql('backfill'));
});
after(async () => db?.close());
beforeEach(async () => { await db.exec('RESET ROLE; TRUNCATE training_day_runs; DELETE FROM rider_training_seen'); });
const parity = async () => (await db.query('SELECT * FROM training_seen_parity()')).rows[0];
const clean = { unindexed: 0, missing_keys: 0, extra_keys: 0, wrong_counts: 0 };

test('bounded backfill resumes old, empty and overlapping report rows without double counting', async () => {
  await db.exec("SET session_replication_role=replica");
  await insertReport(db, report(A, A)); await insertReport(db, report(A, B)); await insertReport(db, {});
  await db.exec('SET session_replication_role=origin');
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*not ready/);
  assert.equal((await parity()).unindexed, 3);
  await db.exec('BEGIN'); await db.query('SELECT * FROM training_seen_backfill_batch(1)'); await db.exec('ROLLBACK');
  assert.equal((await parity()).unindexed, 3);
  for (let i = 0; i < 3; i++) {
    const { rows } = await db.query('SELECT * FROM training_seen_backfill_batch(1)');
    assert.deepEqual(rows, [{ processed: 1, remaining: 2 - i }]);
  }
  assert.deepEqual(await counts(db), { [A]: 2, [B]: 1 });
  assert.deepEqual(await parity(), clean);
  assert.deepEqual((await db.query('SELECT * FROM training_seen_backfill_batch(5)')).rows, [{ processed: 0, remaining: 0 }]);
  await db.query('SELECT training_seen_assert_ready()');
});

test('parity distinguishes missing, extra and wrong counts and ignores zero tombstones', async () => {
  await insertReport(db, report(A, B));
  await db.query('DELETE FROM rider_training_seen WHERE rider_key=$1', [A]);
  await db.query('UPDATE rider_training_seen SET report_count=2 WHERE rider_key=$1', [B]);
  await db.query('INSERT INTO rider_training_seen VALUES($1,1),($2,0)', [C, 'unused']);
  assert.deepEqual(await parity(), { ...clean, missing_keys: 1, extra_keys: 1, wrong_counts: 1 });
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*not ready/);
});

test('readiness and batch reject disabled or changed maintenance contracts before writes', async () => {
  await db.exec('ALTER TABLE training_day_runs DISABLE TRIGGER training_seen_update');
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*contract/);
  await assert.rejects(db.query('SELECT * FROM training_seen_backfill_batch(1)'), /training_seen.*contract/);
  await db.exec('ALTER TABLE training_day_runs ENABLE TRIGGER training_seen_update');
  await db.exec(`CREATE OR REPLACE FUNCTION training_seen_keys(p_report jsonb) RETURNS SETOF text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$ SELECT 'wrong'::text $$`);
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*contract/);
  await installFoundation(db);
  await db.query('SELECT training_seen_assert_ready()');
});

test('batch validates bounds and SQL is idempotent without broadening client access', async () => {
  for (const size of [null, 0, -1, 1001]) {
    await assert.rejects(db.query('SELECT * FROM training_seen_backfill_batch($1)', [size]), /training_seen.*batch size/);
  }
  await insertReport(db, report(A));
  await db.exec(await sql('parity')); await db.exec(await sql('backfill'));
  assert.deepEqual(await parity(), clean);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM training_seen_backfill_batch(1)'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM training_seen_parity()'), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  await db.query('SELECT training_seen_assert_ready()');
  await db.query('SELECT * FROM training_seen_backfill_batch(1)');
  await db.exec('RESET ROLE');
});

test('readiness rejects a nullable source marker and non-exact key collation', async () => {
  await db.exec('ALTER TABLE training_day_runs ALTER COLUMN training_seen_indexed DROP NOT NULL');
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*contract/);
  await db.exec('ALTER TABLE training_day_runs ALTER COLUMN training_seen_indexed SET NOT NULL');
  await db.exec('ALTER TABLE rider_training_seen ALTER COLUMN rider_key TYPE text COLLATE "default"');
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*contract/);
  await db.exec('ALTER TABLE rider_training_seen ALTER COLUMN rider_key TYPE text COLLATE "C"');
  await db.query('SELECT training_seen_assert_ready()');
});

test('a scalar extractor with the same body cannot certify incomplete multi-rider reports', async () => {
  const definition=(await db.query<{ definition: string }>(`SELECT pg_get_functiondef(
    'public.training_seen_keys(jsonb)'::regprocedure) AS definition`)).rows[0].definition;
  await db.exec('DROP FUNCTION public.training_seen_keys(jsonb)');
  await db.exec(definition.replace('RETURNS SETOF text','RETURNS text'));
  await db.exec(`REVOKE ALL ON FUNCTION public.training_seen_keys(jsonb) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.training_seen_keys(jsonb) TO service_role`);
  await insertReport(db,report(A,B));
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'), /training_seen.*contract/);
  await assert.rejects(db.query('SELECT * FROM training_seen_backfill_batch(1)'), /training_seen.*contract/);
});
