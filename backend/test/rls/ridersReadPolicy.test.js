// #6341 — regressionsvagt for riders-læsepolicyen "Public read riders".
//
// Policyen ligger på spillets hotteste læsesti (alle rytterlister henter
// riders direkte via PostgREST som authenticated). To fejlklasser har bidt
// den, og denne fil fanger begge statisk mod den SENESTE migration der
// sætter policyen:
//
//   1. PERFORMANCE (#6341): en SECURITY DEFINER-funktion i USING kaldes pr.
//      række (kan ikke inlines). is_admin() SKAL være pakket i (SELECT ...)
//      så den bliver en InitPlan, og intake-reglen SKAL være set-baseret
//      (én kaldt-én-gang-helper + IN-subquery → hashed SubPlan), ikke
//      is_offered_intake_rider(id) pr. række. Målt 8/10: riders-scanningen
//      faldt fra ~190-350 ms til ~30 ms, identisk rækkeantal.
//   2. LÆKAGE (#1743): en rå subquery mod academy_intake i policyen kører
//      under kalderens RLS (academy_intake_owner_read = eget hold), så andre
//      holds tilbudte kandidater ville blive synlige. Opslaget SKAL gå
//      gennem en SECURITY DEFINER-helper.
//
// Plus: helperen skal have PRÆCIS samme betingelser som den oprindelige
// is_offered_intake_rider(uuid), ellers ændres hvad spillere ser.
//
// Runtime-delen (EXPLAIN som authenticated + symmetrisk differens = 0) står
// som post-verify i selve migrationen og køres efter apply (#2642); den
// kræver en database og kan ikke køre i CI her.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const dbDir = join(repoRoot, "database");

// CRLF i Windows-checkouts (core.autocrlf) må ikke give falske fejl lokalt.
const readLf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

// Fjern linje-kommentarer, så forklarende prosa (der citerer de gamle
// udtryk) ikke tæller som kode.
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");

const squash = (s) => s.replace(/\s+/g, " ").trim();

const migrations = readdirSync(dbDir)
  .filter((f) => /^2026-.*\.sql$/.test(f))
  .sort();

const POLICY_RE = /ALTER POLICY "Public read riders" ON public\.riders\s+USING\s*\(([\s\S]*?)\);/g;

function latestPolicy() {
  let found = null;
  for (const file of migrations) {
    const sql = stripComments(readLf(join(dbDir, file)));
    for (const m of sql.matchAll(POLICY_RE)) found = { file, using: squash(m[1]) };
  }
  assert.ok(found, "fandt ingen ALTER POLICY \"Public read riders\" i database/2026-*.sql");
  return found;
}

function functionBody(file, name) {
  const sql = readLf(join(dbDir, file));
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(([^)]*)\\)([\\s\\S]*?)AS \\$\\$([\\s\\S]*?)\\$\\$;`
  );
  const m = sql.match(re);
  assert.ok(m, `${name}() skal være defineret i ${file}`);
  return { args: m[1], header: squash(m[2]), body: squash(m[3]) };
}

function latestFileDefining(name) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`);
  const hits = migrations.filter((f) => re.test(readLf(join(dbDir, f))));
  assert.ok(hits.length > 0, `ingen migration definerer ${name}()`);
  return hits[hits.length - 1];
}

test("is_admin() er pakket i (SELECT ...) — InitPlan, ikke kald pr. række", () => {
  const { file, using } = latestPolicy();
  assert.match(using, /\(\s*SELECT public\.is_admin\(\)\s*\)/i, `${file}: is_admin() skal stå som (SELECT public.is_admin())`);
  assert.doesNotMatch(
    using.replace(/\(\s*SELECT public\.is_admin\(\)\s*\)/gi, ""),
    /is_admin\s*\(/,
    `${file}: is_admin() må ikke også stå ukapslet i policyen`
  );
});

test("intake-reglen er set-baseret, ikke is_offered_intake_rider(id) pr. række", () => {
  const { file, using } = latestPolicy();
  assert.doesNotMatch(using, /is_offered_intake_rider\s*\(/, `${file}: policyen kalder stadig funktionen pr. række`);
  assert.match(
    using,
    /NOT \(\s*id IN \(\s*SELECT [\w.]+ FROM public\.offered_intake_rider_ids\(\)/i,
    `${file}: forventet NOT (id IN (SELECT ... FROM public.offered_intake_rider_ids() ...))`
  );
});

test("policyen læser IKKE academy_intake direkte (ville lække andre holds kandidater)", () => {
  const { file, using } = latestPolicy();
  assert.doesNotMatch(
    using,
    /academy_intake/,
    `${file}: en rå subquery kører under kalderens RLS (eget hold) — brug SECURITY DEFINER-helperen`
  );
});

test("offered_intake_rider_ids() er SECURITY DEFINER, STABLE, låst search_path, SETOF uuid", () => {
  const file = latestFileDefining("offered_intake_rider_ids");
  const { args, header } = functionBody(file, "offered_intake_rider_ids");
  assert.equal(args.trim(), "", "helperen tager ingen argumenter (kaldes én gang pr. query)");
  assert.match(header, /RETURNS SETOF uuid/);
  assert.match(header, /\bSTABLE\b/);
  assert.match(header, /\bSECURITY DEFINER\b/);
  assert.match(header, /SET search_path = public, pg_catalog/);
});

test("helperen har PRÆCIS samme betingelser som is_offered_intake_rider(uuid) — identisk synlighed", () => {
  const oldFile = latestFileDefining("is_offered_intake_rider");
  const newFile = latestFileDefining("offered_intake_rider_ids");
  const oldBody = functionBody(oldFile, "is_offered_intake_rider").body;
  const newBody = functionBody(newFile, "offered_intake_rider_ids").body;

  const conditions = (body) => {
    const where = body.match(/WHERE ([\s\S]*?)(?:\)\s*;?\s*$|;\s*$|$)/);
    assert.ok(where, "WHERE-klausul mangler");
    return where[1]
      .split(/\bAND\b/i)
      .map((c) => squash(c).replace(/\)+$/, ""))
      .filter((c) => !/p_rider_id/.test(c))
      .sort();
  };

  assert.match(oldBody, /JOIN public\.riders r ON r\.id = ai\.rider_id/);
  assert.match(newBody, /JOIN public\.riders r ON r\.id = ai\.rider_id/);
  assert.match(newBody, /FROM public\.academy_intake ai/);
  assert.deepEqual(conditions(newBody), conditions(oldBody));
  assert.deepEqual(conditions(newBody), ["ai.status = 'offered'", "r.is_academy = false", "r.team_id IS NULL"]);
});

test("grants: authenticated + service_role får EXECUTE, anon gør IKKE (uændret fail-closed)", () => {
  const file = latestFileDefining("offered_intake_rider_ids");
  const sql = squash(stripComments(readLf(join(dbDir, file))));
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.offered_intake_rider_ids\(\) FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.offered_intake_rider_ids\(\) FROM anon;/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.offered_intake_rider_ids\(\) TO authenticated, service_role;/
  );
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.offered_intake_rider_ids\(\) TO [^;]*\banon\b/);
});

test("drift-vagterne kender den nye helper (ellers rød 6-timers-audit / ugentlig sweep)", () => {
  const fnGrants = readLf(join(repoRoot, "scripts", "security-rls-policy-fn-grants.sql"));
  assert.match(fnGrants, /'riders', 'Public read riders', 'offered_intake_rider_ids', 'anon'/);
  assert.doesNotMatch(fnGrants, /'riders', 'Public read riders', 'is_offered_intake_rider', 'anon'/);

  const allowlist = JSON.parse(readLf(join(repoRoot, "scripts", "ops", "supabase-advisor-allowlist.json")));
  assert.ok(
    allowlist.acceptedCacheKeys.some((e) =>
      e.cacheKeyPrefix === "authenticated_security_definer_function_executable_public_offered_intake_rider_ids_"
    ),
    "0029-fundet for offered_intake_rider_ids() skal stå i advisor-allowlisten"
  );
});
