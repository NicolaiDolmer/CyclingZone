#!/usr/bin/env node
// Audit Supabase RLS coverage on tables that the frontend reads, PLUS
// (#2830) whether anon/authenticated hold broad write grants (INSERT/UPDATE/
// DELETE/TRUNCATE) that aren't actually contained by RLS.
//
// Catches two related bug patterns:
// - SELECT side (slice 14 / #279): table has RLS enabled but no SELECT
//   policy covering authenticated/public. Service_role bypass makes backend
//   tests pass while authenticated frontend reads silently return [].
// - WRITE side (#2802/#2830): anon/authenticated hold table-level
//   INSERT/UPDATE/DELETE/TRUNCATE (Supabase's default privileges grant this
//   to every new public table) and either RLS is disabled outright, or a
//   covering policy exists whose column/value scoping needs human review
//   (the #2802 lesson: a row-ownership check alone is not full access
//   control). TRUNCATE is flagged unconditionally — it bypasses RLS
//   entirely and PostgREST never exposes it, so there is no legitimate
//   reason for a client role to hold it.
//
// Usage:
//   node backend/scripts/audit-rls-coverage.js            # human-readable report
//   node backend/scripts/audit-rls-coverage.js --json     # JSON output (for CI)
//   node backend/scripts/audit-rls-coverage.js --strict   # exit 1 if findings
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Requires: RPC public.audit_rls_coverage() — see database/2026-05-10-audit-rls-helper.sql
// Requires (write-grant checks, #2830 — a missing RPC is now CRITICAL, not silent):
//   RPCs public.audit_write_grants() + public.audit_default_privileges() —
//   see database/2026-08-05-audit-write-grants-helper.sql

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySupabaseAuditError, formatSupabaseAuditError } from "./audit-error-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const FRONTEND_SRC = join(REPO_ROOT, "frontend", "src");

dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const STRICT = args.has("--strict");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(path);
  }
  return out;
}

async function findFrontendTableRefs() {
  const files = await walk(FRONTEND_SRC);
  const re = /supabase\s*\.\s*from\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/g;
  const refs = new Map();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) {
      const table = m[1];
      if (!refs.has(table)) refs.set(table, new Set());
      refs.get(table).add(relative(REPO_ROOT, file).replaceAll("\\", "/"));
    }
  }
  return refs;
}

async function fetchRlsState() {
  const { data, error } = await supabase.rpc("audit_rls_coverage");
  if (error) {
    throw new Error(formatSupabaseAuditError(
      "audit_rls_coverage RPC",
      error,
      "Apply database/2026-05-10-audit-rls-helper.sql first."
    ));
  }
  return data || [];
}

// #2830: table-level write-grant state (anon/authenticated INSERT/UPDATE/
// DELETE/TRUNCATE, RLS state, and whether a covering write policy exists).
// Returns null (not []) when the helper RPC is missing, så SELECT-coverage-
// tjekkene stadig kan køre i stedet for at hele auditten crasher. Kalderen
// omsætter null til et CRITICAL-fund (#2830, 14/8) — ikke et info-notat, som
// det var før: RPC'en havde svaret 404 ~92 gange i døgnet siden 5/8, mens
// rls-audit.yml rapporterede grønt på halvdelen af sit scope.
async function fetchWriteGrantState() {
  const { data, error } = await supabase.rpc("audit_write_grants");
  if (error) {
    const classification = classifySupabaseAuditError(error);
    if (classification.kind === "rpc-missing") return null;
    throw new Error(formatSupabaseAuditError(
      "audit_write_grants RPC",
      error,
      "Apply database/2026-08-05-audit-write-grants-helper.sql first (#2830)."
    ));
  }
  return data || [];
}

// #2830 forward-guard: do newly-created public tables still inherit broad
// anon/authenticated write grants via ALTER DEFAULT PRIVILEGES? Returns null
// (not []) when the helper RPC isn't applied yet, same degrade-gracefully
// contract as fetchWriteGrantState.
async function fetchDefaultPrivilegeState() {
  const { data, error } = await supabase.rpc("audit_default_privileges");
  if (error) {
    const classification = classifySupabaseAuditError(error);
    if (classification.kind === "rpc-missing") return null;
    throw new Error(formatSupabaseAuditError(
      "audit_default_privileges RPC",
      error,
      "Apply database/2026-08-05-audit-write-grants-helper.sql first (#2830)."
    ));
  }
  return data || [];
}

export function classify(tables, frontendRefs) {
  const findings = [];
  for (const t of tables) {
    if (!t.rls_enabled) continue;
    if (t.has_authenticated_select) continue;
    const refs = frontendRefs.get(t.table_name);
    const usedByFrontend = !!refs && refs.size > 0;
    findings.push({
      table: t.table_name,
      severity: usedByFrontend ? "critical" : "info",
      reason: t.policy_count === 0
        ? "RLS enabled but 0 policies — postgres default-deny"
        : "RLS enabled, no SELECT policy covering authenticated/public role",
      policy_count: t.policy_count,
      policy_names: t.policy_names || [],
      frontend_files: refs ? [...refs].sort() : [],
    });
  }
  return findings;
}

// Required-policy guard: specific named policies that must exist on critical tables.
// Catches Studio-side deletion or unapplied migrations even when SELECT coverage passes.
// Text-contract proves the SQL was correct; this proves it was actually applied (#518).
const REQUIRED_POLICIES = {
  pending_race_result_rows: [
    "Owner or admin insert pending rows",
    "Owner or admin read pending rows",
  ],
};

export function classifyPolicyGuard(tables) {
  const findings = [];
  for (const [tableName, requiredNames] of Object.entries(REQUIRED_POLICIES)) {
    const tableData = tables.find((t) => t.table_name === tableName);
    const existing = new Set(tableData?.policy_names ?? []);
    for (const name of requiredNames) {
      if (!existing.has(name)) {
        findings.push({
          table: tableName,
          severity: "critical",
          reason: `Required policy missing on live DB: "${name}" — #518 guard unapplied or deleted`,
          policy_count: tableData?.policy_count ?? 0,
          policy_names: tableData?.policy_names ?? [],
          frontend_files: [],
        });
      }
    }
  }
  return findings;
}

// #2830: table-level write grants (anon/authenticated INSERT/UPDATE/DELETE/
// TRUNCATE) that aren't actually contained by RLS. Three independent rules,
// deliberately conservative about severity:
//
//   1. TRUNCATE granted to anon/authenticated on ANY table → critical, no
//      exceptions. TRUNCATE isn't filtered by RLS policies at all (Postgres
//      has no TRUNCATE policy command) and PostgREST never exposes a verb
//      that maps to it, so there is no legitimate reason for a client role
//      to hold it — see .claude/learnings/2026-07-23-rls-broad-write-grants.md.
//   2. A base table (not a view) has RLS disabled entirely AND a client
//      role holds a write grant → critical. This is the "actually wide
//      open" case; as of the #2830 audit (2026-08-05) zero tables matched
//      this, because every base table in this schema has RLS enabled, but a
//      future Studio-created table or a schema restore could reintroduce it
//      (same failure mode as #2676/#3013).
//   3. A client role holds a write grant AND a covering INSERT/UPDATE/
//      DELETE policy actually exists (so the grant is "live", not just
//      default-deny background noise) → info, not critical. Policy
//      existence alone isn't a bug — most of these are legitimate
//      row-scoped or is_admin()-gated writes. This is a periodic-review
//      surface for the #2802 lesson (row-ownership check without column/
//      value scoping), not something a script can safely auto-fail on.
export function classifyWriteGrants(rows) {
  const findings = [];
  for (const t of rows || []) {
    const anonWrite = t.anon_insert || t.anon_update || t.anon_delete;
    const authWrite = t.authenticated_insert || t.authenticated_update || t.authenticated_delete;
    const hasWriteGrant = anonWrite || authWrite;

    if (t.anon_truncate || t.authenticated_truncate) {
      const who = [t.anon_truncate && "anon", t.authenticated_truncate && "authenticated"].filter(Boolean).join("+");
      findings.push({
        table: t.table_name,
        severity: "critical",
        reason: `TRUNCATE granted to ${who} — not filtered by RLS, no legitimate client use (#2830)`,
        policy_names: [],
      });
    }

    if (!t.is_view && t.rls_enabled === false && hasWriteGrant) {
      findings.push({
        table: t.table_name,
        severity: "critical",
        reason: "RLS disabled AND anon/authenticated hold INSERT/UPDATE/DELETE — table is unconditionally writable from the client (#2830 pattern)",
        policy_names: [],
      });
    }

    if (t.is_view && (t.view_is_insertable || t.view_is_updatable) && hasWriteGrant) {
      findings.push({
        table: t.table_name,
        severity: "info",
        reason: "Auto-updatable view holds anon/authenticated write grant — verify the underlying base table's RLS actually blocks it (#2830)",
        policy_names: [],
      });
    }

    if (hasWriteGrant && (t.insert_policy_covers_client || t.update_policy_covers_client || t.delete_policy_covers_client)) {
      findings.push({
        table: t.table_name,
        severity: "info",
        reason: "anon/authenticated write grant is live via a covering RLS policy — review WITH CHECK for column/value scoping periodically (#2802 lesson)",
        policy_names: t.write_policy_names || [],
      });
    }
  }
  return findings;
}

// #2830 forward-guard: does public.ALTER DEFAULT PRIVILEGES still hand new
// tables broad anon/authenticated write grants? Any row back means yes —
// every table created after the #2830 migration without an explicit
// REVOKE is born with the same hole. See database/proposals/
// 2026-08-05-2830-write-grants-lockdown.sql for the fix (ALTER DEFAULT
// PRIVILEGES FOR ROLE postgres, the role this repo's migrations run as).
export function classifyDefaultPrivileges(rows) {
  if (!rows || rows.length === 0) return [];
  const privileges = [...new Set(rows.map((r) => r.privilege_type))].sort();
  const grantors = [...new Set(rows.map((r) => r.grantor_role))].sort();
  return [{
    table: "(schema default privileges)",
    severity: "critical",
    reason: `ALTER DEFAULT PRIVILEGES (grantor: ${grantors.join(", ")}) still hands new public tables ${privileges.join("/")} for anon/authenticated — every newly created table inherits the #2830 hole until this is fixed`,
    policy_names: [],
  }];
}

// ---------------------------------------------------------------------------
// CLI entry — kun når scriptet køres direkte (ikke ved import i tests).
// Samme isMain-mønster som audit-feature-liveness.js (#2985), så classify/
// classifyPolicyGuard/classifyWriteGrants/classifyDefaultPrivileges kan
// importeres og unit-testes uden at det udløser netværkskald/process.exit
// som side-effekt af importet.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [tables, frontendRefs, writeGrantRows, defaultPrivilegeRows] = await Promise.all([
    fetchRlsState(),
    findFrontendTableRefs(),
    fetchWriteGrantState(),
    fetchDefaultPrivilegeState(),
  ]);
  const findings = classify(tables, frontendRefs);
  const guardFindings = classifyPolicyGuard(tables);
  // En manglende RPC er `critical`, ikke `info` (#2830, ændret 14/8). Da den var
  // `info`, kørte rls-audit.yml grønt hver uge på HALVDELEN af sit scope: begge
  // helper-RPC'er svarede 404 (målt 92 kald/døgn hver i edge-loggen), fordi
  // migrationen aldrig var anvendt. En audit der ikke kan køre må ikke se ud som
  // en audit der intet fandt — grøn skal betyde dækket, ikke bare fejlfri.
  const writeGrantFindings = writeGrantRows === null
    ? [{ table: "(audit_write_grants)", severity: "critical", reason: "Write-grant audit RPC svarer ikke — auditten kan ikke køre og dækker derfor IKKE write-grants. Anvend database/2026-08-05-audit-write-grants-helper.sql (#2830)", policy_names: [] }]
    : classifyWriteGrants(writeGrantRows);
  const defaultPrivilegeFindings = defaultPrivilegeRows === null
    ? [{ table: "(audit_default_privileges)", severity: "critical", reason: "Default-privilege audit RPC svarer ikke — forward-guarden mod at nye tabeller fødes klient-skrivbare er ude af drift. Anvend database/2026-08-05-audit-write-grants-helper.sql (#2830)", policy_names: [] }]
    : classifyDefaultPrivileges(defaultPrivilegeRows);
  const allFindings = [...findings, ...guardFindings, ...writeGrantFindings, ...defaultPrivilegeFindings];
  const critical = allFindings.filter((f) => f.severity === "critical");
  const info = allFindings.filter((f) => f.severity === "info");

  if (JSON_OUT) {
    console.log(JSON.stringify({
      total_tables: tables.length,
      critical_count: critical.length,
      info_count: info.length,
      critical,
      info,
    }, null, 2));
  } else {
    console.log(`Scanned ${tables.length} tables in public schema (SELECT coverage), ${writeGrantRows === null ? "write-grant RPC not applied" : `${writeGrantRows.length} tables (write-grant coverage)`}.\n`);
    if (critical.length === 0) {
      console.log("OK — no frontend-referenced tables are blocked by missing RLS policies, all required named policies are present, and no anon/authenticated write-grant hole was found.\n");
    } else {
      console.log(`CRITICAL: ${critical.length} finding(s):\n`);
      for (const f of critical) {
        console.log(`  ${f.table}`);
        console.log(`    reason:    ${f.reason}`);
        if (f.policy_count !== undefined) console.log(`    policies:  ${f.policy_count} (${(f.policy_names || []).join(", ") || "—"})`);
        if ((f.frontend_files || []).length > 0) console.log(`    used by:   ${f.frontend_files.join(", ")}`);
        console.log();
      }
    }
    if (info.length > 0) {
      console.log(`Info: ${info.length} lower-severity finding(s) (SELECT-only backend tables, and #2830 write-grants that are live via a policy — worth periodic human review, not auto-blocking):`);
      for (const f of info) {
        const detail = f.policy_count !== undefined ? `${f.policy_count} polic${f.policy_count === 1 ? "y" : "ies"}` : f.reason;
        console.log(`  ${f.table} (${detail})`);
      }
      console.log();
    }
  }

  if (STRICT && critical.length > 0) process.exit(1);
}
