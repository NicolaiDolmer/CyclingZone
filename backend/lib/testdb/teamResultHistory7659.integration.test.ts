import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const migration = new URL("../../../database/manual/2026-11-18-7659-team-results-page.sql", import.meta.url);

test("#7659: page-first history retains row permissions, missing embeds and page order", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE races (id uuid PRIMARY KEY, name text, race_type text, squad text, season_id uuid);
      CREATE TABLE seasons (id uuid PRIMARY KEY, number integer);
      CREATE TABLE riders (id uuid PRIMARY KEY, firstname text, lastname text, private_value text);
      CREATE TABLE race_results (
        id uuid PRIMARY KEY, team_id uuid, rank integer, result_type text, stage_number integer,
        points_earned integer, prize_money bigint, rider_name text, rider_id uuid, race_id uuid
      );
      GRANT SELECT ON race_results, races, seasons TO anon, authenticated, service_role;
      GRANT SELECT (id, firstname, lastname) ON riders TO anon, authenticated, service_role;
      ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rider_read ON riders FOR SELECT USING (firstname <> 'Hidden');
      ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
      CREATE POLICY season_read ON seasons FOR SELECT USING (number <> 2);
      ALTER TABLE race_results ENABLE ROW LEVEL SECURITY;
      CREATE POLICY team_read ON race_results FOR SELECT USING (team_id::text = current_setting('test.team_id', true));
      INSERT INTO seasons VALUES ('${id(20)}', 1), ('${id(21)}', 2);
      INSERT INTO riders VALUES ('${id(30)}', 'Ada', 'Test', 'private'), ('${id(31)}', 'Hidden', 'Test', 'private');
      INSERT INTO races VALUES
        ('${id(40)}', 'Race A', 'single', 'senior', '${id(20)}'),
        ('${id(41)}', 'Race B', 'stage_race', 'u23', '${id(21)}');
      INSERT INTO race_results VALUES
        ('${id(1)}', '${id(10)}', 1, 'stage', 1, 2, 10, 'Ada', '${id(30)}', '${id(40)}'),
        ('${id(2)}', '${id(10)}', 2, 'gc', 1, 1, 0, 'Hidden', '${id(31)}', '${id(41)}'),
        ('${id(3)}', '${id(11)}', 1, 'stage', 1, 2, 10, 'Ada', '${id(30)}', '${id(40)}');
    `);

    const sql = readFileSync(migration, "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`SET ROLE authenticated; SET test.team_id = '${id(10)}';`);

    const page = (team: number, offset: number, size: number) =>
      db.query<{ id: string; rider: unknown; race: unknown }>(
        "SELECT * FROM public.get_team_result_history_page($1, $2, $3)", [id(team), offset, size],
      );
    const first = (await page(10, 0, 1)).rows;
    const second = (await page(10, 1, 1)).rows;
    assert.deepEqual([first[0].id, second[0].id], [id(1), id(2)]);
    assert.deepEqual(first[0].rider, { id: id(30), firstname: "Ada", lastname: "Test" });
    assert.deepEqual(first[0].race, { id: id(40), name: "Race A", race_type: "single", squad: "senior", season: { number: 1 } });
    assert.deepEqual(second[0].race, { id: id(41), name: "Race B", race_type: "stage_race", squad: "u23", season: null });
    assert.equal(second[0].rider, null);
    assert.equal((await page(11, 0, 1000)).rows.length, 0);
    assert.equal((await page(10, 2, 1000)).rows.length, 0);
    assert.equal((await page(10, 0, 0)).rows.length, 0);
  } finally {
    await db.close();
  }
});
