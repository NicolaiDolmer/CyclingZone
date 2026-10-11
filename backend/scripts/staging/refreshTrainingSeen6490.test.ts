import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createTrainingSeenFixture,installFoundation,insertReport,report,A,counts} from '../../lib/testFixtures/trainingSeen6490.ts';
import {readManual} from '../../lib/testFixtures/trainingSeenReaders6490.ts';
const library=fileURLToPath(new URL('../../../scripts/lib/Refresh-Staging-Gates.ps1',import.meta.url));
const run=(body:string)=>spawnSync('pwsh',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; . '${library.replaceAll("'","''")}'; ${body}`],{encoding:'utf8',timeout:30000,windowsHide:true});

test('generated cleanup anonymizes before rebuilding projection in the same transaction',async t=>{
  const result=run('New-RefreshSanitizeSql "select 1;"');
  assert.equal(result.status,0,result.stderr);
  const db=await createTrainingSeenFixture();t.after(()=>db.close());await installFoundation(db);
  await db.exec(await readManual('parity'));await db.exec(await readManual('backfill'));
  await db.exec(`CREATE TABLE app_config(key text,value jsonb);INSERT INTO app_config VALUES('cz_environment','"loadtest-staging"');
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,email text,phone text,encrypted_password text,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
    INSERT INTO auth.users VALUES('${A}','fixture@private.test','secret','hash','{}','{}');
    CREATE FUNCTION ensure_anonymized() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM auth.users WHERE email NOT LIKE '%@loadtest.invalid') THEN RAISE EXCEPTION 'privacy before projection'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER ensure_anonymized BEFORE UPDATE ON training_day_runs FOR EACH ROW EXECUTE FUNCTION ensure_anonymized();
    BEGIN; SET LOCAL session_replication_role=replica;`);
  await insertReport(db,report(A));await db.exec('UPDATE training_day_runs SET training_seen_indexed=true');
  await db.exec(result.stdout);
  assert.deepEqual(await counts(db),{[A]:1});
  assert.match((await db.query('SELECT email FROM auth.users')).rows[0].email,/@loadtest.invalid$/);
  await db.exec('COMMIT');await db.query('SELECT training_seen_assert_ready()');
});

test('projection gate must positively pass before privacy and final GO',()=>{
  const prefix=`$files=@{fingerprint='fp';counts='ct';privacy='pv';trainingSeen='seen'};
    $prod={param($f) 'table 1 00000000000000000000000000000000'};
    $stage={param($f) switch($f){'fp'{'table 1 00000000000000000000000000000000'} 'ct'{'riders|1'} 'pv'{'0'} 'seen'{''}}};`;
  const bad=run(`${prefix} Invoke-RefreshGates $prod $stage $files 'riders|1' 'riders|1'`);
  assert.notEqual(bad.status,0,'missing projection evidence must block GO');
  const noisy=run(`Assert-RefreshTrainingSeen "DO\`nTRAINING_SEEN_READY"`);
  assert.notEqual(noisy.status,0,'command tags must not be accepted as positive evidence; caller needs psql -q');
  for(const marker of ['TRAINING_SEEN_READY','TRAINING_SEEN_ABSENT']){
    const good=run(`${prefix.replace("'seen'{''}",`'seen'{'${marker}'}`)} Invoke-RefreshGates $prod $stage $files 'riders|1' 'riders|1'`);
    assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/GO/);
  }
});
