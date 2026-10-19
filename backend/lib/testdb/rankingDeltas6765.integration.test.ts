import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration=readFileSync(new URL('../../../database/2026-10-19-6765-incremental-rankings-shadow.sql',import.meta.url),'utf8');
const oldSenior=readFileSync(new URL('../../../database/2026-09-25-5535-senior-only-result-aggregates.sql',import.meta.url),'utf8');
const oldYouth=readFileSync(new URL('../../../database/2026-09-25-4620-youth-rider-rankings-mv.sql',import.meta.url),'utf8');
const views=['rider_rankings_mv','youth_rider_rankings_mv','team_standings_ext_mv','team_race_points_mv'];
const tables=['ranking_rider_season','ranking_youth_rider_season','ranking_team_season_ext','ranking_team_race_points'];
const definitions=views.map(name=>(name.startsWith('youth')?oldYouth:oldSenior)
  .match(new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+name+' AS\\s*([\\s\\S]*?);'))![1]);

test('#6765 shadow SQL equals the legacy definitions after every mutation', async t=>{
  const db=await PGlite.create(); t.after(()=>db.close());
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    'GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;',
    'CREATE TABLE races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text);',
    'CREATE TABLE riders(id uuid PRIMARY KEY,team_id uuid);',
    'CREATE TABLE race_results(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,race_id uuid,rider_id uuid,team_id uuid,points_earned integer,prize_money bigint,rank int,result_type text);',
    'CREATE INDEX idx_race_results ON race_results(race_id);',
    "CREATE FUNCTION fid(int) RETURNS uuid LANGUAGE SQL IMMUTABLE AS 'SELECT md5($1::text)::uuid';",
    'CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint);',
    "INSERT INTO ranking_refresh_work_state VALUES('ranking',fid(900),7,'2026-10-20T00:00:00Z',7,7);",
    'INSERT INTO riders SELECT fid(i),fid(100+i%3) FROM generate_series(1,12) i;',
    "INSERT INTO races SELECT fid(1000+i),fid(2000+i%2),(ARRAY['senior','u23','junior'])[1+i%3],CASE WHEN i%2=0 THEN 'single' ELSE 'stage_race' END,'race '||i FROM generate_series(1,12) i;",
    "INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) SELECT r.id,CASE WHEN i%11=0 THEN NULL ELSE fid(1+i%12) END,CASE WHEN i%3=0 THEN fid(100+i%3) ELSE NULL END,CASE WHEN i%7=0 THEN NULL ELSE i END,CASE WHEN i%5=0 THEN NULL ELSE i*100 END,1+i%12,(ARRAY['stage','gc','points','mountain','young','leader','points_day','mountain_day','young_day','team'])[1+i%10] FROM races r CROSS JOIN generate_series(1,240) i;",
    ...views.map((n,i)=>'CREATE MATERIALIZED VIEW public.'+n+' AS '+definitions[i]+';')
  ].join('\n'));
  await db.exec(migration);
  async function drain(batchSize=3) {
    for(let i=0;i<50;i++) {
      const r=await db.query<{v:{pending:boolean}}>('SELECT apply_ranking_deltas($1) v',[batchSize]);
      if(!r.rows[0].v.pending) return;
    }
    assert.fail('queue did not drain');
  }
  async function parity(label:string) {
    for(let i=0;i<views.length;i++) {
      const a=definitions[i],b='SELECT * FROM '+tables[i];
      const r=await db.query<{n:number}>('SELECT count(*)::int n FROM (('+a+' EXCEPT ALL '+b+') UNION ALL ('+b+' EXCEPT ALL '+a+')) d');
      assert.equal(r.rows[0].n,0,label+': '+views[i]);
    }
  }
  await drain(); await parity('backfill');
  await t.test('transfer then deletion of the last contribution retains the old team key across batches',async()=>{
    await db.exec("INSERT INTO riders VALUES(fid(13),fid(123)); INSERT INTO race_results(race_id,rider_id,points_earned,prize_money,rank,result_type) VALUES(fid(1012),fid(13),10,100,1,'stage');");
    await drain();
    await db.exec("UPDATE riders SET team_id=fid(124) WHERE id=fid(13); DELETE FROM race_results WHERE rider_id=fid(13);");
    await drain(1); await parity('transfer/delete interleaving');
  });
  await t.test('parity RPC uses a stable generation and finds real shadow drift',async()=>{
    assert.equal((await db.query<{v:{status:string}}>('SELECT check_ranking_shadow_parity() v')).rows[0].v.status,'equal');
    await db.exec('UPDATE ranking_rider_season SET points=coalesce(points,0)+1;');
    assert.equal((await db.query<{v:{status:string}}>('SELECT check_ranking_shadow_parity() v')).rows[0].v.status,'different');
    await db.exec("INSERT INTO ranking_dirty_log(kind) VALUES('rebuild');");
    assert.equal((await db.query<{v:{status:string}}>('SELECT check_ranking_shadow_parity() v')).rows[0].v.status,'pending');
    await drain(); await parity('repaired');
    await db.exec('UPDATE ranking_refresh_work_state SET requested_version=8;');
    assert.equal((await db.query<{v:{status:string}}>('SELECT check_ranking_shadow_parity() v')).rows[0].v.status,'pending');
    await db.exec('UPDATE ranking_refresh_work_state SET requested_version=7;');
  });
  const mutations=[
    "INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(1003)),('race',fid(1003));",
    "UPDATE race_results SET points_earned=points_earned+1,prize_money=NULL WHERE race_id=fid(1003);",
    "UPDATE riders SET team_id=fid(199) WHERE id=fid(1);",
    "UPDATE riders SET team_id=fid(198) WHERE id=fid(1); UPDATE riders SET team_id=fid(197) WHERE id=fid(1);",
    "UPDATE riders SET team_id=NULL WHERE id=fid(1);",
    "DELETE FROM riders WHERE id=fid(2);",
    "UPDATE races SET squad='u23',season_id=fid(2099),race_type='single',name='renamed' WHERE id=fid(1003);",
    "UPDATE races SET season_id=NULL WHERE id=fid(1009);",
    "DELETE FROM races WHERE id=fid(1003);",
    "DELETE FROM race_results WHERE race_id=fid(1006); INSERT INTO race_results(race_id,rider_id,team_id,points_earned,prize_money,rank,result_type) VALUES(fid(1006),fid(3),NULL,NULL,NULL,1,'gc'),(fid(1006),NULL,fid(101),NULL,NULL,1,'team'),(fid(1006),NULL,NULL,NULL,NULL,1,'stage');"
  ];
  for(const mutation of mutations) await t.test(mutation.split(';')[0],async()=>{
    await db.exec(mutation); await drain(); await parity(mutation);
  });
  await t.test('replay preserves output and pending queue',async()=>{
    await db.exec("INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(1009));");
    const before=await db.query('SELECT * FROM ranking_dirty_log ORDER BY id');
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM ranking_dirty_log ORDER BY id')).rows,before.rows);
    await drain(); await parity('migration replay');
  });
  await t.test('failed processing rolls back the claimed events',async()=>{
    await db.exec("INSERT INTO ranking_dirty_log(kind,race_id) VALUES('race',fid(1009));");
    await db.exec('BEGIN;');
    await db.query('SELECT apply_ranking_deltas(200)');
    await db.exec('ROLLBACK;');
    assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM ranking_dirty_log')).rows[0].n,1);
    await drain(); await parity('rollback/retry');
  });
  await t.test('client roles cannot read or execute; service_role can',async()=>{
    for(const role of ['anon','authenticated']) {
      await db.exec('SET ROLE '+role);
      await assert.rejects(db.query('SELECT apply_ranking_deltas(200)'),/permission denied/);
      for(const table of ['ranking_race_contrib','ranking_dirty_log',...tables])
        await assert.rejects(db.query('SELECT * FROM '+table),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    await db.query('SELECT apply_ranking_deltas(200)');
    await db.exec('RESET ROLE');
  });
  await t.test('invalid batch and stale lease fail before claiming work',async()=>{
    await assert.rejects(db.query('SELECT apply_ranking_deltas(0)'),/1..200/);
    await assert.rejects(db.query('SELECT apply_ranking_deltas(201)'),/1..200/);
    await assert.rejects(db.query("SELECT apply_ranking_deltas(200,fid(901),7)"),/claim lost/);
  });
  await t.test('truncate rebuild clears all summaries',async()=>{
    await db.exec('TRUNCATE riders'); await drain(); await parity('truncate riders');
    await db.exec('TRUNCATE race_results'); await drain(); await parity('truncate');
  });
});
