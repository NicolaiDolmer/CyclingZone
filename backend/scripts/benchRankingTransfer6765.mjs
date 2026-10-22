// #6765 M1.5: local before/after benchmark of the shadow processor.
// In-process PGlite (PostgreSQL 17, WASM): relative before/after on identical
// data, not an absolute production SLA. Synthetic IDs only; nothing external.
// Same data, M1 processor first, then the M1.5 migration on top:
//   A. one changed race (raw recompute path, regression check)
//   B. bulk transfer of 200 riders (M1: per-race raw fan-out, M1.5: contrib only)
//   C. one rider transfer
// Every step ends with EXCEPT ALL parity against the legacy SELECTs.
//
//   pwsh -File scripts/verify-lock.ps1 -Max 2 -- node backend/scripts/benchRankingTransfer6765.mjs
// --quick runs a small fixture.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root=resolve(import.meta.dirname,'../..');
const quick=process.argv.includes('--quick');
const RACES=quick?24:300, FIELD=160, ROWS_PER_RIDER=12, RIDERS=quick?400:2000, TEAMS=quick?20:120, BULK=quick?20:200;
const db=await PGlite.create();
// Returns the first column of the last statement's first row, as text.
async function sql(source){
  const results=await db.exec(source);
  const last=results.at(-1)?.rows?.[0];
  return last?String(Object.values(last)[0]):'';
}
const read=path=>readFileSync(join(root,'database',path),'utf8');
const senior=read('2026-09-25-5535-senior-only-result-aggregates.sql');
const youth=read('2026-09-25-4620-youth-rider-rankings-mv.sql');
const names=['rider_rankings_mv','team_standings_ext_mv','team_race_points_mv','youth_rider_rankings_mv'];
const tables=['ranking_rider_season','ranking_team_season_ext','ranking_team_race_points','ranking_youth_rider_season'];
const definitions=names.map(n=>(n.startsWith('youth')?youth:senior)
  .match(new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+n+' AS\\s*([\\s\\S]*?);'))[1]);
// Time of one apply call, measured around the in-process query.
async function applyOnce(){
  const started=performance.now();
  const {rows}=await db.query('SELECT public.apply_ranking_deltas(200) r');
  return {r:rows[0].r,ms:+(performance.now()-started).toFixed(1)};
}
async function drain(){
  const ms=[];let queuedAfterFirst=null,rawRaces=0,processed=0;
  for(let i=0;i<5000;i++){
    const {r,ms:m}=await applyOnce(); ms.push(m); rawRaces+=r.races??0; processed+=r.processed??0;
    if(i===0) queuedAfterFirst=+(await sql('SELECT count(*) FROM ranking_dirty_log'));
    if(!r.pending) break;
  }
  return {batches:ms.length,total_ms:+ms.reduce((a,b)=>a+b,0).toFixed(1),max_batch_ms:Math.max(...ms),
    queued_after_first_batch:queuedAfterFirst,processed_items:processed,raw_race_recomputes:rawRaces};
}
async function parity(label){
  for(let i=0;i<names.length;i++){
    const a=definitions[i],b='SELECT * FROM public.'+tables[i];
    assert.equal(await sql('SELECT count(*) FROM (('+a+' EXCEPT ALL '+b+') UNION ALL ('+b+' EXCEPT ALL '+a+')) d;'),'0',label+': '+names[i]);
  }
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
async function scenarios(label,offset){
  const race=[];
  for(let i=0;i<3;i++){
    await sql('UPDATE race_results SET points_earned=coalesce(points_earned,0)+1 WHERE race_id=fid(100004);');
    race.push((await drain()).total_ms);
  }
  await parity(label+' changed race');
  assert.equal(await sql('SELECT count(*) FROM ranking_dirty_log'),'0');
  await sql('UPDATE riders SET team_id=fid(19000+(abs(hashtext(id::text))%'+TEAMS+')) WHERE id IN (SELECT fid(i) FROM generate_series('+(offset+1)+','+(offset+BULK)+') i);');
  const bulk=await drain();
  await parity(label+' bulk transfer');
  await sql('UPDATE riders SET team_id=fid(18999) WHERE id=fid('+(offset+BULK+1)+');');
  const single=await drain();
  await parity(label+' single transfer');
  return {changed_race_ms:race,changed_race_median_ms:median(race),bulk_transfer:bulk,single_transfer:single};
}
try{
  const version=await sql('SHOW server_version');
  await sql([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    'GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;',
    'CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);',
    'CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);',
    'CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);',
    'CREATE INDEX idx_riders_team ON riders(team_id);',
    'CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid,rider_id uuid,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);',
    'CREATE INDEX idx_race_results ON race_results(race_id);',
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    'CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint);',
    'INSERT INTO riders SELECT fid(i),CASE WHEN i%17=0 THEN NULL ELSE fid(10000+i%'+TEAMS+') END FROM generate_series(1,'+RIDERS+') i;',
    "INSERT INTO races SELECT fid(100000+i),fid(200000+i%4),(ARRAY['senior','senior','u23','junior'])[1+i%4],CASE WHEN i%2=0 THEN 'stage_race' ELSE 'single' END,'fixture '||i FROM generate_series(1,"+RACES+') i;',
    // A field of FIELD riders per race, ROWS_PER_RIDER results each (stages, GC, jerseys).
    'INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) SELECT fid(100000+n),CASE WHEN j%19=0 THEN NULL ELSE fid(1+((n*'+FIELD+'+j)%'+RIDERS+')) END,CASE WHEN j%3=0 THEN fid(10000+j%'+TEAMS+") ELSE NULL END,CASE WHEN k%23=0 THEN NULL ELSE (j+k)%80 END,CASE WHEN k%7=0 THEN NULL ELSE ((j*k)%60)*100 END,1+(j+k)%12,(ARRAY['stage','gc','points','mountain','young','leader','points_day','mountain_day','young_day','team'])[1+k%10] FROM generate_series(1,"+RACES+') n CROSS JOIN generate_series(1,'+FIELD+') j CROSS JOIN generate_series(1,'+ROWS_PER_RIDER+') k;',
    'ANALYZE;',
  ].join('\n'));
  await sql(names.map((n,i)=>'CREATE MATERIALIZED VIEW public.'+n+' AS '+definitions[i]+';').join('\n'));
  await sql(read('2026-10-19-6765-incremental-rankings-shadow.sql'));
  await sql("UPDATE app_config SET value='true'::jsonb WHERE key='ranking_shadow_enabled';");
  const backfill=await drain(); await parity('M1 backfill');
  await sql('ANALYZE;');
  const fixture=(await db.query("SELECT jsonb_build_object('race_results',(SELECT count(*) FROM race_results),'contrib',(SELECT count(*) FROM ranking_race_contrib),'avg_races_per_rider',(SELECT round(avg(n),1) FROM (SELECT count(DISTINCT race_id) n FROM ranking_race_contrib WHERE rider_id IS NOT NULL GROUP BY rider_id) x)) v")).rows[0].v;
  const m1=await scenarios('M1',0);
  await sql(read('2026-10-23-6765-ranking-shadow-contrib-transfers.sql'));
  const m15=await scenarios('M1.5',2*BULK);
  console.log(JSON.stringify({engine:'PGlite '+version,quick,fixture,backfill_m1:backfill,m1,m15},null,2));
  console.log('ALL PARITY CHECKS PASSED');
}finally{
  await db.close();
}
