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

test("RACE_HUB_SCHEMA_FILES er en ikke-tom ordnet liste der starter med schema.sql", () => {
  assert.ok(Array.isArray(RACE_HUB_SCHEMA_FILES));
  assert.ok(RACE_HUB_SCHEMA_FILES.length >= 7, "mindst de planlagte tabel-skabende filer");
  assert.equal(RACE_HUB_SCHEMA_FILES[0], "schema.sql", "base-skemaet skal loades først");
});
