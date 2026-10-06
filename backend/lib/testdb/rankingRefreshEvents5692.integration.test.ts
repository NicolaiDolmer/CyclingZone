import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../../database/2026-10-06-5692-ranking-refresh-events.sql', import.meta.url), 'utf8');
const NOW = '2026-10-06T12:00:00Z';
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const views = ['rider_rankings_mv', 'team_standings_ext_mv', 'team_race_points_mv', 'global_rank_mv', 'youth_rider_rankings_mv'];

test('#5692 durable dirty work, fencing, grants, transaction events and rollover ordering', async t => {
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    CREATE TABLE public.race_results(id uuid PRIMARY KEY,race_id uuid,rider_id uuid,team_id uuid,points_earned numeric,prize_money numeric,rank int,result_type text,imported_at timestamptz);
    CREATE TABLE public.races(id uuid PRIMARY KEY,season_id uuid,squad text,race_type text,name text,irrelevant text);
    CREATE TABLE public.riders(id uuid PRIMARY KEY,team_id uuid,rating numeric);
    CREATE TABLE public.season_standings(id uuid PRIMARY KEY,season_id uuid,team_id uuid,total_points numeric,irrelevant text);
    CREATE TABLE public.seasons(id uuid PRIMARY KEY,status text,number int);
    CREATE TABLE public.teams(id uuid PRIMARY KEY,name text,division int,is_ai boolean,is_test_account boolean,is_frozen boolean,is_bank boolean,user_id uuid);
    CREATE TABLE public.team_global_rank_points(team_id uuid PRIMARY KEY,banked_points numeric,updated_at timestamptz);
    CREATE TABLE public.matview_refresh_heartbeat(matview_group text PRIMARY KEY,refreshed_at timestamptz);
    GRANT SELECT,INSERT,UPDATE ON public.matview_refresh_heartbeat TO service_role;
    CREATE TABLE public.global_rank_season_start_snapshot(id uuid PRIMARY KEY,total numeric);
    INSERT INTO public.team_global_rank_points VALUES('${A}',10,'${NOW}');
    CREATE TABLE public.fixture_source(id int PRIMARY KEY,total int); INSERT INTO public.fixture_source VALUES(1,7);
    ${views.map(view => `CREATE MATERIALIZED VIEW public.${view} AS ${view === 'global_rank_mv' ? 'SELECT team_id AS id,banked_points AS total FROM public.team_global_rank_points' : 'SELECT * FROM public.fixture_source'};
      CREATE UNIQUE INDEX ${view}_pk ON public.${view}(id);
      CREATE FUNCTION public.refresh_${view}(p_concurrently boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN REFRESH MATERIALIZED VIEW CONCURRENTLY public.${view}; END; $$;`).join('\n')}
    CREATE FUNCTION public.apply_global_rank_season_rollover(p_completed_season_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
      UPDATE public.team_global_rank_points SET banked_points=banked_points+1;
      REFRESH MATERIALIZED VIEW public.global_rank_mv;
      INSERT INTO public.global_rank_season_start_snapshot SELECT * FROM public.global_rank_mv ON CONFLICT(id) DO UPDATE SET total=excluded.total;
    END; $$;
  `);
  await db.exec(migration);
  async function state() {
    return (await db.query<{ value: { requested_version: string; completed_version: string; pending: boolean } }>(
      'SELECT public.get_ranking_refresh_work_state($1::timestamptz) AS value', [NOW])).rows[0].value;
  }
  // Scenarios below test fencing/events, not the min-interval/backoff gate: age
  // the gate state first. The gate itself has its own scenario at the end.
  async function ageGates() {
    await db.exec(`UPDATE public.ranking_refresh_work_state SET last_completed_at=last_completed_at-interval '1 day',
      last_failed_at=NULL,consecutive_failures=0 WHERE matview_group='ranking';`);
  }
  async function claim(token = A, at = NOW, gated = false) {
    if (!gated) await ageGates();
    return (await db.query<{ value: { status: string; target_version: string } }>(
      'SELECT public.claim_ranking_refresh_work($1::uuid,false,$2::timestamptz) AS value', [token,at])).rows[0].value;
  }
  async function finish(token: string, version: string, success = true, at = NOW) {
    return (await db.query<{ value: boolean }>('SELECT public.finish_ranking_refresh_work($1::uuid,$2::bigint,$3,$4::timestamptz) AS value', [token,version,success,at])).rows[0].value;
  }
  await t.test('initial work is claimed once; acknowledgement is atomic and subsequent empty ticks are clean', async () => {
    const first = await claim(); assert.equal(first.status,'claimed');
    assert.equal((await claim(B)).status,'busy');
    assert.equal(await finish(A,first.target_version),true);
    assert.equal((await claim()).status,'clean');
    assert.equal((await state()).pending,false);
  });
  await t.test('rollback and irrelevant/unchanged updates do not manufacture work', async () => {
    await db.exec(`INSERT INTO public.riders VALUES('${A}','${B}',7);`);
    const work=await claim(); await finish(A,work.target_version);
    const before=await state();
    await db.exec(`UPDATE public.riders SET rating=8; UPDATE public.riders SET team_id=team_id;
      BEGIN; UPDATE public.riders SET team_id=NULL; ROLLBACK;`);
    assert.deepEqual(await state(),before);
  });
  await t.test('historical ownership change remains dirty when it arrives during a pass', async () => {
    await db.exec('UPDATE public.riders SET team_id=NULL;');
    const work=await claim();
    await db.exec(`UPDATE public.riders SET team_id='${B}';`);
    assert.equal(await finish(A,work.target_version),true);
    assert.equal((await state()).pending,true);
    const followup=await claim(B); assert.equal(followup.status,'claimed');
    assert.equal(await finish(B,followup.target_version),true);
  });
  await t.test('lease recovery fences a late owner and failed work remains pending', async () => {
    await db.exec('UPDATE public.riders SET team_id=NULL;');
    const old=await claim();
    const replacement=await claim(B,'2026-10-06T12:01:31Z');
    assert.equal(replacement.status,'claimed');
    assert.equal(await finish(A,old.target_version,true,'2026-10-06T12:01:32Z'),false);
    assert.equal(await finish(B,replacement.target_version,false,'2026-10-06T12:01:32Z'),true);
    assert.equal((await state()).pending,true);
  });
  await t.test('a paused owner cannot execute heavy refresh after a new owner takes over', async () => {
    const old=await claim(A,'2026-10-06T12:03:00Z');
    assert.equal(old.status,'claimed');
    await db.exec('UPDATE public.fixture_source SET total=8;');
    const replacement=await claim(B,'2026-10-06T12:04:31Z');
    assert.equal(replacement.status,'claimed');
    await assert.rejects(db.query('SELECT public.refresh_rider_rankings_mv(true,$1::uuid,$2::bigint,$3::timestamptz)',
      [A,old.target_version,'2026-10-06T12:04:32Z']), /claim lost/);
    assert.equal((await db.query<{ total: number }>('SELECT total FROM public.rider_rankings_mv')).rows[0].total,7,
      'the old owner must perform zero heavy statements');
    await db.query('SELECT public.refresh_rider_rankings_mv(true,$1::uuid,$2::bigint,$3::timestamptz)',
      [B,replacement.target_version,'2026-10-06T12:04:32Z']);
    assert.equal((await db.query<{ total: number }>('SELECT total FROM public.rider_rankings_mv')).rows[0].total,8);
    await finish(B,replacement.target_version,false,'2026-10-06T12:04:32Z');
  });
  await t.test('rollover publishes the refreshed rank before its season-start snapshot', async () => {
    await db.exec(`SELECT public.apply_global_rank_season_rollover('${B}');`);
    const rows=await db.query<{ total: string }>('SELECT total::text FROM public.global_rank_season_start_snapshot');
    assert.equal(rows.rows[0].total,'11');
  });
  await t.test('client roles cannot claim or inspect work; service role can', async () => {
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role};`);
      await assert.rejects(db.query('SELECT public.get_ranking_refresh_work_state($1::timestamptz)',[NOW]), /permission denied/);
      await db.exec('RESET ROLE;');
    }
    await db.exec('SET ROLE service_role;'); await state(); await db.exec('RESET ROLE;');
  });
  await t.test('reapplying preserves generation and pending work', async () => {
    const before=await state(); await db.exec(migration); assert.deepEqual(await state(),before);
  });
  await t.test('min interval and failure backoff protect the database; forced repair bypasses them', async () => {
    const T = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
    await db.exec(`UPDATE public.ranking_refresh_work_state SET lease_token=NULL,leased_version=NULL,lease_expires_at=NULL;`);
    await db.exec('UPDATE public.riders SET team_id=NULL;');
    const w=await claim(A,T(100)); assert.equal(w.status,'claimed');
    assert.equal(await finish(A,w.target_version,true,T(100)),true);
    await db.exec(`UPDATE public.riders SET team_id='${B}';`);
    assert.equal((await claim(A,T(103),true)).status,'cooldown','3 min after a pass: no new full pass');
    const after=await claim(A,T(104.1),true); assert.equal(after.status,'claimed','4-min floor keeps the 5-min contract');
    assert.equal(await finish(A,after.target_version,false,T(104.2)),true);
    assert.equal((await claim(A,T(107),true)).status,'cooldown','1st failure backs off 4 min');
    const retry=await claim(A,T(108.3),true); assert.equal(retry.status,'claimed');
    assert.equal(await finish(A,retry.target_version,false,T(108.4)),true);
    assert.equal((await claim(A,T(115),true)).status,'cooldown','2nd failure backs off 8 min');
    const forced=(await db.query<{ value: { status: string; target_version: string } }>(
      'SELECT public.claim_ranking_refresh_work($1::uuid,true,$2::timestamptz) AS value',[B,T(115)])).rows[0].value;
    assert.equal(forced.status,'claimed','forced repair bypasses cooldown');
    assert.equal(await finish(B,forced.target_version,true,T(115.1)),true);
    const s=(await db.query<{ f: number }>(`SELECT consecutive_failures AS f FROM public.ranking_refresh_work_state`)).rows[0];
    assert.equal(s.f,0,'success resets the backoff');
  });
  await t.test('all seven dependency tables capture statement insert/update/delete/truncate', async () => {
    const scenarios = [
      ['race_results', `INSERT INTO public.race_results(id,points_earned) VALUES('${B}',1)`, `UPDATE public.race_results SET points_earned=2 WHERE id='${B}'`, 'id'],
      ['races', `INSERT INTO public.races(id,name) VALUES('${B}','fixture')`, `UPDATE public.races SET name='corrected' WHERE id='${B}'`, 'id'],
      ['riders', `INSERT INTO public.riders(id,team_id) VALUES('${B}','${A}')`, `UPDATE public.riders SET team_id=NULL WHERE id='${B}'`, 'id'],
      ['season_standings', `INSERT INTO public.season_standings(id,total_points) VALUES('${B}',1)`, `UPDATE public.season_standings SET total_points=2 WHERE id='${B}'`, 'id'],
      ['seasons', `INSERT INTO public.seasons(id,status) VALUES('${B}','active')`, `UPDATE public.seasons SET status='completed' WHERE id='${B}'`, 'id'],
      ['teams', `INSERT INTO public.teams(id,name) VALUES('${B}','fixture')`, `UPDATE public.teams SET name='corrected' WHERE id='${B}'`, 'id'],
      ['team_global_rank_points', `INSERT INTO public.team_global_rank_points(team_id,banked_points) VALUES('${B}',1)`, `UPDATE public.team_global_rank_points SET banked_points=2 WHERE team_id='${B}'`, 'team_id'],
    ];
    for (const [table,insert,update,key] of scenarios) {
      for (const sql of [insert,update,`DELETE FROM public.${table} WHERE ${key}='${B}'`,`TRUNCATE public.${table}`]) {
        const before=BigInt((await state()).requested_version);
        await db.exec(sql);
        assert.equal(BigInt((await state()).requested_version),before+1n,table);
      }
    }
  });
});
