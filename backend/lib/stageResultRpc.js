/**
 * Per-stage atomic result-write via Postgres-RPC (#1598).
 *
 * Wrapper omkring `apply_stage_result(p_race_id, p_stage_index, p_stage_number,
 * p_total_stages, p_result_rows)`-RPC (database/2026-06-21-stage-write-atomic-rpc.sql).
 * RPC'en samler de tre per-etape-skrivninger der MÅ være konsistente med hinanden —
 * den optimistiske stages_completed-lås, den idempotente race_results-delete og
 * race_results-insert — i ÉN DB-transaktion. Et hårdt proces-kill mellem trinene
 * ruller HELE skrivningen tilbage, så stages_completed ikke kan stå foran tomme
 * race_results for en mellem-etape (det skarpe crash-vindue #1574 efterlod).
 *
 * Lås-semantikken er uændret fra den tidligere JS-sti (FIX 5): kun den FØRSTE
 * samtidige afvikling for samme løb vinder WHERE stages_completed = p_stage_index.
 * Taberen ser lockWon=false og afbryder FØR side-effekter — ingen dobbelt-anvendelse.
 *
 * Returnerer { lockWon, rowsImported }:
 *   lockWon=false — konkurrent vandt (eller counteren er allerede forbi etapen).
 *                   INGEN race_results rørt, counter uændret. Caller afbryder.
 *   lockWon=true  — counter bumpet + race_results delete+insert persisteret atomic.
 */

export async function applyStageResultAtomic(
  client,
  { raceId, stageIndex, stageNumber, totalStages, resultRows },
) {
  if (!client?.rpc) {
    throw new Error("applyStageResultAtomic kræver Supabase-client med rpc()");
  }
  if (!raceId) throw new Error("applyStageResultAtomic: raceId er påkrævet");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    throw new Error("applyStageResultAtomic: stageIndex skal være et ikke-negativt heltal");
  }
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error("applyStageResultAtomic: stageNumber skal være et positivt heltal");
  }
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    throw new Error("applyStageResultAtomic: resultRows skal være et ikke-tomt array");
  }

  const { data, error } = await client.rpc("apply_stage_result", {
    p_race_id: raceId,
    p_stage_index: stageIndex,
    p_stage_number: stageNumber,
    p_total_stages: totalStages ?? null,
    p_result_rows: resultRows,
  });

  if (error) throw error;

  // RPC returnerer jsonb { lock_won, rows_imported }. supabase-js giver det som objekt.
  const lockWon = data?.lock_won === true;
  const rowsImported = Number(data?.rows_imported) || 0;
  return { lockWon, rowsImported };
}
