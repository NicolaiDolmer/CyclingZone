import test from "node:test";
import assert from "node:assert/strict";
import { extractObjects, buildSql } from "./proposals-reconcile.mjs";

test("finder tabel, indeks, funktion og constraint", () => {
  const sql = `
CREATE TABLE IF NOT EXISTS public.backup_thing_20260101 (id uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_riders_valuation_type ON riders (valuation_type);
CREATE OR REPLACE FUNCTION public.apply_thing(a uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
ALTER TABLE race_results ADD CONSTRAINT race_results_entrant_unique UNIQUE (entrant_key);
`;
  assert.deepEqual(extractObjects(sql), [
    { kind: "table", name: "backup_thing_20260101" },
    { kind: "index", name: "idx_riders_valuation_type" },
    { kind: "function", name: "apply_thing" },
    { kind: "constraint", name: "race_results_entrant_unique" },
  ]);
});

// Proposals-filerne har lange headere der ofte CITERER den SQL de beskriver.
// Et citat i en kommentar er ikke en erklæring — ellers ville rollback-noter
// ("DROP FUNCTION ...", "CREATE TABLE ..." som eksempel) blive talt med.
test("kommentar-linjer tæller ikke som erklæringer", () => {
  const sql = `
-- Rollback: CREATE TABLE public.noget_der_kun_er_omtalt (id uuid);
-- CREATE OR REPLACE FUNCTION public.kun_i_kommentar() ...
CREATE TABLE public.rigtig_tabel (id uuid);
`;
  assert.deepEqual(extractObjects(sql), [{ kind: "table", name: "rigtig_tabel" }]);
});

test("SQL-nøgleord fra INHERITS og IF NOT EXISTS opfanges ikke som objekter", () => {
  const sql = `
CREATE TABLE public.child_tbl (id uuid) INHERITS (parent_tbl);
ALTER TABLE t ADD CONSTRAINT IF NOT EXISTS c_navn CHECK (x > 0);
`;
  const names = extractObjects(sql).map((o) => o.name);
  assert.ok(!names.includes("inherits"), "INHERITS er et nøgleord, ikke en tabel");
  assert.ok(!names.includes("if"), "IF NOT EXISTS må ikke blive et constraint-navn");
  assert.ok(names.includes("child_tbl") && names.includes("c_navn"));
});

test("dubletter kollapses", () => {
  const sql = `
CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 2 $$;
`;
  assert.equal(extractObjects(sql).length, 1);
});

test("genereret SQL sorterer positionelt — `check` er reserveret i ORDER BY", () => {
  const sql = buildSql([{ file: "a.sql", objects: [{ kind: "table", name: "t" }] }]);
  assert.match(sql, /order by 1, 2;/);
  assert.ok(!/order by severity, check/.test(sql), "bart `check` i ORDER BY er en Postgres-syntaksfejl");
});

test("filer uden erklærede objekter rapporteres som INFO, ikke som tavshed", () => {
  const sql = buildSql([
    { file: "data-only.sql", objects: [] },
    { file: "har-objekt.sql", objects: [{ kind: "table", name: "t" }] },
  ]);
  assert.match(sql, /proposal_not_checkable/);
  assert.match(sql, /data-only\.sql/);
});

test("kun-utjekbare filer giver stadig gyldig SQL", () => {
  const sql = buildSql([{ file: "kun-data.sql", objects: [] }]);
  assert.match(sql, /proposal_not_checkable/);
  assert.ok(!/with declared/.test(sql), "ingen VALUES-liste når der ikke er objekter at slå op");
});

test("tom mappe giver en SQL der returnerer nul rækker", () => {
  const sql = buildSql([]);
  assert.match(sql, /where false/);
});

test("apostroffer i filnavne escapes", () => {
  const sql = buildSql([{ file: "o'brien.sql", objects: [{ kind: "table", name: "t" }] }]);
  assert.match(sql, /'o''brien\.sql'/);
});
