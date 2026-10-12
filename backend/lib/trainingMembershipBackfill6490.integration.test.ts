import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {membershipFixture,readMembership,insertReport,report,A,B,C,refs,refCounts} from './testFixtures/trainingMembership6490.ts';
let db;const clean={unindexed:0,missing_refs:0,extra_refs:0};
const parity=async()=> (await db.query('SELECT * FROM training_membership_parity()')).rows[0];
before(async()=>{db=await membershipFixture();await db.exec(await readMembership('parity'));await db.exec(await readMembership('backfill'));});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('RESET ROLE;SET session_replication_role=origin;TRUNCATE training_day_runs');});

test('bounded backfill resumes empty and overlapping reports with rollback and no double membership',async()=>{
  await db.exec('SET session_replication_role=replica');
  await insertReport(db,report(A,A));await insertReport(db,report(A,B));await insertReport(db,{});
  await db.exec('SET session_replication_role=origin');assert.equal((await parity()).unindexed,3);
  await assert.rejects(db.query('SELECT training_membership_assert_ready()'),/not ready/);
  await db.exec('BEGIN;SELECT training_membership_backfill_batch(1);ROLLBACK');assert.equal((await parity()).unindexed,3);
  for(let i=0;i<3;i++)assert.deepEqual((await db.query('SELECT * FROM training_membership_backfill_batch(1)')).rows,[{processed:1,remaining:2-i}]);
  assert.deepEqual(await refCounts(db),{[A]:2,[B]:1});assert.deepEqual(await parity(),clean);
  assert.deepEqual((await db.query('SELECT * FROM training_membership_backfill_batch(10)')).rows,[{processed:0,remaining:0}]);
  await db.query('SELECT training_membership_assert_ready()');
});
test('pair parity catches wrong report linkage even when every rider count remains correct',async()=>{
  const first=(await insertReport(db,report(A))).rows[0].id;
  const second=(await insertReport(db,report(B))).rows[0].id;
  await db.query('UPDATE rider_training_report_refs SET report_id=CASE WHEN report_id=$1 THEN $2::uuid ELSE $1::uuid END',[first,second]);
  assert.deepEqual(await refCounts(db),{[A]:1,[B]:1});
  assert.deepEqual(await parity(),{unindexed:0,missing_refs:2,extra_refs:2});
  await assert.rejects(db.query('SELECT training_membership_assert_ready()'),/not ready/);
});
test('missing and orphan references are both detected',async()=>{
  await insertReport(db,report(A,B));await db.query('DELETE FROM rider_training_report_refs WHERE rider_key=$1',[A]);
  await db.query('INSERT INTO rider_training_report_refs VALUES($1,$2)',[C,A]);
  assert.deepEqual(await parity(),{unindexed:0,missing_refs:1,extra_refs:1});
  await assert.rejects(db.query('SELECT training_membership_assert_ready()'),/not ready/);
});
test('backfill cannot mark rows indexed when the session bypasses triggers',async()=>{
  await db.exec('SET session_replication_role=replica');await insertReport(db,report(A));
  await assert.rejects(db.query('SELECT training_membership_backfill_batch(1)'),/requires origin/);
  assert.equal((await parity()).unindexed,1);assert.deepEqual(await refs(db),[]);
  await db.exec('SET session_replication_role=origin');
});
test('bounds, installation idempotency and actual backend/client RPC grants',async()=>{
  for(const n of [null,0,-1,1001])await assert.rejects(db.query('SELECT training_membership_backfill_batch($1)',[n]),/batch size/);
  await insertReport(db,report(A));const before=await refs(db);
  await db.exec(await readMembership('parity'));await db.exec(await readMembership('backfill'));
  assert.deepEqual(await refs(db),before);await db.exec('SET ROLE service_role');
  await db.query('SELECT training_membership_assert_ready()');await db.query('SELECT training_membership_backfill_batch(1)');await db.exec('RESET ROLE');
  for(const role of ['anon','authenticated']){
    await db.exec(`SET ROLE ${role}`);
    for(const fn of ['training_membership_parity()','training_membership_assert_ready()','training_membership_backfill_batch(1)'])
      await assert.rejects(db.query(`SELECT ${fn}`),e=>e.code==='42501');
    await db.exec('RESET ROLE');
  }
});
test('readiness and backfill reject drift in layout, indexes, functions, triggers and effective ACL',async()=>{
  const mutations=[
    'ALTER TABLE training_day_runs DISABLE TRIGGER training_membership_update',
    'ALTER TABLE training_day_runs ENABLE ALWAYS TRIGGER training_membership_update',
    'ALTER TABLE training_day_runs ALTER COLUMN training_seen_indexed DROP NOT NULL',
    'ALTER TABLE training_day_runs ALTER COLUMN training_seen_indexed SET DEFAULT true',
    'ALTER TABLE training_day_runs DROP CONSTRAINT training_day_runs_pkey',
    'ALTER TABLE rider_training_report_refs ALTER COLUMN rider_key TYPE text COLLATE "default"',
    'ALTER TABLE rider_training_report_refs DROP CONSTRAINT rider_training_report_refs_pkey',
    'DROP INDEX idx_rider_training_report_refs_rider',
    'CREATE UNIQUE INDEX unexpected_unique_key ON rider_training_report_refs(rider_key)',
    'ALTER TABLE rider_training_report_refs DISABLE ROW LEVEL SECURITY',
    'CREATE POLICY unexpected_client_policy ON rider_training_report_refs FOR SELECT TO authenticated USING(true)',
    'GRANT SELECT(rider_key) ON rider_training_report_refs TO anon',
    'REVOKE DELETE ON rider_training_report_refs FROM service_role',
    'GRANT UPDATE ON rider_training_report_refs TO service_role',
    'GRANT EXECUTE ON FUNCTION training_membership_keys(jsonb) TO authenticated',
    'ALTER FUNCTION training_membership_after_update() SECURITY DEFINER',
    'CREATE TABLE public.rider_training_seen(unexpected int)',
  ];
  for(const mutation of mutations){
    await db.exec(`BEGIN;${mutation};SAVEPOINT before_check`);
    await assert.rejects(db.query('SELECT training_membership_assert_ready()'),/contract/,mutation);
    await db.exec('ROLLBACK TO before_check');
    await assert.rejects(db.query('SELECT training_membership_backfill_batch(1)'),/contract/,mutation);
    await db.exec('ROLLBACK');await db.query('SELECT training_membership_assert_ready()');
  }
});
test('scalar extractor with identical body and ACL cannot pass the SETOF contract',async()=>{
  const body=(await db.query("SELECT pg_get_functiondef('training_membership_keys(jsonb)'::regprocedure) AS body")).rows[0].body;
  await db.exec('BEGIN;DROP FUNCTION training_membership_keys(jsonb)');
  await db.exec(body.replace('RETURNS SETOF text','RETURNS text'));
  await db.exec('REVOKE ALL ON FUNCTION training_membership_keys(jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION training_membership_keys(jsonb) TO service_role');
  await assert.rejects(db.query('SELECT training_membership_assert_ready()'),/contract/);await db.exec('ROLLBACK');
});
