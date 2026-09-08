// #4818 — beviser at DATABASEN selv holder Roadmap-kategorien, ikke kun backend.
//
// Hvorfor denne test findes (CodeRabbit-fund 8/9, major): backend/lib/forum.test.js
// koerer mod createFakeSupabase, som ikke udfoerer triggere, og e2e-specen koerer mod
// mockede netvaerkssvar. Ingen af dem ville opdage at
// `forum_posts_enforce_category_post_role` var stavet forkert, aldrig blev oprettet
// eller holdt op med at binde. Triggeren er hele pointen i tre-lags-haandhaevelsen:
// den er det ENESTE lag der ogsaa binder service-role, altsaa den eneste beskyttelse
// hvis en fremtidig rute glemmer backend-tjekket.
//
// Harness: PGlite med den AEGTE committede DDL (samme moenster som de oevrige
// *.integration.test.js her i mappen). Ingen Docker, ingen prod-adgang.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestDb } from "./createTestDb.js";

// Load-raekkefoelge: base-skemaet (public.users med role), forummet, kategori-
// udvidelsen fra #4492 og til sidst #4818's egen migration.
const FORUM_SCHEMA_FILES = [
  "schema.sql",
  "2026-08-06-3199-forum.sql",
  "2026-09-04-forum-categories.sql",
  "2026-09-08-4818-forum-roadmap-category.sql",
];

const ADMIN_ID = randomUUID();
const PLAYER_ID = randomUUID();

let db;

before(async () => {
  db = await createTestDb({ files: FORUM_SCHEMA_FILES });

  // forum_posts.user_id peger paa auth.users; triggeren slaar rollen op i
  // public.users. Begge skal findes for at efterligne prod.
  for (const id of [ADMIN_ID, PLAYER_ID]) {
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  }
  await db.query(
    "INSERT INTO public.users (id, email, username, role) VALUES ($1, $2, $3, 'admin')",
    [ADMIN_ID, "admin@example.test", "dolmer"],
  );
  await db.query(
    "INSERT INTO public.users (id, email, username, role) VALUES ($1, $2, $3, 'manager')",
    [PLAYER_ID, "player@example.test", "peloton_pete"],
  );
});

after(async () => {
  if (db) await db.close();
});

function insertPost(userId, category, title) {
  return db.query(
    "INSERT INTO public.forum_posts (user_id, category, title, body) VALUES ($1, $2, $3, 'body') RETURNING id",
    [userId, category, title],
  );
}

test("migrationen har faktisk sat triggeren paa forum_posts", async () => {
  const { rows } = await db.query(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.forum_posts'::regclass
        AND tgname = 'forum_posts_enforce_category_post_role'`,
  );
  assert.equal(rows.length, 1, "triggeren skal findes efter load af migrationen");
});

test("seedet: roadmap kraever admin, de oevrige kategorier er aabne", async () => {
  const { rows } = await db.query(
    "SELECT category, post_role FROM public.forum_category_post_roles ORDER BY category",
  );
  assert.equal(rows.length, 7);
  const roles = Object.fromEntries(rows.map((r) => [r.category, r.post_role]));
  assert.equal(roles.roadmap, "admin");
  for (const category of ["general", "feedback_ideas", "questions", "tactics", "transfers", "off_topic"]) {
    assert.equal(roles[category], "everyone", category);
  }
});

test("CHECK-constrainten accepterer roadmap som kategori", async () => {
  const { rows } = await db.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.forum_posts'::regclass
        AND conname = 'forum_posts_category_check'`,
  );
  assert.match(rows[0].def, /roadmap/);
});

test("DATABASEN afviser en ikke-admins traad i roadmap", async () => {
  await assert.rejects(
    () => insertPost(PLAYER_ID, "roadmap", "Min egen roadmap"),
    (err) => {
      assert.match(err.message, /forum_category_admin_only/);
      return true;
    },
  );

  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM public.forum_posts WHERE category = 'roadmap'",
  );
  assert.equal(rows[0].n, 0, "ingen raekke maa vaere sluppet igennem");
});

test("admin kan oprette traaden — og ingen anden kategori blev laast", async () => {
  const created = await insertPost(ADMIN_ID, "roadmap", "What I am building next");
  assert.ok(created.rows[0].id);

  // Kontrolproeven: gaten maa ramme roadmap og INTET andet.
  for (const category of ["general", "feedback_ideas", "questions", "tactics", "transfers", "off_topic"]) {
    const open = await insertPost(PLAYER_ID, category, `Spiller-traad i ${category}`);
    assert.ok(open.rows[0].id, category);
  }
});

test("alle maa svare i en roadmap-traad — svar er UAENDREDE (ejer-afklaring 8/9)", async () => {
  const { rows } = await db.query(
    "SELECT id FROM public.forum_posts WHERE category = 'roadmap' LIMIT 1",
  );
  const postId = rows[0].id;

  const reply = await db.query(
    "INSERT INTO public.forum_replies (post_id, user_id, body) VALUES ($1, $2, 'Godt initiativ') RETURNING id",
    [postId, PLAYER_ID],
  );
  assert.ok(reply.rows[0].id, "en ikke-admin skal kunne svare i roadmap-traaden");
});
