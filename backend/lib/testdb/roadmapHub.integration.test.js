// #6149 (spor 1 af roadmap-hubben, #5387) — beviser at DATABASEN selv holder
// reglerne bag /roadmap: statusser, stemme-låsen, synligheden af kendte fejl,
// admin-tallene, del-punkt-RPC'en og beta-koblingen til app_config.
//
// Harness: PGlite med den ÆGTE committede DDL. Til forskel fra de øvrige
// integrationstests her i mappen loades roadmap-migrationerne RÅT (ikke via
// sanitizeForPglite), fordi det er policies, GRANTs og REVOKEs der testes.
// Supabase-laget efterlignes minimalt:
//   - auth.uid() læser request.jwt.claim.sub, is_admin() læser test.is_admin
//     (prod: SECURITY DEFINER-opslag i public.users, samme sandhedsværdi).
//   - anon har ikke EXECUTE på is_admin() (#5153).
//   - roadmap_items/roadmap_votes er fra før #2830-cutover og har fulde
//     tabel-rettigheder; nye tabeller får kun SELECT som default, og nye
//     funktioner får EXECUTE til anon+authenticated som default (Supabase'
//     ALTER DEFAULT PRIVILEGES). Migrationens egne GRANT/REVOKE skal derfor
//     selv gøre arbejdet, præcis som i prod.
// Roller simuleres med SET LOCAL ROLE + set_config(..., true) i en transaktion.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestDb, readMigration } from "./createTestDb.js";

const NEW_MIGRATION = "2026-10-05-5387-roadmap-hub.sql";
const OLD_ROADMAP_MIGRATIONS = [
  "2026-06-11-roadmap-items-votes.sql",
  "2026-06-20-roadmap-shipped-history.sql",
  "2026-09-07-3457-roadmap-anon-read.sql",
];

const ADMIN = randomUUID();
const P1 = randomUUID();
const P2 = randomUUID();

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
  for (const file of OLD_ROADMAP_MIGRATIONS) await db.exec(readMigration(file));
  await db.exec(PRE_CUTOVER_GRANTS);
  await db.exec(readMigration(NEW_MIGRATION));

  for (const [id, name] of [[ADMIN, "admin"], [P1, "p1"], [P2, "p2"]]) {
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await db.query("INSERT INTO public.users (id, email, username) VALUES ($1, $2, $3)", [id, `${name}@example.test`, name]);
  }
  await db.query("INSERT INTO public.teams (user_id, name) VALUES ($1, 'Hold A'), ($2, 'Hold B'), (NULL, 'AI-hold')", [P1, P2]);
});

after(async () => {
  if (db) await db.close();
});

// Kør fn som en rolle. Kaster fn, rulles transaktionen tilbage.
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
const asAnon = (fn) => as("anon", {}, fn);
const asPlayer = (uid, fn) => as("authenticated", { uid }, fn);
const asAdmin = (fn) => as("authenticated", { uid: ADMIN, admin: true }, fn);
const asService = (fn) => as("service_role", {}, fn);

async function item(fields = {}) {
  const f = { engine: "races", title: "Item", approved: true, status: "active", ...fields };
  const { rows } = await db.query(
    `INSERT INTO roadmap_items (engine, title_en, title_da, approved, status, flag_key)
     VALUES ($1, $2, $2, $3, $4, $5) RETURNING *`,
    [f.engine, f.title, f.approved, f.status, f.flag_key ?? null],
  );
  return rows[0];
}
async function getItem(id) {
  const { rows } = await db.query("SELECT * FROM roadmap_items WHERE id = $1", [id]);
  return rows[0];
}
async function knownIssue(fields = {}) {
  const f = { area: "races", status: "confirmed", published: true, ...fields };
  const { rows } = await db.query(
    "INSERT INTO known_issues (area, status, title_en, title_da, published) VALUES ($1, $2, 'Bug', 'Fejl', $3) RETURNING *",
    [f.area, f.status, f.published],
  );
  return rows[0];
}
function vote(tx, itemId, userId, idea, importance) {
  return tx.query(
    "INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score) VALUES ($1, $2, $3, $4)",
    [itemId, userId, idea, importance],
  );
}
async function setFlag(key, jsonValue) {
  await db.query(
    "INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, jsonValue],
  );
}

test("migrationen er idempotent: anden apply fejler ikke", async () => {
  await db.exec(readMigration(NEW_MIGRATION));
});

test("status-CHECK accepterer planned og in_progress og afviser ukendt værdi", async () => {
  assert.equal((await item({ status: "planned" })).status, "planned");
  assert.equal((await item({ status: "in_progress" })).status, "in_progress");
  await assert.rejects(() => item({ status: "someday" }), /roadmap_items_status_check/);
});

test("horizon er 'next' som default og afviser andet end next/later", async () => {
  const it = await item({ status: "planned" });
  assert.equal(it.horizon, "next");
  await db.query("UPDATE roadmap_items SET horizon = 'later' WHERE id = $1", [it.id]);
  await assert.rejects(
    () => db.query("UPDATE roadmap_items SET horizon = 'soon' WHERE id = $1", [it.id]),
    /roadmap_items_horizon_check/,
  );
});

test("anon læser godkendte active/planned/in_progress/shipped, ikke archived og ikke ikke-godkendte", async () => {
  const tag = `anon-${randomUUID()}`;
  for (const status of ["active", "planned", "in_progress", "shipped", "archived"]) {
    await item({ title: `${tag}-${status}`, status });
  }
  await item({ title: `${tag}-hidden`, status: "planned", approved: false });
  const { rows } = await asAnon((tx) =>
    tx.query("SELECT status FROM roadmap_items WHERE title_en LIKE $1 ORDER BY status", [`${tag}%`]),
  );
  assert.deepEqual(rows.map((r) => r.status), ["active", "in_progress", "planned", "shipped"]);
});

test("spiller kan stemme på et planned-punkt med kun importance_score (idea_score NULL)", async () => {
  const it = await item({ status: "planned" });
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, null, 5));
  const { rows } = await db.query("SELECT idea_score, importance_score FROM roadmap_votes WHERE item_id = $1", [it.id]);
  assert.deepEqual(rows, [{ idea_score: null, importance_score: 5 }]);
});

test("spiller kan IKKE stemme på et active-punkt uden idea_score", async () => {
  const it = await item({ status: "active" });
  await assert.rejects(() => asPlayer(P1, (tx) => vote(tx, it.id, P1, null, 5)), /row-level security/);
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, 3, 5));
});

test("spiller kan IKKE stemme på in_progress, shipped eller archived", async () => {
  for (const status of ["in_progress", "shipped", "archived"]) {
    const it = await item({ status });
    await assert.rejects(() => asPlayer(P1, (tx) => vote(tx, it.id, P1, 3, 5)), /row-level security/, status);
  }
});

test("upsert med kun importance_score bevarer en eksisterende idea_score", async () => {
  const it = await item({ status: "active" });
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, 6, 2));
  // Idéen flyttes til planen; en ny stemme skriver kun vigtighed (PostgREST-upsert).
  await db.query("UPDATE roadmap_items SET status = 'planned' WHERE id = $1", [it.id]);
  await asPlayer(P1, (tx) =>
    tx.query(
      `INSERT INTO roadmap_votes (item_id, user_id, importance_score) VALUES ($1, $2, 4)
       ON CONFLICT (user_id, item_id) DO UPDATE SET importance_score = EXCLUDED.importance_score`,
      [it.id, P1],
    ),
  );
  const { rows } = await db.query("SELECT idea_score, importance_score FROM roadmap_votes WHERE item_id = $1", [it.id]);
  assert.deepEqual(rows, [{ idea_score: 6, importance_score: 4 }]);
});

test("P2a: en stemme på et låst punkt (in_progress, shipped, archived) kan ikke flyttes til et åbent punkt", async () => {
  const target = await item({ status: "planned" });
  for (const status of ["in_progress", "shipped", "archived"]) {
    const locked = await item({ status: "active" });
    await asPlayer(P1, (tx) => vote(tx, locked.id, P1, 4, 4));
    await db.query("UPDATE roadmap_items SET status = $2 WHERE id = $1", [locked.id, status]);
    // USING filtrerer den gamle række fra (låst punkt) -> ingen række ændres;
    // og skulle den slippe igennem, afviser identitets-triggeren flytningen.
    let res = null;
    try {
      res = await asPlayer(P1, (tx) =>
        tx.query("UPDATE roadmap_votes SET item_id = $1 WHERE item_id = $2 AND user_id = $3", [target.id, locked.id, P1]),
      );
    } catch (err) {
      assert.match(String(err.message), /row-level security|cannot be changed/, status);
    }
    if (res) assert.equal(res.affectedRows ?? 0, 0, status);
    const { rows } = await db.query("SELECT item_id FROM roadmap_votes WHERE user_id = $1 AND item_id IN ($2, $3)", [
      P1, locked.id, target.id,
    ]);
    assert.deepEqual(rows.map((r) => r.item_id), [locked.id], status);
  }
});

test("P2a: en spiller kan ikke ændre en stemmes score på et låst punkt", async () => {
  const locked = await item({ status: "active" });
  await asPlayer(P1, (tx) => vote(tx, locked.id, P1, 4, 4));
  await db.query("UPDATE roadmap_items SET status = 'shipped' WHERE id = $1", [locked.id]);
  const res = await asPlayer(P1, (tx) =>
    tx.query("UPDATE roadmap_votes SET importance_score = 6 WHERE item_id = $1 AND user_id = $2", [locked.id, P1]),
  );
  assert.equal(res.affectedRows ?? 0, 0);
  const { rows } = await db.query("SELECT importance_score FROM roadmap_votes WHERE item_id = $1", [locked.id]);
  assert.equal(rows[0].importance_score, 4);
});

test("P2a: item_id og user_id på en stemme kan ikke ændres, heller ikke mellem to åbne punkter", async () => {
  const a = await item({ status: "active" });
  const b = await item({ status: "active" });
  await asPlayer(P1, (tx) => vote(tx, a.id, P1, 4, 4));
  await assert.rejects(
    () => asPlayer(P1, (tx) => tx.query("UPDATE roadmap_votes SET item_id = $1 WHERE item_id = $2 AND user_id = $3", [b.id, a.id, P1])),
    /cannot be changed/,
  );
  await assert.rejects(
    () => db.query("UPDATE roadmap_votes SET user_id = $1 WHERE item_id = $2 AND user_id = $3", [P2, a.id, P1]),
    /cannot be changed/,
  );
  // PostgREST-upsert sender item_id/user_id med i SET (samme værdi) og skal stadig virke.
  await asPlayer(P1, (tx) =>
    tx.query(
      `INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score) VALUES ($1, $2, 2, 6)
       ON CONFLICT (user_id, item_id) DO UPDATE SET item_id = EXCLUDED.item_id, user_id = EXCLUDED.user_id,
         idea_score = EXCLUDED.idea_score, importance_score = EXCLUDED.importance_score`,
      [a.id, P1],
    ),
  );
  const { rows } = await db.query("SELECT idea_score, importance_score FROM roadmap_votes WHERE item_id = $1", [a.id]);
  assert.deepEqual(rows, [{ idea_score: 2, importance_score: 6 }]);
});

test("spiller læser kun egne stemmer; admin læser alle", async () => {
  const it = await item({ status: "active" });
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, 4, 4));
  await asPlayer(P2, (tx) => vote(tx, it.id, P2, 5, 5));
  const own = await asPlayer(P1, (tx) => tx.query("SELECT user_id FROM roadmap_votes WHERE item_id = $1", [it.id]));
  assert.deepEqual(own.rows.map((r) => r.user_id), [P1]);
  const all = await asAdmin((tx) => tx.query("SELECT user_id FROM roadmap_votes WHERE item_id = $1", [it.id]));
  assert.equal(all.rows.length, 2);
});

test("roadmap_item_scores: steering_score er uændret for et punkt med to fulde stemmer", async () => {
  const it = await item({ status: "active" });
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, 6, 4));
  await asPlayer(P2, (tx) => vote(tx, it.id, P2, 4, 6));
  const { rows } = await asAdmin((tx) =>
    tx.query("SELECT votes, avg_idea, avg_importance, steering_score FROM roadmap_item_scores WHERE item_id = $1", [it.id]),
  );
  assert.equal(Number(rows[0].votes), 2);
  assert.equal(Number(rows[0].avg_idea), 5);
  assert.equal(Number(rows[0].avg_importance), 5);
  assert.equal(Number(rows[0].steering_score), 7.07);
});

test("roadmap_item_scores: sd_importance og idea_votes regnes rigtigt når idea_score er NULL", async () => {
  const it = await item({ status: "planned" });
  await asPlayer(P1, (tx) => vote(tx, it.id, P1, null, 2));
  await asPlayer(P2, (tx) => vote(tx, it.id, P2, 4, 6));
  const { rows } = await asAdmin((tx) =>
    tx.query("SELECT * FROM roadmap_item_scores WHERE item_id = $1", [it.id]),
  );
  const r = rows[0];
  assert.equal(Number(r.votes), 2);
  assert.equal(Number(r.idea_votes), 1);
  assert.equal(Number(r.avg_idea), 4);
  assert.equal(Number(r.avg_importance), 4);
  assert.equal(Number(r.sd_importance), 2.83);
  assert.equal(r.horizon, "next");
  assert.deepEqual(
    Object.keys(r),
    ["item_id", "engine", "title_en", "approved", "status", "votes", "avg_idea", "avg_importance", "steering_score",
      "title_da", "sort_order", "horizon", "issue_ref", "idea_votes", "sd_importance"],
  );
});

test("anon læser publicerede known_issues og deres updates, ikke upublicerede", async () => {
  const pub = await knownIssue({ published: true });
  const hidden = await knownIssue({ published: false });
  await db.query(
    "INSERT INTO known_issue_updates (issue_id, body_en, body_da) VALUES ($1, 'a', 'a'), ($2, 'b', 'b')",
    [pub.id, hidden.id],
  );
  const issues = await asAnon((tx) => tx.query("SELECT id FROM known_issues WHERE id IN ($1, $2)", [pub.id, hidden.id]));
  assert.deepEqual(issues.rows.map((r) => r.id), [pub.id]);
  const updates = await asAnon((tx) =>
    tx.query("SELECT issue_id FROM known_issue_updates WHERE issue_id IN ($1, $2)", [pub.id, hidden.id]),
  );
  assert.deepEqual(updates.rows.map((r) => r.issue_id), [pub.id]);
  const adminSees = await asAdmin((tx) => tx.query("SELECT id FROM known_issues WHERE id IN ($1, $2)", [pub.id, hidden.id]));
  assert.equal(adminSees.rows.length, 2);
});

test("kun admin kan insert/update known_issues og known_issue_updates", async () => {
  const insertIssue = (tx) =>
    tx.query("INSERT INTO known_issues (area, title_en, title_da) VALUES ('market', 'x', 'x') RETURNING id");
  await assert.rejects(() => asPlayer(P1, insertIssue), /row-level security/);
  await assert.rejects(() => asAnon(insertIssue), /permission denied|row-level security/);
  const { rows } = await asAdmin(insertIssue);
  const id = rows[0].id;
  await asAdmin((tx) => tx.query("UPDATE known_issues SET status = 'fixing', published = true WHERE id = $1", [id]));

  const upd = await asPlayer(P1, (tx) => tx.query("UPDATE known_issues SET status = 'fixed' WHERE id = $1", [id]));
  assert.equal(upd.affectedRows ?? 0, 0);
  assert.equal((await db.query("SELECT status FROM known_issues WHERE id = $1", [id])).rows[0].status, "fixing");

  const insertUpdate = (tx) =>
    tx.query("INSERT INTO known_issue_updates (issue_id, body_en, body_da) VALUES ($1, 'x', 'x') RETURNING id", [id]);
  await assert.rejects(() => asPlayer(P1, insertUpdate), /row-level security/);
  const created = await asAdmin(insertUpdate);
  await asAdmin((tx) =>
    tx.query("UPDATE known_issue_updates SET body_en = 'y' WHERE id = $1", [created.rows[0].id]),
  );
});

test("spiller kan oprette og slette EGET report på en publiceret, ikke-rettet fejl", async () => {
  const k = await knownIssue({ status: "checking" });
  await asPlayer(P1, (tx) => tx.query("INSERT INTO known_issue_reports (issue_id, user_id) VALUES ($1, $2)", [k.id, P1]));
  await asPlayer(P1, (tx) => tx.query("DELETE FROM known_issue_reports WHERE issue_id = $1 AND user_id = $2", [k.id, P1]));
  const { rows } = await db.query("SELECT count(*)::int AS n FROM known_issue_reports WHERE issue_id = $1", [k.id]);
  assert.equal(rows[0].n, 0);
});

test("spiller kan ikke oprette report på en rettet, lukket (dismissed) eller upubliceret fejl, og ikke for en anden bruger", async () => {
  const report = (issueId, userId) => (tx) =>
    tx.query("INSERT INTO known_issue_reports (issue_id, user_id) VALUES ($1, $2)", [issueId, userId]);
  for (const fields of [{ status: "fixed" }, { status: "dismissed" }, { published: false }]) {
    const k = await knownIssue(fields);
    await assert.rejects(() => asPlayer(P1, report(k.id, P1)), /row-level security/, JSON.stringify(fields));
  }
  const open = await knownIssue();
  await assert.rejects(() => asPlayer(P1, report(open.id, P2)), /row-level security/);
  // En spiller kan heller ikke slette en andens report.
  await asPlayer(P2, report(open.id, P2));
  await asPlayer(P1, (tx) => tx.query("DELETE FROM known_issue_reports WHERE issue_id = $1", [open.id]));
  const { rows } = await db.query("SELECT count(*)::int AS n FROM known_issue_reports WHERE issue_id = $1", [open.id]);
  assert.equal(rows[0].n, 1);
});

test("P2b: efter fixed, dismissed eller afpublicering kan spilleren hverken slette eller læse sit report; admin læser det", async () => {
  for (const change of [{ status: "fixed" }, { status: "dismissed" }, { published: false }]) {
    const k = await knownIssue({ status: "confirmed" });
    await asPlayer(P1, (tx) => tx.query("INSERT INTO known_issue_reports (issue_id, user_id) VALUES ($1, $2)", [k.id, P1]));
    if (change.status) await db.query("UPDATE known_issues SET status = $2 WHERE id = $1", [k.id, change.status]);
    else await db.query("UPDATE known_issues SET published = false WHERE id = $1", [k.id]);

    const del = await asPlayer(P1, (tx) =>
      tx.query("DELETE FROM known_issue_reports WHERE issue_id = $1 AND user_id = $2", [k.id, P1]),
    );
    assert.equal(del.affectedRows ?? 0, 0, JSON.stringify(change));
    const { rows } = await db.query("SELECT count(*)::int AS n FROM known_issue_reports WHERE issue_id = $1", [k.id]);
    assert.equal(rows[0].n, 1, JSON.stringify(change));

    const seen = await asPlayer(P1, (tx) => tx.query("SELECT user_id FROM known_issue_reports WHERE issue_id = $1", [k.id]));
    assert.equal(seen.rows.length, 0, JSON.stringify(change));
    const adminSeen = await asAdmin((tx) => tx.query("SELECT user_id FROM known_issue_reports WHERE issue_id = $1", [k.id]));
    assert.equal(adminSeen.rows.length, 1, JSON.stringify(change));
  }
});

test("P3: known_issue_scores er en admin/authenticated-kontrakt; anon har ingen adgang", async () => {
  const { rows } = await db.query("SELECT has_table_privilege('anon', 'public.known_issue_scores', 'SELECT') AS ok");
  assert.equal(rows[0].ok, false);
  await assert.rejects(() => asAnon((tx) => tx.query("SELECT * FROM known_issue_scores")), /permission denied/);
});

test("known_issues.status er checking som default og afviser ukendte værdier", async () => {
  const { rows } = await db.query("INSERT INTO known_issues (area, title_en, title_da) VALUES ('club', 'x', 'x') RETURNING status, published");
  assert.deepEqual(rows[0], { status: "checking", published: false });
  await assert.rejects(() => knownIssue({ status: "wontfix" }), /check constraint/);
  await assert.rejects(() => knownIssue({ area: "economy" }), /check constraint/);
});

test("spiller ser kun egne reports; known_issue_scores.reports er fuldt tal for admin", async () => {
  const k = await knownIssue();
  for (const uid of [P1, P2]) {
    await asPlayer(uid, (tx) => tx.query("INSERT INTO known_issue_reports (issue_id, user_id) VALUES ($1, $2)", [k.id, uid]));
  }
  const own = await asPlayer(P1, (tx) => tx.query("SELECT user_id FROM known_issue_reports WHERE issue_id = $1", [k.id]));
  assert.deepEqual(own.rows.map((r) => r.user_id), [P1]);
  const playerScore = await asPlayer(P1, (tx) => tx.query("SELECT reports FROM known_issue_scores WHERE issue_id = $1", [k.id]));
  assert.equal(Number(playerScore.rows[0].reports), 1);
  const adminScore = await asAdmin((tx) =>
    tx.query("SELECT reports, days_open FROM known_issue_scores WHERE issue_id = $1", [k.id]),
  );
  assert.equal(Number(adminScore.rows[0].reports), 2);
  assert.equal(adminScore.rows[0].days_open, 0);
});

test("kobling: et punkt der får flag_key til en kontakt på beta, bliver in_progress med beta_since", async () => {
  await setFlag("roadmap_test_beta", '"beta"');
  const it = await item({ status: "planned" });
  await db.query("UPDATE roadmap_items SET beta_soon = true WHERE id = $1", [it.id]);
  await db.query("UPDATE roadmap_items SET flag_key = 'roadmap_test_beta' WHERE id = $1", [it.id]);
  const after = await getItem(it.id);
  assert.equal(after.status, "in_progress");
  assert.ok(after.beta_since);
  assert.equal(after.beta_soon, false);

  // Oprettet koblet til en kontakt der allerede er on: direkte til shipped.
  await setFlag("roadmap_test_live", "true");
  const live = await item({ status: "planned", flag_key: "roadmap_test_live" });
  assert.equal(live.status, "shipped");
  assert.ok(live.shipped_at);
});

test("flip: app_config beta -> on sætter koblede punkter til shipped med shipped_at; ukoblede punkter er uændrede", async () => {
  await setFlag("roadmap_test_flip", '"off"');
  const linked = await item({ status: "planned", flag_key: "roadmap_test_flip" });
  const unlinked = await item({ status: "planned" });
  assert.equal(linked.status, "planned");

  await db.query("UPDATE app_config SET value = '\"beta\"'::jsonb WHERE key = 'roadmap_test_flip'");
  const inBeta = await getItem(linked.id);
  assert.equal(inBeta.status, "in_progress");
  assert.ok(inBeta.beta_since);

  await db.query("UPDATE roadmap_items SET live_soon = true WHERE id = $1", [linked.id]);
  await db.query("UPDATE app_config SET value = '\"on\"'::jsonb WHERE key = 'roadmap_test_flip'");
  const shipped = await getItem(linked.id);
  assert.equal(shipped.status, "shipped");
  assert.ok(shipped.shipped_at);
  assert.equal(shipped.live_soon, false);

  const untouched = await getItem(unlinked.id);
  assert.equal(untouched.status, "planned");
  assert.equal(untouched.beta_since, null);
});

test("flip: en kontakt uden koblede punkter kan flippes uden fejl, og et flip til off nulstiller beta_since", async () => {
  await setFlag("roadmap_test_lonely", '"off"');
  await db.query("UPDATE app_config SET value = '\"beta\"'::jsonb WHERE key = 'roadmap_test_lonely'");
  await db.query("UPDATE app_config SET value = '\"on\"'::jsonb WHERE key = 'roadmap_test_lonely'");

  await setFlag("roadmap_test_back", '"beta"');
  const it = await item({ status: "planned", flag_key: "roadmap_test_back" });
  await db.query("UPDATE roadmap_items SET live_soon = true WHERE id = $1", [it.id]);
  await db.query("UPDATE app_config SET value = '\"off\"'::jsonb WHERE key = 'roadmap_test_back'");
  const after = await getItem(it.id);
  assert.equal(after.status, "in_progress");
  assert.equal(after.beta_since, null);
  assert.equal(after.live_soon, false);
});

test("flip: kontakten flippes, selv om roadmap-opdateringen fejler (sikkerhedskravet)", async () => {
  await setFlag("roadmap_test_broken", '"off"');
  const it = await item({ status: "planned", flag_key: "roadmap_test_broken" });
  await db.exec(`
    CREATE FUNCTION test_explode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
    CREATE TRIGGER test_explode BEFORE UPDATE ON roadmap_items FOR EACH ROW EXECUTE FUNCTION test_explode();
  `);
  try {
    await db.query("UPDATE app_config SET value = '\"beta\"'::jsonb WHERE key = 'roadmap_test_broken'");
  } finally {
    await db.exec("DROP TRIGGER test_explode ON roadmap_items; DROP FUNCTION test_explode();");
  }
  const flag = await db.query("SELECT value FROM app_config WHERE key = 'roadmap_test_broken'");
  assert.equal(flag.rows[0].value, "beta");
  assert.equal((await getItem(it.id)).status, "planned");
});

test("P1: app_config_sync_roadmap venter aldrig: SKIP LOCKED + funktionslokalt lock_timeout", async () => {
  const { rows } = await db.query("SELECT prosrc FROM pg_proc WHERE proname = 'app_config_sync_roadmap'");
  const src = rows[0].prosrc;
  assert.equal((src.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length, 3, "alle tre UPDATE-grene låser med SKIP LOCKED");
  assert.match(src, /set_config\('lock_timeout', '200ms', true\)/);
});

test("P1: en lock_not_available (55P03) under roadmap-UPDATE vælter ikke flippet", async () => {
  await setFlag("roadmap_test_locked", '"off"');
  const it = await item({ status: "planned", flag_key: "roadmap_test_locked" });
  await db.exec(`
    CREATE FUNCTION test_locked() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated lock timeout' USING ERRCODE = '55P03'; END $$;
    CREATE TRIGGER test_locked BEFORE UPDATE ON roadmap_items FOR EACH ROW EXECUTE FUNCTION test_locked();
  `);
  try {
    await db.query("UPDATE app_config SET value = '\"beta\"'::jsonb WHERE key = 'roadmap_test_locked'");
  } finally {
    await db.exec("DROP TRIGGER test_locked ON roadmap_items; DROP FUNCTION test_locked();");
  }
  const flag = await db.query("SELECT value FROM app_config WHERE key = 'roadmap_test_locked'");
  assert.equal(flag.rows[0].value, "beta");
  assert.equal((await getItem(it.id)).status, "planned");
});

test("P1: kalderens lock_timeout er uændret efter triggeren, både i succes- og fejlstien", async () => {
  await setFlag("roadmap_test_lt", '"off"');
  await item({ status: "planned", flag_key: "roadmap_test_lt" });
  const ok = await db.transaction(async (tx) => {
    await tx.exec("SET LOCAL lock_timeout = '7s'");
    await tx.query("UPDATE app_config SET value = '\"beta\"'::jsonb WHERE key = 'roadmap_test_lt'");
    return (await tx.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
  });
  assert.equal(ok, "7s");

  await db.exec(`
    CREATE FUNCTION test_explode2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
    CREATE TRIGGER test_explode2 BEFORE UPDATE ON roadmap_items FOR EACH ROW EXECUTE FUNCTION test_explode2();
  `);
  try {
    const failed = await db.transaction(async (tx) => {
      await tx.exec("SET LOCAL lock_timeout = '9s'");
      await tx.query("UPDATE app_config SET value = '\"on\"'::jsonb WHERE key = 'roadmap_test_lt'");
      return (await tx.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
    });
    assert.equal(failed, "9s");
  } finally {
    await db.exec("DROP TRIGGER test_explode2 ON roadmap_items; DROP FUNCTION test_explode2();");
  }
  const { rows } = await db.query("SELECT value FROM app_config WHERE key = 'roadmap_test_lt'");
  assert.equal(rows[0].value, "on");
});

test("P1: roadmap_resync_flags() retter en bevidst skæv række, er idempotent og kun for admin/service_role", async () => {
  await setFlag("roadmap_test_drift", '"beta"');
  const beta = await item({ status: "planned", flag_key: "roadmap_test_drift" });
  assert.equal(beta.status, "in_progress");
  // Skæv: som hvis flippet sprang rækken over (SKIP LOCKED).
  await db.query("UPDATE roadmap_items SET status = 'planned', beta_since = NULL, beta_soon = true WHERE id = $1", [beta.id]);

  await setFlag("roadmap_test_drift_on", '"off"');
  const live = await item({ status: "planned", flag_key: "roadmap_test_drift_on" });
  await db.query("UPDATE app_config SET value = '\"on\"'::jsonb WHERE key = 'roadmap_test_drift_on'");
  await db.query("UPDATE roadmap_items SET status = 'in_progress', shipped_at = NULL WHERE id = $1", [live.id]);

  const first = await asAdmin((tx) => tx.query("SELECT public.roadmap_resync_flags() AS n"));
  assert.ok(first.rows[0].n >= 2, `rettede ${first.rows[0].n}`);
  const fixedBeta = await getItem(beta.id);
  assert.equal(fixedBeta.status, "in_progress");
  assert.ok(fixedBeta.beta_since);
  assert.equal(fixedBeta.beta_soon, false);
  const fixedLive = await getItem(live.id);
  assert.equal(fixedLive.status, "shipped");
  assert.ok(fixedLive.shipped_at);

  const second = await asService((tx) => tx.query("SELECT public.roadmap_resync_flags() AS n"));
  assert.equal(second.rows[0].n, 0);

  await assert.rejects(
    () => asPlayer(P1, (tx) => tx.query("SELECT public.roadmap_resync_flags()")),
    (err) => err.code === "42501",
  );
  await assert.rejects(() => asAnon((tx) => tx.query("SELECT public.roadmap_resync_flags()")), /permission denied/);
});

test("P2c: alle SECURITY DEFINER-funktioner i migrationen har search_path = public, pg_temp", async () => {
  const { rows } = await db.query(
    `SELECT proname, proconfig FROM pg_proc
     WHERE proname IN ('roadmap_admin_stats', 'roadmap_split_item', 'roadmap_items_sync_flag',
                       'app_config_sync_roadmap', 'roadmap_resync_flags')
     ORDER BY proname`,
  );
  assert.equal(rows.length, 5);
  for (const r of rows) assert.deepEqual(r.proconfig, ["search_path=public, pg_temp"], r.proname);
  // Funktionskroppe ($$...$$) må kun pege på skema-kvalificerede relationer.
  const bodies = readMigration(NEW_MIGRATION).match(/\$\$[\s\S]*?\$\$/g) ?? [];
  assert.ok(bodies.length >= 6, `fandt ${bodies.length} funktionskroppe`);
  for (const body of bodies) {
    assert.doesNotMatch(body, /\b(FROM|INTO|JOIN|UPDATE)\s+(roadmap_items|roadmap_votes|app_config|teams)\b/, body.slice(0, 80));
    assert.doesNotMatch(body, /[^.]roadmap_items%ROWTYPE/);
  }
});

test("roadmap_admin_stats() giver én række til admin og nul rækker til spiller", async () => {
  const admin = await asAdmin((tx) => tx.query("SELECT * FROM roadmap_admin_stats()"));
  assert.equal(admin.rows.length, 1);
  const r = admin.rows[0];
  assert.deepEqual(Object.keys(r), ["voters", "voters_14d", "votes_total", "voted_all", "managed_teams"]);
  assert.equal(r.voters, 2);
  assert.equal(r.voters_14d, 2);
  assert.equal(r.managed_teams, 2);
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM roadmap_votes");
  assert.equal(r.votes_total, n);

  const player = await asPlayer(P1, (tx) => tx.query("SELECT * FROM roadmap_admin_stats()"));
  assert.equal(player.rows.length, 0);
  await assert.rejects(() => asAnon((tx) => tx.query("SELECT * FROM roadmap_admin_stats()")), /permission denied/);
});

test("roadmap_split_item: admin får nyt skjult punkt med samme område og en kopi af alle kildens stemmer; kilden er uændret", async () => {
  const src = await item({ engine: "youth", status: "in_progress" });
  await db.query(
    "INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score) VALUES ($1, $2, 5, 6), ($1, $3, NULL, 3)",
    [src.id, P1, P2],
  );
  const { rows } = await asAdmin((tx) =>
    tx.query("SELECT roadmap_split_item($1, ' Rest EN ', 'Rest DA', 'planned', 'later', 6149) AS id", [src.id]),
  );
  const created = await getItem(rows[0].id);
  assert.equal(created.engine, "youth");
  assert.equal(created.approved, false);
  assert.equal(created.status, "planned");
  assert.equal(created.horizon, "later");
  assert.equal(created.issue_ref, 6149);
  assert.equal(created.title_en, "Rest EN");

  const votes = (id) =>
    db.query("SELECT user_id, idea_score, importance_score FROM roadmap_votes WHERE item_id = $1 ORDER BY importance_score", [id]);
  assert.deepEqual((await votes(created.id)).rows, (await votes(src.id)).rows);
  assert.equal((await votes(src.id)).rows.length, 2);
  const srcAfter = await getItem(src.id);
  assert.equal(srcAfter.status, "in_progress");
  assert.equal(srcAfter.approved, true);
});

test("roadmap_split_item: en spiller afvises (42501), og intet punkt oprettes", async () => {
  const src = await item({ status: "planned" });
  const before = (await db.query("SELECT count(*)::int AS n FROM roadmap_items")).rows[0].n;
  await assert.rejects(
    () => asPlayer(P1, (tx) => tx.query("SELECT roadmap_split_item($1, 'a', 'b')", [src.id])),
    (err) => err.code === "42501",
  );
  await assert.rejects(
    () => asAnon((tx) => tx.query("SELECT roadmap_split_item($1, 'a', 'b')", [src.id])),
    /permission denied/,
  );
  const afterCount = (await db.query("SELECT count(*)::int AS n FROM roadmap_items")).rows[0].n;
  assert.equal(afterCount, before);
});

test("triggerfunktionerne kan ikke kaldes som RPC af anon eller authenticated", async () => {
  for (const fn of ["roadmap_items_sync_flag()", "app_config_sync_roadmap()", "roadmap_votes_lock_identity()"]) {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, `public.${fn}`]);
      assert.equal(rows[0].ok, false, `${role} ${fn}`);
    }
  }
});

test('#6221: forward hardening denies client roles and preserves service stats/split/resync', async () => {
  const migration = readMigration('2026-10-06-6221-roadmap-service-rpcs.sql');
  await db.exec(migration);
  await db.exec(migration);
  const functions = ['roadmap_admin_stats()', 'roadmap_split_item(uuid,text,text,text,text,integer)', 'roadmap_resync_flags()'];
  for (const fn of functions) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [role, `public.${fn}`]);
      assert.equal(rows[0].ok, role === 'service_role', `${role} ${fn}`);
    }
  }
  await assert.rejects(() => asAdmin(tx => tx.query('SELECT * FROM roadmap_admin_stats()')), /permission denied/);
  const stats = await asService(tx => tx.query('SELECT * FROM roadmap_admin_stats()'));
  assert.equal(stats.rows.length, 1);
  const src = await item({ status: 'planned' });
  const result = await asService(tx => tx.query("SELECT roadmap_split_item($1,'Rest EN','Rest DA') AS id", [src.id]));
  assert.ok(result.rows[0].id);
  const synced = await asService(tx => tx.query('SELECT roadmap_resync_flags() AS n'));
  assert.equal(typeof synced.rows[0].n, 'number');
});
