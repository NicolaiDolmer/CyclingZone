// scripts/ops/supabase-advisor-sweep.test.mjs
// Regression tests for the allowlist-diff logic (#3978).
// Run: node --test scripts/ops/supabase-advisor-sweep.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, diffFindings, loadAllowlist } from "./supabase-advisor-sweep.mjs";

const allowlist = {
  names: new Set(["rls_enabled_no_policy", "extension_in_public"]),
  cacheKeyPrefixes: ["authenticated_security_definer_function_executable_public_is_beta_tester_"],
};

test("allows a finding matched by name (whole class accepted)", () => {
  const finding = { name: "rls_enabled_no_policy", cache_key: "rls_enabled_no_policy_public_foo" };
  assert.equal(isAllowed(finding, allowlist), true);
});

test("allows a finding matched by cache_key prefix (specific accepted finding)", () => {
  const finding = {
    name: "authenticated_security_definer_function_executable",
    cache_key: "authenticated_security_definer_function_executable_public_is_beta_tester_",
  };
  assert.equal(isAllowed(finding, allowlist), true);
});

test("does NOT allow a same-named finding with a different cache_key (e.g. a new SECURITY DEFINER function)", () => {
  // Real-world case found during build: is_admin() and three new get_* RPCs are
  // NOT in the accept-list even though they share a name-prefix with is_beta_tester.
  const finding = {
    name: "authenticated_security_definer_function_executable",
    cache_key: "authenticated_security_definer_function_executable_public_get_sprint_metrics_p_window text",
  };
  assert.equal(isAllowed(finding, allowlist), false);
});

test("does NOT allow an unrelated advisor name", () => {
  const finding = { name: "auth_otp_long_expiry", cache_key: "auth_otp_long_expiry" };
  assert.equal(isAllowed(finding, allowlist), false);
});

test("diffFindings returns only the un-allowed findings", () => {
  const findings = [
    { name: "rls_enabled_no_policy", cache_key: "rls_enabled_no_policy_public_a" },
    { name: "anon_security_definer_function_executable", cache_key: "anon_security_definer_function_executable_public_is_admin_" },
  ];
  const result = diffFindings(findings, allowlist);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "anon_security_definer_function_executable");
});

test("loadAllowlist reads the real repo allowlist file and produces a usable shape", () => {
  const real = loadAllowlist();
  assert.ok(real.names instanceof Set);
  assert.ok(Array.isArray(real.cacheKeyPrefixes));
  assert.ok(real.names.has("materialized_view_in_api"));
  assert.ok(real.cacheKeyPrefixes.some((p) => p.includes("is_offered_intake_rider")));
});
