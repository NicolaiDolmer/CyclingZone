// Starts an isolated, loopback-only PostgreSQL instance; never reads project .env.
// Requires initdb, pg_ctl and psql on PATH. All processes are hidden on Windows.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const folder=mkdtempSync(join(tmpdir(),'cz-4753-postgres-'));
const data=join(folder,'data');
const server=net.createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
const exe=name=>process.platform==='win32'?`${name}.exe`:name;
const options={windowsHide:true,encoding:'utf8',stdio:'pipe',timeout:30000};
const args=['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-At'];
const sql=text=>execFileSync(exe('psql'),args,{...options,input:text}).trim();
const AI='00000000-0000-0000-0000-000000000001';
const AI2='00000000-0000-0000-0000-000000000002';
const RIDER='10000000-0000-0000-0000-000000000001';
const NOW='2026-09-09T12:00:00Z';
function session(text,onOutput) {
  const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000});
  let output='',errors='';
  child.stdout.on('data',chunk=>{output+=chunk;onOutput?.(output);});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const done=new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(output):reject(new Error(errors)));
  });
  child.stdin.end(text);
  return done;
}
function reset() {
  sql(`TRUNCATE race_stage_claims,notifications,rider_watchlist,auctions,swap_offers,transfer_listings,
    transfer_offers,race_results,race_entries,riders,races,teams,league_divisions CASCADE;
    INSERT INTO league_divisions VALUES (13,4,5,'D4 F');
    INSERT INTO teams(name,league_division_id) SELECT 'Manager '||i,13 FROM generate_series(1,23) i;
    INSERT INTO teams(id,name,is_ai,league_division_id) VALUES ('${AI}','AI',true,13),('${AI2}','AI 2',true,13);
    INSERT INTO riders(id,team_id) VALUES ('${RIDER}','${AI}');`);
}
let started=false;
try {
  execFileSync(exe('initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],options);
  // The server inherits handles on Windows. Pipes keep execFileSync waiting
  // until server exit even after pg_ctl itself exits; use no inherited pipes.
  execFileSync(exe('pg_ctl'),['-D',data,'-l',join(folder,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start'],{...options,stdio:'ignore'});
  started=true;
  sql(readFileSync(new URL('../lib/testFixtures/aiPoolRetirement.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../../database/2026-09-09-4753-ai-pool-retirement.sql',import.meta.url),'utf8'));
  reset();
  let locked;
  const hasLock=new Promise(resolve=>{locked=resolve;});
  const first=session(`BEGIN; SELECT 1 FROM league_divisions WHERE id=13 FOR NO KEY UPDATE;
    SELECT 'LOCKED'; SELECT pg_sleep(0.8); SELECT retire_ai_pool_team('${AI}','${NOW}'); COMMIT;`,
    output=>{if(output.includes('LOCKED'))locked();});
  await Promise.race([hasLock,first.then(()=>{throw new Error('Lock sentinel missing');})]);
  const second=session(`SELECT retire_ai_pool_team('${AI2}','${NOW}');`);
  const outputs=await Promise.all([first,second]);
  assert.equal(sql('SELECT count(*) FROM teams WHERE league_division_id=13'),'24');
  assert.equal(sql('SELECT count(*) FROM teams WHERE retired_at IS NOT NULL'),'1');
  assert.ok(outputs[1].includes('not_excess'));
  console.log('PASS: two competing retirement connections remove exactly one team');

  reset();
  let placed;
  const reserved=new Promise(resolve=>{placed=resolve;});
  const signup=session(`BEGIN; INSERT INTO teams(name,league_division_id) VALUES ('Concurrent manager',13);
    SELECT 'RESERVED'; SELECT pg_sleep(0.8); COMMIT;`,output=>{if(output.includes('RESERVED'))placed();});
  await Promise.race([reserved,signup.then(()=>{throw new Error('Reservation sentinel missing');})]);
  await Promise.all([signup,session(`SELECT retire_ai_pool_team('${AI}','${NOW}');`)]);
  assert.equal(sql('SELECT count(*) FROM teams WHERE league_division_id=13'),'25');
  assert.equal(sql('SELECT count(*) FROM teams WHERE pending_removal_at IS NOT NULL'),'1');
  sql(`SELECT retire_ai_pool_team('${AI2}','${NOW}')`);
  assert.equal(sql('SELECT count(*) FROM teams WHERE league_division_id=13'),'24');
  console.log('PASS: concurrent signup and retirement preserve the remaining reservation');

  reset();
  const race=sql("INSERT INTO races DEFAULT VALUES RETURNING id").split(/\r?\n/)[0];
  sql(`INSERT INTO race_entries VALUES ('${race}','${RIDER}','${AI}');
    INSERT INTO transfer_offers(seller_team_id,status) VALUES ('${AI2}','pending');`);
  let claimed;
  const ready=new Promise(resolve=>{claimed=resolve;});
  const claim=session(`BEGIN; INSERT INTO race_stage_claims VALUES ('${race}',0,'${NOW}','test');
    SELECT 'CLAIMED'; SELECT pg_sleep(0.8); COMMIT;`,output=>{if(output.includes('CLAIMED'))claimed();});
  await Promise.race([ready,claim.then(()=>{throw new Error('Claim sentinel missing');})]);
  const retirement=session(`SELECT retire_ai_pool_team('${AI}','${NOW}');`);
  const outcomes=await Promise.all([claim,retirement]);
  assert.ok(outcomes[1].includes('inflight_entries'));
  assert.equal(sql('SELECT count(*) FROM race_entries'),'1');
  assert.equal(sql('SELECT count(*) FROM teams WHERE retired_at IS NOT NULL'),'0');
  console.log('PASS: a racing first-stage claim preserves the active field');

  reset();
  const entryRace=sql("INSERT INTO races DEFAULT VALUES RETURNING id").split(/\r?\n/)[0];
  sql(`INSERT INTO race_entries VALUES ('${entryRace}','${RIDER}','${AI}')`);
  let batchLocked;
  const batchReady=new Promise(resolve=>{batchLocked=resolve;});
  // Same lock/delete/insert ordering as apply_race_entry_unit_batch (#4173).
  const batch=session(`BEGIN; SELECT pg_advisory_xact_lock(hashtext('${AI}'));
    DELETE FROM race_entries WHERE team_id='${AI}'; SELECT 'BATCH_LOCKED';
    SELECT pg_sleep(0.8); INSERT INTO race_entries VALUES ('${entryRace}','${RIDER}','${AI}'); COMMIT;`,
    output=>{if(output.includes('BATCH_LOCKED'))batchLocked();});
  await Promise.race([batchReady,batch.then(()=>{throw new Error('Batch sentinel missing');})]);
  await Promise.all([batch,session(`SELECT retire_ai_pool_team('${AI}','${NOW}')`)]);
  assert.equal(sql('SELECT count(*) FROM race_entries'),'0');
  assert.equal(sql('SELECT count(*) FROM teams WHERE league_division_id=13'),'24');
  console.log('PASS: race entry batch and retirement serialize without deadlock');
} finally {
  if(started) execFileSync(exe('pg_ctl'),['-D',data,'-m','fast','-w','stop'],options);
  // Keep isolated logs for review. No recursive filesystem deletion.
  console.log(`Isolated PostgreSQL stopped; evidence: ${folder}`);
}
