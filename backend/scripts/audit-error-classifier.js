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
