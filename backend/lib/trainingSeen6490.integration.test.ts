import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, TEAM, createTrainingSeenFixture, installFoundation, insertReport, counts, report } from './testFixtures/trainingSeen6490.ts';

let db: PGlite;
before(async () => { db = await createTrainingSeenFixture(); await installFoundation(db); });
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE training_day_runs; DELETE FROM rider_training_seen;
    INSERT INTO teams VALUES('${TEAM}') ON CONFLICT DO NOTHING;`);
});

test('keys match the real JSON containment oracle for typed and noncanonical values', async () => {
  const probes = [A, A.toUpperCase(), A.replaceAll('-', ''), B, '', '42', 'null', 'é', 'e\u0301'];
  const cases: unknown[] = [null, {}, { riders: null }, { riders: [] }, { riders: A },
    { riders: { rider_id: A } }, report(A, A, B), report(A.toUpperCase()),
    report(A.replaceAll('-', ''), '', 'é', 'e\u0301'), { riders: [null, A, 42, {}, { rider_id: null }, { rider_id: 42 }] },
    { riders: [[{ rider_id: A }]] }, { riders: [{ rider_id: [A] }] }, { riders: [{ rider_id: { nested: A } }] }];
  for (const value of cases) for (const key of probes) {
    const { rows } = await db.query<{ old_hit: boolean; new_hit: boolean }>(`SELECT
      COALESCE($1::jsonb->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',$2::text)),false) AS old_hit,
      EXISTS(SELECT 1 FROM training_seen_keys($1::jsonb) AS k WHERE k COLLATE "C"=$2::text COLLATE "C") AS new_hit`,
    [JSON.stringify(value), key]);
    assert.equal(rows[0].new_hit, rows[0].old_hit, JSON.stringify({ value, key }));
  }
});

test('counts reports once per exact key and ignores unchanged membership', async () => {
  const id = (await insertReport(db, report(A, A, B))).rows[0].id;
  await insertReport(db, report(A.toUpperCase()));
  assert.deepEqual(await counts(db), { [A.toUpperCase()]: 1, [A]: 1, [B]: 1 });
  const before = (await db.query('SELECT rider_key,xmin::text FROM rider_training_seen ORDER BY rider_key')).rows;
  await db.query('UPDATE training_day_runs SET report=$1 WHERE id=$2', [JSON.stringify({ ...report(B, A), extra: 'changed' }), id]);
  assert.deepEqual((await db.query('SELECT rider_key,xmin::text FROM rider_training_seen ORDER BY rider_key')).rows, before);
  await db.query('UPDATE training_day_runs SET report=$1 WHERE id=$2', [JSON.stringify(report(B, C)), id]);
  assert.deepEqual(await counts(db), { [A.toUpperCase()]: 1, [A]: 0, [B]: 1, [C]: 1 });
});

test('delete, cascade and truncate remove references, not tombstones', async () => {
  await insertReport(db, report(A));
  const id = (await insertReport(db, report(A, B))).rows[0].id;
  await db.query('DELETE FROM training_day_runs WHERE id=$1', [id]);
  assert.deepEqual(await counts(db), { [A]: 1, [B]: 0 });
  await db.query('DELETE FROM teams WHERE id=$1', [TEAM]);
  assert.deepEqual(await counts(db), { [A]: 0, [B]: 0 });
  await db.query('INSERT INTO teams VALUES($1)', [TEAM]);
  await insertReport(db, report(C));
  await db.exec('TRUNCATE training_day_runs');
  assert.deepEqual(await counts(db), { [A]: 0, [B]: 0, [C]: 0 });
});

test('multi-row UPSERT counts insert and update transition sets correctly', async () => {
  const oldId = (await insertReport(db, report(A))).rows[0].id;
  await db.query(`INSERT INTO training_day_runs(id,team_id,report) VALUES
    ($1,$2,$3),(gen_random_uuid(),$2,$4)
    ON CONFLICT(id) DO UPDATE SET report=EXCLUDED.report`, [oldId, TEAM, JSON.stringify(report(B)), JSON.stringify(report(A, C))]);
  assert.deepEqual(await counts(db), { [A]: 1, [B]: 1, [C]: 1 });
  await db.exec('UPDATE training_day_runs SET report=report WHERE false; DELETE FROM training_day_runs WHERE false;');
  assert.deepEqual(await counts(db), { [A]: 1, [B]: 1, [C]: 1 });
});

test('transaction rollback undoes source, marker and counter changes together', async () => {
  await db.exec('BEGIN');
  await insertReport(db, report(A));
  assert.deepEqual(await counts(db), { [A]: 1 });
  await db.exec('ROLLBACK');
  assert.deepEqual(await counts(db), {});
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM training_day_runs')).rows[0].n, 0);
});

test('counter underflow aborts the original source delete', async () => {
  const id = (await insertReport(db, report(A))).rows[0].id;
  await db.exec('UPDATE rider_training_seen SET report_count=0');
  await assert.rejects(db.query('DELETE FROM training_day_runs WHERE id=$1', [id]), /training_seen.*underflow/i);
  const rows = (await db.query<{ training_seen_indexed: boolean }>('SELECT training_seen_indexed FROM training_day_runs WHERE id=$1', [id])).rows;
  assert.deepEqual(rows, [{ training_seen_indexed: true }]);
});

test('a missing counter aborts an update and preserves the old report', async () => {
  const id = (await insertReport(db, report(A))).rows[0].id;
  await db.exec('DELETE FROM rider_training_seen');
  await assert.rejects(db.query('UPDATE training_day_runs SET report=$1 WHERE id=$2', [JSON.stringify(report(B)), id]), /training_seen.*underflow/i);
  assert.deepEqual((await db.query('SELECT report FROM training_day_runs WHERE id=$1', [id])).rows, [{ report: report(A) }]);
  assert.deepEqual(await counts(db), {});
});

test('client roles have no projection access while service and the fixture definer owner can write', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM rider_training_seen'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM training_seen_keys($1)', [JSON.stringify(report(A))]), /permission denied/);
    await assert.rejects(db.query('INSERT INTO rider_training_seen VALUES($1,1)', [A]), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  await insertReport(db, report(A));
  assert.deepEqual(await counts(db), { [A]: 1 });
  await db.exec('UPDATE training_day_runs SET report=\'{"riders":[]}\'; TRUNCATE training_day_runs; RESET ROLE;');
  await db.exec(`CREATE OR REPLACE FUNCTION training_seen_test_rpc() RETURNS void LANGUAGE sql SECURITY DEFINER
    SET search_path=pg_catalog,public AS $$ INSERT INTO public.training_day_runs(team_id,report)
    VALUES('${TEAM}','${JSON.stringify(report(B))}'::jsonb) $$;
    REVOKE ALL ON FUNCTION training_seen_test_rpc() FROM PUBLIC; GRANT EXECUTE ON FUNCTION training_seen_test_rpc() TO service_role;
    SET ROLE service_role; SELECT training_seen_test_rpc(); RESET ROLE;`);
  assert.deepEqual(await counts(db), { [A]: 0, [B]: 1 });
});

test('reinstall preserves counts, GIN and existing reader definitions', async () => {
  await insertReport(db, report(A));
  const snapshot = async () => (await db.query(`SELECT pg_get_indexdef('idx_training_day_runs_report_riders'::regclass) AS idx,
    pg_get_functiondef('training_seen_legacy_reader(text)'::regprocedure) AS reader`)).rows;
  const before = await snapshot();
  await installFoundation(db); await installFoundation(db);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await counts(db), { [A]: 1 });
});

test('old reports stay unindexed until touched and an old delete does not subtract', async t => {
  const legacy = await createTrainingSeenFixture();
  t.after(() => legacy.close());
  const first = (await insertReport(legacy, report(A))).rows[0].id;
  const removed = (await insertReport(legacy, report(B))).rows[0].id;
  const empty = (await insertReport(legacy, { riders: [] })).rows[0].id;
  await installFoundation(legacy);
  assert.deepEqual(await counts(legacy), {});
  assert.equal((await legacy.query<{ n: number }>('SELECT count(*)::int AS n FROM training_day_runs WHERE NOT training_seen_indexed')).rows[0].n, 3);
  await legacy.query('DELETE FROM training_day_runs WHERE id=$1', [removed]);
  await legacy.query('UPDATE training_day_runs SET training_seen_indexed=true WHERE id=$1', [first]);
  await legacy.query('UPDATE training_day_runs SET training_seen_indexed=false WHERE id=$1', [first]);
  await legacy.query('UPDATE training_day_runs SET training_seen_indexed=true WHERE id=$1', [empty]);
  assert.deepEqual(await counts(legacy), { [A]: 1 });
  assert.equal((await legacy.query<{ n: number }>('SELECT count(*)::int AS n FROM training_day_runs WHERE NOT training_seen_indexed')).rows[0].n, 0);
});

test('a multi-row membership swap is net zero and does not rewrite counters', async () => {
  await insertReport(db, report(A)); await insertReport(db, report(B));
  const before = (await db.query('SELECT rider_key,xmin::text FROM rider_training_seen ORDER BY rider_key')).rows;
  await db.query(`UPDATE training_day_runs SET report=CASE
    WHEN report=$1::jsonb THEN $2::jsonb ELSE $1::jsonb END`, [JSON.stringify(report(A)), JSON.stringify(report(B))]);
  assert.deepEqual((await db.query('SELECT rider_key,xmin::text FROM rider_training_seen ORDER BY rider_key')).rows, before);
});
