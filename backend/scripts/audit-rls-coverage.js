#!/usr/bin/env node
// Audit Supabase RLS coverage on tables that the frontend reads.
//
// Catches the slice 14 / #279 bug pattern:
// - Table has RLS enabled but no SELECT policy covering authenticated/public
// - Frontend queries it via supabase.from('<name>').select(...)
// - Service_role bypass makes backend tests pass → false signal
// - Authenticated frontend reads silently return [] → broken UI
//
// Usage:
//   node backend/scripts/audit-rls-coverage.js            # human-readable report
//   node backend/scripts/audit-rls-coverage.js --json     # JSON output (for CI)
//   node backend/scripts/audit-rls-coverage.js --strict   # exit 1 if findings
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Requires: RPC public.audit_rls_coverage() — see database/2026-05-10-audit-rls-helper.sql

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";

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

function classify(tables, frontendRefs) {
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

const [tables, frontendRefs] = await Promise.all([
  fetchRlsState(),
  findFrontendTableRefs(),
]);
const findings = classify(tables, frontendRefs);
const critical = findings.filter((f) => f.severity === "critical");
const info = findings.filter((f) => f.severity === "info");

if (JSON_OUT) {
  console.log(JSON.stringify({
    total_tables: tables.length,
    critical_count: critical.length,
    info_count: info.length,
    critical,
    info,
  }, null, 2));
} else {
  console.log(`Scanned ${tables.length} tables in public schema.\n`);
  if (critical.length === 0) {
    console.log("OK — no frontend-referenced tables are blocked by missing RLS policies.\n");
  } else {
    console.log(`CRITICAL: ${critical.length} table(s) blocked for authenticated frontend reads:\n`);
    for (const f of critical) {
      console.log(`  ${f.table}`);
      console.log(`    reason:    ${f.reason}`);
      console.log(`    policies:  ${f.policy_count} (${f.policy_names.join(", ") || "—"})`);
      console.log(`    used by:   ${f.frontend_files.join(", ")}`);
      console.log();
    }
  }
  if (info.length > 0) {
    console.log(`Info: ${info.length} backend-only table(s) with RLS but no auth-covering policy (likely intentional, service_role bypasses):`);
    for (const f of info) console.log(`  ${f.table} (${f.policy_count} polic${f.policy_count === 1 ? "y" : "ies"})`);
    console.log();
  }
}

if (STRICT && critical.length > 0) process.exit(1);
