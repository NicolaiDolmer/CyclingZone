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
