export function classifySupabaseAuditError(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "");
  const status = String(error?.status || "");
  const text = `${message} ${code} ${status}`;

  if (/legacy api keys are disabled|invalid api key|jwt expired|invalid jwt|invalid claim|401|403/i.test(text)) {
    return {
      kind: "auth-failure",
      detail: "Supabase auth failed. Update SUPABASE_SERVICE_KEY in Infisical (env=dev or prod) to a valid sb_secret_* — backend/.env fallback only if not using infisical run. See #337.",
    };
  }

  if (/function .* does not exist|could not find the function|relation .* does not exist|schema cache|404/i.test(text)) {
    return {
      kind: "rpc-missing",
      detail: "Required audit helper RPC/table is missing. Apply the matching database migration first.",
    };
  }

  // #4754: statement_timeout på 4/9 — hele funktionen fejlede fordi ét
  // COUNT(*) blokerede bag et lock. Klassificeret separat (og markeret
  // retryable) så scriptet kan lave et par forsøg med backoff i stedet for
  // straks at rødfarve CI'en — se database/2026-09-04-4754-feature-liveness-
  // count-lock-timeout.sql for den egentlige fix (per-tabel lock_timeout +
  // reltuples-fallback); denne retry er kun et sikkerhedsnet mod resterende
  // transiente belastningstoppe.
  if (/canceling statement due to statement timeout|statement timeout|57014/i.test(text)) {
    return {
      kind: "statement-timeout",
      detail: "Query cancelled by Postgres statement_timeout — likely transient lock contention or load. Retried automatically; see #4754.",
      retryable: true,
    };
  }

  return {
    kind: "other",
    detail: "Unexpected Supabase audit failure. Inspect the raw error before assuming migration drift.",
  };
}

export function formatSupabaseAuditError(operation, error, migrationHint) {
  const classification = classifySupabaseAuditError(error);
  const raw = String(error?.message || error || "unknown error");
  const suffix = classification.kind === "rpc-missing" && migrationHint
    ? ` ${migrationHint}`
    : ` ${classification.detail}`;
  return `${operation} failed (${classification.kind}): ${raw}.${suffix}`;
}
