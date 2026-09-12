import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../database/proposals/2026-09-12-5176-revoke-matview-select.sql", import.meta.url), "utf8");
const views = ["rider_rankings_mv", "global_rank_mv", "team_standings_ext_mv", "team_race_points_mv"];

test("first rollout does not auto-apply the staged revoke", () => {
  assert.equal(existsSync(new URL("../../database/2026-09-12-5176-revoke-matview-select.sql", import.meta.url)), false,
    "activate the revoke only in the separately approved second rollout");
});

test("matview revokes are idempotent and preserve only service access", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const view of views) {
      await db.exec(`CREATE MATERIALIZED VIEW public.${view} AS SELECT 42 AS points;
        GRANT SELECT ON public.${view} TO PUBLIC, anon, authenticated;`);
    }
    await db.exec("CREATE FUNCTION public.honours_fixture() RETURNS int LANGUAGE sql SECURITY INVOKER AS 'SELECT points FROM public.rider_rankings_mv'; GRANT EXECUTE ON FUNCTION public.honours_fixture() TO authenticated, service_role;");
    await db.exec("SET ROLE authenticated");
    assert.deepEqual((await db.query("SELECT public.honours_fixture() AS points")).rows, [{ points: 42 }]);
    await db.exec("RESET ROLE");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.honours_fixture()"), /permission denied/);
    await db.exec("RESET ROLE; SET ROLE service_role");
    assert.deepEqual((await db.query("SELECT public.honours_fixture() AS points")).rows, [{ points: 42 }]);
    await db.exec("RESET ROLE");
    for (const view of views) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
        "SELECT has_table_privilege('anon', $1, 'SELECT') AS anon, has_table_privilege('authenticated', $1, 'SELECT') AS authenticated, has_table_privilege('service_role', $1, 'SELECT') AS service", [view]);
      assert.deepEqual(rows[0], { anon: false, authenticated: false, service: true }, view);
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        await assert.rejects(db.query(`SELECT * FROM public.${view}`), /permission denied/);
        await db.exec("RESET ROLE");
      }
      await db.exec("SET ROLE service_role");
      assert.deepEqual((await db.query(`SELECT points FROM public.${view}`)).rows, [{ points: 42 }]);
      await db.exec("RESET ROLE");
    }
  } finally { await db.close(); }
});
