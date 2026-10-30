// Refs #7153. Same committed triggers on PGlite and optional native PG17. No production DB.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { sanitizeForPglite } from './sanitizeForPglite.js';
const __dirname=dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR=join(__dirname,'../../../database');
const BASE_DDL = `
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'scheduled',
  stages_completed INTEGER NOT NULL DEFAULT 0,
  league_division_id INTEGER,
  season_id UUID NOT NULL DEFAULT gen_random_uuid()
);
CREATE TABLE race_stage_schedule (
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  game_day INTEGER,
  stage_number INTEGER DEFAULT 1,
  scheduled_at TIMESTAMPTZ
);
CREATE TABLE race_withdrawals (
  race_id UUID,
  team_id UUID,
  withdrawn_reason TEXT
);
CREATE TABLE race_entries (
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL,
  team_id UUID,
  binding_span int4range,
  race_role TEXT NOT NULL DEFAULT 'helper',
  is_auto_filled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, rider_id)
);
`;

// Prod-raekkefoelgen for alt 5246 bygger ovenpaa (se filens header).
const PREREQUISITE_MIGRATIONS = [
  "2026-08-24-4173-rider-binding-per-game-day.sql",
  "2026-08-24-4191-race-entry-days-diff-rebuild.sql",
  "2026-08-25-4217-spaend-binding.sql",
  "2026-08-27-1146-selection-bulk-rpc.sql",
  "2026-08-27-4283-selection-guard-spaend.sql",
  "2026-08-31-4534-selection-frozen-both-directions.sql",
];
const MIGRATION_5246 = "2026-09-23-5246-late-fill-log.sql";

function loadMigration(filename) {
  const raw = readFileSync(join(DATABASE_DIR, filename), "utf8");
  return sanitizeForPglite(raw);
}


let db;
const native=process.env.REJOIN_PG_PORT;
const baseline=process.env.REJOIN_BASELINE === '1';
const migration='2026-10-28-7153-manager-selection-rejoin.sql';
const TEAM='00000000-0000-0000-0000-000000000001';
const OLD='00000000-0000-0000-0000-000000000002';
const NEXT='00000000-0000-0000-0000-000000000003';
const SEASON='00000000-0000-0000-0000-000000000004';
const NOW='2026-10-28T10:00:00Z';
before(async()=>{
 if(native){
  const sql=text=>execFileSync(join(process.env.REJOIN_PG_BIN,'psql.exe'),['-X','-h','127.0.0.1','-p',native,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA','-q','-f','-'],{encoding:'utf8',input:text,windowsHide:true,env:{...process.env,PGCLIENTENCODING:'UTF8'}}).trim();
  const literal=v=>"'"+String(Array.isArray(v)?'{'+v.join(',')+'}':v).replaceAll("'","''")+"'";
  db={exec:async text=>sql(text),query:async(text,args=[])=>{const q=text.replace(/\$(\d+)/g,(_,n)=>literal(args[Number(n)-1]));return {rows:JSON.parse(sql(`WITH result AS (${q}) SELECT coalesce(json_agg(result),'[]') FROM result`))};},close:async()=>{}};
  assert.match(await db.exec('SELECT version()'),/PostgreSQL 17\./);
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
 }else db=new PGlite();
 await db.exec(BASE_DDL);
 const span=loadMigration('2026-08-21-4075-monument-normal-gameday.sql').match(/CREATE OR REPLACE FUNCTION public\.race_entries_binding_span[\s\S]*?\$\$;/i)[0];
 await db.exec(span);
 for(const file of [...PREREQUISITE_MIGRATIONS,MIGRATION_5246]) await db.exec(loadMigration(file));
 await db.exec(loadMigration('2026-08-18-3420-race-entries-rider-day-invariant.sql').match(/create trigger trg_race_withdrawals_resync_binding[\s\S]*?;/i)[0]);
 if(!baseline) {
  const newSql=native?readFileSync(join(DATABASE_DIR,migration),'utf8'):loadMigration(migration);
  await db.exec(newSql);await db.exec(newSql);
 }
});
after(async()=>{if(db)await db.close();});
beforeEach(async()=>{await db.exec('TRUNCATE race_entries, race_entry_days, race_entry_overrides, race_entry_generator_runs, race_stage_schedule, race_withdrawals, races CASCADE');});
async function race(id,day=3){
 await db.query('INSERT INTO races (id,season_id) VALUES ($1,$2) RETURNING id',[id,SEASON]);
 await db.query('INSERT INTO race_stage_schedule(race_id,game_day,scheduled_at) VALUES ($1,$2,$3) RETURNING race_id',[id,day,'2026-10-29T10:00:00Z']);
 return id;
}
const A='00000000-0000-0000-0000-000000000010',B='00000000-0000-0000-0000-000000000011';
async function entry(rider,raceId){await db.query('INSERT INTO race_entries(race_id,team_id,rider_id) VALUES ($1,$2,$3) RETURNING rider_id',[raceId,TEAM,rider]);}
async function withdraw(reason=null){await db.query('INSERT INTO race_withdrawals(race_id,team_id,withdrawn_reason) VALUES ($1,$2,$3) RETURNING race_id',[A,TEAM,reason??'manager']);}
async function rows(table){return (await db.query('SELECT * FROM '+table+' ORDER BY race_id')).rows;}
const change=(raceId,riders)=>({race_id:raceId,rider_ids:riders,roles:riders.map(()=> 'helper')});
async function save(changes){return baseline ? db.query('SELECT replace_race_selection_bulk($1::uuid,$2::jsonb,$3::jsonb)',[TEAM,JSON.stringify(changes),'[]']) : db.query('SELECT replace_manager_race_selections($1::uuid,$2::jsonb,$3::jsonb,$4::timestamptz)',[TEAM,JSON.stringify(changes),'[]',NOW]);}
test('before start: replace kept entries, remove withdrawal, bind only new riders',async()=>{
 await race(A);await race(B);await entry(OLD,A);await withdraw();await entry(OLD,B);
 await save([change(A,[NEXT])]);
 assert.deepEqual((await rows('race_entries')).filter(e=>e.race_id===A).map(e=>e.rider_id),[NEXT]);
 assert.equal((await rows('race_withdrawals')).length,0);
 assert.deepEqual((await rows('race_entry_days')).filter(e=>e.race_id===A).map(e=>e.rider_id),[NEXT]);
});
test('new rider bound elsewhere: entire bulk rolls back with old entries and withdrawal intact',async()=>{
 await race(A);await race(B);await entry(OLD,A);await withdraw();await entry(NEXT,B);
 const previous=await rows('race_entries');
 await assert.rejects(save([change(A,[NEXT])]),/selection_rider_bound/);
 assert.deepEqual(await rows('race_entries'),previous);assert.equal((await rows('race_withdrawals')).length,1);
});
for(const locked of ['completed-stage','scheduled-start'])test('withdrawn locked race rejected: '+locked,async()=>{
 await race(A);await entry(OLD,A);await withdraw();
 if(locked==='completed-stage')await db.exec("UPDATE races SET stages_completed=1");
 else await db.exec("UPDATE race_stage_schedule SET scheduled_at='2026-10-28T10:00:00Z'");
 await assert.rejects(save([change(A,[NEXT])]),/selection_withdrawn_locked/);
 assert.equal((await rows('race_withdrawals')).length,1);assert.equal((await rows('race_entries'))[0].rider_id,OLD);
});
test('did_not_start is never removed',async()=>{
 await race(A);await entry(OLD,A);await withdraw('did_not_start');
 await assert.rejects(save([change(A,[NEXT])]),/selection_withdrawn/);
 assert.equal((await rows('race_withdrawals'))[0].withdrawn_reason,'did_not_start');
});
test('ordinary save and intentional peer swap still work atomically',async()=>{
 await race(A);await race(B);await entry(OLD,B);
 await save([change(A,[OLD]),change(B,[NEXT])]);
 assert.equal((await rows('race_entry_days')).length,2);
});
test('failed peer in bulk rolls back a successful rejoin too',async()=>{
 await race(A);await race(B);await entry(OLD,A);await withdraw();
 await assert.rejects(save([change(A,[NEXT]),change(B,[NEXT])]),/selection_rider_bound/);
 assert.equal((await rows('race_withdrawals')).length,1);assert.equal((await rows('race_entries')).length,1);
});

test('automation writer never cancels a voluntary withdrawal',async()=>{
 await race(A);await entry(OLD,A);await withdraw();
 await db.query('SELECT replace_race_selection($1::uuid,$2::uuid,$3::uuid[],$4::text[])',[TEAM,A,[NEXT],['helper']]);
 assert.equal((await rows('race_withdrawals')).length,1);assert.equal((await rows('race_entry_days')).length,0);
});
test('rejoin does not auto-release a conflicting automatic entry',async()=>{
 await race(A);await race(B);await entry(OLD,A);await withdraw();await entry(NEXT,B);
 await db.exec("UPDATE race_entries SET is_auto_filled=true WHERE race_id='"+B+"'");
 await assert.rejects(db.query('SELECT replace_manager_race_selections($1::uuid,$2::jsonb,$3::jsonb,$4::timestamptz)',[TEAM,JSON.stringify([change(A,[NEXT])]),JSON.stringify([{race_id:B,rider_id:NEXT}]),NOW]),/selection_rider_bound/);
 assert.equal((await rows('race_entries')).find(e=>e.race_id===B).rider_id,NEXT);
 assert.equal((await rows('race_withdrawals')).length,1);
});
test('native PG17 denies public API roles', {skip:!native||baseline}, async()=>{
 for(const role of ['anon','authenticated'])await assert.rejects(db.exec('SET ROLE '+role+"; SELECT replace_manager_race_selections('"+TEAM+"','[]','[]','"+NOW+"');"),/permission denied/);
});

test('auto-release source locked at scheduled start is untouched',async()=>{
 await race(A);await race(B);await entry(NEXT,B);
 await db.exec("UPDATE race_entries SET is_auto_filled=true; UPDATE race_stage_schedule SET scheduled_at='2026-10-28T10:00:00Z' WHERE race_id='"+B+"'");
 await assert.rejects(db.query('SELECT replace_manager_race_selections($1::uuid,$2::jsonb,$3::jsonb,$4::timestamptz)',[TEAM,JSON.stringify([change(A,[NEXT])]),JSON.stringify([{race_id:B,rider_id:NEXT}]),NOW]),/selection_rider_bound/);
 assert.equal((await rows('race_entries'))[0].race_id,B);
});
for(const lock of ['team','race'])test('native PG17 busy '+lock+' lock rejects without waiting or changing withdrawal',{skip:!native||baseline},async()=>{
 await race(A);await entry(OLD,A);await withdraw();
 const holder=spawn(join(process.env.REJOIN_PG_BIN,'psql.exe'),['-X','-h','127.0.0.1','-p',native,'-U','postgres','-d','postgres','-tA','-q'],{windowsHide:true,env:{...process.env,PGCLIENTENCODING:'UTF8'}});
 const held=new Promise((resolve,reject)=>{let out='';holder.stdout.on('data',c=>{out+=c;if(out.includes('HELD'))resolve();});holder.once('error',reject);holder.stderr.on('data',c=>reject(new Error(String(c))));});
 const query=lock==='team'?"SELECT pg_advisory_xact_lock(hashtext('"+TEAM+"'))":"SELECT id FROM races WHERE id='"+A+"' FOR UPDATE";
 holder.stdin.write('BEGIN; '+query+';\n\\echo HELD\n');
 try{await held;await assert.rejects(save([change(A,[NEXT])]),/selection_save_busy/);assert.equal((await rows('race_withdrawals')).length,1);}
 finally{const exit=once(holder,'exit');holder.stdin.end('ROLLBACK;\n\\q\n');await exit;}
});
