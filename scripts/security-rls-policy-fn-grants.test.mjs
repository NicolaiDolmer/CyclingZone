import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Selvtest af forward-guarden i #2671.
//
// Selve tjekket er ren SQL og kan kun køres mod en database. Det denne fil
// beskytter er de to måder guarden kan dø tavst på uden at nogen opdager det:
//
//   1. Whitelisten vokser. Klassen har bidt 3x, og hver gang så det ud som om
//      ét enkelt undtagelsestilfælde var uskadeligt. En whitelist-post uden en
//      dokumenteret beslutning er præcis den tavshed tjekket findes for at
//      bryde, så hver post skal pege på en learning-fil der FAKTISK ligger der.
//   2. Scriptet falder ud af workflowet. En sql-fil ingen kører er ikke en
//      guard. Testen kræver at psql-kaldet, has_findings-gaten og exit-stien
//      alle stadig nævner den.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sqlPath = join(here, "security-rls-policy-fn-grants.sql");
const workflowPath = join(repoRoot, ".github/workflows/security-grants-audit.yml");

const sql = readFileSync(sqlPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");

/**
 * Trækker whitelistens VALUES-rækker ud som rå tekst. Bevidst tekstuel: en
 * SQL-parser ville være mere præcis, men også noget der selv kan gå i stykker
 * uden at nogen ser det, og formen her er fast.
 */
function whitelistRows(text) {
  const start = text.indexOf("allowed(tbl, polname, proname, polrole, why) AS (");
  assert.notEqual(start, -1, "whitelist-CTE'en 'allowed' skal findes i scriptet");
  const rest = text.slice(start);
  const end = rest.indexOf("\n)\n");
  assert.notEqual(end, -1, "whitelist-CTE'en skal være afsluttet");
  const body = rest.slice(0, end);
  return [...body.matchAll(/\(\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\)/g)].map(
    (m) => ({ tbl: m[1], polname: m[2], proname: m[3], polrole: m[4], why: m[5] })
  );
}

test("hver whitelist-post peger paa en learning-fil der findes", () => {
  const rows = whitelistRows(sql);
  assert.ok(rows.length > 0, "forventer mindst den kendte riders-post");
  for (const row of rows) {
    const label = `${row.tbl} / ${row.polname} / ${row.proname} / ${row.polrole}`;
    const match = row.why.match(/\.claude\/learnings\/[\w./-]+\.md/);
    assert.ok(match, `whitelist-posten ${label} mangler en learning-reference i begrundelsen`);
    assert.ok(
      existsSync(join(repoRoot, match[0])),
      `whitelist-posten ${label} peger paa ${match[0]}, som ikke findes i repoet`
    );
  }
});

test("whitelisten daekker kun anon, ikke authenticated", () => {
  // En manglende EXECUTE for `authenticated` betyder at indloggede spillere
  // faar 42501 paa hele tabellen. Det er aldrig en acceptabel fail-closed
  // tilstand, og maa derfor ikke kunne whitelistes stille.
  for (const row of whitelistRows(sql)) {
    assert.notEqual(
      row.polrole,
      "authenticated",
      `${row.tbl} / ${row.polname} / ${row.proname}: authenticated maa ikke whitelistes, kør GRANT i stedet`
    );
  }
});

test("den kendte riders-post staar uaendret i whitelisten", () => {
  const rows = whitelistRows(sql);
  const riders = rows.find(
    (r) =>
      r.tbl === "riders" &&
      r.polname === "Public read riders" &&
      r.proname === "is_offered_intake_rider" &&
      r.polrole === "anon"
  );
  assert.ok(
    riders,
    "riders / Public read riders / is_offered_intake_rider / anon skal blive staaende, ellers gaar det daglige tjek roedt paa en kendt, accepteret tilstand"
  );
});

test("scriptet er wiret ind i security-grants-audit.yml", () => {
  assert.match(
    workflow,
    /psql "\$DB_URL"[^\n]*-f scripts\/security-rls-policy-fn-grants\.sql/,
    "workflowet skal koere scriptet med psql"
  );
  assert.match(workflow, /id: policyfn/, "psql-steppet skal have id'et 'policyfn'");
  assert.match(
    workflow,
    /steps\.policyfn\.outputs\.has_findings == 'true'/,
    "fund skal gate baade issue-oprettelsen og exit-stien"
  );
  assert.match(
    workflow,
    /- 'scripts\/security-rls-policy-fn-grants\.sql'/,
    "scriptet skal staa i pull_request-paths, ellers reviewes aendringer i det uden at vagten koerer"
  );
});

test("scriptet overholder output-kontrakten severity | check | detail", () => {
  // Workflowet splitter paa '|' og forventer praecis tre kolonner pr. raekke.
  for (const check of ["policy_fn_missing_execute", "policy_fn_whitelist_stale", "policy_fn_name_not_regex_safe"]) {
    assert.ok(sql.includes(`'${check}'`), `check-navnet ${check} skal findes i scriptet`);
  }
  assert.match(sql, /AS severity/, "foerste kolonne skal hedde severity");
  assert.match(sql, /AS detail/, "tredje kolonne skal hedde detail");
});
