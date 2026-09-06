import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSql, maskComments } from "./check-secdef-revoke-lint.mjs";

// Den ægte #3765-fil, forkortet: REVOKE ... FROM PUBLIC + GRANT service_role.
// Præcis det mønster der føltes sikkert og ikke var det.
const THE_3765_MISTAKE = `
CREATE OR REPLACE FUNCTION public.apply_race_results_batch(p_race_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public.race_results WHERE race_id = p_race_id;
  RETURN '{}'::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_race_results_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_race_results_batch(uuid) TO service_role;
`;

test("fanger #3765: REVOKE FROM PUBLIC alene er ikke nok", () => {
  const { findings } = analyzeSql(THE_3765_MISTAKE);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].function, "apply_race_results_batch");
  assert.deepEqual(findings[0].missingRevokeFor, ["anon", "authenticated"]);
});

test("accepterer en korrekt lukket funktion", () => {
  const sql = `
CREATE OR REPLACE FUNCTION public.f(a uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE ALL ON FUNCTION public.f(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

test("delvis lukning fanges — kun anon revoked", () => {
  const sql = `
CREATE FUNCTION public.f(a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon;
`;
  const { findings } = analyzeSql(sql);
  assert.deepEqual(findings[0].missingRevokeFor, ["authenticated"]);
});

test("SECURITY INVOKER (default) er ikke et fund", () => {
  const sql = `
CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
  assert.deepEqual(analyzeSql(sql).secdefFunctions, []);
});

test("SECURITY DEFINER i funktion 2 smitter ikke af på funktion 1", () => {
  const sql = `
CREATE FUNCTION public.plain() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
CREATE FUNCTION public.privileged() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.privileged() FROM anon, authenticated;
`;
  const { secdefFunctions, findings } = analyzeSql(sql);
  assert.deepEqual(secdefFunctions, ["privileged"]);
  assert.deepEqual(findings, []);
});

test("allow-markør med begrundelse undertrykker fundet", () => {
  const sql = `
-- secdef-lint: allow is_admin (read-only, returnerer false for anon — fjerner 42501-stoej fra RLS)
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN false; END; $$;
`;
  const { findings, allowed } = analyzeSql(sql);
  assert.deepEqual(findings, []);
  assert.deepEqual(allowed, ["is_admin"]);
});

test("allow-markør UDEN begrundelse tæller ikke — fundet består", () => {
  const sql = `
-- secdef-lint: allow is_admin ()
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN false; END; $$;
`;
  assert.equal(analyzeSql(sql).findings.length, 1);
});

test("funktioner uden for public ignoreres", () => {
  const sql = `
CREATE FUNCTION auth.something() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

test("navngivet dollar-tag ($function$) afgrænses korrekt", () => {
  const sql = `
CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$ BEGIN NULL; END; $function$;
REVOKE EXECUTE ON FUNCTION public.f() FROM anon, authenticated;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

// ── #4870: kommentarer tæller ikke, og en re-GRANT er et fund ────────────────

// Formen fra database/2026-09-03-4649-founder-public.sql: den eneste REVOKE i
// filen står i rollback-kommentaren, den kørende SQL granter til authenticated.
const COMMENTED_REVOKE_ONLY = `
-- Rollback:
--   REVOKE EXECUTE ON FUNCTION public.founder_public_list() FROM anon, authenticated;
--   DROP FUNCTION IF EXISTS public.founder_public_list();
CREATE OR REPLACE FUNCTION public.founder_public_list()
RETURNS TABLE (team_id uuid) LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
GRANT EXECUTE ON FUNCTION public.founder_public_list() TO authenticated;
`;

test("#4870: REVOKE i en rollback-kommentar lukker ikke hullet", () => {
  const { findings } = analyzeSql(COMMENTED_REVOKE_ONLY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].function, "founder_public_list");
  assert.deepEqual(findings[0].missingRevokeFor, ["anon", "authenticated"]);
  assert.deepEqual(findings[0].grantedTo, ["authenticated"]);
});

test("#4870: REVOKE + efterfølgende re-GRANT til authenticated er et fund", () => {
  const sql = `
CREATE FUNCTION public.f(a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated;
`;
  const { findings } = analyzeSql(sql);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].missingRevokeFor, []);
  assert.deepEqual(findings[0].grantedTo, ["authenticated"]);
});

test("#4870: GRANT til service_role alene er ikke et fund", () => {
  const sql = `
CREATE FUNCTION public.f(a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

test("#4870: allow-markøren undertrykker også re-GRANT-fundet", () => {
  const sql = `
-- secdef-lint: allow f (bevidst klient-kaldbar, gater selv paa is_admin())
CREATE FUNCTION public.f(a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

test("#4870: blokkommentar med CREATE + REVOKE ignoreres helt", () => {
  const sql = `
/* Historik:
   CREATE FUNCTION public.gammel() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $x$ BEGIN NULL; END; $x$;
   REVOKE EXECUTE ON FUNCTION public.gammel() FROM anon, authenticated;
*/
CREATE FUNCTION public.ny() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.ny() FROM anon, authenticated;
`;
  const { secdefFunctions, findings } = analyzeSql(sql);
  assert.deepEqual(secdefFunctions, ["ny"]);
  assert.deepEqual(findings, []);
});

test("#4870: maskering bevarer længde og newlines", () => {
  const sql = "SELECT 1; -- hej\nSELECT 2;\n";
  const masked = maskComments(sql);
  assert.equal(masked.length, sql.length);
  assert.equal(masked.split("\n").length, sql.split("\n").length);
  assert.match(masked, /SELECT 1;\s+\nSELECT 2;/);
});

test("#4870: '--' inde i en streng maskeres ikke væk", () => {
  const sql = `
CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
COMMENT ON FUNCTION public.f() IS 'note -- ikke en kommentar';
REVOKE EXECUTE ON FUNCTION public.f() FROM anon, authenticated;
`;
  assert.deepEqual(analyzeSql(sql).findings, []);
});

test("REVOKE der nævner en ANDEN funktion lukker ikke hullet", () => {
  const sql = `
CREATE FUNCTION public.target() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
REVOKE EXECUTE ON FUNCTION public.other() FROM anon, authenticated;
`;
  assert.equal(analyzeSql(sql).findings.length, 1);
  assert.equal(analyzeSql(sql).findings[0].function, "target");
});
