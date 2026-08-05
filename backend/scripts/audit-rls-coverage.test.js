import test from "node:test";
import assert from "node:assert/strict";

import {
  classify,
  classifyPolicyGuard,
  classifyWriteGrants,
  classifyDefaultPrivileges,
} from "./audit-rls-coverage.js";

// #2830: unit tests for the write-grant + default-privilege classifiers.
// Pure functions over simulated RPC rows — no live DB call, matches the
// isMain-guard pattern from audit-feature-liveness.js (#2985) so importing
// them here doesn't trigger network calls.

function writeGrantRow(overrides = {}) {
  return {
    table_name: "some_table",
    relkind: "r",
    is_view: false,
    rls_enabled: true,
    view_is_insertable: null,
    view_is_updatable: null,
    anon_insert: false,
    anon_update: false,
    anon_delete: false,
    anon_truncate: false,
    authenticated_insert: false,
    authenticated_update: false,
    authenticated_delete: false,
    authenticated_truncate: false,
    insert_policy_covers_client: false,
    update_policy_covers_client: false,
    delete_policy_covers_client: false,
    write_policy_names: [],
    ...overrides,
  };
}

test("classify (SELECT coverage): unchanged behaviour — critical when frontend-referenced, info otherwise", () => {
  const tables = [
    { table_name: "riders", rls_enabled: true, has_authenticated_select: false, policy_count: 0, policy_names: [] },
    { table_name: "admin_log", rls_enabled: true, has_authenticated_select: false, policy_count: 0, policy_names: [] },
    { table_name: "teams", rls_enabled: true, has_authenticated_select: true, policy_count: 2, policy_names: ["x"] },
  ];
  const refs = new Map([["riders", new Set(["frontend/src/pages/RidersPage.jsx"])]]);
  const findings = classify(tables, refs);
  assert.equal(findings.length, 2);
  assert.equal(findings.find((f) => f.table === "riders").severity, "critical");
  assert.equal(findings.find((f) => f.table === "admin_log").severity, "info");
  assert.equal(findings.some((f) => f.table === "teams"), false, "has_authenticated_select=true is never a finding");
});

test("classifyPolicyGuard: flags missing required named policy", () => {
  const tables = [{ table_name: "pending_race_result_rows", policy_count: 1, policy_names: ["Owner or admin insert pending rows"] }];
  const findings = classifyPolicyGuard(tables);
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /Owner or admin read pending rows/);
});

test("classifyWriteGrants: TRUNCATE granted to anon/authenticated is always critical, regardless of RLS", () => {
  const rows = [writeGrantRow({ table_name: "riders", authenticated_truncate: true, rls_enabled: true })];
  const findings = classifyWriteGrants(rows);
  const truncateFinding = findings.find((f) => /TRUNCATE/.test(f.reason));
  assert.ok(truncateFinding, "expected a TRUNCATE finding");
  assert.equal(truncateFinding.severity, "critical");
});

test("classifyWriteGrants: RLS disabled + write grant on a base table is critical (the truly-open case)", () => {
  const rows = [writeGrantRow({ table_name: "some_new_table", rls_enabled: false, authenticated_insert: true })];
  const findings = classifyWriteGrants(rows);
  const openFinding = findings.find((f) => /RLS disabled/.test(f.reason));
  assert.ok(openFinding, "expected an RLS-disabled finding");
  assert.equal(openFinding.severity, "critical");
});

test("classifyWriteGrants: RLS enabled, no covering policy, no TRUNCATE → zero findings (protected by default-deny)", () => {
  const rows = [writeGrantRow({ table_name: "backup_whatever", authenticated_insert: true, authenticated_update: true })];
  const findings = classifyWriteGrants(rows);
  assert.deepEqual(findings, [], "default-deny protection should not be flagged at all");
});

test("classifyWriteGrants: covering policy exists → info, not critical (the #2802 review surface)", () => {
  const rows = [writeGrantRow({
    table_name: "rider_watchlist",
    authenticated_insert: true,
    authenticated_delete: true,
    insert_policy_covers_client: true,
    delete_policy_covers_client: true,
    write_policy_names: ["Own watchlist only"],
  })];
  const findings = classifyWriteGrants(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.deepEqual(findings[0].policy_names, ["Own watchlist only"]);
});

test("classifyWriteGrants: auto-updatable view with write grant is info-level", () => {
  const rows = [writeGrantRow({
    table_name: "ai_active_season_status",
    relkind: "v",
    is_view: true,
    rls_enabled: null,
    view_is_insertable: true,
    view_is_updatable: true,
    authenticated_update: true,
  })];
  const findings = classifyWriteGrants(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.match(findings[0].reason, /Auto-updatable view/);
});

test("classifyWriteGrants: non-updatable view with write grant produces no finding (DML would error regardless)", () => {
  const rows = [writeGrantRow({
    table_name: "roadmap_item_scores",
    relkind: "v",
    is_view: true,
    rls_enabled: null,
    view_is_insertable: false,
    view_is_updatable: false,
    authenticated_update: true,
  })];
  assert.deepEqual(classifyWriteGrants(rows), []);
});

test("classifyDefaultPrivileges: empty rows → clean (no finding)", () => {
  assert.deepEqual(classifyDefaultPrivileges([]), []);
  assert.deepEqual(classifyDefaultPrivileges(null), []);
});

test("classifyDefaultPrivileges: any row → single critical finding naming grantor + privileges", () => {
  const rows = [
    { grantor_role: "postgres", schema_name: "public", grantee_role: "anon", privilege_type: "INSERT" },
    { grantor_role: "postgres", schema_name: "public", grantee_role: "authenticated", privilege_type: "UPDATE" },
  ];
  const findings = classifyDefaultPrivileges(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.match(findings[0].reason, /postgres/);
  assert.match(findings[0].reason, /INSERT/);
  assert.match(findings[0].reason, /UPDATE/);
});
