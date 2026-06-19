// Forward-guard mod #1465-bug-klassen: en ny finance_transactions.type-værdi brugt
// i backend-koden, men UDEN en tilsvarende værdi i CHECK-constraintet i database/*.sql.
//
// #1465 (twin af #1463 'upkeep'-bug'en): koden krediterer 'forced_debt_sale' via
// creditTeam(...) i economyEngine, men typen blev aldrig tilføjet til
// finance_transactions_type_check → en ægte prod-INSERT fejler med check_violation
// (23514) midt i payroll-cron'en. Unit-testene kører mod en mock-supabase uden ægte
// CHECK, så de var grønne mens prod ville crashe. Audit: docs/audits/2026-06-19-enum-fk-drift-audit.md
// (Anbefaling 2 = denne tests kerne-leverance).
//
// Kontrakt-test i samme stil som adminRouteOwnership.test.js / orFilterParamGuard.test.js:
// rent statisk kilde-assertion (ingen DB), så driften fanges ved PR-tid.
//
// INVARIANT (det vi tester): MÆNGDEN af finance_transactions.type-string-literaler som
// backend-koden faktisk skriver ⊆ MÆNGDEN af værdier som finance_transactions_type_check
// CHECK'et tillader. (Subset, ikke lighed: CHECK'et MÅ gerne tillade ekstra værdier som
// ingen kode-sti skriver endnu, fx 'starting_budget' der seedes via SQL.)

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const repoRoot = join(backendRoot, "..");
const databaseDir = join(repoRoot, "database");

// ────────────────────────────────────────────────────────────────────────────
// 1. Parse de CHECK-tilladte finance_transactions.type-værdier fra database/*.sql.
//
// Constraintet redefineres over tid (DROP + ADD i hver migration), så hver
// "ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (...))" ERSTATTER
// fuldt den forrige liste. Den AUTORITATIVE er derfor den seneste daterede migration
// der redefinerer constraintet. database/schema.sql + supabase_setup.sql har en INLINE
// baseline-CHECK på selve CREATE TABLE der er ÆLDRE end migrationerne (mangler fx
// 'upkeep'/'forced_debt_sale') — kun fallback hvis ingen migration findes.
// ────────────────────────────────────────────────────────────────────────────

// Træk værdi-listen ud af en "type IN ( 'a','b', ... )"-klausul (string-literaler).
function parseTypeInList(clauseBody) {
  const values = [];
  const RE = /'([a-z_]+)'/g;
  let m;
  while ((m = RE.exec(clauseBody)) !== null) values.push(m[1]);
  return values;
}

// Find den autoritative CHECK-værdimængde. Returnerer { values, source }.
function loadCheckAllowedTypes() {
  const sqlFiles = readdirSync(databaseDir).filter((f) => f.endsWith(".sql"));

  // (a) Navngivne constraint-redefinitioner i daterede migrationer (autoritative).
  // Matcher: ADD CONSTRAINT finance_transactions_type_check CHECK (type IN ( ... ))
  const NAMED_RE =
    /ADD CONSTRAINT finance_transactions_type_check\s+CHECK\s*\(\s*type IN\s*\(([\s\S]*?)\)\s*\)/i;

  const namedDefs = [];
  for (const file of sqlFiles) {
    const src = readFileSync(join(databaseDir, file), "utf8");
    const m = src.match(NAMED_RE);
    if (m) namedDefs.push({ file, values: parseTypeInList(m[1]) });
  }

  if (namedDefs.length > 0) {
    // Filnavne er YYYY-MM-DD-...-præfikset → leksikografisk sortering = kronologisk.
    // Den seneste migration er den autoritative prod-state.
    namedDefs.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const latest = namedDefs[namedDefs.length - 1];
    return { values: new Set(latest.values), source: latest.file };
  }

  // (b) Fallback: inline CHECK på CREATE TABLE finance_transactions i base-skemaet.
  const INLINE_RE =
    /CREATE TABLE finance_transactions\s*\([\s\S]*?type TEXT NOT NULL CHECK\s*\(\s*type IN\s*\(([\s\S]*?)\)\s*\)/i;
  for (const file of ["schema.sql", "supabase_setup.sql"]) {
    if (!sqlFiles.includes(file)) continue;
    const src = readFileSync(join(databaseDir, file), "utf8");
    const m = src.match(INLINE_RE);
    if (m) return { values: new Set(parseTypeInList(m[1])), source: file };
  }

  return { values: new Set(), source: null };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Træk de finance_transactions.type-literaler ud som backend-koden SKRIVER.
//
// Tre — og kun tre — write-sinks rammer finance_transactions.type (bekræftet i
// audit'en + grep af lib/ + routes/):
//   A. incrementBalanceWithAudit(client, { ..., payload: { type: "X", ... } })
//      — balanceRpc-wrapperen hvis ENESTE formål er at INSERT'e i finance_transactions.
//   B. creditTeam(teamId, amount, "X", ...) / debitTeam(...) — economyEngine-helpere
//      der videresender 3.-positionsargumentet som payload.type til samme RPC.
//   C. await client.from("finance_transactions").insert({ type: "X", ... }) — direkte.
//
// Vi anker BEVIDST på disse tre kald-mønstre i stedet for en global `type:`-grep:
// `type:` er voldsomt overloadet i kodebasen (notifikationstyper, rytter-arketyper,
// PostgREST-operatorer som eq/in/gte, result_type, board-goal-typer …), så en bred
// grep ville give massevis af falske positiver. Anker-mønstrene er entydige.
// ────────────────────────────────────────────────────────────────────────────

const FINANCE_SOURCE_FILES = [
  "lib/economyEngine.js",
  "lib/auctionFinalization.js",
  "lib/squadEnforcement.js",
  "lib/academyIntake.js",
  "lib/prizePayoutEngine.js",
  "lib/loanEngine.js",
  "routes/api.js",
];

function extractCodeWrittenTypes() {
  const types = new Map(); // type -> [ "file:locator", ... ] (for fejlbeskeder)
  const record = (type, where) => {
    if (!types.has(type)) types.set(type, []);
    types.get(type).push(where);
  };

  for (const rel of FINANCE_SOURCE_FILES) {
    const src = readFileSync(join(backendRoot, rel), "utf8");

    // A. incrementBalanceWithAudit( ... payload: { type: "X" } ... )
    // Find hvert kald og scan dets argument-blok for det FØRSTE type: "literal".
    const CALL_RE = /incrementBalanceWithAudit\s*\(/g;
    let cm;
    while ((cm = CALL_RE.exec(src)) !== null) {
      // Slice et generøst vindue fra kaldet (payload ligger få linjer inde).
      const window = src.slice(cm.index, cm.index + 900);
      const tm = window.match(/\btype:\s*"([a-z_]+)"/);
      if (tm) record(tm[1], `${rel} (incrementBalanceWithAudit@${cm.index})`);
    }

    // B. creditTeam( ... , "X", ... ) / debitTeam( ... , "X", ... )
    // Signatur: (teamId, amount, type, description, ...). 3. positionsarg = type.
    // Vi matcher de tre første argumenter hvor det 3. er en string-literal.
    const HELPER_RE =
      /\b(creditTeam|debitTeam)\s*\(\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g;
    let hm;
    while ((hm = HELPER_RE.exec(src)) !== null) {
      record(hm[2], `${rel} (${hm[1]}@${hm.index})`);
    }

    // C. .from("finance_transactions").insert({ ... type: "X" ... })
    const INSERT_RE = /\.from\(\s*"finance_transactions"\s*\)\s*\.insert\(/g;
    let im;
    while ((im = INSERT_RE.exec(src)) !== null) {
      const window = src.slice(im.index, im.index + 900);
      const tm = window.match(/\btype:\s*"([a-z_]+)"/);
      if (tm) record(tm[1], `${rel} (finance_transactions.insert@${im.index})`);
    }
  }

  return types;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test("CHECK-listen for finance_transactions.type kan parses fra database/*.sql", () => {
  const { values, source } = loadCheckAllowedTypes();
  assert.ok(source, "fandt ingen finance_transactions.type CHECK-definition i database/*.sql");
  // Sanity: den autoritative liste skal have et betydeligt antal værdier. Falder
  // dette til ~0 er parseren (ikke skemaet) brudt — fang det eksplicit.
  assert.ok(
    values.size >= 15,
    `forventede mange tilladte finance-typer i ${source}, fandt kun ${values.size} — parser sandsynligvis brudt`,
  );
  // Anker-værdier der MÅ findes (de blev tilføjet af #1463/#1465 og er kerne-payouts).
  for (const must of ["sponsor", "salary", "prize", "upkeep", "forced_debt_sale"]) {
    assert.ok(values.has(must), `forventede '${must}' i den autoritative CHECK (${source})`);
  }
});

test("kode-skrevne finance_transactions.type-literaler kan udtrækkes fra backend", () => {
  const codeTypes = extractCodeWrittenTypes();
  // Sanity: vi skal finde et meningsfuldt antal write-sinks. Falder dette til ~0 er
  // anker-regex'erne (ikke koden) brudt.
  assert.ok(
    codeTypes.size >= 10,
    `forventede mange kode-skrevne finance-typer, fandt kun ${codeTypes.size} — anker-regex sandsynligvis brudt`,
  );
  // #1465-anker: 'forced_debt_sale' SKAL fanges som kode-skrevet (ellers tester vi
  // ikke den bug-klasse vi blev bygget til).
  assert.ok(
    codeTypes.has("forced_debt_sale"),
    "forventede at fange 'forced_debt_sale' som kode-skrevet finance-type (economyEngine creditTeam) — anker-regex brudt",
  );
});

test("HVER kode-skrevet finance_transactions.type har en CHECK-constraint-værdi (#1464/#1465 forward-guard)", () => {
  const { values: allowed, source } = loadCheckAllowedTypes();
  const codeTypes = extractCodeWrittenTypes();

  const missing = [];
  for (const [type, locations] of codeTypes) {
    if (!allowed.has(type)) {
      missing.push({ type, locations });
    }
  }

  assert.deepEqual(
    missing.map((x) => x.type),
    [],
    missing.length === 0
      ? ""
      : "Finance-type(r) brugt i backend-koden UDEN en tilsvarende CHECK-constraint-værdi " +
          `(#1465-bug-klassen — en ægte prod-INSERT ville fejle med check_violation 23514).\n` +
          `Autoritativ CHECK parset fra: database/${source}\n` +
          `Manglende:\n` +
          missing
            .map((x) => `  - '${x.type}'  skrevet i: ${x.locations.join(", ")}`)
            .join("\n") +
          `\nFix: tilføj værdien til finance_transactions_type_check i en NY database/*.sql-migration ` +
          `(additiv DROP IF EXISTS + re-ADD, jf. database/2026-06-19-finance-forced-debt-sale-type.sql). ` +
          `Ejeren applier migrationen (auto-applies ved merge).`,
  );
});
