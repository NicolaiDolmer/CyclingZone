#!/usr/bin/env node
// Audit foreign keys that could block beta-reset's destructive deletes.
//
// Catches the relaunch-reset FK-crash class (#1471, relaunch 18/6):
// - A FK with ON DELETE NO ACTION/RESTRICT points at a table beta-reset DELETEs rows from
// - betaResetService.js does NOT null/delete the child reference before the parent delete
// - Dry-run/preview stays green (no writes) → the crash only fires mid-apply, inside an
//   irreversible destructive reset of prod.
//
// The audit queries the LIVE prod schema (not static migrations — those drift, which is the
// whole point) via RPC audit_foreign_keys(), then fails if any blocking FK is missing from
// the checked-in baseline (BLOCKING_FK_BASELINE in betaResetService.js). A new unhandled FK
// thus fails at PR/cron time, not at relaunch time.
//
// Usage:
//   node backend/scripts/audit-reset-fk-coverage.js            # human-readable report
//   node backend/scripts/audit-reset-fk-coverage.js --json     # JSON output (for CI)
//   node backend/scripts/audit-reset-fk-coverage.js --strict   # exit 1 if critical findings
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Requires: RPC public.audit_foreign_keys() — see database/2026-06-18-audit-foreign-keys-helper.sql

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySupabaseAuditError, formatSupabaseAuditError } from "./audit-error-classifier.js";
import { RESET_DELETE_TARGETS, BLOCKING_FK_BASELINE } from "../lib/betaResetService.js";
import { classifyResetFkFindings, fkKey } from "../lib/resetFkAudit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

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

async function fetchForeignKeys() {
  const { data, error } = await supabase.rpc("audit_foreign_keys");
  if (error) {
    const message = formatSupabaseAuditError(
      "audit_foreign_keys RPC",
      error,
      "Apply database/2026-06-18-audit-foreign-keys-helper.sql first."
    );
    const err = new Error(message);
    // rpc-missing er en deployment-ordering-tilstand, ikke en reset-safety-overtrædelse:
    // på selve den PR der INDFØRER helper-migrationen er RPC'en endnu ikke i prod (den
    // auto-applies først ved merge). Soft-skip (exit 0 + tydelig advarsel) så guarden ikke
    // blokerer sin egen indførelse; auth/andre fejl hard-fejler stadig.
    err.skip = classifySupabaseAuditError(error).kind === "rpc-missing";
    throw err;
  }
  return data || [];
}

// Paste-ready baseline entry for a newly-discovered blocking FK (after it's handled in code).
function suggestBaselineEntry(row) {
  return `  { child: "${row.child_table}", column: "${row.child_column}", parent: "${row.parent_table}", `
    + `strategy: "null-before-delete" /* or "delete-child-first" */, handled_by: "resetBeta..." },`;
}

let fkRows = null;
let skipped = false;
try {
  fkRows = await fetchForeignKeys();
} catch (err) {
  if (!err.skip) throw err;
  // Soft-skip: lad processen ende NATURLIGT (ingen process.exit — matcher audit-rls-coverage;
  // et eksplicit exit her tricker en libuv-teardown-assertion på Windows mens HTTP-klienten
  // stadig har åbne handles). exitCode forbliver 0.
  skipped = true;
  if (JSON_OUT) {
    console.log(JSON.stringify({ skipped: true, reason: err.message, critical_count: 0 }, null, 2));
  } else {
    console.warn(`SKIP: ${err.message}`);
    console.warn("Helper-RPC'en er endnu ikke deployet — auditen kører rigtigt så snart migrationen er applied. Ikke en reset-safety-fejl.");
  }
}

const { blocking, critical, stale } = skipped
  ? { blocking: [], critical: [], stale: [] }
  : classifyResetFkFindings({
    fkRows,
    deleteTargets: RESET_DELETE_TARGETS,
    baseline: BLOCKING_FK_BASELINE,
  });

if (skipped) {
  // intet at rapportere ud over SKIP-beskeden ovenfor
} else if (JSON_OUT) {
  console.log(JSON.stringify({
    total_foreign_keys: fkRows.length,
    reset_delete_targets: RESET_DELETE_TARGETS.length,
    blocking_count: blocking.length,
    critical_count: critical.length,
    stale_count: stale.length,
    critical,
    stale,
    blocking: blocking.map((r) => ({ ...r, key: fkKey(r.child_table, r.child_column, r.parent_table) })),
  }, null, 2));
} else {
  console.log(`Scanned ${fkRows.length} foreign key(s) across ${RESET_DELETE_TARGETS.length} reset-delete target table(s).\n`);
  console.log(`Blocking FKs (NO ACTION/RESTRICT → a reset-target): ${blocking.length}, of which ${blocking.length - critical.length} are baselined.\n`);

  if (critical.length === 0) {
    console.log("OK — every blocking FK on a beta-reset target is registered in BLOCKING_FK_BASELINE.\n");
  } else {
    console.log(`CRITICAL: ${critical.length} unhandled blocking FK(s):\n`);
    for (const f of critical) {
      console.log(`  ${fkKey(f.child_table, f.child_column, f.parent_table)}  [${f.delete_action}]`);
      console.log(`    ${f.reason}`);
    }
    console.log("\nFix: in backend/lib/betaResetService.js, null or delete the child reference BEFORE the");
    console.log("parent delete (see resetBetaLoans/resetBetaSeasons), then register each in BLOCKING_FK_BASELINE:");
    for (const f of critical) console.log(suggestBaselineEntry(f));
    console.log();
  }

  if (stale.length > 0) {
    console.log(`Info: ${stale.length} baseline entr${stale.length === 1 ? "y" : "ies"} with no matching live FK (prune candidates — FK dropped/changed in prod):`);
    for (const s of stale) console.log(`  ${fkKey(s.child, s.column, s.parent)}`);
    console.log();
  }
}

if (STRICT && critical.length > 0) process.exit(1);
