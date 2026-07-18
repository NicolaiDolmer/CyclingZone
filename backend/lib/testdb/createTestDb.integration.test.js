// Schema-fidelitets-meta-test for createTestDb (#1840 pre-live contract-harness, B2).
//
// Beviser at den ÆGTE committede DDL (database/*.sql, saneret via sanitizeForPglite)
// loader fejlfrit mod en in-memory Postgres (PGlite) — og at det loadede skema er
// FAITHFUL: riders har de kolonner strategi-endpointet projicerer, men har IKKE en
// `overall`-kolonne. Sidstnævnte er hele pointen: et endpoint der projicerer en
// ikke-eksisterende kolonne (riders.overall, #1840) MÅ fejle mod dette skema, så
// fejlen fanges i CI i stedet for tavst tom roster i prod.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { createTestDb, columnExists, RACE_HUB_SCHEMA_FILES } from "./createTestDb.js";

let db;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  if (db) await db.close();
});

test("harness loader uden fejl og riders-tabellen findes", async () => {
  const { rows } = await db.query("SELECT to_regclass('public.riders') AS reg");
  assert.ok(rows[0].reg, "public.riders skal findes efter load");
});

test("riders HAR de kolonner strategi-endpointet projicerer", async () => {
  const required = [
    "id",
    "firstname",
    "lastname",
    "primary_type",
    "secondary_type",
    "team_id",
    "is_academy",
    "is_retired",
  ];
  for (const col of required) {
    assert.ok(await columnExists(db, "riders", col), `riders.${col} skal findes`);
  }
});

test("riders har IKKE en `overall`-kolonne (fidelitets-beviset bag #1840)", async () => {
  assert.equal(
    await columnExists(db, "riders", "overall"),
    false,
    "riders.overall må IKKE findes — ellers fanger harnessen ikke #1840-klassen",
  );
});

test("riders.pending_team_id findes og er SELECT-bar (#2628 drift-lukker)", async () => {
  // #2628: kolonnen findes i prod (fra #1995/#2579-parkeringsmekanikken), men var
  // ALDRIG en committet migration i database/ — RACE_HUB_SCHEMA_FILES loadede den
  // derfor ikke, og enhver kontrakt-test der rørte kolonnen fejlede med
  // "column does not exist". Dette beviser at drift-lukkeren
  // (2026-07-18-riders-pending-team-id-drift-closer.sql) faktisk loader kolonnen —
  // en ÆGTE SQL-SELECT, ikke kun et kilde-scan (jf. #2616-regressionens fallback).
  assert.ok(await columnExists(db, "riders", "pending_team_id"), "riders.pending_team_id skal findes");

  const { rows } = await db.query(
    "SELECT id, pending_team_id FROM riders WHERE pending_team_id IS NOT NULL LIMIT 1",
  );
  assert.ok(Array.isArray(rows), "SELECT mod riders.pending_team_id skal kunne køre uden fejl");
});

test("riders_pending_team_id_fkey peger på teams(id) (matcher prod verificeret via Supabase MCP)", async () => {
  const { rows } = await db.query(`
    SELECT ccu.table_name AS foreign_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'riders'
      AND tc.constraint_name = 'riders_pending_team_id_fkey'
  `);
  assert.equal(rows[0]?.foreign_table, "teams", "FK skal pege på teams(id) som i prod");
});

test("academy_intake findes (BEGIN/COMMIT-transaktioner i academy-mvp loader korrekt i PGlite)", async () => {
  // 2026-06-13-academy-mvp.sql wrapper sin DDL i en eksplicit BEGIN/COMMIT. Hvis
  // PGlite's exec() nogensinde ændrer transaktions-semantik, ville academy_intake
  // tavst udeblive og en fremtidig /academy/me-contract-test fejle med en forvirrende
  // "table not found" i stedet for en kolonne-kontrakt-fejl. Verificér eksplicit.
  const { rows } = await db.query("SELECT to_regclass('public.academy_intake') AS reg");
  assert.ok(rows[0].reg, "academy_intake mangler — BEGIN/COMMIT i 2026-06-13-academy-mvp.sql loadede ikke korrekt");
});

test("RACE_HUB_SCHEMA_FILES er en ikke-tom ordnet liste der starter med schema.sql", () => {
  assert.ok(Array.isArray(RACE_HUB_SCHEMA_FILES));
  assert.ok(RACE_HUB_SCHEMA_FILES.length >= 7, "mindst de planlagte tabel-skabende filer");
  assert.equal(RACE_HUB_SCHEMA_FILES[0], "schema.sql", "base-skemaet skal loades først");
});
