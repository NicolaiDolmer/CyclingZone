import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingSeenFixture,installFoundation,insertReport,report,A,B,counts } from './testFixtures/trainingSeen6490.ts';
import { readManual } from './testFixtures/trainingSeenReaders6490.ts';

async function fixture(){
  const db=await createTrainingSeenFixture();await installFoundation(db);
  await db.exec(await readManual('parity'));await db.exec(await readManual('backfill'));
  await db.exec(`CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);
    INSERT INTO app_config VALUES('cz_environment','"loadtest-staging"')`);
  return db;
}

test('replica restore rebuilds stale markers/counts before the atomic restore can commit',async t=>{
  const db=await fixture();t.after(()=>db.close());
  await db.exec('BEGIN; SET LOCAL session_replication_role=replica');
  await insertReport(db,report(A,A,B));
  await db.exec('UPDATE training_day_runs SET training_seen_indexed=true');
  await db.query('INSERT INTO rider_training_seen VALUES($1,99)',['stale']);
  await assert.rejects(db.query('SELECT training_seen_assert_ready()'),/training_seen not ready/);
  // The failed assertion aborts its transaction; recreate the deliberately bad restore.
  await db.exec('ROLLBACK; BEGIN; SET LOCAL session_replication_role=replica');
  await insertReport(db,report(A,A,B));
  await db.exec('UPDATE training_day_runs SET training_seen_indexed=true');
  await db.query('INSERT INTO rider_training_seen VALUES($1,99)',['stale']);
  await db.exec(await readManual('restore'));
  assert.deepEqual(await counts(db),{[A]:1,[B]:1,stale:0});
  assert.equal((await db.query("SELECT current_setting('session_replication_role') AS role")).rows[0].role,'replica');
  await db.exec('COMMIT');await db.exec(await readManual('restore-check'));
});

test('restore refuses wrong environment and a failure leaves the previous snapshot intact',async t=>{
  const db=await fixture();t.after(()=>db.close());await insertReport(db,report(A));
  const before=await counts(db);
  await db.exec("BEGIN; SET LOCAL session_replication_role=replica; UPDATE app_config SET value='\"production\"'");
  await assert.rejects(db.exec(await readManual('restore')),/training_seen.*staging/);
  await db.exec('ROLLBACK');assert.deepEqual(await counts(db),before);
  await db.exec('BEGIN; SET LOCAL session_replication_role=replica; ALTER TABLE training_day_runs DISABLE TRIGGER training_seen_update');
  await assert.rejects(db.exec(await readManual('restore')),/training_seen.*contract/);
  await db.exec('ROLLBACK');assert.deepEqual(await counts(db),before);
  await db.query('SELECT training_seen_assert_ready()');
});

test('old schema remains a no-op and verify-only rejects a broken projection',async t=>{
  const old=await createTrainingSeenFixture();t.after(()=>old.close());
  await old.exec(await readManual('restore'));await old.exec(await readManual('restore-check'));
  const db=await fixture();t.after(()=>db.close());await insertReport(db,report(A));
  await db.exec('UPDATE rider_training_seen SET report_count=0');
  await assert.rejects(db.exec(await readManual('restore-check')),/training_seen not ready/);
});

test('a missing projection table with remaining writer bindings is not a valid old schema',async t=>{
  const db=await fixture();t.after(()=>db.close());
  await db.exec('DROP TABLE rider_training_seen');
  await assert.rejects(db.exec(await readManual('restore-check')),/training_seen partial schema/);
  await assert.rejects(db.exec(await readManual('restore')),/training_seen partial schema/);
});

test('restore reapplies projection ACL stripped by pg_restore --no-acl before validating',async t=>{
  const db=await fixture();t.after(()=>db.close());
  // pg_dump --no-acl omits explicit REVOKEs; Supabase defaults may also grant clients table access.
  await db.exec(`GRANT ALL ON rider_training_seen TO anon,authenticated,service_role;
    DO $$ DECLARE f record; BEGIN FOR f IN
      SELECT oid::regprocedure AS signature FROM pg_proc WHERE proname LIKE 'training_seen_%'
      LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC,anon,authenticated',f.signature); END LOOP; END $$;`);
  await assert.rejects(db.query('SELECT training_seen_assert_contract()'),/contract mismatch/);
  await db.exec('BEGIN; SET LOCAL session_replication_role=replica');
  await insertReport(db,report(A));
  await db.exec(await readManual('restore'));
  await db.exec('COMMIT');
  await db.query('SELECT training_seen_assert_ready()');
  assert.deepEqual(await counts(db),{[A]:1});
  assert.equal((await db.query(`SELECT has_function_privilege('anon','training_seen_assert_ready()','EXECUTE') AS allowed`)).rows[0].allowed,false);
});
