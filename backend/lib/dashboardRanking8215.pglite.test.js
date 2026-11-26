import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { splitStatements } from "../../scripts/lint-migration-idempotency.mjs";
import { pickDashboardTopRiders, readDashboardTopRiders7664 } from "./rankingRead7664.js";

const migration = new URL("../../database/2026-11-26-8215-dashboard-ranking-shadow.sql", import.meta.url);
const id = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const seasonId = id(100);
const signature = "public.dashboard_rider_ranking_shadow(uuid,integer)";

test("#8215: the migration replays and the RPC matches every field of the current reader", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.riders(id uuid PRIMARY KEY, team_id uuid, firstname text, lastname text, nationality_code text, is_retired boolean);
    CREATE TABLE public.teams(id uuid PRIMARY KEY, name text, is_ai boolean, league_division_id integer);
    CREATE TABLE public.ranking_rider_season(season_id uuid, rider_id uuid, points numeric, stage_wins bigint, gc_wins bigint, classic_wins bigint, UNIQUE (season_id,rider_id));
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  const teams = [{ id: id(80), name: "Pool one", is_ai: false, league_division_id: 1 },
    { id: id(81), name: "Pool two", is_ai: true, league_division_id: 2 }];
  for (const team of teams) {
    await db.query("INSERT INTO teams VALUES ($1,$2,$3,$4)", Object.values(team));
  }
  const stats = [];
  const display = new Map();
  for (const [index, points, team, retired] of [
    [1, 400, teams[0], true], [2, 150, teams[1], false], [3, 80.75, teams[0], false],
    [4, 80.75, teams[0], false], [5, 50, null, false], [6, 10, teams[0], false],
    [7, 0, teams[0], false], [8, null, teams[0], false], [9, 500, teams[0], null],
  ]) {
    const riderId = id(index);
    const first = index === 8 ? null : "First " + index;
    await db.query("INSERT INTO riders VALUES ($1,$2,$3,$4,$5,$6)", [riderId, team?.id, first, null, "DK", retired]);
    await db.query("INSERT INTO ranking_rider_season VALUES ($1,$2,$3,$4,$5,$6)", [seasonId, riderId, points, index, index % 2, index % 3]);
    stats.push({ rider_id: riderId, points, stage_wins: index, gc_wins: index % 2, classic_wins: index % 3 });
    if (retired === false) display.set(riderId, { firstname: first, lastname: null, nationality_code: "DK", team });
  }
  // Missing rider and other season rows cannot displace eligible results.
  await db.query("INSERT INTO ranking_rider_season VALUES ($1,$2,1000,1,2,3),($3,$4,900,1,2,3)", [seasonId, id(60), id(101), id(8)]);
  // psql -f autocommits each top-level statement unless the file opens a transaction.
  const statements = splitStatements(await readFile(migration, "utf8"));
  const apply = async () => {
    for (const { text } of statements) await db.exec(text);
  };
  await apply();
  // An interrupted concurrent build leaves an index entry the retry must replace.
  await db.exec(`UPDATE pg_catalog.pg_index SET indisvalid = false
    WHERE indexrelid = 'public.ranking_rider_season_dashboard_order'::regclass`);
  await apply();
  await apply();
  const index = await db.query(`SELECT indisvalid AS valid FROM pg_catalog.pg_index
    WHERE indexrelid = 'public.ranking_rider_season_dashboard_order'::regclass`);
  assert.deepEqual(index.rows, [{ valid: true }]);
  const grants = await db.query(`SELECT
    has_function_privilege('anon', '${signature}', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', '${signature}', 'EXECUTE') AS authenticated,
    has_function_privilege('service_role', '${signature}', 'EXECUTE') AS service_role,
    (SELECT proconfig FROM pg_proc WHERE oid = '${signature}'::regprocedure) AS settings`);
  assert.deepEqual(grants.rows, [{ anon: false, authenticated: false, service_role: true, settings: null }]);
  const calls = [];
  const client = {
    rpc(name, args) {
      assert.equal(name, "dashboard_rider_ranking_shadow");
      calls.push(args);
      return { abortSignal: async (signal) => {
        assert.ok(signal instanceof AbortSignal);
        const { rows } = await db.query("SELECT * FROM public.dashboard_rider_ranking_shadow($1,$2)", [args.p_season_id, args.p_league_division_id]);
        return { data: rows, error: null };
      } };
    },
  };
  await db.exec("SET ROLE service_role");
  for (const pool of [null, 1, 2, 999]) {
    const scoped = new Map([...display].filter(([, rider]) => pool == null || rider.team?.league_division_id === pool));
    const expected = pickDashboardTopRiders(stats, scoped);
    const actual = await readDashboardTopRiders7664(client, {
      seasonId, leagueDivisionId: pool, source: { source: "shadow" }, now: () => 0, preferRpc: true,
    });
    assert.deepEqual(actual, expected);
  }
  assert.equal(calls.length, 4);
});
