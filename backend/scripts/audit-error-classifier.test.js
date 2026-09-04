import test from "node:test";
import assert from "node:assert/strict";

import { classifySupabaseAuditError, formatSupabaseAuditError } from "./audit-error-classifier.js";

test("classifies disabled legacy keys as auth-failure", () => {
  assert.equal(
    classifySupabaseAuditError({ message: "Legacy API keys are disabled." }).kind,
    "auth-failure"
  );
});

test("classifies missing helper RPC as rpc-missing", () => {
  assert.equal(
    classifySupabaseAuditError({ message: "function public.audit_rls_coverage() does not exist" }).kind,
    "rpc-missing"
  );
});

test("formatted auth failures do not suggest applying migrations", () => {
  const formatted = formatSupabaseAuditError(
    "audit_rls_coverage RPC",
    { message: "Invalid API key" },
    "Apply database/2026-05-10-audit-rls-helper.sql first."
  );

  assert.match(formatted, /auth-failure/);
  assert.doesNotMatch(formatted, /Apply database/);
});

// #4754: 4/9 fejlede feature_liveness_table_counts med denne præcise
// Postgres-fejlbesked (statement_timeout=2min, arvet af service_role).
test("classifies statement_timeout cancellation as retryable statement-timeout", () => {
  const classification = classifySupabaseAuditError({
    message: "canceling statement due to statement timeout",
  });
  assert.equal(classification.kind, "statement-timeout");
  assert.equal(classification.retryable, true);
});

test("statement-timeout classification also matches the bare Postgres SQLSTATE 57014", () => {
  assert.equal(
    classifySupabaseAuditError({ message: "query cancelled", code: "57014" }).kind,
    "statement-timeout"
  );
});

test("other error kinds are not marked retryable", () => {
  assert.notEqual(
    classifySupabaseAuditError({ message: "Invalid API key" }).retryable,
    true
  );
  assert.notEqual(
    classifySupabaseAuditError({ message: "relation public.foo does not exist" }).retryable,
    true
  );
});
