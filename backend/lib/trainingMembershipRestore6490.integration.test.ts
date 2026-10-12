import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingSeenFixture,installFoundation} from './testFixtures/trainingSeen6490.ts';
import {membershipFixture,readMembership,insertReport,report,A,B,C,refs,refCounts} from './testFixtures/trainingMembership6490.ts';
async function fixture(){
  const db=await membershipFixture();for(const name of ['parity','backfill','snapshot-ready'])await db.exec(await readMembership(name));
  await db.exec(`CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);INSERT INTO app_config VALUES('cz_environment','"loadtest-staging"')`);
  return db;
}
test('replica restore rebuilds every pair, including false markers and corrupt imported true markers',async t=>{
  const db=await fixture();t.after(()=>db.close());await db.exec('BEGIN;SET LOCAL session_replication_role=replica');
  const first=(await insertReport(db,report(A,A,B))).rows[0].id;await insertReport(db,report(A));
  await db.query('UPDATE training_day_runs SET training_seen_indexed=true WHERE id=$1',[first]);
  await db.query('INSERT INTO rider_training_report_refs VALUES($1,$2)',[C,'orphan']);
  const before=(await db.query('SELECT ctid::text FROM training_day_runs WHERE id=$1',[first])).rows;
  await db.exec(await readMembership('restore'));
  assert.deepEqual(await refCounts(db),{[A]:2,[B]:1});
  assert.deepEqual((await db.query('SELECT ctid::text FROM training_day_runs WHERE id=$1',[first])).rows,before,'true source markers need no rewrite');
  assert.equal((await db.query("SELECT current_setting('session_replication_role') AS r")).rows[0].r,'replica');
  await db.exec('COMMIT');await db.exec(await readMembership('restore-check'));await db.query('SELECT training_membership_assert_ready()');
});
test('restore refuses wrong target or changed maintenance and leaves prior snapshot intact',async t=>{
  const db=await fixture();t.after(()=>db.close());await insertReport(db,report(A));const before=await refs(db);
  for(const mutation of ["UPDATE app_config SET value='\"production\"'",'ALTER TABLE training_day_runs DISABLE TRIGGER training_membership_update']){
    await db.exec(`BEGIN;SET LOCAL session_replication_role=replica;${mutation}`);
    await assert.rejects(db.exec(await readMembership('restore')),/training_membership/);
    await db.exec('ROLLBACK');assert.deepEqual(await refs(db),before);
  }
});
test('restore supports pre-projection schema but rejects partial and rejected counter schema',async t=>{
  const old=await createTrainingSeenFixture();t.after(()=>old.close());
  await old.exec(await readMembership('restore'));await old.exec(await readMembership('restore-check'));
  await installFoundation(old);
  await assert.rejects(old.exec(await readMembership('restore-check')),/partial or rejected/);
  await assert.rejects(old.exec(await readMembership('restore')),/partial or rejected/);
  const partial=await fixture();t.after(()=>partial.close());await partial.exec('DROP TABLE rider_training_report_refs');
  await assert.rejects(partial.exec(await readMembership('restore-check')),/partial or rejected/);
});
test('no-ACL restore reestablishes exact grants, with or without the later snapshot helper',async t=>{
  for(const hasSnapshotHelper of [false,true]){
    const db=await fixture();t.after(()=>db.close());
    if(!hasSnapshotHelper)await db.exec('DROP FUNCTION training_membership_snapshot_ready()');
    await db.exec(`GRANT ALL ON rider_training_report_refs TO anon,authenticated,service_role;
      DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname LIKE 'training_membership_%'
      LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC,anon,authenticated',f.sig);END LOOP;END $$;
      BEGIN;SET LOCAL session_replication_role=replica;`);
    await insertReport(db,report(A));await db.exec(await readMembership('restore'));await db.exec('COMMIT');
    await db.query('SELECT training_membership_assert_ready()');assert.deepEqual(await refCounts(db),{[A]:1});
    if(hasSnapshotHelper)assert.equal((await db.query("SELECT has_function_privilege('anon','training_membership_snapshot_ready()','EXECUTE') AS allowed")).rows[0].allowed,false);
  }
});
test('snapshot gate is stable, consumed as boolean, rejects corrupt pairs and denies clients',async t=>{
  const db=await fixture();t.after(()=>db.close());await insertReport(db,report(A));
  assert.equal((await db.query("SELECT provolatile FROM pg_proc WHERE oid='training_membership_snapshot_ready()'::regprocedure")).rows[0].provolatile,'s');
  const query='WITH gate AS MATERIALIZED(SELECT training_membership_snapshot_ready() AS ready) SELECT count(*)::int AS n FROM rider_training_report_refs,gate WHERE gate.ready';
  await db.exec('SET ROLE service_role');
  assert.deepEqual((await db.query(query)).rows,[{n:1}]);
  await db.exec('DELETE FROM rider_training_report_refs');await assert.rejects(db.query(query),/not ready/);
  await db.exec('SET ROLE anon');await assert.rejects(db.query('SELECT training_membership_snapshot_ready()'),e=>e.code==='42501');
});
