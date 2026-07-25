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
}

if (isMain()) main();
