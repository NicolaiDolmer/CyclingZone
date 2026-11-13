// #8143 trin 1 · directDb.ts mod en rigtig PostgreSQL (PGlite, samme opstart som de
// øvrige *.pg.test.*/*.pglite.test.*-prøver i repoet). Viser:
//  - "kør en handel" ruller ALT tilbage, når kalderen eller databasen fejler;
//  - handlens tidsgrænser gælder kun inde i handlen (reglen om én handel ad gangen);
//  - begge migrationer kan køres to gange, og rollen får præcis sine lofter og
//    ingen rettigheder; verify-blokken fælder migrationen, hvis den får for mange;
//  - opgørelsen pr. vej pr. time er én gyldig SELECT.
// PGlite er én forbindelse; adapteren nedenfor giver den pg's Pool-form.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { DIRECT_DB_URL_ENV, DirectDbError, createDirectDb } from "./directDb.ts";
import { DIRECT_DB_PROBE_READOUT_SQL } from "./directDbProbe.ts";

const FAKE_URL = ["postgresql", "://", "probe_user", ":", "not-a-real-password", "@", "db.example.invalid", ":5432/postgres"].join("");

function pglitePool(db) {
  const pool = new EventEmitter();
  pool.connect = async () => {
    const client = new EventEmitter();
    // Uden parametre: simpel protokol (flere sætninger i ét kald), som i pg.
    client.query = (text, params = []) => (params.length ? db.query(text, params) : db.exec(text));
    client.release = () => {};
    return client;
  };
  pool.end = async () => {};
  return pool;
}

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  const direct = createDirectDb({
    env: { [DIRECT_DB_URL_ENV]: FAKE_URL },
    createPool: () => pglitePool(db),
    logger: { warn: () => {} },
  });
  await db.exec("CREATE TABLE ledger (id int PRIMARY KEY, note text NOT NULL)");
  return { db, direct };
}

const countRows = async (db) => (await db.query("SELECT count(*)::int AS n FROM ledger")).rows[0].n;

test("#8143 pg: en handel, der lykkes, gemmer alt", async (t) => {
  const { db, direct } = await fixture(t);
  const out = await direct.transaction(async (tx) => {
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [1, "a"]);
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [2, "b"]);
    return (await tx.query("SELECT count(*)::int AS n FROM ledger")).rows[0].n;
  });
  assert.equal(out, 2);
  assert.equal(await countRows(db), 2);
});

test("#8143 pg: kalderens fejl midt i handlen ruller alt tilbage", async (t) => {
  const { db, direct } = await fixture(t);
  const stop = new Error("regel brudt efter to skrivninger");
  await assert.rejects(direct.transaction(async (tx) => {
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [1, "a"]);
    await tx.query("UPDATE ledger SET note = $1 WHERE id = $2", ["ændret", 1]);
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [2, "b"]);
    throw stop;
  }), (err) => err === stop);
  assert.equal(await countRows(db), 0, "intet må være gemt");
  // Forbindelsen er ren bagefter: ingen åben handel hænger ved.
  assert.equal((await db.query("SELECT 1 AS ok")).rows[0].ok, 1);
});

test("#8143 pg: databasens fejl midt i handlen ruller alt tilbage og renses", async (t) => {
  const { db, direct } = await fixture(t);
  await db.exec("INSERT INTO ledger VALUES (9, 'findes')");
  await assert.rejects(direct.transaction(async (tx) => {
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [1, "a"]);
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [9, "dublet"]);
  }), (err) => {
    assert.ok(err instanceof DirectDbError);
    assert.equal(err.sqlState, "23505");
    assert.ok(!err.message.includes("db.example.invalid"));
    return true;
  });
  assert.deepEqual((await db.query("SELECT id FROM ledger ORDER BY id")).rows, [{ id: 9 }]);
});

test("#8143 pg: fanger kalderen databasens fejl, afvises handlen, og intet er gemt", async (t) => {
  const { db, direct } = await fixture(t);
  await db.exec("INSERT INTO ledger VALUES (9, 'findes')");
  await assert.rejects(direct.transaction(async (tx) => {
    await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [1, "a"]);
    try {
      await tx.query("INSERT INTO ledger (id, note) VALUES ($1, $2)", [9, "dublet"]);
    } catch {
      // kalderen sluger fejlen med vilje; databasen har allerede afbrudt handlen
    }
    return "ser ud til at lykkes";
  }), (err) => err instanceof DirectDbError && /intet er gemt/.test(err.message));
  assert.deepEqual((await db.query("SELECT id FROM ledger ORDER BY id")).rows, [{ id: 9 }]);
  assert.equal((await db.query("SELECT 1 AS ok")).rows[0].ok, 1, "forbindelsen er ren bagefter");
});

test("#8143 pg: handlens tidsgrænser gælder kun inde i handlen", async (t) => {
  const { db, direct } = await fixture(t);
  const before = (await db.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
  const inside = await direct.transaction(async (tx) => (await tx.query(
    "SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l, current_setting('idle_in_transaction_session_timeout') AS i",
  )).rows[0]);
  assert.deepEqual(inside, { s: "15s", l: "3s", i: "10s" });
  const after = (await db.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
  assert.equal(after, before, "grænsen må ikke overleve handlen (fordelerens delte tilstand)");
});

test("#8143 pg: stil ét spørgsmål", async (t) => {
  const { direct } = await fixture(t);
  const timings = [];
  const r = await direct.query("SELECT 1 AS ok", [], { onTiming: (x) => timings.push(x) });
  assert.deepEqual(r.rows, [{ ok: 1 }]);
  assert.equal(timings.length, 1);
});

// ── Migrationerne ──────────────────────────────────────────────────────────

const migration = (name) => readFileSync(new URL(`../../database/${name}`, import.meta.url), "utf8");
const ROLE_SQL = migration("2026-11-13-8143-direct-db-role.sql");
const PROBE_SQL = migration("2026-11-13-8143-direct-db-probe.sql");

async function supabaseLike(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE public.app_config (key text PRIMARY KEY, value jsonb, description text,
      updated_at timestamptz DEFAULT now(), updated_by uuid);
    CREATE TABLE public.riders (id int PRIMARY KEY);
  `);
  return db;
}

test("#8143 pg: rollemigrationen kan køres to gange og giver lofter, tidsgrænser og ingen rettigheder", async (t) => {
  const db = await supabaseLike(t);
  await db.exec(ROLE_SQL);
  await db.exec(ROLE_SQL);
  const role = (await db.query(`SELECT rolcanlogin, rolconnlimit, rolsuper, rolinherit, rolbypassrls, rolcreatedb, rolcreaterole
    FROM pg_roles WHERE rolname = 'cz_direct'`)).rows[0];
  assert.deepEqual(role, {
    rolcanlogin: true, rolconnlimit: 10, rolsuper: false, rolinherit: false,
    rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
  });
  const password = (await db.query("SELECT rolpassword FROM pg_authid WHERE rolname = 'cz_direct'")).rows[0].rolpassword;
  assert.equal(password, null, "ingen adgangskode: rollen kan ikke logge ind, før ejeren sætter en");
  const settings = (await db.query(`SELECT unnest(setconfig) AS cfg FROM pg_db_role_setting
    WHERE setrole = 'cz_direct'::regrole ORDER BY 1`)).rows.map((r) => r.cfg);
  for (const expected of ["statement_timeout=15s", "lock_timeout=3s", "idle_in_transaction_session_timeout=10s", "default_transaction_read_only=on"]) {
    assert.ok(settings.includes(expected), `mangler ${expected}: ${settings}`);
  }
  const can = (await db.query("SELECT has_table_privilege('cz_direct', 'public.riders', 'SELECT') AS r, has_table_privilege('cz_direct', 'public.app_config', 'SELECT') AS c")).rows[0];
  assert.deepEqual(can, { r: false, c: false }, "ingen spillertabeller i trin 1");
  // Prøvens spørgsmål kræver intet: rollen kan stille det.
  await db.exec("SET ROLE cz_direct");
  assert.equal((await db.query("SELECT 1 AS ok")).rows[0].ok, 1);
  await assert.rejects(db.query("SELECT * FROM public.riders"), /permission denied/);
  await db.exec("RESET ROLE");
});

test("#8143 pg: rollemigrationens verify fælder den, hvis rollen har fået en tabel-rettighed", async (t) => {
  const db = await supabaseLike(t);
  await db.exec(ROLE_SQL);
  await db.exec("GRANT SELECT ON public.riders TO cz_direct");
  await assert.rejects(db.exec(ROLE_SQL), /cz_direct har tabel-rettigheder/);
});

test("#8143 pg: prøvens migration kan køres to gange; kontakten står på off; opgørelsen er én SELECT", async (t) => {
  const db = await supabaseLike(t);
  await db.exec(PROBE_SQL);
  await db.exec("UPDATE public.app_config SET value = '\"on\"' WHERE key = 'direct_db_probe_8143'");
  await db.exec(PROBE_SQL);
  const flag = (await db.query("SELECT value FROM public.app_config WHERE key = 'direct_db_probe_8143'")).rows[0].value;
  assert.equal(flag, "on", "en gen-kørsel må ikke overskrive ejerens valg");

  const grants = (await db.query(`SELECT
      has_table_privilege('anon', 'public.direct_db_probe_samples', 'SELECT') AS anon_read,
      has_table_privilege('authenticated', 'public.direct_db_probe_samples', 'SELECT') AS auth_read,
      has_table_privilege('service_role', 'public.direct_db_probe_samples', 'INSERT') AS server_write,
      has_table_privilege('service_role', 'public.direct_db_probe_samples', 'DELETE') AS server_expire`)).rows[0];
  assert.deepEqual(grants, { anon_read: false, auth_read: false, server_write: true, server_expire: true });

  // To timer med syntetiske målinger: web ca. 75 ms, direkte ca. 10 ms, én fejl.
  await db.exec(`INSERT INTO public.direct_db_probe_samples (sampled_at, path, ok, query_ms, acquire_ms, new_connection, error_kind)
    SELECT '2026-11-13 10:00:00+00'::timestamptz + make_interval(mins => n), 'web', true, 70 + n % 10, NULL, NULL, NULL
    FROM generate_series(0, 59) n;
    INSERT INTO public.direct_db_probe_samples (sampled_at, path, ok, query_ms, acquire_ms, new_connection, error_kind)
    SELECT '2026-11-13 10:00:00+00'::timestamptz + make_interval(mins => n), 'direct', n <> 7, 8 + n % 5, 1, n = 0, CASE WHEN n = 7 THEN 'timeout' END
    FROM generate_series(0, 59) n;
    INSERT INTO public.direct_db_probe_samples (sampled_at, path, ok, query_ms) VALUES ('2026-11-13 11:05:00+00', 'web', false, 15000);`);
  const rows = (await db.query(DIRECT_DB_PROBE_READOUT_SQL)).rows;
  const byKey = Object.fromEntries(rows.map((r) => [`${new Date(r.hour).toISOString().slice(11, 13)}:${r.path}`, r]));
  assert.equal(byKey["10:web"].answers, 60);
  assert.equal(byKey["10:web"].errors, 0);
  assert.equal(Number(byKey["10:web"].median_ms), 74.5);
  assert.equal(byKey["10:direct"].answers, 59);
  assert.equal(byKey["10:direct"].errors, 1);
  assert.equal(byKey["10:direct"].new_connections, 1);
  assert.ok(Number(byKey["10:direct"].p95_ms) >= Number(byKey["10:direct"].median_ms));
  assert.equal(Number(byKey["10:direct"].median_acquire_ms), 1);
  assert.equal(byKey["11:web"].errors, 1);
  assert.equal(byKey["11:web"].median_ms, null);

  // To rækker pr. runde: samme tidspunkt, én pr. vej. En dublet afvises.
  await assert.rejects(db.exec("INSERT INTO public.direct_db_probe_samples (sampled_at, path, ok) VALUES ('2026-11-13 10:00:00+00', 'web', true)"), /duplicate key/);
  await assert.rejects(db.exec("INSERT INTO public.direct_db_probe_samples (sampled_at, path, ok) VALUES (now(), 'andet', true)"), /check constraint/);
});
