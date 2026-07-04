import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const schema = readFileSync(resolve(repoRoot, "database/schema.sql"), "utf8");

const RUNTIME_FINANCE_TYPES = [
  "admin_adjustment",
  "emergency_loan",
  "interest",
  "loan_interest",
  "loan_received",
  "loan_repayment",
  "prize",
  "salary",
  "sponsor",
  "transfer_in",
  "transfer_out",
];

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

test("runtime finance transaction types are allowed by the schema contract", () => {
  const allowed = extractAllowedValues("finance_transactions", "type");
  const missing = RUNTIME_FINANCE_TYPES.filter(type => !allowed.has(type));
  assert.deepEqual(missing, []);
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
