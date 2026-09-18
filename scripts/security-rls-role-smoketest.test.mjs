import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Selvtest af runtime-smoketesten i #2671 (punkt 2).
//
// Selve tjekket er ren SQL (SET LOCAL ROLE + rigtige SELECTs mod prod) og kan
// kun køres mod en database — se PR-slutrapporten for et live-bevis kørt
// read-only mod prod 18/9. Det denne fil beskytter er de tavse dødsmåder:
//
//   1. Whitelisten her drifter fra den statiske whitelist i
//      security-rls-policy-fn-grants.sql (punkt 1). De to tjek er
//      uafhængige metoder for SAMME fejlklasse; hvis de er uenige om hvilke
//      (tabel, rolle)-par der er en bevidst fail-closed-beslutning, er
//      mindst ét af dem forkert.
//   2. Whitelisten her er nøglet på funktionsnavn i stedet for (tabel,
//      rolle). Målt live 18/9: samme (riders, anon)-par rapporterer
//      "permission denied for function is_admin" i én kørsel, fordi
//      Postgres kortslutter en `a() OR b()`-policy og ikke er forpligtet
//      til at evaluere begge grene i samme rækkefølge hver gang. En
//      funktions-nøglet whitelist ville derfor kunne give falske
//      "whitelist_stale"-fund uafhængigt af databasens faktiske tilstand.
//   3. Scriptet falder ud af workflowet.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sqlPath = join(here, "security-rls-role-smoketest.sql");
const policyFnSqlPath = join(here, "security-rls-policy-fn-grants.sql");
const workflowPath = join(repoRoot, ".github/workflows/security-grants-audit.yml");

const sql = readFileSync(sqlPath, "utf8");
const policyFnSql = readFileSync(policyFnSqlPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");

/**
 * Trækker denne fils whitelist ud: VALUES ('tbl', 'polrole', 'why'). Nøglet
 * kun på (tbl, polrole) — se header-kommentaren i .sql-filen for hvorfor en
 * funktions-kolonne ville gøre denne whitelist flaky.
 */
function smoketestWhitelistRows(rawText) {
  const text = rawText.replace(/\r\n/g, "\n");
  const start = text.indexOf("WITH allowed(tbl, polrole, why) AS (");
  assert.notEqual(start, -1, "whitelist-CTE'en 'allowed' skal findes i scriptet");
  const rest = text.slice(start);
  const end = rest.indexOf("\n)\n");
  assert.notEqual(end, -1, "whitelist-CTE'en skal være afsluttet");
  const body = rest.slice(0, end);
  return [...body.matchAll(/\(\s*'([^']*)',\s*'([^']*)',\s*'((?:[^'])*)'\s*\)/g)].map((m) => ({
    tbl: m[1],
    polrole: m[2],
    why: m[3],
  }));
}

/**
 * Trækker whitelisten fra security-rls-policy-fn-grants.sql (punkt 1) ud,
 * som (tbl, polrole)-par uden hensyn til funktionsnavnet — det er præcis
 * den granularitet der skal stemme overens på tværs af de to scripts.
 */
function policyFnWhitelistPairs(rawText) {
  const text = rawText.replace(/\r\n/g, "\n");
  const start = text.indexOf("allowed(tbl, polname, proname, polrole, why) AS (");
  assert.notEqual(start, -1, "whitelist-CTE'en i security-rls-policy-fn-grants.sql skal findes");
  const rest = text.slice(start);
  const end = rest.indexOf("\n)\n");
  assert.notEqual(end, -1, "whitelist-CTE'en i security-rls-policy-fn-grants.sql skal være afsluttet");
  const body = rest.slice(0, end);
  const rows = [...body.matchAll(/\(\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\)/g)].map(
    (m) => ({ tbl: m[1], polname: m[2], proname: m[3], polrole: m[4] })
  );
  return new Set(rows.map((r) => `${r.tbl}::${r.polrole}`));
}

test("hver whitelist-post peger paa en learning-fil der findes", () => {
  const rows = smoketestWhitelistRows(sql);
  assert.ok(rows.length > 0, "forventer mindst den kendte riders-post");
  for (const row of rows) {
    const label = `${row.tbl} / ${row.polrole}`;
    const match = row.why.match(/\.claude\/learnings\/[\w./-]+\.md/);
    assert.ok(match, `whitelist-posten ${label} mangler en learning-reference i begrundelsen`);
    assert.ok(
      existsSync(join(repoRoot, match[0])),
      `whitelist-posten ${label} peger paa ${match[0]}, som ikke findes i repoet`
    );
  }
});

test("whitelisten daekker kun anon, ikke authenticated", () => {
  for (const row of smoketestWhitelistRows(sql)) {
    assert.notEqual(
      row.polrole,
      "authenticated",
      `${row.tbl}: authenticated maa ikke whitelistes her, kør GRANT i stedet`
    );
  }
});

test("smoketestens whitelist er en delmaengde af security-rls-policy-fn-grants.sql's whitelist", () => {
  const smoketestPairs = smoketestWhitelistRows(sql).map((r) => `${r.tbl}::${r.polrole}`);
  const policyFnPairs = policyFnWhitelistPairs(policyFnSql);
  for (const pair of smoketestPairs) {
    assert.ok(
      policyFnPairs.has(pair),
      `${pair} er whitelistet i smoketesten, men findes ikke som (tabel, rolle) i ` +
        "security-rls-policy-fn-grants.sql's whitelist - de to tjek er ude af sync"
    );
  }
});

test("den kendte riders/anon-post staar uaendret i whitelisten", () => {
  const rows = smoketestWhitelistRows(sql);
  const riders = rows.find((r) => r.tbl === "riders" && r.polrole === "anon");
  assert.ok(
    riders,
    "riders/anon skal blive staaende, ellers gaar det periodiske tjek roedt paa en kendt, accepteret tilstand"
  );
});

test("scriptet er wiret ind i security-grants-audit.yml", () => {
  assert.match(
    workflow,
    /psql "\$DB_URL"[^\n]*-f scripts\/security-rls-role-smoketest\.sql/,
    "workflowet skal koere scriptet med psql"
  );
  assert.match(workflow, /id: smoketest/, "psql-steppet skal have id'et 'smoketest'");
  assert.match(
    workflow,
    /steps\.smoketest\.outputs\.has_findings == 'true'/,
    "fund skal gate baade issue-oprettelsen og exit-stien"
  );
  assert.match(
    workflow,
    /- 'scripts\/security-rls-role-smoketest\.sql'/,
    "scriptet skal staa i pull_request-paths, ellers reviewes aendringer i det uden at vagten koerer"
  );
});

test("scriptet overholder output-kontrakten severity | check | detail", () => {
  for (const check of ["rls_smoketest_fn_denied", "rls_smoketest_whitelist_stale"]) {
    assert.ok(sql.includes(`'${check}'`), `check-navnet ${check} skal findes i scriptet`);
  }
  assert.match(sql, /AS severity/, "foerste kolonne skal hedde severity");
  assert.match(sql, /AS detail/, "sidste kolonne skal hedde detail");
});

test("hele scriptet koerer i en transaktion der rulles tilbage - ingen prod-mutation", () => {
  const trimmed = sql.trim();
  assert.match(sql, /^\s*BEGIN;/m, "scriptet skal aabne en transaktion med BEGIN;");
  assert.ok(trimmed.endsWith("ROLLBACK;"), "scriptet skal slutte med ROLLBACK; uanset udfald");
  assert.ok(!/\bCOMMIT;/.test(sql), "scriptet maa aldrig committe - kun ROLLBACK er tilladt");
});
