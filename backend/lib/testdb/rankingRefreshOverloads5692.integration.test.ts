import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../../../database/2026-10-05-5692-ranking-refresh.sql', import.meta.url);
const views = ['rider_rankings_mv', 'team_standings_ext_mv', 'team_race_points_mv', 'global_rank_mv', 'youth_rider_rankings_mv'];

// Raw migration, actual role switches and SQL execution in a throwaway in-memory
// PostgreSQL. Multi-session locks/HTTP are separately verified by #6153's real
// PG17/PostgREST test; this fixture does not claim load or concurrency evidence.
test('#5692 SQL-only: additive overloads, grants, mode enforcement and idempotence', async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.fixture_source(id integer PRIMARY KEY, total integer);
    INSERT INTO public.fixture_source VALUES (1, 7);
    ${views.map(view => `
      CREATE MATERIALIZED VIEW public.${view} AS SELECT id,total FROM public.fixture_source;
      CREATE UNIQUE INDEX ${view}_pk ON public.${view}(id);
      CREATE FUNCTION public.refresh_${view}() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
        SET search_path=public,pg_catalog AS $$ BEGIN REFRESH MATERIALIZED VIEW public.${view}; END; $$;
      REVOKE ALL ON FUNCTION public.refresh_${view}() FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.refresh_${view}() TO service_role;
    `).join('\n')}
  `);
  const legacy = await db.query(`SELECT proname, pg_get_functiondef(oid) AS definition
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'refresh_%' AND pronargs=0 ORDER BY proname`);

  // The baseline may lack the staged migration. Its catalog assertion below
  // must fail then: never skip an unavailable overload or silently use plain.
  if (existsSync(migration)) await db.exec(readFileSync(migration, 'utf8'));
  const overloads = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname LIKE 'refresh_%' AND pronargs=1`);
  assert.equal(overloads.rows[0].n, 5, 'all five boolean overloads must exist before Node activation');

  async function assertSafeSearchPaths() {
    for (const view of views) {
      const signature = `public.refresh_${view}(boolean)`;
      const config = await db.query<{ proconfig: string[] }>(
        'SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure', [signature]);
      assert.deepEqual(config.rows[0].proconfig, ['search_path=public, pg_temp'],
        `${signature} must explicitly place pg_temp last`);
    }
  }

  await t.test('all five definers explicitly place pg_temp last', assertSafeSearchPaths);

  await t.test('all five are service-only definers and retain no-argument rollback functions', async () => {
    for (const view of views) {
      const signature = `public.refresh_${view}(boolean)`;
      const grants = await db.query<{ service: boolean; anon: boolean; player: boolean; definer: boolean }>(`
        SELECT has_function_privilege('service_role',$1,'EXECUTE') AS service,
          has_function_privilege('anon',$1,'EXECUTE') AS anon,
          has_function_privilege('authenticated',$1,'EXECUTE') AS player,
          (SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure) AS definer`, [signature]);
      assert.deepEqual(grants.rows[0], { service: true, anon: false, player: false, definer: true });
    }
    const after = await db.query(`SELECT proname, pg_get_functiondef(oid) AS definition
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'refresh_%' AND pronargs=0 ORDER BY proname`);
    assert.deepEqual(after.rows, legacy.rows);
  });

  await t.test('service role refreshes all five with explicit true', async () => {
    await db.exec('INSERT INTO public.fixture_source VALUES (2,9)');
    await db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE service_role');
      for (const view of views) await tx.query(`SELECT public.refresh_${view}(true)`);
    });
    for (const view of views) {
      assert.deepEqual((await db.query(`SELECT id,total FROM public.${view} ORDER BY id`)).rows,
        [{ id: 1, total: 7 }, { id: 2, total: 9 }]);
    }
  });

  await t.test('false and null are rejected instead of selecting blocking fallback', async () => {
    for (const view of views) for (const argument of ['false', 'NULL::boolean']) {
      await assert.rejects(() => db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE service_role');
        await tx.query(`SELECT public.refresh_${view}(${argument})`);
      }), (error: { code?: string }) => error.code === '22023');
    }
  });

  await t.test('anon and authenticated cannot execute either old or new overloads', async () => {
    for (const role of ['anon', 'authenticated']) for (const view of views) for (const args of ['', 'true']) {
      await assert.rejects(() => db.transaction(async tx => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query(`SELECT public.refresh_${view}(${args})`);
      }), (error: { code?: string }) => error.code === '42501');
    }
  });

  await t.test('repeat apply preserves data, legacy definitions and exactly five overloads', async () => {
    await db.exec(readFileSync(migration, 'utf8'));
    await assertSafeSearchPaths();
    const after = await db.query(`SELECT proname, pg_get_functiondef(oid) AS definition
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'refresh_%' AND pronargs=0 ORDER BY proname`);
    assert.deepEqual(after.rows, legacy.rows);
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname LIKE 'refresh_%' AND pronargs=1`)).rows[0].n, 5);
    for (const view of views) assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${view}`)).rows[0].n, 2);
  });

  await t.test('missing UNIQUE fails without changing the last completed snapshot', async () => {
    await db.exec('DROP INDEX public.team_race_points_mv_pk; INSERT INTO public.fixture_source VALUES (3,11)');
    await assert.rejects(() => db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE service_role');
      await tx.query('SELECT public.refresh_team_race_points_mv(true)');
    }), (error: { code?: string }) => error.code === '55000');
    assert.deepEqual((await db.query('SELECT id,total FROM public.team_race_points_mv ORDER BY id')).rows,
      [{ id: 1, total: 7 }, { id: 2, total: 9 }]);
  });
});
