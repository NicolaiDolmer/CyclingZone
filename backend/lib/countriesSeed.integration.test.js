// Integrationstest for countries-migrationen (#844 Slice 1) mod en ægte Postgres
// via PGlite (in-memory, ingen Docker/cost — samme mønster som #669). Kører den
// FAKTISKE committede migrationsfil, så DDL + RLS-syntaks + seed + CHECK-constraints
// alle bevises som gyldig Postgres mod prod-schemaet.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

import { ISO2_SOURCE } from "./countriesSeed.js";

const MIGRATION = readFileSync(
  new URL("../../database/2026-05-31-countries-table.sql", import.meta.url),
  "utf8",
);

// Supabase-prærekvisitter migrationen antager findes (roller + is_admin()).
const PREREQ = `
  CREATE ROLE authenticated;
  CREATE ROLE anon;
  CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`;

let db;
before(async () => {
  db = new PGlite();
  await db.exec(PREREQ);
  await db.exec(MIGRATION); // kaster hvis DDL/RLS/seed/constraint-syntaks er ugyldig
});

test("migrationen seeder præcis alle prod-nationer (ingen forældreløse muligt)", async () => {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM public.countries");
  assert.equal(rows[0].n, ISO2_SOURCE.length, "antal seed-rækker = antal distinct prod-nationer");

  // Hver kode i kildelisten (= de faktiske riders.nationality_code) har en row.
  const present = await db.query("SELECT iso2 FROM public.countries");
  const set = new Set(present.rows.map((r) => r.iso2));
  for (const iso of ISO2_SOURCE) {
    assert.ok(set.has(iso), `nation mangler i countries: ${iso}`);
  }
});

test("ingen række bryder NOT NULL/akse-invarianterne", async () => {
  const bad = await db.query(`
    SELECT count(*)::int AS n FROM public.countries
    WHERE name_en IS NULL
       OR birth_weight < 0
       OR talent_ceiling <= 0
       OR reputation NOT BETWEEN 0 AND 100
       OR reputation_seed NOT BETWEEN 0 AND 100
       OR iso2 !~ '^[A-Z]{2}$'
  `);
  assert.equal(bad.rows[0].n, 0);
});

test("S-tier nationer har forventede akse-værdier i DB", async () => {
  const { rows } = await db.query(
    "SELECT birth_weight::float AS bw, talent_ceiling::float AS tc, reputation::float AS rep FROM public.countries WHERE iso2 = 'FR'",
  );
  assert.equal(rows[0].bw, 100);
  assert.equal(rows[0].tc, 1.45);
  assert.equal(rows[0].rep, 90);
});

test("CHECK-constraint afviser reputation udenfor 0-100", async () => {
  await assert.rejects(
    () =>
      db.query(
        "INSERT INTO public.countries (iso2, name_en, reputation) VALUES ('ZZ', 'Test', 150)",
      ),
    /constraint|check/i,
  );
});

test("CHECK-constraint afviser ugyldigt iso2-format", async () => {
  await assert.rejects(
    () => db.query("INSERT INTO public.countries (iso2, name_en) VALUES ('xx', 'lowercase')"),
    /constraint|check/i,
  );
  await assert.rejects(
    () => db.query("INSERT INTO public.countries (iso2, name_en) VALUES ('ABC', 'three')"),
    /constraint|check/i,
  );
});

test("migrationen er idempotent (kan køres igen uden fejl/dubletter)", async () => {
  await db.exec(MIGRATION); // CREATE IF NOT EXISTS + DROP/CREATE POLICY + seed ON CONFLICT
  const { rows } = await db.query("SELECT count(*)::int AS n FROM public.countries");
  assert.equal(rows[0].n, ISO2_SOURCE.length, "stadig præcis samme antal efter gen-kørsel");
});

test("RLS er aktiveret på countries", async () => {
  const { rows } = await db.query(
    "SELECT relrowsecurity FROM pg_class WHERE relname = 'countries'",
  );
  assert.equal(rows[0].relrowsecurity, true);
});
