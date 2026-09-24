// #5647 (Y7 / plan S4 + S5) · Ungdomsstillingen og ungdoms-rytterranglisten.
//
// Del 1 kører mod en ÆGTE Postgres-motor (PGlite, in-memory) med de ÆGTE
// committede migrationer (database/2026-09-25-4620-youth-season-standings.sql og
// -youth-rider-rankings-mv.sql oven på S1-skemaet). Den beviser:
//   1. Genberegning: point, sejre, podier, løb og placering pr. gruppe er rigtige.
//   2. Seniorløb (og den anden ungdomstrup) tæller ALDRIG med i stillingen.
//   3. Idempotens: samme kald to gange giver samme rækker.
//   4. Hold der ikke længere hører til (ingen gruppe, ingen resultater) fjernes;
//      parkerede hold uden resultater står ikke i stillingen.
//   5. RPC'en kræver service_role og afviser 'senior' som trup.
//   6. youth_rider_rankings_mv tæller kun ungdomsløb; seniorlisten er urørt.
//   7. refreshYouthStandings (JS) → RPC → tabel hele vejen, og seniorstillingen
//      (season_standings) røres ikke.
// Del 2 er rene enhedstests af JS-kontrakten (best-effort, skip, fejl-udfald).

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createTestDb, RESULT_AGGREGATE_SCHEMA_FILES } from "./testdb/createTestDb.js";
import {
  refreshYouthStandings,
  listYouthStandings,
  isYouthSquad,
  YOUTH_SQUADS,
  YOUTH_STANDINGS_COLUMNS,
} from "./youthStandings.js";

const YOUTH_STANDINGS_FILES = [
  ...RESULT_AGGREGATE_SCHEMA_FILES,
  "2026-09-04-4753-team-retired-at.sql",
  "2026-09-25-4620-youth-season-standings.sql",
  "2026-09-25-4620-youth-rider-rankings-mv.sql",
];

const AS_SERVICE_ROLE =
  "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$";
const AS_NO_ROLE = "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$";

async function one(conn, sql, params) {
  return (await conn.query(sql, params)).rows[0];
}

// Mini-supabase oven på PGlite: kun de to kald refreshYouthStandings bruger.
function pgliteSupabase(conn) {
  return {
    from(table) {
      assert.equal(table, "races");
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push([column, value]); return builder; },
        async maybeSingle() {
          assert.deepEqual(filters.map(([c]) => c), ["id"]);
          const row = await one(conn, "SELECT id, season_id, squad FROM races WHERE id = $1", [filters[0][1]]);
          return { data: row ?? null, error: null };
        },
      };
      return builder;
    },
    async rpc(name, args) {
      assert.equal(name, "recompute_youth_season_standings");
      try {
        const row = await one(conn, "SELECT public.recompute_youth_season_standings($1, $2) AS r", [args.p_season_id, args.p_squad]);
        return { data: row.r, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
    },
  };
}

// ── Fixture ────────────────────────────────────────────────────────────────────
// Én seniorpulje, to U23-grupper (G1, G2) og én juniorgruppe. Hold A og B i G1,
// Hold C i G2, Hold D parkeret (ingen seniorpulje) men med en U23-gruppe.
// Et U23-etapeløb i G1 (A vinder etape 1 + GC, B vinder etape 2), et U23-endagsløb
// i G2 (C vinder), et seniorløb og et juniorløb med store point til Hold B, som
// ikke må tælle i U23-stillingen.
async function seed(conn) {
  const season = (await one(conn, "INSERT INTO seasons (number, status) VALUES (4, 'active') RETURNING id")).id;
  const senior = (await one(conn, "INSERT INTO league_divisions (tier, pool_index, label, squad) VALUES (1, 0, 'Pulje', 'senior') RETURNING id")).id;
  const g1 = (await one(conn, "INSERT INTO league_divisions (tier, pool_index, label, squad) VALUES (1, 0, 'U23 G1', 'u23') RETURNING id")).id;
  const g2 = (await one(conn, "INSERT INTO league_divisions (tier, pool_index, label, squad) VALUES (1, 1, 'U23 G2', 'u23') RETURNING id")).id;
  const j1 = (await one(conn, "INSERT INTO league_divisions (tier, pool_index, label, squad) VALUES (1, 0, 'Junior G1', 'junior') RETURNING id")).id;

  const team = async (name, pool, u23, junior) =>
    (await one(
      conn,
      `INSERT INTO teams (name, is_ai, division, league_division_id, u23_league_division_id, junior_league_division_id)
       VALUES ($1, false, 1, $2, $3, $4) RETURNING id`,
      [name, pool, u23, junior],
    )).id;
  const teamA = await team("Hold A", senior, g1, j1);
  const teamB = await team("Hold B", senior, g1, j1);
  const teamC = await team("Hold C", senior, g2, null);
  const teamD = await team("Hold D", null, g2, null); // parkeret: ingen seniorpulje

  const rider = async (last, teamId, squad) =>
    (await one(
      conn,
      "INSERT INTO riders (firstname, lastname, team_id, nationality_code, squad) VALUES ('Rytter', $1, $2, 'DK', $3) RETURNING id",
      [last, teamId, squad],
    )).id;
  const uA = await rider("Alfa", teamA, "u23");
  const uB = await rider("Bravo", teamB, "u23");
  const uC = await rider("Charlie", teamC, "u23");
  const sB = await rider("Senior", teamB, "senior");
  const jB = await rider("Junior", teamB, "junior");

  const race = async (name, type, stages, squad, pool) =>
    (await one(
      conn,
      `INSERT INTO races (season_id, name, race_type, stages, status, squad, league_division_id)
       VALUES ($1, $2, $3, $4, 'completed', $5, $6) RETURNING id`,
      [season, name, type, stages, squad, pool],
    )).id;
  const u23Stage = await race("U23-etapeløbet", "stage_race", 2, "u23", g1);
  const u23Single = await race("U23-endagsløbet", "single", 1, "u23", g2);
  const seniorRace = await race("Seniorløbet", "single", 1, "senior", senior);
  const juniorRace = await race("Juniorløbet", "single", 1, "junior", j1);

  const res = (raceId, stage, type, rank, riderId, teamId, pts) =>
    conn.query(
      `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, team_id, points_earned, prize_money)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [raceId, stage, type, rank, riderId, teamId, pts],
    );
  // U23-etapeløbet (G1): A vinder etape 1 og GC, B vinder etape 2 og er 2 i GC.
  await res(u23Stage, 1, "stage", 1, uA, teamA, 20);
  await res(u23Stage, 1, "stage", 2, uB, teamB, 10);
  await res(u23Stage, 2, "stage", 1, uB, teamB, 20);
  await res(u23Stage, 2, "stage", 2, uA, teamA, 10);
  await res(u23Stage, 2, "gc", 1, uA, teamA, 50);
  await res(u23Stage, 2, "gc", 2, uB, teamB, 30);
  await res(u23Stage, 2, "team", 1, null, teamB, 5); // holdkonkurrence tilskrives via team_id
  // Resultat uden team_id: tilskrives rytterens hold (som senior).
  await res(u23Stage, 2, "points", 1, uA, null, 4);
  // U23-endagsløbet (G2): C vinder.
  await res(u23Single, 1, "gc", 1, uC, teamC, 40);
  // Seniorløb + juniorløb: store point til Hold B, må ikke tælle i U23.
  await res(seniorRace, 1, "gc", 1, sB, teamB, 999);
  await res(juniorRace, 1, "gc", 1, jB, teamB, 777);

  return { season, senior, g1, g2, j1, teamA, teamB, teamC, teamD, uA, uB, uC, sB, jB, u23Stage, u23Single, seniorRace, juniorRace };
}

async function standings(conn, season, squad) {
  return (
    await conn.query(
      `SELECT team_id, league_division_id, total_points, wins, podiums, races, rank_in_pool
       FROM youth_season_standings WHERE season_id = $1 AND squad = $2
       ORDER BY league_division_id, rank_in_pool`,
      [season, squad],
    )
  ).rows;
}

async function recompute(conn, season, squad) {
  return (await one(conn, "SELECT public.recompute_youth_season_standings($1, $2) AS r", [season, squad])).r;
}

describe("PGlite: youth_season_standings + recompute_youth_season_standings", () => {
  let db;
  before(async () => {
    db = await createTestDb({ files: YOUTH_STANDINGS_FILES });
  });
  after(async () => {
    if (db) await db.close();
  });
  beforeEach(async () => {
    await db.exec(
      "TRUNCATE youth_season_standings, race_results, races, season_standings, riders, teams, seasons, league_divisions CASCADE",
    );
    await db.exec(AS_SERVICE_ROLE);
  });

  test("genberegning: point, sejre, podier, løb og placering pr. U23-gruppe; seniorløb og juniorløb tæller ikke", async () => {
    const f = await seed(db);
    const result = await recompute(db, f.season, "u23");
    assert.equal(result.squad, "u23");
    assert.equal(result.rows_updated, 3, "A, B og C; parkeret Hold D uden resultater udelades");

    const rows = await standings(db, f.season, "u23");
    const byTeam = Object.fromEntries(rows.map((r) => [r.team_id, r]));
    // Hold A: 20 + 10 + 50 + 4 (points-trøje uden team_id → rytterens hold).
    assert.deepEqual(
      { ...byTeam[f.teamA], team_id: undefined },
      { team_id: undefined, league_division_id: f.g1, total_points: 84, wins: 2, podiums: 3, races: 1, rank_in_pool: 1 },
    );
    // Hold B: 10 + 20 + 30 + 5 (holdkonkurrence). Seniorens 999 og juniorens 777 er IKKE med.
    assert.deepEqual(
      { ...byTeam[f.teamB], team_id: undefined },
      { team_id: undefined, league_division_id: f.g1, total_points: 65, wins: 1, podiums: 3, races: 1, rank_in_pool: 2 },
    );
    // Hold C står alene i G2 og er nr. 1 dér (placering er PR. GRUPPE).
    assert.equal(byTeam[f.teamC].league_division_id, f.g2);
    assert.equal(byTeam[f.teamC].total_points, 40);
    assert.equal(byTeam[f.teamC].rank_in_pool, 1);
    assert.equal(byTeam[f.teamD], undefined, "parkeret hold uden resultater står ikke i stillingen");
  });

  test("hold i en gruppe uden resultater står med 0 point", async () => {
    const f = await seed(db);
    await db.query("UPDATE teams SET league_division_id = $1 WHERE id = $2", [f.senior, f.teamD]); // ikke længere parkeret
    await recompute(db, f.season, "u23");
    const d = (await standings(db, f.season, "u23")).find((r) => r.team_id === f.teamD);
    assert.deepEqual(
      { ...d, team_id: undefined },
      { team_id: undefined, league_division_id: f.g2, total_points: 0, wins: 0, podiums: 0, races: 0, rank_in_pool: 2 },
    );
  });

  test("juniorstillingen tæller kun juniorløb og er adskilt fra U23", async () => {
    const f = await seed(db);
    await recompute(db, f.season, "junior");
    const rows = await standings(db, f.season, "junior");
    const b = rows.find((r) => r.team_id === f.teamB);
    assert.equal(b.total_points, 777);
    assert.equal(b.league_division_id, f.j1);
    assert.equal(rows.find((r) => r.team_id === f.teamC), undefined, "Hold C har ingen juniorgruppe og ingen juniorresultater");
    assert.equal((await standings(db, f.season, "u23")).length, 0, "juniorkørslen skriver ikke U23-rækker");
  });

  test("idempotens: to kald i træk giver identiske rækker (også id)", async () => {
    const f = await seed(db);
    await recompute(db, f.season, "u23");
    const first = (await db.query("SELECT id, team_id, total_points, wins, podiums, races, rank_in_pool FROM youth_season_standings ORDER BY team_id")).rows;
    await recompute(db, f.season, "u23");
    const second = (await db.query("SELECT id, team_id, total_points, wins, podiums, races, rank_in_pool FROM youth_season_standings ORDER BY team_id")).rows;
    assert.deepEqual(second, first);
  });

  test("et nyt resultat genberegnes ind; et hold uden gruppe og uden resultater fjernes", async () => {
    const f = await seed(db);
    await recompute(db, f.season, "u23");
    // C mister sin gruppe OG sit eneste resultat → rækken skal væk.
    await db.query("DELETE FROM race_results WHERE race_id = $1", [f.u23Single]);
    await db.query("UPDATE teams SET u23_league_division_id = NULL WHERE id = $1", [f.teamC]);
    // B får en ny etapesejr → overhaler A.
    await db.query(
      "INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, team_id, points_earned, prize_money) VALUES ($1, 3, 'stage', 1, $2, $3, 30, 0)",
      [f.u23Stage, f.uB, f.teamB],
    );
    const result = await recompute(db, f.season, "u23");
    assert.equal(result.rows_deleted, 1);
    const rows = await standings(db, f.season, "u23");
    assert.deepEqual(rows.map((r) => [r.team_id, r.total_points, r.rank_in_pool]), [
      [f.teamB, 95, 1],
      [f.teamA, 84, 2],
    ]);
  });

  test("et hold med resultater men uden gruppe beholder sine point (egen 'uden gruppe'-placering)", async () => {
    const f = await seed(db);
    await db.query("UPDATE teams SET u23_league_division_id = NULL WHERE id = $1", [f.teamC]);
    await recompute(db, f.season, "u23");
    const c = (await standings(db, f.season, "u23")).find((r) => r.team_id === f.teamC);
    assert.equal(c.league_division_id, null);
    assert.equal(c.total_points, 40);
    assert.equal(c.rank_in_pool, 1);
  });

  test("RPC'en kræver service_role og afviser 'senior' og ukendte trupper", async () => {
    const f = await seed(db);
    await assert.rejects(recompute(db, f.season, "senior"), /invalid youth squad/);
    await assert.rejects(recompute(db, f.season, "u19"), /invalid youth squad/);
    await db.exec(AS_NO_ROLE);
    await assert.rejects(recompute(db, f.season, "u23"), /forbidden/);
  });

  test("refreshYouthStandings → RPC → tabel; seniorstillingen (season_standings) røres ikke; seniorløb er no-op", async () => {
    const f = await seed(db);
    const supabase = pgliteSupabase(db);
    const before = (await db.query("SELECT count(*)::int AS n FROM season_standings")).rows[0].n;

    const senior = await refreshYouthStandings({ supabase, raceId: f.seniorRace });
    assert.deepEqual(senior, { status: "skipped", reason: "senior", raceId: f.seniorRace });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM youth_season_standings")).rows[0].n, 0);

    const updated = await refreshYouthStandings({ supabase, raceId: f.u23Stage });
    assert.equal(updated.status, "updated");
    assert.equal(updated.squad, "u23");
    assert.equal(updated.seasonId, f.season);
    assert.equal(updated.result.rows_updated, 3);
    const again = await refreshYouthStandings({ supabase, raceId: f.u23Stage });
    assert.deepEqual(again.result, updated.result, "idempotent gennem JS-laget");

    assert.equal((await db.query("SELECT count(*)::int AS n FROM season_standings")).rows[0].n, before);
  });

  test("youth_rider_rankings_mv: kun ungdomsløb, nøgle pr. trup; seniorens rider_rankings_mv er urørt", async () => {
    const f = await seed(db);
    await db.exec("SELECT public.refresh_youth_rider_rankings_mv()");
    await db.exec("REFRESH MATERIALIZED VIEW public.rider_rankings_mv");
    const youth = (await db.query("SELECT rider_id, squad, points::int AS points, stage_wins::int AS sw, gc_wins::int AS gw, classic_wins::int AS cw FROM youth_rider_rankings_mv WHERE season_id = $1 ORDER BY points DESC", [f.season])).rows;
    assert.deepEqual(youth, [
      { rider_id: f.jB, squad: "junior", points: 777, sw: 0, gw: 0, cw: 1 },
      { rider_id: f.uA, squad: "u23", points: 84, sw: 1, gw: 1, cw: 0 },
      { rider_id: f.uB, squad: "u23", points: 60, sw: 1, gw: 0, cw: 0 },
      { rider_id: f.uC, squad: "u23", points: 40, sw: 0, gw: 0, cw: 1 },
    ]);
    assert.equal(youth.find((r) => r.rider_id === f.sB), undefined, "seniorrytteren står ikke i ungdomslisten");
    const senior = (await db.query("SELECT rider_id FROM rider_rankings_mv WHERE season_id = $1", [f.season])).rows;
    assert.deepEqual(senior.map((r) => r.rider_id), [f.sB], "kun seniorløbet i seniorlisten");
  });

  test("migrationerne kan køres to gange (auto-migrate-sikre)", async () => {
    const again = await createTestDb({
      files: [...YOUTH_STANDINGS_FILES, "2026-09-25-4620-youth-season-standings.sql", "2026-09-25-4620-youth-rider-rankings-mv.sql"],
    });
    await again.close();
  });
});

// ── Del 2: JS-kontrakten ─────────────────────────────────────────────────────────

function mockSupabase({ race = null, raceError = null, rpcResult = { rows_updated: 3 }, rpcError = null } = {}) {
  const calls = { from: [], rpc: [] };
  return {
    calls,
    from(table) {
      calls.from.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: race, error: raceError }; },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return { data: rpcError ? null : rpcResult, error: rpcError };
    },
  };
}

const SEASON = "00000000-0000-0000-0000-000000000004";

test("isYouthSquad: kun u23 og junior", () => {
  assert.deepEqual([...YOUTH_SQUADS], ["u23", "junior"]);
  assert.equal(isYouthSquad("u23"), true);
  assert.equal(isYouthSquad("junior"), true);
  assert.equal(isYouthSquad("senior"), false);
  assert.equal(isYouthSquad(null), false);
});

test("refreshYouthStandings: seniorløb og løb uden trup kalder aldrig RPC'en", async () => {
  for (const squad of ["senior", null]) {
    const supabase = mockSupabase({ race: { id: "r1", season_id: SEASON, squad } });
    const out = await refreshYouthStandings({ supabase, raceId: "r1" });
    assert.deepEqual(out, { status: "skipped", reason: "senior", raceId: "r1" });
    assert.equal(supabase.calls.rpc.length, 0);
  }
});

test("refreshYouthStandings: ungdomsløb kalder RPC'en med sæson og trup", async () => {
  const supabase = mockSupabase({ race: { id: "r2", season_id: SEASON, squad: "junior" } });
  const out = await refreshYouthStandings({ supabase, raceId: "r2" });
  assert.deepEqual(supabase.calls.rpc, [{ name: "recompute_youth_season_standings", args: { p_season_id: SEASON, p_squad: "junior" } }]);
  assert.deepEqual(out, { status: "updated", raceId: "r2", seasonId: SEASON, squad: "junior", result: { rows_updated: 3 } });
});

test("refreshYouthStandings: medsendt løbsrække sparer opslaget", async () => {
  const supabase = mockSupabase();
  const out = await refreshYouthStandings({ supabase, raceId: "r3", race: { id: "r3", season_id: SEASON, squad: "u23" } });
  assert.equal(out.status, "updated");
  assert.equal(supabase.calls.from.length, 0);
});

test("refreshYouthStandings: ukendt løb springes over", async () => {
  const supabase = mockSupabase({ race: null });
  assert.deepEqual(await refreshYouthStandings({ supabase, raceId: "nope" }), { status: "skipped", reason: "race_not_found", raceId: "nope" });
});

test("refreshYouthStandings: manglende RPC (migration ikke applied) giver 'unavailable' uden Sentry", async () => {
  const captured = [];
  const supabase = mockSupabase({
    race: { id: "r4", season_id: SEASON, squad: "u23" },
    rpcError: { code: "PGRST202", message: "Could not find the function" },
  });
  const out = await refreshYouthStandings({ supabase, raceId: "r4", captureExceptionFn: (e) => captured.push(e) });
  assert.deepEqual(out, { status: "unavailable", raceId: "r4", squad: "u23" });
  assert.equal(captured.length, 0);
});

test("refreshYouthStandings: databasefejl kastes aldrig videre, men rapporteres", async () => {
  const captured = [];
  for (const supabase of [
    mockSupabase({ race: { id: "r5", season_id: SEASON, squad: "u23" }, rpcError: { code: "57014", message: "statement timeout" } }),
    mockSupabase({ raceError: { message: "connection reset" } }),
  ]) {
    const out = await refreshYouthStandings({ supabase, raceId: "r5", captureExceptionFn: (e, ctx) => captured.push({ e, ctx }) });
    assert.equal(out.status, "error");
    assert.equal(out.raceId, "r5");
  }
  assert.equal(captured.length, 2);
  assert.equal(captured[0].ctx.tags.lib, "youthStandings");
  assert.equal((await refreshYouthStandings({})).status, "error", "manglende argumenter kaster heller ikke");
});

test("listYouthStandings: fast projektion, filtre og sortering pr. gruppe og placering", async () => {
  const seen = [];
  const supabase = {
    from(table) {
      const q = { table, eq: [], order: [], range: null };
      seen.push(q);
      const builder = {
        select(cols) { q.select = cols; return builder; },
        eq(c, v) { q.eq.push([c, v]); return builder; },
        order(c, o = {}) { q.order.push([c, o.ascending !== false, o.nullsFirst]); return builder; },
        range(a, b) { q.range = [a, b]; return Promise.resolve({ data: [{ team_id: "t1" }], error: null }); },
      };
      return builder;
    },
  };
  const rows = await listYouthStandings({ supabase, seasonId: SEASON, squad: "u23", leagueDivisionId: 7 });
  assert.deepEqual(rows, [{ team_id: "t1" }]);
  assert.equal(seen[0].table, "youth_season_standings");
  assert.equal(seen[0].select, YOUTH_STANDINGS_COLUMNS);
  assert.deepEqual(seen[0].eq, [["season_id", SEASON], ["squad", "u23"], ["league_division_id", 7]]);
  assert.deepEqual(seen[0].order.map(([c]) => c), ["league_division_id", "rank_in_pool", "team_id"]);

  await listYouthStandings({ supabase, seasonId: SEASON, squad: "junior" });
  assert.deepEqual(seen[1].eq, [["season_id", SEASON], ["squad", "junior"]], "uden gruppe: alle grupper");

  await assert.rejects(listYouthStandings({ supabase, seasonId: SEASON, squad: "senior" }), /invalid youth squad/);
  await assert.rejects(listYouthStandings({ supabase, squad: "u23" }), /seasonId is required/);
});
