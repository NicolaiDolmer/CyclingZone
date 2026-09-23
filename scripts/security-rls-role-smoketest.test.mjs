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

// #5375 — falsk alarm: en SUND koersel (ingen reelle fund) blev alligevel
// rapporteret som CRITICAL. Aarsag: scriptet wrapper sig i
// BEGIN/CREATE TEMP TABLE/GRANT/DO $$...$$/ROLLBACK, og psql printer en bar
// kommando-tag-linje ("BEGIN", "CREATE TABLE", "GRANT", "DO", "ROLLBACK")
// for hver af disse ikke-SELECT-kommandoer naar scriptet koeres med -f. Det
// er UPAAVIRKET af -tA (tuples-only styrer kun SELECT-resultatets
// header/footer, ikke kommando-status-linjer) og laekkede derfor direkte ind
// i FINDINGS via workflowets `sed '/^$/d'`-filter, som kun fjerner TOMME
// linjer - ikke disse. -q (quiet) undertrykker kommando-tags, saa kun
// scriptets reelle severity|check|detail-output fra SELECT'et bliver
// tilbage.
test("psql-kaldet for smoketest-trinnet bruger -q, ellers laekker BEGIN/CREATE TABLE/GRANT/DO/ROLLBACK som falske fund (#5375)", () => {
  const smoketestStep = workflow.split(/\n\s*- name: Kør RLS-role-smoketest\b/)[1];
  assert.ok(smoketestStep, "smoketest-steppet ('Kør RLS-role-smoketest') skal findes i workflowet");
  const runBlock = smoketestStep.split(/\n\s*- name: /)[0];
  assert.match(
    runBlock,
    /psql "\$DB_URL" -q -tA -F '\|' -v ON_ERROR_STOP=1 -f scripts\/security-rls-role-smoketest\.sql/,
    "psql-kaldet skal have -q FOER -tA, ellers laekker kommando-tags som falske fund (#5375)"
  );
});

test("de tre andre psql-trin i workflowet har ikke BEGIN/CREATE TABLE/GRANT/DO-moenstret og behoever derfor ikke -q", () => {
  // Kun scripts der selv aabner en transaktion / opretter noget / GRANT'er
  // noget udloeser bar-kommando-tag-problemet fra #5375 - en ren SELECT (evt.
  // i en "with ... select" CTE-kaede) goer det ikke, fordi -tA allerede
  // undertrykker header/footer for SELECT-tuple-output.
  const otherScripts = [
    join(repoRoot, "scripts/security-grants.sql"),
    join(repoRoot, "scripts/security-rls-policy-fn-grants.sql"),
  ];
  for (const path of otherScripts) {
    const text = readFileSync(path, "utf8");
    assert.ok(
      !/^\s*(BEGIN|CREATE TABLE|CREATE TEMP TABLE|GRANT |DO \$\$)/m.test(text),
      `${path} har faaet et top-niveau BEGIN/CREATE TABLE/GRANT/DO-moenster - tilfoej -q til dens psql-kald i .github/workflows/security-grants-audit.yml (samme klasse som #5375)`
    );
  }
});

/**
 * Simulerer psql's stdout for scriptets faste, ikke-SELECT-kommandoer
 * (BEGIN, CREATE TEMP TABLE, GRANT, DO $$...$$, ROLLBACK) i en koersel UDEN
 * reelle fund (den afsluttende SELECT returnerer 0 raekker). Modellerer kun
 * det trae der udloeste #5375 - ikke en fuld psql-parser.
 */
function simulateSmoketestPsqlOutput({ quiet }) {
  const commandTagLines = quiet ? [] : ["BEGIN", "CREATE TABLE", "GRANT", "DO", "ROLLBACK"];
  const selectDataLines = []; // -tA + 0 fund = ingen datalinjer, med eller uden -q
  return [...commandTagLines, ...selectDataLines].join("\n");
}

// Samme filter som workflowet bruger: `sed '/^$/d'` fjerner kun TOMME linjer.
function stripBlankLines(text) {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .join("\n");
}

test("simulering: uden -q ser en fundfri koersel alligevel ikke-tom ud (reproducerer #5375's falske CRITICAL)", () => {
  const findings = stripBlankLines(simulateSmoketestPsqlOutput({ quiet: false }));
  assert.notEqual(
    findings,
    "",
    "dokumenterer roden til #5375: uden -q er FINDINGS ikke-tom selvom scriptets SELECT ikke fandt noget"
  );
});

test("simulering: med -q er en fundfri koersel tom, saa has_findings korrekt bliver false", () => {
  const findings = stripBlankLines(simulateSmoketestPsqlOutput({ quiet: true }));
  assert.equal(
    findings,
    "",
    "med -q skal en koersel uden reelle fund give tom FINDINGS (has_findings=false) - regressionstest for #5375"
  );
});
