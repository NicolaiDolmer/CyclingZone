import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const schema = readFileSync(resolve(repoRoot, "database/schema.sql"), "utf8");

// FINANCE-HALVDELEN ER PENSIONERET (#1464, 2026-08-31).
//
// Her stod tidligere en HÅNDHOLDT RUNTIME_FINANCE_TYPES-liste (11 typer) matchet mod
// den inline CHECK i database/schema.sql. Begge sider var forældede, så testen var
// grøn af den forkerte grund — falsk tryghed, jf. ejer-auditen 7/8 på #1464.
//
// Målt 2026-08-31: schema.sql's inline finance_transactions-CHECK tillader 18 værdier;
// den autoritative migration (database/2026-07-25-sponsor-choice-2.sql, verificeret
// identisk med live-skemaet) tillader 30. De 12 der manglede i schema.sql:
// facility_purchase, facility_upkeep, forced_debt_sale, parachute, scout_travel,
// sponsor_objective_bonus, sponsor_race_day, sponsor_result_bonus,
// sponsor_signing_bonus, staff_salary, staff_severance, upkeep. En ny finance-type
// kunne altså tilføjes uden at denne test blinkede.
//
// Den ægte, ikke-håndholdte paritetstest er backend/lib/financeTypeConstraintGuard.test.js
// (via scripts/lint-finance-types.mjs): kode-siden udledes med directory-walk over
// backend/{lib,routes,scripts} — ingen allowlist — og DB-siden fra den NYESTE
// constraint-redefinition i database/*.sql, ikke fra schema.sql-baselinen. Den dækker
// nu også audit-enum-kolonnerne actor_type + related_entity_type. Tilføj intet
// finance-specifikt her; udvid guarden i stedet.
//
// NB: notifikations-halvdelen nedenfor læser stadig database/schema.sql. Det er en
// kendt, separat svaghed (samme audit-punkt) og hører til notifikations-sporet.

// #1464 forward-guard: opdag de notifikationstyper backend'en FAKTISK dispatcher
// direkte fra kildekoden, i stedet for en håndholdt liste der driver bagud (den
// gamle liste manglede fx 'race_result' (#2158) og 'emergency_loan_breach' — begge
// notifikationer der fejlede tavst i prod fordi typen ikke var i CHECK-constraint'et).
//
// Alle notifikationer inserted via notifyUser() (backend/lib/notificationService.js);
// notifyTeamOwner()/notifyManager()/raceRunner-wrapperen delegerer alle dertil.
// Callere angiver `type` som (a) et string-literal eller (b) en exporteret
// *_TYPE-konstant fra notificationService.js. Denne discovery dækker begge; en
// dynamisk (variabel) type fanges ikke, men det er en bevidst, dokumenteret grænse.
const BACKEND_DIR = resolve(repoRoot, "backend");

function walkJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walkJsFiles(full));
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

function discoverRuntimeNotificationTypes() {
  const svc = readFileSync(resolve(BACKEND_DIR, "lib/notificationService.js"), "utf8");
  const constMap = {};
  for (const m of svc.matchAll(/export const ([A-Z0-9_]+)\s*=\s*["']([a-z_]+)["']/g)) {
    constMap[m[1]] = m[2];
  }

  const NOTIFY_CALL = /\bnotify(?:User|TeamOwner|TeamOwnerShared|TeamOwnerFn|Manager|Fn)?\s*\(/g;
  const types = new Set();

  for (const file of walkJsFiles(BACKEND_DIR)) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = NOTIFY_CALL.exec(src))) {
      const seg = src.slice(m.index, m.index + 300);
      // Object form:  notifyX({ ... type: "x" | X_TYPE ... })
      const objMatch = seg.match(/\{[\s\S]*?\btype\s*:\s*(?:["']([a-z_]+)["']|([A-Z0-9_]+))/);
      // Positional form:  notifyX(arg1, "x" | X_TYPE, ...)
      const posMatch = seg.match(/^notify\w*\(\s*[^,{]+,\s*(?:["']([a-z_]+)["']|([A-Z0-9_]+))/);
      const token = (objMatch && (objMatch[1] || objMatch[2])) || (posMatch && (posMatch[1] || posMatch[2]));
      if (!token) continue;
      if (/^[a-z_]+$/.test(token)) types.add(token);
      else if (constMap[token]) types.add(constMap[token]);
    }
  }
  return [...types].sort();
}

const RUNTIME_NOTIFICATION_TYPES = discoverRuntimeNotificationTypes();

function extractAllowedValues(table, column) {
  const tableStart = schema.indexOf(`CREATE TABLE ${table}`);
  assert.notEqual(tableStart, -1, `${table} table exists in schema`);

  const tableEnd = schema.indexOf(");", tableStart);
  const tableDefinition = schema.slice(tableStart, tableEnd);
  const columnStart = tableDefinition.indexOf(`${column} TEXT NOT NULL CHECK`);
  assert.notEqual(columnStart, -1, `${table}.${column} has a check constraint`);

  const constraint = tableDefinition.slice(columnStart);
  return new Set([...constraint.matchAll(/'([^']+)'/g)].map(match => match[1]));
}

// Erstatter den pensionerede finance-test: håndhæver at ingen fremtidig test i denne
// fil igen bruger database/schema.sql som autoritet for finance_transactions.type.
// schema.sql-baselinen er bevidst en STALE delmængde af det levende constraint (18 af
// 30 værdier målt 2026-08-31); den korrekte autoritet er den nyeste
// constraint-redefinition i database/*.sql, parset af scripts/lint-finance-types.mjs.
test("database/schema.sql er en delmængde af det autoritative finance-CHECK, ikke en autoritet i sig selv", async () => {
  const { loadCheckAllowedTypes } = await import("../../scripts/lint-finance-types.mjs");
  const { values: authoritative, source } = loadCheckAllowedTypes();
  const baseline = extractAllowedValues("finance_transactions", "type");

  assert.ok(source, "fandt ingen autoritativ finance_transactions_type_check-migration");
  // Drift den anden vej (en værdi i schema.sql som INGEN migration tillader) ville
  // betyde at baselinen er blevet redigeret i hånden — fang det eksplicit.
  const orphaned = [...baseline].filter(value => !authoritative.has(value)).sort();
  assert.deepEqual(
    orphaned,
    [],
    `database/schema.sql tillader finance-type(r) som den autoritative migration `
      + `(database/${source}) ikke gør: ${orphaned.join(", ")}. Baselinen er redigeret i hånden `
      + `eller en migration er gået tabt.`,
  );
  assert.ok(
    baseline.size < authoritative.size,
    "schema.sql-baselinen er nu på højde med migrationerne — hvis den vedligeholdes bevidst, "
      + "kan denne test erstattes af en ægte lighedstest.",
  );
});

test("runtime notification types are allowed by the schema contract", () => {
  // Guard mod at discovery-regexen tavst holder op med at matche (så testen ellers
  // ville bestå trivielt): vi ved der er >20 distinkte notifikationstyper i koden.
  assert.ok(
    RUNTIME_NOTIFICATION_TYPES.length >= 20,
    `notifikations-discovery fandt kun ${RUNTIME_NOTIFICATION_TYPES.length} typer — regexen matcher sandsynligvis ikke længere; tjek discoverRuntimeNotificationTypes()`,
  );
  const allowed = extractAllowedValues("notifications", "type");
  const missing = RUNTIME_NOTIFICATION_TYPES.filter(type => !allowed.has(type));
  assert.deepEqual(
    missing,
    [],
    `Notifikationstyper dispatchet i backend men fraværende fra notifications_type_check `
      + `(database/schema.sql): ${missing.join(", ")}. Tilføj en additiv migration der udvider `
      + `constraint'et + opdatér schema.sql (se database/2026-07-04-race-result-notification-type.sql).`,
  );
});
