// Verificerer SQL-semantikken bag admin-gaten for fiktive ryttere (#669) mod en
// ægte Postgres-motor (PGlite). NULL-filtre er en klassisk fejlkilde, så vi
// fastlåser at:
//   - den brugervendte query (GET /riders) skjuler fiktive (pcm_id IS NULL),
//   - admin-vinduet (GET /admin/riders) viser KUN fiktive,
//   - de to mængder er komplementære (ingen rytter falder mellem to stole).
//
// Route-handler-branching (isViewerAdmin → 403/404 i POST /auctions + GET
// /riders/:id) verificeres LIVE efter deploy: repoet har ingen route-integration-
// test-infra (alle eksisterende tests er rene lib-unit-tests).

import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE riders (
    id SERIAL PRIMARY KEY,
    pcm_id INTEGER UNIQUE,
    firstname TEXT,
    lastname TEXT,
    is_retired BOOLEAN DEFAULT FALSE
  )`);
});
beforeEach(async () => {
  await db.exec("TRUNCATE riders RESTART IDENTITY");
  await db.exec(`INSERT INTO riders (pcm_id, firstname, lastname) VALUES
    (101, 'Real', 'One'),
    (102, 'Real', 'Two'),
    (NULL, 'Fake', 'A'),
    (NULL, 'Fake', 'B'),
    (NULL, 'Fake', 'C')`);
});

test("brugervendt filter (pcm_id IS NOT NULL) skjuler fiktive — viser kun PCM", async () => {
  const { rows } = await db.query(
    "SELECT firstname FROM riders WHERE is_retired = false AND pcm_id IS NOT NULL",
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.firstname === "Real"), "kun PCM-ryttere må slippe igennem");
});

test("admin-vindue (pcm_id IS NULL) viser KUN fiktive", async () => {
  const { rows } = await db.query(
    "SELECT firstname FROM riders WHERE is_retired = false AND pcm_id IS NULL",
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.firstname === "Fake"), "kun fiktive ryttere i admin-vinduet");
});

test("de to filtre er komplementære — ingen overlap, dækker alt ikke-retired", async () => {
  const all = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE is_retired = false");
  const pcm = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE is_retired = false AND pcm_id IS NOT NULL");
  const fic = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE is_retired = false AND pcm_id IS NULL");
  assert.equal(pcm.rows[0].n + fic.rows[0].n, all.rows[0].n, "PCM + fiktive skal summere til alle ikke-retired");
});
