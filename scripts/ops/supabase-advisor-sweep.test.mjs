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
  assert.ok(real.names.has("rls_enabled_no_policy"));
  assert.ok(real.cacheKeyPrefixes.some((p) => p.includes("is_offered_intake_rider")));
});

// #5088: alle tre LEVENDE 0029-WARN (maalt 17/9 kl. 15:30 UTC) skal vaere
// daekket af en cache_key-post, ellers aabner sweepen et issue hver uge om fund
// der er dokumenteret bevidst aabne i docs/SUPABASE_SECURITY_ADVISORS.md.
test("de tre dokumenterede 0029-fund er daekket af accept-listen (#5088)", () => {
  const real = loadAllowlist();
  for (const fn of ["founder_public_list", "is_admin", "is_offered_intake_rider"]) {
    const finding = {
      name: "authenticated_security_definer_function_executable",
      cache_key: `authenticated_security_definer_function_executable_public_${fn}_`,
    };
    assert.equal(isAllowed(finding, real), true, `0029 paa ${fn}() mangler i accept-listen`);
  }
});

// #5088 forward-guard: matview-klassen maa IKKE accepteres som helhed igen.
// Posten stod der med begrundelsen "authenticated-SELECT tilsigtet"; den
// forudsaetning faldt med #5176 (reads flyttet bag backend) og
// 2026-09-17-5088-revoke-matview-grants.sql (REVOKE ALL). En klasse-accept ville
// goere sweepen blind for praecis den regression.
test("materialized_view_in_api er IKKE blanket-accepteret (#5088)", () => {
  const real = loadAllowlist();
  assert.equal(real.names.has("materialized_view_in_api"), false);
  const finding = {
    name: "materialized_view_in_api",
    cache_key: "materialized_view_in_api_public_rider_rankings_mv",
  };
  assert.equal(isAllowed(finding, real), false);
});

// #5088 forward-guard, samme klasse som testen ovenfor: en accept-post for et
// LUKKET fund skjuler regressionen i stedet for at daempe stoej. De fem fund
// herunder blev revoket i #4870 (de tre metrics-RPC'er) og #5153 (§C anon-
// is_admin, §D is_beta_tester), og advisoren maalte dem som vaek 17/9 kl.
// 15:30 UTC. Kommer et af dem tilbage, SKAL sweepen aabne et issue.
test("accept-listen daekker ikke fund der allerede er lukket (#5088)", () => {
  const real = loadAllowlist();
  const closed = [
    ["anon_security_definer_function_executable", "public_is_admin_", "#5153 §C"],
    ["authenticated_security_definer_function_executable", "public_is_beta_tester_", "#5153 §D"],
    ["authenticated_security_definer_function_executable", "public_get_cohort_retention_", "#4870"],
    ["authenticated_security_definer_function_executable", "public_get_retention_scorecard_activity_", "#4870"],
    ["authenticated_security_definer_function_executable", "public_get_sprint_metrics_", "#4870"],
  ];
  for (const [name, suffix, closedBy] of closed) {
    const finding = { name, cache_key: `${name}_${suffix}` };
    assert.equal(isAllowed(finding, real), false, `${suffix} er lukket i ${closedBy} og maa ikke vaere accepteret`);
  }
});
