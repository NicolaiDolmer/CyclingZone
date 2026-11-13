// #8129 — roadmap-pakken 13/11 koert mod den AEGTE roadmap-DDL (triggere og det
// unikke flag_key-indeks), med raekkerne i den tilstand, prod havde 13/11.
// Beviser: dubletten slipper kontakten foer den stemte raekke faar den, stemmerne
// er uroerte, anden koersel aendrer intet, og vagterne stopper hoejlydt.
//
// Harness: samme opsaetning som roadmapSyncOwnerGate.integration.test.js
// (roadmap-migrationerne raat; CREATE INDEX CONCURRENTLY uden noegleordet,
// fordi PGlite koerer i en implicit transaktion).

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestDb, readMigration } from "./createTestDb.js";

const PAKKE = "2026-11-13-8129-roadmap-pakke.sql";

const DUP = "15634206-1cae-4b9a-81c7-d7b4d5841dd8";
const VOTED = "d8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc";
const SQUAD = "136efc1d-7aca-4e85-9c7d-f11b88639198";
const RACE = "d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee";
const FOUR = {
  "00005387-0000-4000-8000-000000000202": "jersey_hunt_7855",
  "1fdf9eef-3df4-430a-850a-5e76f149e4c6": "development_xp_model",
  "ca91c33a-4e11-40f8-a7f9-b61513e67642": "training_train_now_bonus",
  "391b0555-b234-4bcb-a422-1edbbf024433": "ranking_shadow_decoupled_6765",
};
const ALL = [DUP, VOTED, SQUAD, RACE, ...Object.keys(FOUR)];
const VOTERS = [randomUUID(), randomUUID(), randomUUID()];

let db;

before(async () => {
  db = await createTestDb({ files: ["schema.sql", "2026-05-16-app-config.sql"] });
  await db.exec(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
  `);
  for (const file of [
    "2026-06-11-roadmap-items-votes.sql",
    "2026-06-20-roadmap-shipped-history.sql",
    "2026-09-07-3457-roadmap-anon-read.sql",
    "2026-10-05-5387-roadmap-hub.sql",
  ]) {
    await db.exec(readMigration(file));
  }
  await db.exec(readMigration("2026-10-15-6693-roadmap-sync-owner-gate.sql").replace(/INDEX CONCURRENTLY/g, "INDEX"));
  for (const file of ["2026-11-04-7666-roadmap-horizons.sql", "2026-11-08-7895-roadmap-saesonnumre.sql"]) {
    await db.exec(readMigration(file));
  }
  for (const [i, id] of VOTERS.entries()) {
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await db.query("INSERT INTO public.users (id, email, username) VALUES ($1, $2, $3)", [id, `v${i}@example.test`, `v${i}`]);
  }
});

after(async () => {
  if (db) await db.close();
});

async function setFlag(key, stage) {
  await db.query(
    "INSERT INTO app_config (key, value) VALUES ($1, to_jsonb($2::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, stage],
  );
}

/** Tilstanden i prod 13/11 foer pakken (laest read-only). */
async function seedProdState() {
  await db.exec("DELETE FROM roadmap_votes; DELETE FROM roadmap_items;");
  await setFlag("tactics_ready_7864", "beta");
  for (const key of ["race_page_v6", ...Object.values(FOUR)]) await setFlag(key, "off");
  const row = (id, status, horizon, flagKey = null, issueRef = null) =>
    db.query(
      `INSERT INTO roadmap_items (id, engine, title_en, title_da, approved, status, horizon, flag_key, issue_ref)
       VALUES ($1, 'races', 'Same text', 'Samme tekst', true, $2, $3, $4, $5)`,
      [id, status, horizon, flagKey, issueRef],
    );
  await row(DUP, "in_progress", "unscheduled", "tactics_ready_7864", 7864);
  await row(VOTED, "in_progress", "this_week", null, 7864);
  await db.query("UPDATE roadmap_items SET beta_soon = true WHERE id = $1", [VOTED]);
  await row(SQUAD, "in_progress", "this_week", null, 8034);
  await row(RACE, "planned", "this_week", null, 7778);
  for (const id of Object.keys(FOUR)) await row(id, "in_progress", "this_week");
  for (const uid of VOTERS) {
    await db.query("INSERT INTO roadmap_votes (item_id, user_id, importance_score) VALUES ($1, $2, 5)", [VOTED, uid]);
  }
  await db.query("INSERT INTO roadmap_votes (item_id, user_id, importance_score) VALUES ($1, $2, 4)", [RACE, VOTERS[0]]);
}

async function rows() {
  const { rows: r } = await db.query("SELECT * FROM roadmap_items WHERE id = ANY($1::uuid[]) ORDER BY id", [ALL]);
  return Object.fromEntries(r.map((x) => [x.id, x]));
}
async function votes() {
  const { rows: r } = await db.query("SELECT item_id, user_id, idea_score, importance_score FROM roadmap_votes ORDER BY item_id, user_id");
  return r;
}
async function runPakke() {
  try {
    await db.exec(readMigration(PAKKE));
  } catch (err) {
    await db.exec("ROLLBACK").catch(() => {});
    throw err;
  }
}

test("pakken: dubletten arkiveres uden kontakt, den stemte raekke faar den, og ejerens fire valg staar", async () => {
  await seedProdState();
  const votesBefore = await votes();
  await runPakke();
  const r = await rows();

  assert.equal(r[DUP].status, "archived");
  assert.equal(r[DUP].flag_key, null);
  assert.equal(r[VOTED].flag_key, "tactics_ready_7864");
  assert.equal(r[VOTED].status, "in_progress");
  assert.equal(r[VOTED].beta_soon, false);
  assert.equal(new Date(r[VOTED].beta_since).toISOString(), "2026-11-12T18:02:01.555Z");
  assert.deepEqual([r[SQUAD].status, r[SQUAD].horizon, r[SQUAD].flag_key], ["planned", "next_week", null]);
  assert.deepEqual([r[RACE].status, r[RACE].horizon, r[RACE].flag_key], ["in_progress", "this_week", "race_page_v6"]);
  for (const [id, flag] of Object.entries(FOUR)) {
    assert.deepEqual([r[id].status, r[id].horizon, r[id].flag_key, r[id].beta_since], ["in_progress", "this_week", flag, null], id);
  }
  // Ingen tekst aendret, stemmerne uroerte, ingen kontakt paa to raekker.
  for (const id of ALL) assert.deepEqual([r[id].title_en, r[id].title_da], ["Same text", "Samme tekst"], id);
  assert.deepEqual(await votes(), votesBefore);
  const dupFlags = await db.query("SELECT flag_key FROM roadmap_items WHERE flag_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1");
  assert.equal(dupFlags.rows.length, 0);
});

test("pakken er idempotent: anden koersel aendrer intet (heller ikke updated_at)", async () => {
  const before1 = await rows();
  await runPakke();
  assert.deepEqual(await rows(), before1);
});

test("vagt: en af de fire kontakter staar paa on -> stopper, intet aendres", async () => {
  await seedProdState();
  await setFlag("jersey_hunt_7855", "on");
  const before1 = await rows();
  await assert.rejects(runPakke, /kontakt mangler eller staar paa on: jersey_hunt_7855/);
  assert.deepEqual(await rows(), before1);
});

test("vagt: dubletten har faaet en stemme -> stopper", async () => {
  await seedProdState();
  await db.query("INSERT INTO roadmap_votes (item_id, user_id, importance_score) VALUES ($1, $2, 3)", [DUP, VOTERS[1]]);
  await assert.rejects(runPakke, /dubletten har faaet stemmer/);
  assert.equal((await rows())[DUP].flag_key, "tactics_ready_7864");
});

test("vagt: en anden raekke baerer allerede en af kontakterne -> stopper", async () => {
  await seedProdState();
  await db.query(
    "INSERT INTO roadmap_items (engine, title_en, title_da, status, flag_key) VALUES ('races', 'x', 'x', 'planned', 'race_page_v6')",
  );
  await assert.rejects(runPakke, /kontakten staar paa en anden raekke: race_page_v6/);
  assert.equal((await rows())[RACE].flag_key, null);
});

test("vagt: holdplanernes kontakt er slukket -> stopper", async () => {
  await seedProdState();
  await setFlag("tactics_ready_7864", "off");
  await assert.rejects(runPakke, /holdplanernes kontakt er ikke beta\/on/);
});
