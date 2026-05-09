/**
 * Slice 07c — Atomic balance updates via Postgres-RPC.
 *
 * Wrapper omkring `increment_balance_with_audit(team_id, delta, payload)`-RPC
 * (database/2026-05-09-balance-rpc.sql). RPC'en samler `UPDATE teams.balance`
 * + `INSERT finance_transactions` i én DB-transaktion + serialiserer concurrent
 * calls per team via pg_advisory_xact_lock. Eliminerer lost-update-races.
 *
 * Brug i stedet for de gamle 2-trin patterns (SELECT balance → UPDATE balance,
 * derefter separat INSERT i finance_transactions).
 *
 * Payload-felter (alle valgfri undtagen type + amount):
 *   type, amount               — finance_transactions.type/amount (påkrævet)
 *   description                — fritekst
 *   season_id, race_id         — eksisterende FK-kolonner
 *   related_loan_id            — FK til loans (07b loan-interest idempotency)
 *   actor_type, actor_id       — 07d audit (cron|api|admin|system|migration)
 *   source_path                — 07d audit (fx 'loanEngine.createLoan')
 *   reason_code                — 07d audit (FINANCE_REASON-enum)
 *   related_entity_type/_id    — 07d audit (auction|loan|transfer|...)
 *   idempotency_key            — 07d audit (UNIQUE-håndhævet skip-key)
 *
 * Audit-felterne (actor_type ... idempotency_key) populeres af callsites i
 * 07d Fase B (#235); 07c kalder med basale felter + lader audit-kolonner være
 * NULL. before_balance + after_balance udfyldes automatisk af RPC'en.
 *
 * Returner en object med `{ skipped, balance }`:
 *   skipped=true  — DB afviste INSERT med unique_violation (23505), fx fra
 *                   uniq_sponsor_per_team_season eller uniq_finance_idempotency_key.
 *                   Hele transaktionen blev rullet tilbage; balance er IKKE ændret.
 *                   Caller skal logge "already paid"-skip og fortsætte.
 *   skipped=false — Balance + finance_transactions row er begge persisteret.
 *                   `balance` indeholder ny saldo (BIGINT).
 *
 * Sæt `options.allowDuplicate=false` (default) for at lade 23505 propagere som
 * exception — bruges for paths uden idempotency-håndhævelse hvor en konflikt
 * ville være en reel bug.
 */

export const DUPLICATE_VIOLATION_CODE = "23505";

export async function incrementBalanceWithAudit(
  client,
  { teamId, delta, payload },
  options = {}
) {
  if (!client?.rpc) {
    throw new Error("incrementBalanceWithAudit kræver Supabase-client med rpc()");
  }
  if (!teamId) throw new Error("incrementBalanceWithAudit: teamId er påkrævet");
  if (!Number.isFinite(delta)) {
    throw new Error("incrementBalanceWithAudit: delta skal være et tal");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("incrementBalanceWithAudit: payload er påkrævet");
  }
  if (!payload.type) throw new Error("incrementBalanceWithAudit: payload.type er påkrævet");
  if (!Number.isFinite(payload.amount)) {
    throw new Error("incrementBalanceWithAudit: payload.amount skal være et tal");
  }

  const { data, error } = await client.rpc("increment_balance_with_audit", {
    p_team_id: teamId,
    p_delta: delta,
    p_finance_payload: payload,
  });

  if (error) {
    if (options.allowDuplicate && error.code === DUPLICATE_VIOLATION_CODE) {
      return { skipped: true, balance: null };
    }
    throw error;
  }

  return { skipped: false, balance: typeof data === "number" ? data : Number(data) };
}
