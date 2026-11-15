// #6515 · Sidst set patch notes/roadmap mod en rigtig Postgres (PGlite) med de
// rigtige migrationer. Viser at to overlappende skrivninger for samme bruger
// begge bevares, og at en aeldre markoer aldrig vinder over en nyere.
//
// Adapteren taler med PGlite som supabase-js taler med PostgREST: .from() til
// laes/upsert og .rpc() til funktioner. Hvert databasekald gaar gennem en
// barriere, der holder kaldene tilbage, til begge samtidige skrivninger er naaet
// samme trin. Saa er rækkefoelgen styret og ens hver gang (ingen timing-held).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { writeSeenMarkers, readSeenMarkers } from "./seenMarkers6515.js";

const USER = "00000000-0000-0000-0000-000000006515";
const OLD_PATCH = "2026-11-01";
const NEW_PATCH = "2026-11-14";
const OLD_ROADMAP = "2026-11-10T08:00:00.000000+00:00";
const NEW_ROADMAP = "2026-11-13T09:00:00.000000+00:00";

async function migration(file) {
  return readFile(new URL(`../../database/${file}`, import.meta.url), "utf8");
}

async function freshDb(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${USER}');
  `);
  await db.exec(await migration("2026-11-12-7778-user-ui-prefs.sql"));
  const own = await migration("2026-11-14-6515-seen-markers.sql");
  await db.exec(own);
  await db.exec(own); // idempotent: anden koersel maa hverken fejle eller aendre noget
  return db;
}

/**
 * Barriere: hvert kald venter, til `parties` kald er naaet frem, og slippes saa
 * samlet. Kommer den anden part aldrig (fx fordi koden springer en skrivning
 * over), slippes den ventende efter kort tid, saa testen fejler i stedet for at haenge.
 */
function barrier(parties) {
  let waiting = [];
  let timer = null;
  const releaseAll = () => {
    clearTimeout(timer);
    timer = null;
    const release = waiting;
    waiting = [];
    for (const go of release) go();
  };
  return () => new Promise((resolve) => {
    waiting.push(resolve);
    if (waiting.length >= parties) releaseAll();
    else if (!timer) timer = setTimeout(releaseAll, 200);
  });
}

function pgError(error) {
  return { code: error.code, message: error.message };
}

/** Et supabase-js-lignende lag over PGlite (kun det seenMarkers6515.js bruger). */
function supabaseOver(db, arrive = async () => {}) {
  return {
    from(table) {
      assert.equal(table, "user_ui_prefs");
      let userId = null;
      const query = {
        select() { return query; },
        eq(column, value) { assert.equal(column, "user_id"); userId = value; return query; },
        async limit() {
          await arrive();
          try {
            const r = await db.query("SELECT seen_markers FROM public.user_ui_prefs WHERE user_id = $1 LIMIT 1", [userId]);
            return { data: r.rows, error: null };
          } catch (error) { return { data: null, error: pgError(error) }; }
        },
        async upsert(value) {
          await arrive();
          try {
            await db.query(
              `INSERT INTO public.user_ui_prefs (user_id, seen_markers, updated_at) VALUES ($1, $2::jsonb, $3::timestamptz)
               ON CONFLICT (user_id) DO UPDATE SET seen_markers = EXCLUDED.seen_markers, updated_at = EXCLUDED.updated_at`,
              [value.user_id, JSON.stringify(value.seen_markers), value.updated_at],
            );
            return { error: null };
          } catch (error) { return { error: pgError(error) }; }
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "merge_seen_markers_6515");
      await arrive();
      try {
        const r = await db.query("SELECT public.merge_seen_markers_6515($1::uuid, $2::jsonb) AS markers", [args.p_user_id, JSON.stringify(args.p_patch)]);
        return { data: r.rows[0].markers, error: null };
      } catch (error) { return { data: null, error: pgError(error) }; }
    },
  };
}

async function storedMarkers(db) {
  const r = await db.query("SELECT seen_markers, prefs FROM public.user_ui_prefs WHERE user_id = $1", [USER]);
  return r.rows[0] ?? null;
}

test("to samtidige skrivninger mod en tom raekke: baade patch notes og roadmap bevares", async (t) => {
  const db = await freshDb(t);
  const supabase = supabaseOver(db, barrier(2));
  await Promise.all([
    writeSeenMarkers(supabase, USER, { patch_notes: NEW_PATCH }),
    writeSeenMarkers(supabase, USER, { roadmap: NEW_ROADMAP }),
  ]);
  const row = await storedMarkers(db);
  assert.deepEqual(row.seen_markers, { patch_notes: NEW_PATCH, roadmap: NEW_ROADMAP });
});

test("to samtidige skrivninger til samme markoer: den nyeste vinder i begge raekkefoelger", async (t) => {
  for (const order of [[OLD_PATCH, NEW_PATCH], [NEW_PATCH, OLD_PATCH]]) {
    const db = await freshDb(t);
    const supabase = supabaseOver(db, barrier(2));
    await Promise.all(order.map((value) => writeSeenMarkers(supabase, USER, { patch_notes: value })));
    assert.deepEqual((await storedMarkers(db)).seen_markers, { patch_notes: NEW_PATCH }, `raekkefoelge ${order.join(" -> ")}`);
  }
});

test("samtidige skrivninger med en gemt raekke: andre markoerer og visningsvalg staar uroert", async (t) => {
  const db = await freshDb(t);
  await db.query(
    "INSERT INTO public.user_ui_prefs (user_id, prefs, seen_markers) VALUES ($1, $2::jsonb, $3::jsonb)",
    [USER, JSON.stringify({ race_route_hidden: true }), JSON.stringify({ patch_notes: OLD_PATCH, roadmap: NEW_ROADMAP })],
  );
  const supabase = supabaseOver(db, barrier(2));
  const [a, b] = await Promise.all([
    writeSeenMarkers(supabase, USER, { patch_notes: NEW_PATCH }),
    writeSeenMarkers(supabase, USER, { roadmap: OLD_ROADMAP }),
  ]);
  const row = await storedMarkers(db);
  assert.deepEqual(row.seen_markers, { patch_notes: NEW_PATCH, roadmap: NEW_ROADMAP });
  assert.deepEqual(row.prefs, { race_route_hidden: true });
  // Svaret er raekkens tilstand efter hver enkelt skrivning, aldrig en aeldre end den gemte.
  assert.equal(a.available, true);
  assert.equal(b.available, true);
  assert.equal(b.markers.roadmap, NEW_ROADMAP);
});

test("en aeldre markoer vinder aldrig over en nyere, og intet skrives naar intet rykker", async (t) => {
  const db = await freshDb(t);
  const supabase = supabaseOver(db);
  await writeSeenMarkers(supabase, USER, { patch_notes: NEW_PATCH, roadmap: NEW_ROADMAP });
  const before = (await db.query("SELECT updated_at FROM public.user_ui_prefs WHERE user_id = $1", [USER])).rows[0].updated_at;
  const out = await writeSeenMarkers(supabase, USER, { patch_notes: OLD_PATCH, roadmap: OLD_ROADMAP });
  assert.deepEqual(out, { markers: { patch_notes: NEW_PATCH, roadmap: NEW_ROADMAP }, available: true });
  const after = (await db.query("SELECT updated_at FROM public.user_ui_prefs WHERE user_id = $1", [USER])).rows[0].updated_at;
  assert.equal(after.getTime(), before.getTime(), "ingen skrivning naar intet rykkede frem");
  assert.deepEqual(await readSeenMarkers(supabase, USER), { markers: { patch_notes: NEW_PATCH, roadmap: NEW_ROADMAP }, available: true });
});

test("funktionen sammenligner som klienten (byte-orden), ikke efter sprog-sortering", async (t) => {
  const db = await freshDb(t);
  const supabase = supabaseOver(db);
  await writeSeenMarkers(supabase, USER, { roadmap: "2026-11-13T09:00:00Z" });
  await writeSeenMarkers(supabase, USER, { roadmap: "2026-11-13T09:00:00.5Z" });
  // "." (0x2E) sorterer foer "Z" (0x5A) i byte-orden, ligesom i JavaScript.
  assert.equal("2026-11-13T09:00:00.5Z" > "2026-11-13T09:00:00Z", false);
  assert.equal((await storedMarkers(db)).seen_markers.roadmap, "2026-11-13T09:00:00Z");
});

test("kun service_role maa kalde funktionen", async (t) => {
  const db = await freshDb(t);
  const grants = await db.query(`
    SELECT r.rolname, has_function_privilege(r.rolname, 'public.merge_seen_markers_6515(uuid,jsonb)', 'EXECUTE') AS can
    FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role') ORDER BY r.rolname`);
  assert.deepEqual(grants.rows.map((r) => [r.rolname, r.can]), [["anon", false], ["authenticated", false], ["service_role", true]]);
});

test("backend foer migrationen: funktionen findes ikke = available false, intet kast", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
  `);
  await db.exec(await migration("2026-11-12-7778-user-ui-prefs.sql"));
  const out = await writeSeenMarkers(supabaseOver(db), USER, { patch_notes: NEW_PATCH });
  assert.deepEqual(out, { markers: {}, available: false });
});
