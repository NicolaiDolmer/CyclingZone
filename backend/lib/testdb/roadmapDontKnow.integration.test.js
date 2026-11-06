// #7788 — beviser at DATABASEN holder reglerne bag Ved ikke: svaret kan gives på
// idéer og planlagte punkter, det tæller ikke i snit, stemmetal eller admin-tal,
// og en halv stemme kan ikke gemmes.
//
// Harness: samme PGlite-opsætning som roadmapHub.integration.test.js, med de ægte
// migrationer loadet råt, fordi det er policies og GRANTs der testes.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestDb, readMigration } from "./createTestDb.js";

const MIGRATION = "2026-11-06-7788-roadmap-dont-know.sql";
const EARLIER_MIGRATIONS = [
  "2026-06-11-roadmap-items-votes.sql",
  "2026-06-20-roadmap-shipped-history.sql",
  "2026-09-07-3457-roadmap-anon-read.sql",
];

const P1 = randomUUID();
const P2 = randomUUID();
const P3 = randomUUID();

let db;

const SUPABASE_SIM = `
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT coalesce(current_setting('test.is_admin', true), '') = 'true' $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
  REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT SELECT ON public.app_config TO anon, authenticated;
`;

const PRE_CUTOVER_GRANTS = `
  GRANT ALL ON public.roadmap_items, public.roadmap_votes, public.roadmap_item_scores TO anon, authenticated;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`;

before(async () => {
  db = await createTestDb({ files: ["schema.sql", "2026-05-16-app-config.sql"] });
  await db.exec(SUPABASE_SIM);
  for (const file of EARLIER_MIGRATIONS) await db.exec(readMigration(file));
  await db.exec(PRE_CUTOVER_GRANTS);
  await db.exec(readMigration("2026-10-05-5387-roadmap-hub.sql"));
  await db.exec(readMigration("2026-10-06-6221-roadmap-service-rpcs.sql"));
  await db.exec(readMigration(MIGRATION));
  // Idempotent: auto-migrate må gerne møde filen to gange.
  await db.exec(readMigration(MIGRATION));

  for (const [id, name] of [[P1, "p1"], [P2, "p2"], [P3, "p3"]]) {
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await db.query("INSERT INTO public.users (id, email, username) VALUES ($1, $2, $3)", [id, `${name}@example.test`, name]);
  }
});

after(async () => {
  if (db) await db.close();
});

function as(role, { uid = null, admin = false } = {}, fn) {
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true), set_config('test.is_admin', $2, true), set_config('request.jwt.claim.role', $3, true)",
      [uid ?? "", admin ? "true" : "false", role],
    );
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  });
}
const asPlayer = (uid, fn) => as("authenticated", { uid }, fn);
const asAdmin = (fn) => as("authenticated", { uid: P3, admin: true }, fn);
const asService = (fn) => as("service_role", {}, fn);

async function item(status = "active") {
  const { rows } = await db.query(
    "INSERT INTO roadmap_items (engine, title_en, title_da, approved, status) VALUES ('races', 'Item', 'Punkt', TRUE, $1) RETURNING id",
    [status],
  );
  return rows[0].id;
}

// Samme form som klientens PostgREST-upsert (onConflict: user_id,item_id).
function upsert(tx, itemId, userId, idea, importance) {
  return tx.query(
    `INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, item_id) DO UPDATE SET idea_score = EXCLUDED.idea_score, importance_score = EXCLUDED.importance_score`,
    [itemId, userId, idea, importance],
  );
}

const scores = async (id) => (await asAdmin((tx) => tx.query("SELECT * FROM roadmap_item_scores WHERE item_id = $1", [id]))).rows[0];

test("spilleren kan svare Ved ikke på en idé og et planlagt punkt", async () => {
  const idea = await item("active");
  const planned = await item("planned");
  await asPlayer(P1, (tx) => upsert(tx, idea, P1, null, null));
  await asPlayer(P1, (tx) => upsert(tx, planned, P1, null, null));
  const { rows } = await db.query("SELECT idea_score, importance_score FROM roadmap_votes WHERE user_id = $1 AND item_id = ANY($2)", [P1, [idea, planned]]);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.deepEqual([r.idea_score, r.importance_score], [null, null]);
});

test("Ved ikke kan skiftes til tal og tilbage, og erstatter en gammel idea_score", async () => {
  const id = await item("active");
  await asPlayer(P1, (tx) => upsert(tx, id, P1, null, null));
  await asPlayer(P1, (tx) => upsert(tx, id, P1, 5, 4));
  await asPlayer(P1, (tx) => upsert(tx, id, P1, null, null));
  const { rows } = await db.query("SELECT idea_score, importance_score FROM roadmap_votes WHERE item_id = $1", [id]);
  assert.deepEqual([rows[0].idea_score, rows[0].importance_score], [null, null]);
});

test("en halv stemme afvises, og en idé kræver fortsat begge tal", async () => {
  const id = await item("active");
  await assert.rejects(() => asPlayer(P1, (tx) => upsert(tx, id, P1, 4, null)), /roadmap_votes_dont_know_check/);
  await assert.rejects(() => asPlayer(P1, (tx) => upsert(tx, id, P1, null, 4)), /row-level security/);
});

test("1-6-CHECK'ene gælder stadig", async () => {
  const id = await item("planned");
  await assert.rejects(() => asPlayer(P1, (tx) => upsert(tx, id, P1, null, 7)), /roadmap_votes_importance_score_check/);
});

test("et låst punkt kan ikke få et Ved ikke", async () => {
  const id = await item("planned");
  await asPlayer(P1, (tx) => upsert(tx, id, P1, null, 5));
  await db.query("UPDATE roadmap_items SET status = 'in_progress' WHERE id = $1", [id]);
  await assert.rejects(() => asPlayer(P1, (tx) => upsert(tx, id, P1, null, null)));
  const { rows } = await db.query("SELECT importance_score FROM roadmap_votes WHERE item_id = $1", [id]);
  assert.equal(rows[0].importance_score, 5);
});

test("roadmap_item_scores: Ved ikke rører hverken snit, stemmetal eller styrings-score", async () => {
  const withDontKnow = await item("active");
  const without = await item("active");
  for (const id of [withDontKnow, without]) {
    await asPlayer(P1, (tx) => upsert(tx, id, P1, 6, 2));
    await asPlayer(P2, (tx) => upsert(tx, id, P2, 2, 5));
  }
  await asPlayer(P3, (tx) => upsert(tx, withDontKnow, P3, null, null));

  const a = await scores(withDontKnow);
  const b = await scores(without);
  for (const col of ["votes", "avg_idea", "avg_importance", "steering_score", "idea_votes", "sd_importance"]) {
    assert.equal(String(a[col]), String(b[col]), col);
  }
  assert.equal(Number(a.votes), 2);
  assert.equal(Number(a.dont_know), 1);
  assert.equal(Number(b.dont_know), 0);
});

test("roadmap_item_scores: et punkt uden stemmer eller med lutter Ved ikke har ingen snit", async () => {
  const empty = await scores(await item("active"));
  assert.equal(Number(empty.votes), 0);
  assert.equal(Number(empty.dont_know), 0);

  const id = await item("planned");
  await asPlayer(P1, (tx) => upsert(tx, id, P1, null, null));
  const only = await scores(id);
  assert.equal(Number(only.votes), 0);
  assert.equal(Number(only.dont_know), 1);
  assert.equal(only.avg_importance, null);
  assert.equal(only.steering_score, null);
});

test("roadmap_admin_stats: Ved ikke tæller ikke som stemme, men punktet er besvaret", async () => {
  await db.query("DELETE FROM roadmap_votes");
  await db.query("UPDATE roadmap_items SET status = 'archived'");
  const a = await item("active");
  const b = await item("planned");

  await asPlayer(P1, (tx) => upsert(tx, a, P1, 5, 4));
  await asPlayer(P1, (tx) => upsert(tx, b, P1, null, null));
  await asPlayer(P2, (tx) => upsert(tx, a, P2, null, null));

  const { rows: [stats] } = await asService((tx) => tx.query("SELECT * FROM roadmap_admin_stats()"));
  assert.equal(stats.voters, 1, "kun den med tal har stemt");
  assert.equal(stats.voters_14d, 1);
  assert.equal(stats.votes_total, 1);
  assert.equal(stats.voted_all, 1, "Ved ikke på det sidste punkt er stadig svar på alt");
});

test("roadmap_admin_stats er stadig kun for service_role", async () => {
  await assert.rejects(() => asAdmin((tx) => tx.query("SELECT * FROM roadmap_admin_stats()")), /permission denied/);
});
