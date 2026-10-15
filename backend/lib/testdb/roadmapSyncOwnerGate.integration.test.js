// #6693 — ejer-gaten paa auto-oprettede roadmap-punkter. Beviser at DATABASEN
// selv holder reglen: et punkt som scripts/roadmap-sync-registry.mjs opretter
// (approved = false, publish_on_beta = true) bliver synligt, foerst naar
// kontakten staar paa beta eller on - og aldrig, hvis ejeren har redigeret det.
//
// Harness: PGlite med den AEGTE committede DDL, samme opsaetning som
// roadmapHub.integration.test.js (roadmap-migrationerne loades raat, fordi
// triggere og grants testes). Den eneste tilpasning: CREATE INDEX CONCURRENTLY
// kan ikke koere i PGlites implicitte transaktion, saa noegleordet fjernes her
// (som sanitizeForPglite goer for de oevrige migrationer).

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { createTestDb, readMigration } from "./createTestDb.js";

const GATE_MIGRATION = "2026-10-15-6693-roadmap-sync-owner-gate.sql";
const ROADMAP_MIGRATIONS = [
  "2026-06-11-roadmap-items-votes.sql",
  "2026-06-20-roadmap-shipped-history.sql",
  "2026-09-07-3457-roadmap-anon-read.sql",
];

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
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`;

const gateSql = () => readMigration(GATE_MIGRATION).replace(/INDEX CONCURRENTLY/g, "INDEX");

before(async () => {
  db = await createTestDb({ files: ["schema.sql", "2026-05-16-app-config.sql"] });
  await db.exec(SUPABASE_SIM);
  for (const file of ROADMAP_MIGRATIONS) await db.exec(readMigration(file));
  await db.exec(readMigration("2026-10-05-5387-roadmap-hub.sql"));
  await db.exec(gateSql());
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

/** Samme raekke som roadmap-sync-registry.mjs indsaetter. */
async function synced(flagKey, fields = {}) {
  const f = { approved: false, publish_on_beta: true, sort_order: 1000, ...fields };
  const { rows } = await db.query(
    `INSERT INTO roadmap_items (engine, sort_order, title_en, title_da, approved, publish_on_beta, status, horizon, flag_key)
     VALUES ('races', $1, 'Synced EN', 'Synced DA', $2, $3, 'planned', 'next', $4) RETURNING *`,
    [f.sort_order, f.approved, f.publish_on_beta, flagKey],
  );
  return rows[0];
}

async function getItem(id) {
  const { rows } = await db.query("SELECT * FROM roadmap_items WHERE id = $1", [id]);
  return rows[0];
}

test("migrationen er idempotent: anden apply fejler ikke", async () => {
  await db.exec(gateSql());
});

test("publish_on_beta er false som default: eksisterende og manuelt oprettede punkter er uberoerte", async () => {
  await setFlag("gate_manual", "off");
  const { rows } = await db.query(
    "INSERT INTO roadmap_items (engine, title_en, title_da, approved, status, flag_key) VALUES ('club', 'M', 'M', false, 'planned', 'gate_manual') RETURNING *",
  );
  assert.equal(rows[0].publish_on_beta, false);
  await setFlag("gate_manual", "beta");
  const after = await getItem(rows[0].id);
  assert.equal(after.status, "in_progress", "beta-koblingen virker som foer");
  assert.equal(after.approved, false, "et punkt ejeren selv har skjult, publiceres ikke af flippet");
});

test("oprettet mens flaget er off: skjult; flip til beta publicerer og fjerner markeringen", async () => {
  await setFlag("gate_flip", "off");
  const it = await synced("gate_flip");
  assert.equal(it.approved, false);
  assert.equal(it.publish_on_beta, true);
  assert.equal(it.status, "planned");

  await setFlag("gate_flip", "beta");
  const after = await getItem(it.id);
  assert.equal(after.approved, true);
  assert.equal(after.publish_on_beta, false);
  assert.equal(after.status, "in_progress");
  assert.ok(after.beta_since);
});

test("flip direkte fra off til on publicerer ogsaa", async () => {
  await setFlag("gate_on", "off");
  const it = await synced("gate_on");
  await setFlag("gate_on", "on");
  const after = await getItem(it.id);
  assert.equal(after.approved, true);
  assert.equal(after.status, "shipped");
});

test("oprettet mens flaget allerede er beta eller on: synligt med det samme", async () => {
  await setFlag("gate_pre_beta", "beta");
  const beta = await synced("gate_pre_beta");
  assert.equal(beta.approved, true);
  assert.equal(beta.publish_on_beta, false);
  assert.equal(beta.status, "in_progress");

  await setFlag("gate_pre_on", "on");
  const on = await synced("gate_pre_on");
  assert.equal(on.approved, true);
  assert.equal(on.status, "shipped");
});

test("flag der ikke findes i app_config endnu: skjult", async () => {
  const it = await synced("gate_absent");
  assert.equal(it.approved, false);
  assert.equal(it.publish_on_beta, true);
});

test("ejeren retter titlen mens punktet er skjult: markeringen fjernes, og flippet roerer det ikke", async () => {
  await setFlag("gate_edited", "off");
  const it = await synced("gate_edited");
  await db.query("UPDATE roadmap_items SET title_en = 'Owner text' WHERE id = $1", [it.id]);
  assert.equal((await getItem(it.id)).publish_on_beta, false);

  await setFlag("gate_edited", "beta");
  const after = await getItem(it.id);
  assert.equal(after.approved, false, "ejerens redigering vinder");
  assert.equal(after.status, "in_progress");
});

test("ejeren arkiverer punktet: markeringen fjernes, og et senere flip publicerer ikke", async () => {
  await setFlag("gate_archived", "off");
  const it = await synced("gate_archived");
  await db.query("UPDATE roadmap_items SET status = 'archived' WHERE id = $1", [it.id]);
  await setFlag("gate_archived", "on");
  const after = await getItem(it.id);
  assert.equal(after.approved, false);
  assert.equal(after.publish_on_beta, false);
  assert.equal(after.status, "archived");
});

test("ejeren flytter punktet i planen (sort_order/horizon): markeringen bevares, flippet publicerer", async () => {
  await setFlag("gate_moved", "off");
  const it = await synced("gate_moved");
  await db.query("UPDATE roadmap_items SET sort_order = 5, horizon = 'later' WHERE id = $1", [it.id]);
  assert.equal((await getItem(it.id)).publish_on_beta, true);
  await setFlag("gate_moved", "beta");
  assert.equal((await getItem(it.id)).approved, true);
});

test("en raekke flippet sprang over (drift) publiceres af roadmap_resync_flags()", async () => {
  await setFlag("gate_drift", "off");
  const it = await synced("gate_drift");
  // Som hvis flippet sprang raekken over (SKIP LOCKED): kontakten er beta, punktet ikke.
  await db.exec("ALTER TABLE app_config DISABLE TRIGGER app_config_sync_roadmap");
  try {
    await setFlag("gate_drift", "beta");
  } finally {
    await db.exec("ALTER TABLE app_config ENABLE TRIGGER app_config_sync_roadmap");
  }
  const skewed = await getItem(it.id);
  assert.equal(skewed.approved, false);
  assert.equal(skewed.status, "planned");

  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await tx.query("SELECT public.roadmap_resync_flags()");
  });
  const fixed = await getItem(it.id);
  assert.equal(fixed.status, "in_progress");
  assert.equal(fixed.approved, true);
  assert.equal(fixed.publish_on_beta, false);
});

test("flag_key er unik (partielt): en dublet afvises, flere punkter uden flag er fine", async () => {
  await synced("gate_unique");
  await assert.rejects(() => synced("gate_unique"), /roadmap_items_flag_key_uniq/);
  await db.query("INSERT INTO roadmap_items (engine, title_en, title_da) VALUES ('club', 'A', 'A'), ('club', 'B', 'B')");
});

test("triggerfunktionen kan ikke kaldes som RPC af anon eller authenticated og har fast search_path", async () => {
  for (const role of ["anon", "authenticated"]) {
    const { rows } = await db.query("SELECT has_function_privilege($1, 'public.roadmap_items_publish_on_beta()', 'EXECUTE') AS ok", [role]);
    assert.equal(rows[0].ok, false, role);
  }
  const { rows } = await db.query("SELECT proconfig FROM pg_proc WHERE proname = 'roadmap_items_publish_on_beta'");
  assert.deepEqual(rows[0].proconfig, ["search_path=public, pg_temp"]);
  const body = readMigration(GATE_MIGRATION).match(/\$\$[\s\S]*?\$\$/g) ?? [];
  for (const b of body) assert.doesNotMatch(b, /\b(FROM|INTO|JOIN|UPDATE)\s+(roadmap_items|app_config)\b/);
});

test("triggeren fyrer efter roadmap_items_sync_flag (navneorden), saa den ser status fra flaget", async () => {
  const { rows } = await db.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.roadmap_items'::regclass AND NOT tgisinternal ORDER BY tgname",
  );
  const names = rows.map((r) => r.tgname);
  assert.ok(names.indexOf("roadmap_items_sync_flag") < names.indexOf("roadmap_items_sync_publish"), names.join(","));
});
