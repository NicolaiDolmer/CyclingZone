// #5535 (spor S1) · Senior-resultat-aggregaterne tæller kun seniorløb — kørt mod en
// ÆGTE Postgres-motor (PGlite, in-memory) med den ÆGTE committede migration.
//
// Hvad filen beviser:
//   1. Et afgjort ungdomsløb (squad 'u23') ændrer INTET i seniorstillingen
//      (recompute_season_standings), de tre rangliste-matviews, dashboard-RPC'erne,
//      sæson-recap eller sæson-krøniken.
//   2. Kontrol: SAMME løb markeret 'senior' ændrer dem. Filteret er altså det eneste
//      der holder ungdomsresultaterne ude — ikke pulje, status eller fixture-held.
//   3. Før S1 lækker ungdomsløbet ind i matviews (fejlen findes), og S1 kan køres oven
//      på de eksisterende, udfyldte views (DROP + CREATE som i prod).
//   4. De unikke indekser er bevaret: REFRESH ... CONCURRENTLY og refresh-RPC'en virker.
//   5. Migrationen kan køres to gange (auto-migrate-sikker).
//   6. Funktionskroppene er prods (pg_get_functiondef 24/9) + kun de `#5535`-mærkede
//      linjer: md5 af kroppen uden de linjer = md5 af prods prosrc.
//   7. Grants: matviews revokes eksplicit fra PUBLIC/anon/authenticated efter
//      DROP + CREATE (#5088/#5176). PGlite stripper GRANT/REVOKE, så det er et
//      kilde-tjek; prod-tilstanden post-verificeres efter merge (se filens bund).
//
// get_rider_race_days er bevidst urørt (en løbsdag er en løbsdag uanset trup) —
// punkt 8 låser at migrationen ikke rører den.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createTestDb,
  readMigration,
  RESULT_AGGREGATE_PRE_S1_FILES,
  RESULT_AGGREGATE_SCHEMA_FILES,
} from "./testdb/createTestDb.js";
import { sanitizeForPglite } from "./testdb/sanitizeForPglite.js";

const MIGRATION_FILE = "2026-09-25-5535-senior-only-result-aggregates.sql";
const MATVIEWS = ["rider_rankings_mv", "team_standings_ext_mv", "team_race_points_mv"];
const FUNCTIONS = [
  "recompute_season_standings",
  "dashboard_rider_ranking",
  "dashboard_my_team_season_races",
  "get_season_recap",
  "get_season_documentary_facts",
];

// Supabase' auth.role() er stubbet til NULL i createTestDb. Seniorstillingen og
// dashboard-RPC'erne kræver service_role (som backenden kalder dem med).
const AS_SERVICE_ROLE =
  "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$";
const AS_NO_ROLE = "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$";

let db;
before(async () => {
  db = await createTestDb({ files: RESULT_AGGREGATE_SCHEMA_FILES });
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE race_results, races, season_standings, finance_transactions, riders, teams, seasons, league_divisions CASCADE",
  );
  await db.exec(AS_SERVICE_ROLE);
  await refreshAll(db);
});

// ── Fixture ────────────────────────────────────────────────────────────────────
// Én seniorpulje, to menneskehold (Hold A, Hold B). Seniorløbet vinder Hold A.
// Ungdomsløbet (samme pulje, samme sæson, afgjort) vindes af Hold B's U23-rytter
// med så mange point at det ville vende seniorstillingen, hvis det talte med.

const T0 = "2026-09-20T12:00:00Z";
const T1 = "2026-09-21T12:00:00Z";

async function one(conn, sql, params) {
  return (await conn.query(sql, params)).rows[0];
}

async function seedSenior(conn) {
  const season = (await one(conn, "INSERT INTO seasons (number, status) VALUES (1, 'active') RETURNING id")).id;
  const pool = (
    await one(conn, "INSERT INTO league_divisions (tier, pool_index, label) VALUES (1, 0, 'Pulje 1') RETURNING id")
  ).id;
  const teamA = (
    await one(conn, "INSERT INTO teams (name, is_ai, division, league_division_id) VALUES ('Hold A', false, 1, $1) RETURNING id", [pool])
  ).id;
  const teamB = (
    await one(conn, "INSERT INTO teams (name, is_ai, division, league_division_id) VALUES ('Hold B', false, 1, $1) RETURNING id", [pool])
  ).id;
  const riderA = (
    await one(conn, "INSERT INTO riders (firstname, lastname, team_id, nationality_code) VALUES ('Rytter', 'Alfa', $1, 'DK') RETURNING id", [teamA])
  ).id;
  const riderB = (
    await one(conn, "INSERT INTO riders (firstname, lastname, team_id, nationality_code) VALUES ('Rytter', 'Bravo', $1, 'DK') RETURNING id", [teamB])
  ).id;
  const seniorRace = (
    await one(
      conn,
      `INSERT INTO races (season_id, name, race_type, stages, status, squad, league_division_id)
       VALUES ($1, 'Seniorløbet', 'single', 1, 'completed', 'senior', $2) RETURNING id`,
      [season, pool],
    )
  ).id;
  await conn.query(
    `INSERT INTO race_results (race_id, result_type, rank, rider_id, team_id, points_earned, prize_money, imported_at) VALUES
       ($1, 'gc',   1, $2,   $4, 100, 1000, $5),
       ($1, 'gc',   2, $3,   $6,  60,  500, $5),
       ($1, 'team', 1, NULL, $4,   0,  200, $5)`,
    [seniorRace, riderA, riderB, teamA, T0, teamB],
  );
  return { season, pool, teamA, teamB, riderA, riderB, seniorRace };
}

async function addYouthRace(conn, f) {
  const youthRider = (
    await one(
      conn,
      "INSERT INTO riders (firstname, lastname, team_id, nationality_code, squad, is_academy) VALUES ('Rytter', 'Charlie', $1, 'DK', 'u23', true) RETURNING id",
      [f.teamB],
    )
  ).id;
  const youthRace = (
    await one(
      conn,
      `INSERT INTO races (season_id, name, race_type, stages, status, squad, league_division_id)
       VALUES ($1, 'U23-løbet', 'stage_race', 2, 'completed', 'u23', $2) RETURNING id`,
      [f.season, f.pool],
    )
  ).id;
  await conn.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, team_id, points_earned, prize_money, imported_at) VALUES
       ($1, 1, 'stage', 1, $2,   $3, 500, 5000, $4),
       ($1, 2, 'stage', 1, $2,   $3, 500, 5000, $4),
       ($1, 2, 'gc',    1, $2,   $3, 300, 3000, $4),
       ($1, 2, 'team',  1, NULL, $3,   0,  100, $4)`,
    [youthRace, youthRider, f.teamB, T1],
  );
  return { ...f, youthRider, youthRace };
}

async function refreshAll(conn, { concurrently = false } = {}) {
  for (const mv of MATVIEWS) {
    await conn.exec(`REFRESH MATERIALIZED VIEW ${concurrently ? "CONCURRENTLY " : ""}public.${mv}`);
  }
}

async function recompute(conn, season) {
  return (await one(conn, "SELECT public.recompute_season_standings($1) AS r", [season])).r;
}

// Alt hvad de otte senior-læsere viser for sæsonen, i en sammenlignelig form.
// updated_at udelades (now() pr. recompute-kald); alt andet er deterministisk.
async function snapshot(conn, f) {
  const rows = async (sql, params) => (await conn.query(sql, params)).rows;
  const standings = await rows(
    `SELECT team_id, division, league_division_id, total_points, stage_wins, gc_wins,
            races_completed, rank_in_division
       FROM season_standings WHERE season_id = $1 ORDER BY team_id`,
    [f.season],
  );
  const mvs = {};
  for (const mv of MATVIEWS) {
    mvs[mv] = await rows(`SELECT * FROM public.${mv} WHERE season_id = $1 ORDER BY 1, 2, 3`, [f.season]);
  }
  const riderRanking = await rows("SELECT * FROM public.dashboard_rider_ranking($1, NULL) ORDER BY points DESC, rider_id", [f.season]);
  const riderRankingPool = await rows("SELECT * FROM public.dashboard_rider_ranking($1, $2) ORDER BY points DESC, rider_id", [f.season, f.pool]);
  const myRacesB = await rows("SELECT * FROM public.dashboard_my_team_season_races($1, $2, NULL, 20)", [f.teamB, f.season]);
  const myRacesBPool = await rows("SELECT * FROM public.dashboard_my_team_season_races($1, $2, $3, 20)", [f.teamB, f.season, f.pool]);
  const recap = (await one(conn, "SELECT public.get_season_recap($1) AS r", [f.season])).r;
  const facts = (await one(conn, "SELECT public.get_season_documentary_facts($1, $2) AS r", [f.season, f.teamB])).r;
  if (facts?.myStanding) delete facts.myStanding.updated_at;
  return { standings, mvs, riderRanking, riderRankingPool, myRacesB, myRacesBPool, recap, facts };
}

async function recomputeAndSnapshot(conn, f) {
  await recompute(conn, f.season);
  await refreshAll(conn, { concurrently: true });
  return snapshot(conn, f);
}

// ── 1 + 2. Ungdomsløb ændrer intet i senior; samme løb som senior gør ─────────────

test("et afgjort U23-løb ændrer intet i nogen af de otte senior-læsere", async () => {
  const f = await seedSenior(db);
  const baseline = await recomputeAndSnapshot(db, f);

  const g = await addYouthRace(db, f);
  const withYouth = await recomputeAndSnapshot(db, g);

  assert.deepEqual(withYouth, baseline);
  // Sanity: baseline er ikke tom — seniorløbet står faktisk i hver læser.
  assert.equal(baseline.standings.length, 2);
  assert.equal(baseline.mvs.rider_rankings_mv.length, 2);
  assert.equal(baseline.mvs.team_standings_ext_mv.length, 2);
  assert.equal(baseline.mvs.team_race_points_mv.length, 2);
  assert.equal(baseline.riderRanking.length, 2);
  assert.equal(baseline.myRacesB.length, 1);
  assert.deepEqual(Object.keys(baseline.recap.team_race_prize), [f.seniorRace]);
  assert.equal(baseline.facts.biggestResult.race_name, "Seniorløbet");
});

test("kontrol: SAMME løb markeret senior ændrer stilling, matviews, dashboard, recap og krønike", async () => {
  const f = await addYouthRace(db, await seedSenior(db));
  const youthExcluded = await recomputeAndSnapshot(db, f);

  await db.query("UPDATE races SET squad = 'senior' WHERE id = $1", [f.youthRace]);
  const asSenior = await recomputeAndSnapshot(db, f);

  // Seniorstillingen vender: Hold B får ungdomsløbets point og et ekstra løb.
  const pts = (s, team) => s.standings.find((r) => r.team_id === team);
  assert.equal(pts(youthExcluded, f.teamB).total_points, 60);
  assert.equal(pts(youthExcluded, f.teamB).rank_in_division, 2);
  assert.equal(pts(youthExcluded, f.teamB).races_completed, 1);
  assert.equal(pts(asSenior, f.teamB).total_points, 60 + 1300);
  assert.equal(pts(asSenior, f.teamB).rank_in_division, 1);
  assert.equal(pts(asSenior, f.teamB).races_completed, 2);
  assert.equal(pts(asSenior, f.teamB).stage_wins, 2);

  // Hver af de otte læsere ser forskellen — ingen af dem er grøn af anden grund.
  for (const mv of MATVIEWS) {
    assert.notDeepEqual(asSenior.mvs[mv], youthExcluded.mvs[mv], `${mv} skal tælle løbet som senior`);
  }
  assert.ok(asSenior.mvs.rider_rankings_mv.some((r) => r.rider_id === f.youthRider));
  assert.ok(!youthExcluded.mvs.rider_rankings_mv.some((r) => r.rider_id === f.youthRider));
  assert.ok(asSenior.riderRanking.some((r) => r.rider_id === f.youthRider));
  assert.ok(asSenior.riderRankingPool.some((r) => r.rider_id === f.youthRider));
  assert.ok(!youthExcluded.riderRanking.some((r) => r.rider_id === f.youthRider));
  assert.equal(asSenior.myRacesB.length, 2);
  assert.equal(asSenior.myRacesBPool.length, 2);
  assert.equal(youthExcluded.myRacesB.length, 1);
  assert.ok(f.youthRace in asSenior.recap.team_race_prize);
  assert.ok(!(f.youthRace in youthExcluded.recap.team_race_prize));
  assert.equal(asSenior.recap.stage_kings[0]?.rider_id, f.youthRider);
  assert.deepEqual(youthExcluded.recap.stage_kings, []);
  assert.equal(asSenior.facts.biggestResult.race_name, "U23-løbet");
  assert.equal(youthExcluded.facts.biggestResult.race_name, "Seniorløbet");
});

test("junior-løb holdes ude på samme måde som U23", async () => {
  const f = await seedSenior(db);
  const baseline = await recomputeAndSnapshot(db, f);
  const g = await addYouthRace(db, f);
  await db.query("UPDATE races SET squad = 'junior' WHERE id = $1", [g.youthRace]);
  assert.deepEqual(await recomputeAndSnapshot(db, g), baseline);
});

// ── 3. Før S1 lækker ungdomsløbet; S1 kører oven på udfyldte views ───────────────

test("før S1 lækker U23-løbet ind i matviews — S1 oven på de udfyldte views lukker det", async () => {
  const pre = await createTestDb({ files: RESULT_AGGREGATE_PRE_S1_FILES });
  try {
    const f = await addYouthRace(pre, await seedSenior(pre));
    await refreshAll(pre);
    const leaked = await pre.query("SELECT 1 FROM public.rider_rankings_mv WHERE rider_id = $1", [f.youthRider]);
    assert.equal(leaked.rows.length, 1, "fejlen findes før S1: U23-rytteren står i senior-rytterranglisten");

    await pre.exec(sanitizeForPglite(readMigration(MIGRATION_FILE)));
    const after = await pre.query("SELECT 1 FROM public.rider_rankings_mv WHERE rider_id = $1", [f.youthRider]);
    assert.equal(after.rows.length, 0, "S1's CREATE ... WITH DATA bygger viewet uden ungdomsløbet");
    const trp = await pre.query("SELECT 1 FROM public.team_race_points_mv WHERE race_id = $1", [f.youthRace]);
    assert.equal(trp.rows.length, 0);
  } finally {
    await pre.close();
  }
});

// ── 4. Indekser + refresh-RPC ────────────────────────────────────────────────────

test("samme indekser som før S1 — tre unikke, så REFRESH CONCURRENTLY virker", async () => {
  const { rows } = await db.query(
    `SELECT indexrelid::regclass::text AS idx, indisunique AS uniq,
            pg_get_indexdef(indexrelid) AS def
       FROM pg_index
      WHERE indrelid IN ('public.rider_rankings_mv'::regclass,
                         'public.team_standings_ext_mv'::regclass,
                         'public.team_race_points_mv'::regclass)
      ORDER BY 1`,
  );
  assert.deepEqual(
    rows.map((r) => [r.idx, r.uniq]),
    [
      ["rider_rankings_mv_pk", true],
      ["rider_rankings_mv_season", false],
      ["team_race_points_mv_pk", true],
      ["team_race_points_mv_season", false],
      ["team_standings_ext_mv_pk", true],
    ],
  );
  assert.match(rows[0].def, /\(season_id, rider_id\)$/);
  assert.match(rows[1].def, /\(season_id, points DESC\)$/);
  assert.match(rows[2].def, /\(season_id, team_id, race_id\)$/);
  assert.match(rows[3].def, /\(season_id, team_id\)$/);
  assert.match(rows[4].def, /\(season_id, team_id\)$/);

  await addYouthRace(db, await seedSenior(db));
  await refreshAll(db, { concurrently: true });
  await db.query("SELECT public.refresh_ranking_matviews()");
});

test("seniorstillingens service_role-port er bevaret", async () => {
  const f = await seedSenior(db);
  await db.exec(AS_NO_ROLE);
  await assert.rejects(() => recompute(db, f.season), (err) => err?.code === "42501");
});

// ── 5. Idempotens ────────────────────────────────────────────────────────────────

test("migrationen kan køres to gange (auto-migrate-sikker)", async () => {
  const f = await addYouthRace(db, await seedSenior(db));
  const before = await recomputeAndSnapshot(db, f);
  await db.exec(sanitizeForPglite(readMigration(MIGRATION_FILE)));
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pg_matviews WHERE schemaname = 'public' AND matviewname = ANY($1) AND definition ~ 'squad'",
    [MATVIEWS],
  );
  assert.equal(rows[0].n, 3);
  const fns = await db.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)",
    [FUNCTIONS],
  );
  assert.equal(fns.rows[0].n, FUNCTIONS.length, "præcis én overload pr. funktion");
  assert.deepEqual(await recomputeAndSnapshot(db, f), before);
});

// ── 6. Funktionskroppene er prods + kun de mærkede linjer ─────────────────────────

// md5(pg_proc.prosrc) i prod, målt read-only 24/9 FØR S1 (dvs. uden filteret).
const PROD_PROSRC_MD5_BEFORE_S1 = {
  recompute_season_standings: "01cfe8a5ed3a163313388995dd680eb2",
  dashboard_rider_ranking: "438c2b4ba8693ff5c21369dbc4cc8a96",
  dashboard_my_team_season_races: "56276611d875e9bb6ec178b8ad0cb734",
  get_season_recap: "b63ac2ac0cf52e46743f0c4c4226c29e",
  get_season_documentary_facts: "ba349c3c751b050fa36681e9b68f5647",
};

test("hver funktionskrop = prods krop + kun `#5535`-linjer med senior-filteret", () => {
  const sql = readMigration(MIGRATION_FILE).replace(/\r\n/g, "\n");
  for (const [name, md5] of Object.entries(PROD_PROSRC_MD5_BEFORE_S1)) {
    const m = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    ).exec(sql);
    assert.ok(m, `${name} findes i migrationen`);
    const lines = m[1].split("\n");
    const added = lines.filter((l) => l.includes("#5535"));
    assert.ok(added.length >= 1, `${name}: mindst én mærket linje`);
    for (const l of added) assert.match(l, /\b(r|ra)\.squad = 'senior'/, `${name}: mærket linje er filteret`);
    const original = lines.filter((l) => !l.includes("#5535")).join("\n");
    assert.equal(createHash("md5").update(original, "utf8").digest("hex"), md5, `${name}: resten er byte-identisk med prod`);
  }
});

// ── 7 + 8. Grants og get_rider_race_days (kilde-tjek) ─────────────────────────────

function executableSql() {
  // Kun SQL der faktisk kører: fjern linje-kommentarer (ingen af dem står i strenge).
  return readMigration(MIGRATION_FILE).replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
}

test("matviews: REVOKE ALL fra PUBLIC, anon og authenticated EFTER sidste CREATE (#5088/#5176)", () => {
  const sql = executableSql();
  const lastCreate = sql.lastIndexOf("CREATE MATERIALIZED VIEW");
  const revoke = /REVOKE ALL ON TABLE\s+public\.rider_rankings_mv,\s+public\.team_standings_ext_mv,\s+public\.team_race_points_mv\s+FROM PUBLIC, anon, authenticated;/.exec(sql);
  assert.ok(revoke, "eksplicit REVOKE på alle tre views");
  assert.ok(revoke.index > lastCreate, "REVOKE står efter genopbygningen");
  assert.doesNotMatch(sql, /GRANT[^;]*_mv[^;]*TO[^;]*\b(anon|authenticated)\b/i, "ingen GRANT tilbage til klientrollerne");
  assert.match(sql, /\bBEGIN;[\s\S]*\bCOMMIT;/, "alt i én transaktion");
});

test("get_rider_race_days er bevidst urørt", () => {
  assert.doesNotMatch(executableSql(), /get_rider_race_days/);
});
