// #6765 M1.5: rider events are recomputed from contrib (no raw fan-out), the
// team_standings_ext recompute is index-driven, and queue age is exposed.
// Same legacy reference SELECTs and EXCEPT ALL parity as the M1 suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read=(path:string)=>readFileSync(new URL('../../../database/'+path,import.meta.url),'utf8');
const m1=read('2026-10-19-6765-incremental-rankings-shadow.sql');
const m15=read('2026-10-23-6765-ranking-shadow-contrib-transfers.sql');
const oldSenior=read('2026-09-25-5535-senior-only-result-aggregates.sql');
const oldYouth=read('2026-09-25-4620-youth-rider-rankings-mv.sql');
const views=['rider_rankings_mv','youth_rider_rankings_mv','team_standings_ext_mv','team_race_points_mv'];
const tables=['ranking_rider_season','ranking_youth_rider_season','ranking_team_season_ext','ranking_team_race_points'];
const definitions=views.map(name=>(name.startsWith('youth')?oldYouth:oldSenior)
  .match(new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+name+' AS\\s*([\\s\\S]*?);'))![1]);
type Applied={pending:boolean;processed?:number;races?:number;rider_races?:number};

async function fixture(){
  const db=await PGlite.create();
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    'GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;',
    'CREATE TABLE app_config(key text PRIMARY KEY,value jsonb);',
    'CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);',
    'CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);',
    'CREATE INDEX idx_riders_team ON riders(team_id);',
    // Production FK semantics: deleting a rider nulls its historical results.
    'CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid REFERENCES races(id) ON DELETE CASCADE,rider_id uuid REFERENCES riders(id) ON DELETE SET NULL,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);',
    'CREATE INDEX idx_race_results ON race_results(race_id);',
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    'CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint);',
    "INSERT INTO ranking_refresh_work_state VALUES('ranking',fid(900),7,'2026-10-20T00:00:00Z',7,7);",
    'INSERT INTO riders SELECT fid(i),CASE WHEN i%9=0 THEN NULL ELSE fid(100+i%4) END FROM generate_series(1,24) i;',
    "INSERT INTO races SELECT fid(1000+i),CASE WHEN i=12 THEN NULL ELSE fid(2000+i%3) END,(ARRAY['senior','senior','u23','junior'])[1+i%4],CASE WHEN i%2=0 THEN 'single' ELSE 'stage_race' END,'race '||i FROM generate_series(1,12) i;",
    "INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) SELECT r.id,CASE WHEN i%11=0 THEN NULL ELSE fid(1+i%24) END,CASE WHEN i%3=0 THEN fid(100+i%4) ELSE NULL END,CASE WHEN i%7=0 THEN NULL ELSE i END,CASE WHEN i%5=0 THEN NULL ELSE i*100 END,1+i%12,(ARRAY['stage','gc','points','mountain','young','leader','points_day','mountain_day','young_day','team'])[1+i%10] FROM races r CROSS JOIN generate_series(1,240) i;",
    ...views.map((n,i)=>'CREATE MATERIALIZED VIEW public.'+n+' AS '+definitions[i]+';'),
  ].join('\n'));
  await db.exec(m1);
  await db.exec("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_enabled';");
  return db;
}
async function apply(db:PGlite,batch=200){
  return (await db.query<{v:Applied}>('SELECT apply_ranking_deltas($1) v',[batch])).rows[0].v;
}
async function drain(db:PGlite,batch=200){
  for(let i=0;i<200;i++) if(!(await apply(db,batch)).pending) return;
  assert.fail('queue did not drain');
}
async function parity(db:PGlite,label:string){
  for(let i=0;i<views.length;i++){
    const a=definitions[i],b='SELECT * FROM '+tables[i];
    const r=await db.query<{n:number}>('SELECT count(*)::int n FROM (('+a+' EXCEPT ALL '+b+') UNION ALL ('+b+' EXCEPT ALL '+a+')) d');
    assert.equal(r.rows[0].n,0,label+': '+views[i]);
  }
}
const queue=async(db:PGlite)=>(await db.query<{kind:string;race_id:string|null;rider_id:string|null}>('SELECT kind,race_id,rider_id FROM ranking_dirty_log ORDER BY id')).rows;

test('#6765 M1.5 shadow processor keeps parity without raw transfer fan-out',async t=>{
  const db=await fixture(); t.after(()=>db.close());
  await db.exec(m15);
  await drain(db,7); await parity(db,'backfill with M1.5 processor');

  await t.test('a bulk transfer is one contrib-only batch: no race items, no raw rebuild',async()=>{
    await db.exec('UPDATE riders SET team_id=fid(150+(abs(hashtext(id::text))%3)) WHERE team_id IS NOT NULL;');
    const queued=await queue(db);
    assert.ok(queued.length>=20&&queued.every(q=>q.kind==='rider'),'transfer queues rider items only');
    const r=await apply(db);
    assert.equal(r.races,0,'no raw race_results recompute');
    assert.ok((r.rider_races??0)>0,'rollups recomputed for the riders\' races');
    assert.equal(r.pending,false);
    assert.deepEqual(await queue(db),[],'no per-race fan-out items left behind');
    await parity(db,'bulk transfer');
  });

  await t.test('transfer to and from no team, including NULL-season races',async()=>{
    await db.exec('UPDATE riders SET team_id=NULL WHERE id IN (fid(1),fid(2));');
    await drain(db); await parity(db,'to no team');
    await db.exec('UPDATE riders SET team_id=fid(160) WHERE id IN (fid(1),fid(2),fid(9));');
    await drain(db); await parity(db,'from no team');
  });

  await t.test('race item before rider item: old team is still invalidated',async()=>{
    // The removed contribution is processed first, so contrib no longer shows
    // the rider when its transfer item runs; the old team summary must not stay.
    await db.exec('DELETE FROM race_results WHERE rider_id=fid(5) AND team_id IS NULL;');
    await db.exec('UPDATE riders SET team_id=fid(170) WHERE id=fid(5);');
    const kinds=(await queue(db)).map(q=>q.kind);
    assert.equal(kinds[0],'race'); assert.equal(kinds.at(-1),'rider');
    await drain(db,1); await parity(db,'race-then-rider ordering');
  });

  await t.test('rider item before race item across single-item batches',async()=>{
    await db.exec('UPDATE riders SET team_id=fid(171) WHERE id=fid(14);');
    await db.exec('DELETE FROM race_results WHERE rider_id=fid(14) AND team_id IS NULL;');
    await drain(db,1); await parity(db,'rider-then-race ordering');
  });

  await t.test('two transfers before the queue drains',async()=>{
    await db.exec('UPDATE riders SET team_id=fid(172) WHERE id=fid(6); UPDATE riders SET team_id=fid(173) WHERE id=fid(6);');
    await drain(db,1); await parity(db,'double transfer');
  });

  await t.test('rider deletion nulls its results (FK) and the old team is recomputed',async()=>{
    await db.exec('DELETE FROM riders WHERE id=fid(7);');
    assert.ok((await queue(db)).some(q=>q.kind==='rider'));
    await drain(db,1); await parity(db,'deleted rider with SET NULL results');
  });

  await t.test('mixed race and rider items in one batch',async()=>{
    await db.exec("UPDATE race_results SET points_earned=coalesce(points_earned,0)+3,prize_money=NULL WHERE race_id=fid(1003);");
    await db.exec('UPDATE riders SET team_id=fid(174) WHERE id IN (fid(8),fid(10),fid(11));');
    await db.exec("UPDATE races SET squad='u23',season_id=fid(2099) WHERE id=fid(1005);");
    await drain(db); await parity(db,'mixed batch');
  });

  await t.test('replaying the M1.5 migration is a no-op for output and queue',async()=>{
    await db.exec("INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(1009));");
    const before=await queue(db);
    await db.exec(m15);
    assert.deepEqual(await queue(db),before);
    await drain(db); await parity(db,'M1.5 replay');
  });

  await t.test('queue metrics expose the age of the oldest item',async()=>{
    const empty=(await db.query<{v:{queue_length:number;oldest_age_s:number|null}}>('SELECT get_ranking_shadow_metrics() v')).rows[0].v;
    assert.deepEqual(empty,{queue_length:0,oldest_age_s:null});
    await db.exec("INSERT INTO ranking_dirty_log(kind,race_id,enqueued_at) VALUES('race',fid(1009),clock_timestamp()-interval '90 seconds');");
    const aged=(await db.query<{v:{queue_length:number;oldest_age_s:number}}>('SELECT get_ranking_shadow_metrics() v')).rows[0].v;
    assert.equal(aged.queue_length,1);
    assert.ok(Number.isSafeInteger(aged.oldest_age_s)&&aged.oldest_age_s>=90&&aged.oldest_age_s<600,String(aged.oldest_age_s));
    await drain(db);
  });

  await t.test('grants are unchanged: client roles denied, service_role allowed',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec('SET ROLE '+role);
      await assert.rejects(db.query('SELECT apply_ranking_deltas(200)'),/permission denied/);
      await assert.rejects(db.query('SELECT get_ranking_shadow_metrics()'),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    await db.query('SELECT apply_ranking_deltas(200)');
    await db.query('SELECT get_ranking_shadow_metrics()');
    await db.exec('RESET ROLE');
  });

  await t.test('rebuild after truncation still converges',async()=>{
    await db.exec('TRUNCATE race_results;'); await drain(db,5); await parity(db,'truncate rebuild');
  });
});

test('#6765 M1.5 drains rider fan-out items queued by the M1 processor before deploy',async t=>{
  const db=await fixture(); t.after(()=>db.close());
  await drain(db); await parity(db,'M1 backfill');
  await db.exec('UPDATE riders SET team_id=fid(180) WHERE id IN (fid(1),fid(3));');
  // M1 turns each rider item into per-race items carrying old attribution.
  await apply(db,1); await apply(db,1);
  const legacy=await queue(db);
  assert.ok(legacy.length>0&&legacy.every(q=>q.kind==='race'&&q.rider_id!==null),'M1 fan-out items pending at deploy');
  await db.exec(m15);
  await drain(db,3); await parity(db,'M1 items drained by M1.5');
});
