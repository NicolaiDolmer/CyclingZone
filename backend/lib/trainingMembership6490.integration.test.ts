import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingSeenFixture,installFoundation} from './testFixtures/trainingSeen6490.ts';
import {membershipFixture,readMembership,insertReport,report,A,B,C,TEAM,refs,refCounts} from './testFixtures/trainingMembership6490.ts';

test('membership preserves exact raw strings and distinct report references against legacy containment',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());
  const compact=A.replaceAll('-','');
  const inputs=[null,{},[report(A)],{riders:[[ {rider_id:A} ]]}, {riders:null},{riders:'x'},{riders:{}},{riders:[null,'x',3,{},
    {rider_id:null},{rider_id:7},{rider_id:A},{rider_id:A},{rider_id:A.toUpperCase()},
    {rider_id:compact},{rider_id:[B]},{rider_id:{id:B}},
    {rider_id:''},{rider_id:'æ🚲'},{rider_id:'not-a-uuid'}]},report(A,B),report(A)];
  for(const input of inputs)await insertReport(db,input);
  assert.deepEqual(await refCounts(db),{[A]:3,[A.toUpperCase()]:1,[compact]:1,[B]:1,'':1,'æ🚲':1,'not-a-uuid':1});
  for(const key of [A,A.toUpperCase(),compact,B,C,'','æ🚲','not-a-uuid','7']){
    const actual=(await db.query(`SELECT (SELECT count(*) FROM rider_training_report_refs WHERE rider_key=$1)::int AS projected,
      (SELECT count(*) FROM training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',$1::text)))::int AS legacy`,[key])).rows[0];
    assert.equal(actual.projected,actual.legacy,key);
  }
});
test('old rows remain unindexed until a write; installer is idempotent without losing refs',async t=>{
  const db=await createTrainingSeenFixture();t.after(()=>db.close());await insertReport(db,report(A));
  await db.exec(await readMembership('foundation'));
  assert.deepEqual(await refs(db),[]);
  assert.equal((await db.query('SELECT training_seen_indexed FROM training_day_runs')).rows[0].training_seen_indexed,false);
  await db.exec('UPDATE training_day_runs SET bonus_applied=false');
  assert.deepEqual(await refCounts(db),{[A]:1});
  await db.exec(await readMembership('foundation'));assert.deepEqual(await refCounts(db),{[A]:1});
});
test('metadata, order and duplicate-only updates preserve physical membership rows',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());await insertReport(db,report(A,B));
  const physical=async()=> (await db.query('SELECT report_id,rider_key,xmin::text,ctid::text FROM rider_training_report_refs ORDER BY rider_key')).rows;
  const before=await physical();await db.query('UPDATE training_day_runs SET report=$1,bonus_applied=true',[JSON.stringify(report(B,A,A))]);
  assert.deepEqual(await physical(),before);
  await db.query('UPDATE training_day_runs SET report=$1',[JSON.stringify(report(A,C))]);
  assert.deepEqual(await refCounts(db),{[A]:1,[C]:1});
  assert.deepEqual((await physical()).find(r=>r.rider_key===A),before.find(r=>r.rider_key===A));
});
test('mixed UPSERT, source id change and rollback preserve exact membership',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());const [{id}]=(await insertReport(db,report(A))).rows;
  await db.query(`INSERT INTO training_day_runs(id,team_id,report) VALUES($1,$2,$3),(gen_random_uuid(),$2,$4)
    ON CONFLICT(id) DO UPDATE SET report=excluded.report`,[id,TEAM,JSON.stringify(report(B)),JSON.stringify(report(A,C))]);
  assert.deepEqual(await refCounts(db),{[A]:1,[B]:1,[C]:1});
  await db.query('UPDATE training_day_runs SET id=gen_random_uuid() WHERE id=$1',[id]);
  assert.equal((await refs(db)).some(r=>r.report_id===id),false);assert.deepEqual(await refCounts(db),{[A]:1,[B]:1,[C]:1});
  const before=await refs(db);await db.exec('BEGIN');await insertReport(db,report(A,B));await db.exec('ROLLBACK');
  assert.deepEqual(await refs(db),before);
});
test('source delete, team cascade and source TRUNCATE remain atomic and need no CASCADE addition',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());const [{id}]=(await insertReport(db,report(A,B))).rows;
  await insertReport(db,report(A));await db.query('DELETE FROM training_day_runs WHERE id=$1',[id]);
  assert.deepEqual(await refCounts(db),{[A]:1});
  await db.exec('BEGIN;TRUNCATE training_day_runs');assert.deepEqual(await refs(db),[]);await db.exec('ROLLBACK');
  assert.deepEqual(await refCounts(db),{[A]:1});await db.query('DELETE FROM teams WHERE id=$1',[TEAM]);assert.deepEqual(await refs(db),[]);
});
test('clients cannot read or write refs; service writer keeps projection atomically with least grants',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());
  for(const role of ['anon','authenticated']){
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.exec('SELECT * FROM rider_training_report_refs'),e=>e.code==='42501');
    await assert.rejects(db.exec("SELECT training_membership_keys('{}')"),e=>e.code==='42501');
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');await insertReport(db,report(A));
  await db.query('UPDATE training_day_runs SET report=$1',[JSON.stringify(report(B))]);
  assert.deepEqual(await refCounts(db),{[B]:1});
  await assert.rejects(db.exec('UPDATE rider_training_report_refs SET rider_key=rider_key'),e=>e.code==='42501');
  await db.exec('TRUNCATE training_day_runs');assert.deepEqual(await refs(db),[]);
});
test('installation rejects the counter candidate and orphan marker before introducing a second projection',async t=>{
  const counter=await createTrainingSeenFixture();t.after(()=>counter.close());await installFoundation(counter);
  await assert.rejects(counter.exec(await readMembership('foundation')),/counter candidate/);await counter.exec('ROLLBACK');
  assert.equal((await counter.query("SELECT to_regclass('public.rider_training_report_refs') AS ref")).rows[0].ref,null);
  const partial=await createTrainingSeenFixture();t.after(()=>partial.close());
  await partial.exec('ALTER TABLE training_day_runs ADD COLUMN training_seen_indexed boolean NOT NULL DEFAULT false');
  await assert.rejects(partial.exec(await readMembership('foundation')),/orphan source marker/);await partial.exec('ROLLBACK');
});
test('a projection error rolls back the source update and its already deleted old references',async t=>{
  const db=await membershipFixture();t.after(()=>db.close());await insertReport(db,report(A));
  await db.exec('REVOKE INSERT ON rider_training_report_refs FROM service_role;SET ROLE service_role');
  await assert.rejects(db.query('UPDATE training_day_runs SET report=$1',[JSON.stringify(report(B))]),e=>e.code==='42501');
  assert.deepEqual(await refCounts(db),{[A]:1});
  assert.deepEqual((await db.query('SELECT report FROM training_day_runs')).rows[0].report,report(A));
});
