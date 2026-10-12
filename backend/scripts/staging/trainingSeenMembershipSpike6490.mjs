// Readable, reproducible local experiment for the blocking L4 design finding.
// Does not implement a production replacement for L1-L3.
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { sourceFunction } from '../../lib/testFixtures/trainingSeenReaders6490.ts';
import { PsqlSession,waitForBlock } from './verifyTrainingSeen6490.mjs';

const env=process.env;
if(env.CZ_TARGET_ENV!=='local-disposable'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='56490'
  ||env.PGUSER!=='cz6490'||!/^cz_6490_[a-f0-9]{12}$/.test(env.PGDATABASE??'')||!env.PGPASSWORD
  ||process.argv.length!==3)throw new Error('LOCAL_FIXTURE_CONFIG_REQUIRED');
const sessions=[];const connect=()=>{const s=new PsqlSession(env);sessions.push(s);return s;};
const report=keys=>JSON.stringify({riders:keys.map(rider_id=>({rider_id}))});
const value=keys=>`'${report(keys)}'::jsonb`;const id=()=>randomUUID();
const results={status:'RUNNING',target:'local-disposable',clock:'2026-10-11T12:00:00Z',cases:[]};
results.runnerHash=createHash('sha256').update((await readFile(new URL(import.meta.url),'utf8')).replaceAll('\r','')).digest('hex');
await writeFile(process.argv[2],JSON.stringify(results),{flag:'wx'});
try{
  const c=connect(),a=connect(),b=connect(),observer=connect();
  const preflight=JSON.parse(await c.query(`SELECT json_build_object('version',current_setting('server_version_num'),
    'marker',current_setting('cz.fixture',true),'empty',NOT EXISTS(SELECT 1 FROM pg_class p JOIN pg_namespace n
    ON n.oid=p.relnamespace WHERE n.nspname='public' AND p.relkind IN('r','p','v','m','S')))`));
  if(!/^17\d{4}$/.test(preflight.version)||preflight.marker!=='6490'||!preflight.empty)throw new Error('FIXTURE_REQUIRED');
  results.version=preflight.version;
  const sql=await sourceFunction('manual/6490/training-seen-foundation.sql','training_seen_keys')+'\n'
    +await readFile(new URL('../../lib/testFixtures/trainingSeenMembershipSpike6490.sql',import.meta.url),'utf8');
  results.fixtureHash=createHash('sha256').update(sql.replaceAll('\r','')).digest('hex');await c.query(sql);
  for(const s of sessions)await s.query("SET statement_timeout='20s';SET lock_timeout='15s'");
  const pa=Number(await a.query('SELECT pg_backend_pid()')),pb=Number(await b.query('SELECT pg_backend_pid()')),
    pc=Number(await c.query('SELECT pg_backend_pid()'));
  const assertParity=async()=>{
    // Independent legacy-containment oracle, including the report COUNT, not the extractor.
    const mismatch=await c.query(`SELECT count(*) FROM (SELECT DISTINCT rider_key FROM fixture_memberships
      UNION SELECT '6490:a' UNION SELECT '6490:b') k WHERE
      (SELECT count(*) FROM fixture_reports r WHERE r.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',k.rider_key)))
      <> (SELECT count(*) FROM fixture_memberships m WHERE m.rider_key=k.rider_key)`);
    if(mismatch!=='0')throw new Error('PARITY_FAILED');
  };
  const first=id(),second=id();
  await c.query(`INSERT INTO fixture_reports VALUES('${first}',${value([])}),('${second}',${value([])});
    CREATE FUNCTION fixture_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock_shared(6490,2);RETURN NULL;END $$;
    CREATE TRIGGER zz_fixture_pause AFTER UPDATE ON fixture_reports FOR EACH STATEMENT EXECUTE FUNCTION fixture_pause();
    BEGIN;SELECT pg_advisory_xact_lock(6490,2)`);
  const upsert=(existing,oldKey,newKey)=>`INSERT INTO fixture_reports VALUES('${existing}',${value([oldKey])}),('${id()}',${value([newKey])})
    ON CONFLICT(id) DO UPDATE SET report=excluded.report`;
  const one=a.query(upsert(first,'6490:a','6490:b')),two=b.query(upsert(second,'6490:b','6490:a'));
  one.catch(()=>{});two.catch(()=>{});
  await waitForBlock(observer,pa,pc);await waitForBlock(observer,pb,pc);await c.query('COMMIT');await Promise.all([one,two]);
  await c.query('DROP TRIGGER zz_fixture_pause ON fixture_reports;DROP FUNCTION fixture_pause()');await assertParity();
  results.cases.push({name:'concurrent_mixed_upsert',status:'PASS'});
  const insert=key=>`INSERT INTO fixture_reports VALUES('${id()}',${value([key])})`;
  await a.query(`BEGIN;${insert('6490:a')}`);await b.query(`BEGIN;${insert('6490:b')}`);
  await Promise.all([a.query(`${insert('6490:b')};COMMIT`),b.query(`${insert('6490:a')};COMMIT`)]);await assertParity();
  results.cases.push({name:'reverse_keys_across_multiple_statements',status:'PASS'});
  const before=await c.query(`SELECT xmin::text||':'||ctid::text FROM fixture_memberships WHERE report_id='${first}'`);
  await a.query(`UPDATE fixture_reports SET report=${value(['6490:a','6490:a'])} WHERE id='${first}'`);
  if(before!==await c.query(`SELECT xmin::text||':'||ctid::text FROM fixture_memberships WHERE report_id='${first}'`))throw new Error('UNCHANGED_MEMBERSHIP_REWRITTEN');
  await a.query(`BEGIN;UPDATE fixture_reports SET report=${value(['6490:b'])} WHERE id='${first}';ROLLBACK`);await assertParity();
  await a.query(`DELETE FROM fixture_reports WHERE id='${first}'`);await assertParity();
  results.cases.push({name:'dedup_no_rewrite_rollback_delete',status:'PASS'});results.status='PASS';
}catch(error){results.status='FAIL';if(error.sqlState)results.sqlState=error.sqlState;}
finally{await Promise.all(sessions.map(s=>s.close()));}
await writeFile(process.argv[2],`${JSON.stringify(results,null,2)}\n`);console.log(JSON.stringify(results));process.exitCode=results.status==='PASS'?0:1;
