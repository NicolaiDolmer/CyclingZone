#!/usr/bin/env node
// scripts/lint-finance-types.mjs
// ============================================================
// Forward-guard for #2957 — every finance_transactions.type literal written by
// backend code must exist in the live finance_transactions_type_check CHECK.
//
// WHY (owner-verified 2026-07-26, postmortem
// .claude/learnings/2026-07-25-finance-type-check-latent-sponsor-race-day.md):
//   sponsorRaceDayIncome.js (#1663, written 2026-06-21) credits finance_transactions
//   with `type: "sponsor_race_day"` — but the CHECK constraint was never updated to
//   allow that value. The mechanic had 0 payouts ever (#2913), so the INSERT never
//   actually ran until caught manually on 2026-07-25 — days before the S1→S2 cutover
//   (2026-07-27) with 153 live sponsor contracts. A real payout would have thrown
//   check_violation (23514) mid-cron on its very first real credit.
//
//   A guard for exactly this bug ALREADY existed —
//   backend/lib/financeTypeConstraintGuard.test.js (#1464/#1465, PR #1557) — but it
//   missed sponsor_race_day because its FINANCE_SOURCE_FILES allowlist was a fixed
//   list of files that was never updated when sponsorRaceDayIncome.js,
//   sponsorContractsService.js, transferExecution.js and scoutAssignmentService.js
//   started writing finance_transactions rows. A hardcoded file list going stale is
//   the exact failure mode this script is built to structurally eliminate: it WALKS
//   backend/{lib,routes,scripts} instead of naming files, so a brand-new finance-
//   writing module is covered automatically, with no allowlist to forget to update.
//
// RULE: every finance_transactions.type string literal actually written by backend
// code (backend/lib, backend/routes, backend/scripts) must be a member of the LATEST
// (filename-sorted) `finance_transactions_type_check` redefinition in database/*.sql.
// The reverse is NOT required — the CHECK may allow values with no code callsite yet
// (e.g. seeded/backfilled via SQL, or a repayment type only ever written by SQL — see
// SCOPE below) — reported as an info note, never a failure.
//
// WRITE-SINK ANCHORS (verified against the full codebase 2026-07-26, not guessed):
//   A. incrementBalanceWithAudit(client, { ..., payload: { type: "X", ... } })
//      — the balanceRpc.js wrapper around the generic increment_balance_with_audit
//        RPC (database/2026-05-09-balance-rpc.sql); by far the most common sink.
//   B. creditTeam(teamId, amount, "X", ...) / debitTeam(teamId, amount, "X", ...)
//      — economyEngine.js helpers that forward their 3rd positional arg as
//        payload.type to incrementBalanceWithAudit. Definitions themselves pass the
//        `type` *parameter* through (no string literal there — correctly not
//        matched); only CALLERS with a literal 3rd arg are write-sinks.
//   C. await client.from("finance_transactions").insert({ type: "X", ... })
//      — direct insert. No current callsite does this, but it's a legitimate sink
//        shape kept for forward coverage.
//   D. client.rpc("<bespoke_atomic_fn>", { ..., p_finance_payload: { type: "X", ... } })
//      — a handful of bespoke atomic RPCs (finalize_academy_acquisition) take a
//        p_finance_payload object directly rather than going through
//        incrementBalanceWithAudit; the SQL function still does
//        `v_type := p_finance_payload->>'type'`, so the JS-side literal is the real
//        source of truth. Anchored on `p_finance_payload: {` (object literal opens
//        immediately) — balanceRpc.js's own `p_finance_payload: payload` forwarding
//        line does NOT match (no `{`), so it isn't double-counted with pattern A.
//
// We anchor on these four call shapes rather than a bare `type:` grep: `type:` is
// heavily overloaded elsewhere in the codebase (notification types, warning/report
// row types, PostgREST operators, board-goal types, season-event types, ...) — a
// blind grep produces false positives (verified while building this guard: e.g.
// prizePayoutEngine.js's `warnings.push({ type: "no_prize_results", ... })` and
// api.js's `notifySeasonEvent({ type: "season_started", ... })` are NOT finance rows).
//
// SCOPE / KNOWN BLIND SPOT (documented, not silently ignored): this scans JS-side
// literals only, per #2957's scope ("alle steder i backend-koden"). One RPC function,
// repay_loan_atomic (database/2026-07-1{0,1}-repay-loan-atomic*.sql), hardcodes its
// finance_transactions.type ('loan_repayment') directly in the SQL INSERT instead of
// reading p_finance_payload->>'type' — a JS source scanner structurally cannot see
// that literal. Verified against prod 2026-07-26: 'loan_repayment' IS in the live
// CHECK, so this is not current drift. A *future* bespoke RPC that hardcodes a new,
// un-added literal type straight in SQL would slip past this guard silently. Flagged
// as residual risk in #2957's closing report, not fixed here (out of issue scope).
//
// Heuristic-vs-parser trade-off (same family as lint-migration-idempotency.mjs /
// lint-swallowed-catches.mjs): this is a regex + bounded-window scanner, not a real
// JS parser. Each anchor match opens a bounded window (WINDOW_CHARS) and takes the
// FIRST `type: "..."` literal inside it. In every verified real callsite `type:` is
// declared within the first few lines of its object literal, well inside the window,
// so overlap with an adjacent call (the window bleeding past the current call's own
// closing brace) never wins over the closer, correct match.
//
// Usage:
//   node scripts/lint-finance-types.mjs
//   npm run lint:finance-types
//
// Exit codes:
//   0 — every code-written type is CHECK-allowed
//   1 — at least one code-written type is missing from the CHECK
//
// Refs #2957 #2948 #1463 #1465 #1464.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const DATABASE_DIR = join(ROOT, "database");
const BACKEND_DIR = join(ROOT, "backend");

// Directories (relative to backend/) walked for finance-write callsites. Scripts is
// included alongside lib/routes (a superset of #2957's explicit "backend/lib +
// backend/routes" ask) because backend/scripts/repair2276Div4Cascade.js is a real,
// occasionally-run-against-prod admin repair script that also calls
// incrementBalanceWithAudit with a literal type — the same write-sink shape, just in
// a one-off script rather than always-on runtime code.
const SCAN_DIRS = ["lib", "routes", "scripts"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
const WINDOW_CHARS = 900;

// ────────────────────────────────────────────────────────────────────────────
// 1. Parse the CHECK-allowed finance_transactions.type values from database/*.sql.
//
// The constraint is redefined over time (DROP + ADD in each migration that touches
// it), so each "ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (...))"
// fully REPLACES the previous list. The authoritative set is therefore the LATEST
// dated migration that redefines it. database/schema.sql + supabase_setup.sql carry
// an inline baseline CHECK on the CREATE TABLE itself that is OLDER than the
// migrations (missing e.g. 'upkeep'/'forced_debt_sale') — fallback only, if no
// migration redefinition exists.
// ────────────────────────────────────────────────────────────────────────────

function parseTypeInList(clauseBody) {
  const values = [];
  const RE = /'([a-z_]+)'/g;
  let m;
  while ((m = RE.exec(clauseBody)) !== null) values.push(m[1]);
  return values;
}

/** @returns {{values: Set<string>, source: string|null}} */
export function loadCheckAllowedTypes() {
  const sqlFiles = readdirSync(DATABASE_DIR).filter((f) => f.endsWith(".sql"));

  const NAMED_RE =
    /ADD CONSTRAINT finance_transactions_type_check\s+CHECK\s*\(\s*type IN\s*\(([\s\S]*?)\)\s*\)/i;

  const namedDefs = [];
  for (const file of sqlFiles) {
    const src = readFileSync(join(DATABASE_DIR, file), "utf8");
    const m = src.match(NAMED_RE);
    if (m) namedDefs.push({ file, values: parseTypeInList(m[1]) });
  }

  if (namedDefs.length > 0) {
    // YYYY-MM-DD-prefixed filenames → lexicographic sort == chronological.
    namedDefs.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const latest = namedDefs[namedDefs.length - 1];
    return { values: new Set(latest.values), source: latest.file };
  }

  const INLINE_RE =
    /CREATE TABLE finance_transactions\s*\([\s\S]*?type TEXT NOT NULL CHECK\s*\(\s*type IN\s*\(([\s\S]*?)\)\s*\)/i;
  for (const file of ["schema.sql", "supabase_setup.sql"]) {
    if (!sqlFiles.includes(file)) continue;
    const src = readFileSync(join(DATABASE_DIR, file), "utf8");
    const m = src.match(INLINE_RE);
    if (m) return { values: new Set(parseTypeInList(m[1])), source: file };
  }

  return { values: new Set(), source: null };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Walk backend/{lib,routes,scripts} and extract the finance_transactions.type
//    literals actually written, via the four anchor patterns documented above.
// ────────────────────────────────────────────────────────────────────────────

/** @returns {string[]} absolute paths of .js/.mjs files to scan (tests excluded) */
export function collectScanFiles(backendDir = BACKEND_DIR, scanDirs = SCAN_DIRS) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs)$/.test(entry)) continue;
      if (/\.test\.(js|mjs)$/.test(entry)) continue;
      files.push(full);
    }
  };
  for (const d of scanDirs) walk(join(backendDir, d));
  return files.sort();
}

function lineAt(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}

/**
 * Extract finance_transactions.type literals written by a single source string.
 * @param {string} src
 * @param {string} label - path/identifier used in reported locations
 * @returns {Map<string, string[]>} type -> ["label:line (sink)", ...]
 */
export function extractTypesFromSource(src, label) {
  const types = new Map();
  const record = (type, offset, sink) => {
    if (!/^[a-z_]+$/.test(type)) return;
    if (!types.has(type)) types.set(type, []);
    types.get(type).push(`${label}:${lineAt(src, offset)} (${sink})`);
  };

  // A. incrementBalanceWithAudit( ... payload: { type: "X" } ... )
  {
    const RE = /incrementBalanceWithAudit\s*\(/g;
    let m;
    while ((m = RE.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + WINDOW_CHARS);
      const tm = window.match(/\btype:\s*"([a-z_]+)"/);
      if (tm) record(tm[1], m.index, "incrementBalanceWithAudit");
    }
  }

  // B. creditTeam(teamId, amount, "X", ...) / debitTeam(teamId, amount, "X", ...)
  {
    const RE = /\b(creditTeam|debitTeam)\s*\(\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g;
    let m;
    while ((m = RE.exec(src)) !== null) {
      record(m[2], m.index, m[1]);
    }
  }

  // C. .from("finance_transactions").insert({ ... type: "X" ... })
  {
    const RE = /\.from\(\s*["']finance_transactions["']\s*\)\s*\.insert\(/g;
    let m;
    while ((m = RE.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + WINDOW_CHARS);
      const tm = window.match(/\btype:\s*"([a-z_]+)"/);
      if (tm) record(tm[1], m.index, "finance_transactions.insert");
    }
  }

  // D. client.rpc("<fn>", { ..., p_finance_payload: { type: "X", ... } })
  {
    const RE = /p_finance_payload:\s*\{/g;
    let m;
    while ((m = RE.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + WINDOW_CHARS);
      const tm = window.match(/\btype:\s*"([a-z_]+)"/);
      if (tm) record(tm[1], m.index, "p_finance_payload");
    }
  }

  return types;
}

/** @returns {Map<string, string[]>} type -> locations, merged across all scanned files */
export function extractCodeWrittenTypes(files) {
  const merged = new Map();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const label = relative(ROOT, file).replace(/\\/g, "/");
    const found = extractTypesFromSource(src, label);
    for (const [type, locations] of found) {
      if (!merged.has(type)) merged.set(type, []);
      merged.get(type).push(...locations);
    }
  }
  return merged;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Audit-enum-kolonner på finance_transactions (#1464-udvidelse, 2026-08-31)
//
// `type` er ikke den eneste CHECK-begrænsede enum-kolonne på finance_transactions.
// De samme write-sinks sætter også `actor_type` og `related_entity_type`, og begge
// har en rigtig CHECK-constraint i prod (verificeret mod live-skemaet 2026-08-31:
// finance_transactions_actor_type_check = cron/api/admin/system/migration,
// finance_transactions_related_entity_type_check = auction/loan/transfer/swap/race/
// season/manual). Værdierne kommer fra to frosne konstant-objekter i
// backend/lib/economyConstants.js — FINANCE_ACTOR_TYPE og FINANCE_RELATED_ENTITY —
// hvis egen kommentar allerede SIGER "MUST matche database CHECK constraints", men
// indtil nu håndhævede INTET den påstand. En ny nøgle i et af de objekter (fx en
// "scout"-actor eller en "facility"-relation) ville derfor slippe grøn gennem CI og
// først fejle med check_violation (23514) på den første ægte INSERT i prod — præcis
// #1463/#1465/#2948-bug-klassen, bare i nabokolonnen.
//
// Kilden til de kode-skrevne værdier er todelt:
//   1. de frosne konstant-objekter (kanonisk vej — næsten alle callsites bruger dem)
//   2. rå string-literaler på `actor_type:` / `actorType:` / `related_entity_type:` /
//      `relatedEntityType:` i backend/{lib,routes,scripts} (fx
//      stageRaceTransferDefer.js's `actorType: "cron"`), så en callsite der springer
//      konstanten over stadig dækkes.
//
// #4328-NOTE (CHECK → rigtig Postgres-enum): når constraintet konverteres til en
// enum-type, er det KUN loadNamedCheckValues() der skal pege et andet sted hen —
// registret nedenfor og hele sammenligningen er uændret. Tilføj en `enumName` til
// posten i AUDIT_ENUM_COLUMNS og lad parseren falde tilbage på
// `CREATE TYPE <enumName> AS ENUM (...)` når constraint-formen ikke findes.
// ────────────────────────────────────────────────────────────────────────────

const ECONOMY_CONSTANTS_FILE = join(BACKEND_DIR, "lib", "economyConstants.js");

/**
 * Registret over CHECK-begrænsede enum-kolonner der udledes af et frosset
 * konstant-objekt. `type` står bevidst IKKE her — den har sin egen write-sink-
 * baserede discovery ovenfor, fordi typerne skrives som inline-literaler.
 */
export const AUDIT_ENUM_COLUMNS = [
  {
    column: "actor_type",
    constraint: "finance_transactions_actor_type_check",
    constant: "FINANCE_ACTOR_TYPE",
    literalKeys: ["actor_type", "actorType"],
  },
  {
    column: "related_entity_type",
    constraint: "finance_transactions_related_entity_type_check",
    constant: "FINANCE_RELATED_ENTITY",
    literalKeys: ["related_entity_type", "relatedEntityType"],
  },
];

/**
 * Parse værdierne i en navngiven CHECK-constraint fra database/*.sql. Samme
 * "seneste filnavn vinder"-regel som loadCheckAllowedTypes(): constraintet DROP'es
 * + ADD'es på ny i hver migration der rører det, så den nyeste redefinition er den
 * autoritative.
 * @param {string} constraintName
 * @returns {{values: Set<string>, source: string|null}}
 */
export function loadNamedCheckValues(constraintName) {
  const sqlFiles = readdirSync(DATABASE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const RE = new RegExp(
    `ADD CONSTRAINT ${constraintName}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "i",
  );

  let found = null;
  for (const file of sqlFiles) {
    const src = readFileSync(join(DATABASE_DIR, file), "utf8");
    const m = src.match(RE);
    if (m) found = { file, values: parseTypeInList(m[1]) };
  }

  return found
    ? { values: new Set(found.values), source: found.file }
    : { values: new Set(), source: null };
}

/**
 * Læs værdierne ud af et `export const X = Object.freeze({ KEY: "value", ... })`
 * i backend/lib/economyConstants.js.
 * @param {string} constantName
 * @returns {Map<string, string>} value -> KEY
 */
export function extractConstantValues(constantName, file = ECONOMY_CONSTANTS_FILE) {
  const src = readFileSync(file, "utf8");
  const block = src.match(
    new RegExp(`export const ${constantName}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`),
  );
  const values = new Map();
  if (!block) return values;
  for (const m of block[1].matchAll(/([A-Z0-9_]+)\s*:\s*"([a-z_]+)"/g)) {
    values.set(m[2], m[1]);
  }
  return values;
}

/**
 * Find rå string-literaler skrevet direkte på en audit-enum-nøgle (uden om
 * konstant-objektet), fx `actorType: "cron"`.
 * @param {string[]} files
 * @param {string[]} literalKeys
 * @returns {Map<string, string[]>} value -> locations
 */
export function extractLiteralEnumValues(files, literalKeys) {
  const found = new Map();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const label = relative(ROOT, file).replace(/\\/g, "/");
    const RE = new RegExp(`\\b(?:${literalKeys.join("|")})\\s*:\\s*"([a-z_]+)"`, "g");
    let m;
    while ((m = RE.exec(src)) !== null) {
      const value = m[1];
      if (!found.has(value)) found.set(value, []);
      found.get(value).push(`${label}:${lineAt(src, m.index)}`);
    }
  }
  return found;
}

/**
 * Kør paritets-tjekket for alle audit-enum-kolonner i AUDIT_ENUM_COLUMNS.
 * @param {string[]} [files]
 * @returns {{column: string, constraint: string, source: string|null, allowed: Set<string>, codeValues: Map<string, string[]>, missing: {value: string, locations: string[]}[]}[]}
 */
export function collectAuditEnumDrift(files = collectScanFiles()) {
  return AUDIT_ENUM_COLUMNS.map((spec) => {
    const { values: allowed, source } = loadNamedCheckValues(spec.constraint);

    /** @type {Map<string, string[]>} */
    const codeValues = new Map();
    for (const [value, key] of extractConstantValues(spec.constant)) {
      codeValues.set(value, [`backend/lib/economyConstants.js (${spec.constant}.${key})`]);
    }
    for (const [value, locations] of extractLiteralEnumValues(files, spec.literalKeys)) {
      if (!codeValues.has(value)) codeValues.set(value, []);
      codeValues.get(value).push(...locations);
    }

    const missing = [];
    for (const [value, locations] of codeValues) {
      if (!allowed.has(value)) missing.push({ value, locations });
    }
    missing.sort((a, b) => (a.value < b.value ? -1 : 1));

    return {
      column: spec.column,
      constraint: spec.constraint,
      source,
      allowed,
      codeValues,
      missing,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────
function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

function main() {
  const { values: allowed, source } = loadCheckAllowedTypes();
  if (!source) {
    process.stderr.write(
      "🔴 finance-type-guard: fandt ingen finance_transactions_type_check-definition i database/*.sql — parser sandsynligvis brudt.\n"
    );
    process.exit(1);
  }

  const files = collectScanFiles();
  const codeTypes = extractCodeWrittenTypes(files);

  const missing = [];
  for (const [type, locations] of codeTypes) {
    if (!allowed.has(type)) missing.push({ type, locations });
  }
  missing.sort((a, b) => (a.type < b.type ? -1 : 1));

  const unused = [...allowed].filter((t) => !codeTypes.has(t)).sort();

  if (missing.length > 0) {
    process.stderr.write(
      `🔴 finance-type-guard blocked: ${missing.length} finance_transactions.type-værdi(er) brugt i backend-koden UDEN en tilsvarende CHECK-constraint-værdi.\n\n` +
        `Autoritativ CHECK parset fra: database/${source}\n` +
        `Scannede ${files.length} fil(er) i backend/{${SCAN_DIRS.join(",")}}.\n\n` +
        `Manglende:\n` +
        missing
          .map((x) => `  - '${x.type}'\n      skrevet i: ${x.locations.join(", ")}`)
          .join("\n") +
        `\n\nDette er #1463/#1465/#2948-bug-klassen: en ægte prod-INSERT ville fejle med ` +
        `check_violation (23514) — typisk første gang lige netop den transaktionstype ` +
        `udbetales, dvs. på det værst tænkelige tidspunkt.\n\n` +
        `Fix: tilføj værdien til finance_transactions_type_check i en NY database/*.sql-` +
        `migration (DROP CONSTRAINT IF EXISTS + re-ADD, jf. database/2026-07-25-sponsor-` +
        `choice-2.sql). Ejeren applier migrationen efter merge (#2642-rammer).\n\n` +
        `Refs #2957 #2948 #1463 #1465.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `✅ finance-type-guard: ${codeTypes.size} kode-skrevet finance-type(r) fundet i ${files.length} fil(er), alle i CHECK'et (database/${source}).\n`
  );
  if (unused.length > 0) {
    process.stdout.write(
      `ℹ CHECK tillader ${unused.length} værdi(er) uden fundet kode-callsite (ikke en fejl — ` +
        `kan være SQL-seedet/kun-SQL-skrevet/legacy): ${unused.join(", ")}\n`
    );
  }

  // Audit-enum-kolonnerne (#1464): actor_type + related_entity_type.
  const auditReports = collectAuditEnumDrift(files);
  const brokenParsers = auditReports.filter((r) => !r.source || r.allowed.size === 0);
  if (brokenParsers.length > 0) {
    process.stderr.write(
      `🔴 finance-type-guard: fandt ingen CHECK-definition for ` +
        `${brokenParsers.map((r) => r.constraint).join(", ")} i database/*.sql — parser sandsynligvis brudt.\n`
    );
    process.exit(1);
  }

  const auditDrift = auditReports.filter((r) => r.missing.length > 0);
  if (auditDrift.length > 0) {
    process.stderr.write(
      `🔴 finance-type-guard blocked: audit-enum-værdi(er) brugt i backend-koden UDEN en tilsvarende CHECK-constraint-værdi.\n\n` +
        auditDrift
          .map(
            (r) =>
              `finance_transactions.${r.column} (autoritativ CHECK: database/${r.source})\n` +
              r.missing
                .map((x) => `  - '${x.value}'\n      skrevet i: ${x.locations.join(", ")}`)
                .join("\n")
          )
          .join("\n\n") +
        `\n\nSamme bug-klasse som #1463/#1465/#2948, bare i en audit-kolonne: en ægte ` +
        `prod-INSERT ville fejle med check_violation (23514) første gang netop den ` +
        `actor/relation bruges.\n\n` +
        `Fix: tilføj værdien til constraintet i en NY database/*.sql-migration ` +
        `(DROP CONSTRAINT IF EXISTS + re-ADD, jf. database/2026-05-09-audit-log-foundation.sql). ` +
        `Ejeren applier migrationen efter merge (#2642-rammer).\n\n` +
        `Refs #1464.\n`
    );
    process.exit(1);
  }

  for (const r of auditReports) {
    process.stdout.write(
      `✅ finance-type-guard: finance_transactions.${r.column} — ${r.codeValues.size} kode-skrevet værdi(er), ` +
        `alle i CHECK'et (database/${r.source}).\n`
    );
  }
}

if (isMain()) main();
