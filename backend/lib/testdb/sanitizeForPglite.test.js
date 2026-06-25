// Unit-test for sanitizeForPglite (#1840 pre-live contract-harness, Part B).
//
// sanitizeForPglite fjerner Supabase-/Postgres-statements som PGlite ikke kan køre
// (eller som er irrelevante for kolonne-kontrakt-tests): CREATE/DROP POLICY,
// ENABLE/DISABLE ROW LEVEL SECURITY, GRANT, REVOKE, CREATE EXTENSION, COMMENT ON.
// Den BEVARER al strukturel DDL: CREATE TABLE, ALTER TABLE ... ADD COLUMN,
// CHECK-constraints, INDEX. Hele pointen er at den ægte committede DDL kan loades
// mod en in-memory Postgres, så et select af en ikke-eksisterende kolonne fejler
// (fidelitets-beviset bag #1840).

import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeForPglite } from "./sanitizeForPglite.js";

test("fjerner CREATE POLICY (en-linje og fler-linje med USING)", () => {
  const sql = `
    CREATE TABLE riders (id uuid PRIMARY KEY, team_id uuid);
    CREATE POLICY "Public read riders" ON riders FOR SELECT USING (true);
    CREATE POLICY academy_owner_read ON academy_intake
      FOR SELECT TO authenticated
      USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
  `;
  const out = sanitizeForPglite(sql);
  assert.doesNotMatch(out, /CREATE POLICY/i);
  assert.doesNotMatch(out, /USING \(/i);
  assert.match(out, /CREATE TABLE riders/i);
});

test("fjerner DROP POLICY", () => {
  const out = sanitizeForPglite(`DROP POLICY IF EXISTS foo ON riders;\nCREATE TABLE t (id int);`);
  assert.doesNotMatch(out, /DROP POLICY/i);
  assert.match(out, /CREATE TABLE t/i);
});

test("fjerner ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY men bevarer ADD COLUMN", () => {
  const sql = `
    ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE riders DISABLE ROW LEVEL SECURITY;
    ALTER TABLE riders ADD COLUMN IF NOT EXISTS primary_type TEXT;
  `;
  const out = sanitizeForPglite(sql);
  assert.doesNotMatch(out, /ROW LEVEL SECURITY/i);
  assert.match(out, /ADD COLUMN IF NOT EXISTS primary_type/i);
});

test("fjerner GRANT og REVOKE", () => {
  const sql = `
    GRANT SELECT ON sponsor_contracts TO authenticated;
    GRANT SELECT (primary_type) ON riders TO anon, authenticated;
    REVOKE ALL ON academy_intake FROM anon;
    CREATE TABLE keep (id int);
  `;
  const out = sanitizeForPglite(sql);
  assert.doesNotMatch(out, /\bGRANT\b/i);
  assert.doesNotMatch(out, /\bREVOKE\b/i);
  assert.match(out, /CREATE TABLE keep/i);
});

test("fjerner CREATE EXTENSION", () => {
  const out = sanitizeForPglite(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\nCREATE TABLE t (id int);`);
  assert.doesNotMatch(out, /CREATE EXTENSION/i);
  assert.match(out, /CREATE TABLE t/i);
});

test("fjerner COMMENT ON TABLE og COMMENT ON COLUMN (også fler-linje)", () => {
  const sql = `
    COMMENT ON TABLE academy_intake IS 'noget';
    COMMENT ON COLUMN riders.primary_type IS
      'Primær ryttertype (#49). '
      'Fler-linje literal.';
    ALTER TABLE riders ADD COLUMN secondary_type TEXT;
  `;
  const out = sanitizeForPglite(sql);
  assert.doesNotMatch(out, /COMMENT ON/i);
  assert.match(out, /ADD COLUMN secondary_type/i);
});

test("BEVARER CREATE TABLE med CHECK-constraint og GENERATED-kolonne", () => {
  const sql = `
    CREATE TABLE riders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      firstname TEXT NOT NULL,
      contract_length INTEGER CHECK (contract_length IS NULL OR contract_length BETWEEN 1 AND 3),
      full_name TEXT GENERATED ALWAYS AS (firstname) STORED
    );
  `;
  const out = sanitizeForPglite(sql);
  assert.match(out, /CREATE TABLE riders/i);
  assert.match(out, /CHECK \(contract_length/i);
  assert.match(out, /GENERATED ALWAYS AS/i);
});

test("er ren funktion — muterer ikke input, returnerer streng", () => {
  const input = `CREATE POLICY p ON t USING (true);\nCREATE TABLE t (id int);`;
  const copy = String(input);
  const out = sanitizeForPglite(input);
  assert.equal(typeof out, "string");
  assert.equal(input, copy, "input uændret");
});
