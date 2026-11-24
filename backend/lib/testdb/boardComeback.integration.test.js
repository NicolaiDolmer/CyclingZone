import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTrustTier } from "../boardMandate.js";
import { resolveRelationSeasonAnchor } from "../boardMandateEngine.js";

const returned = "10000000-0000-0000-0000-000000000001";
const parked = "10000000-0000-0000-0000-000000000002";
const listing = "20000000-0000-0000-0000-000000000001";

test("return clears penalties from the parking sweep and withdraws a paused forced listing", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TABLE teams (id uuid PRIMARY KEY, parked_at timestamptz);
      CREATE TABLE board_profiles (team_id uuid, budget_modifier numeric, satisfaction integer DEFAULT 50);
      CREATE TABLE board_relations (
        team_id uuid PRIMARY KEY, confidence integer NOT NULL DEFAULT 50, confidence_source jsonb NOT NULL DEFAULT '{}'
      );
      CREATE TABLE board_consequences (
        team_id uuid, layer integer, status text, created_at timestamptz,
        resolved_at timestamptz, payload jsonb
      );
      CREATE TABLE transfer_listings (id uuid, seller_team_id uuid, status text);
    `);
    const seasonId = "30000000-0000-0000-0000-000000000001";
    const oldSource = { method: "weekend_update", season_anchor: { season_id: seasonId, confidence: 17 } };
    const readRelation = async (teamId) => (await db.query(
      "SELECT confidence,confidence_source FROM board_relations WHERE team_id=$1", [teamId],
    )).rows[0];
    for (const teamId of [returned, parked]) {
      await db.query("INSERT INTO teams VALUES ($1, NULL)", [teamId]);
      await db.query("INSERT INTO board_profiles VALUES ($1, 0.9, 15)", [teamId]);
      await db.query("INSERT INTO board_relations VALUES ($1, 18, $2)", [teamId, oldSource]);
      await db.query(`
        INSERT INTO board_consequences
        SELECT $1, layer, 'active',
          CASE WHEN layer IN (3, 4) THEN '2026-11-21'::timestamptz ELSE '2026-11-19'::timestamptz END,
          NULL, jsonb_build_object('listing_id', $2::text)
        FROM generate_series(2, 6) layer
      `, [teamId, listing]);
    }
    await db.query("INSERT INTO transfer_listings VALUES ($1, $2, 'paused')", [listing, returned]);

    // Season-end takes its timestamp, writes the judgment, and only then parks
    // the team using the earlier timestamp.
    await db.query("UPDATE teams SET parked_at = '2026-11-20' WHERE id IN ($1, $2)", [returned, parked]);

    const migration = await readFile(new URL("../../../database/2026-11-24-8100-board-comeback.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);

    const unpark = () => db.query(
      "UPDATE teams SET parked_at = NULL, comeback_board_season_number = 6 WHERE id = $1",
      [returned],
    );
    await unpark();
    assert.deepEqual((await db.query("SELECT team_id,satisfaction FROM board_profiles ORDER BY team_id")).rows, [
      { team_id: returned, satisfaction: 50 },
      { team_id: parked, satisfaction: 15 },
    ]);
    const neutral = await readRelation(returned);
    assert.equal(neutral.confidence, 50);
    assert.equal(getTrustTier(neutral.confidence).key, "standard");
    assert.deepEqual(neutral.confidence_source, { ...oldSource, season_anchor: { season_id: seasonId, confidence: 50 } });
    assert.deepEqual(resolveRelationSeasonAnchor(neutral, seasonId), { anchor: 50, reanchored: false });
    assert.deepEqual(resolveRelationSeasonAnchor(neutral, "30000000-0000-0000-0000-000000000002"), { anchor: 50, reanchored: true });
    assert.deepEqual(await readRelation(parked), { confidence: 18, confidence_source: oldSource });
    await db.query("UPDATE board_profiles SET satisfaction = 55 WHERE team_id = $1", [returned]);
    await db.query("UPDATE board_relations SET confidence = 57, confidence_source = $2 WHERE team_id = $1", [returned, oldSource]);
    await unpark();

    assert.equal((await db.query("SELECT satisfaction FROM board_profiles WHERE team_id = $1", [returned])).rows[0].satisfaction, 55);

    assert.deepEqual(await readRelation(returned), { confidence: 57, confidence_source: oldSource });

    const { rows: expired } = await db.query(
      "SELECT team_id, layer FROM board_consequences WHERE status = 'expired' ORDER BY layer",
    );
    assert.deepEqual(expired, [2, 3, 4, 5].map(layer => ({ team_id: returned, layer })));
    assert.equal((await db.query("SELECT status FROM transfer_listings")).rows[0].status, "withdrawn");
    const { rows: reduced } = await db.query("SELECT team_id FROM board_profiles WHERE budget_modifier < 1");
    assert.deepEqual(reduced, [{ team_id: parked }]);
  } finally {
    await db.close();
  }
});
