/**
 * Atomic result-write via Postgres-RPC (#1598, udvidet #3022).
 *
 * To wrappers, én per skrivesti:
 *
 * applyStageResultAtomic — per-etape (#1598). Wrapper omkring
 * `apply_stage_result(p_race_id, p_stage_index, p_stage_number, p_total_stages,
 * p_result_rows)`-RPC (database/2026-06-21-stage-write-atomic-rpc.sql). RPC'en
 * samler de tre per-etape-skrivninger der MÅ være konsistente med hinanden —
 * den optimistiske stages_completed-lås, den idempotente race_results-delete og
 * race_results-insert — i ÉN DB-transaktion. Et hårdt proces-kill mellem trinene
 * ruller HELE skrivningen tilbage, så stages_completed ikke kan stå foran tomme
 * race_results for en mellem-etape (det skarpe crash-vindue #1574 efterlod).
 *
 * Lås-semantikken er uændret fra den tidligere JS-sti (FIX 5): kun den FØRSTE
 * samtidige afvikling for samme løb vinder WHERE stages_completed = p_stage_index.
 * Taberen ser lockWon=false og afbryder FØR side-effekter — ingen dobbelt-anvendelse.
 *
 * applyRaceResultsBatchAtomic — fuld-løb + PCM-import (#3022 fejlmode B). Wrapper
 * omkring `apply_race_results_batch(p_race_id, p_stage_numbers, p_result_rows)`
 * (database/proposals/2026-08-05-race-results-batch-write-atomic-rpc.sql). Samme
 * mønster UDEN stages_completed-lås (findes ikke i fuld-løb/PCM-kaldeformen) —
 * samler blot delete-af-berørte-etaper + insert i ÉN transaktion, så et crash
 * mellem dem ikke kan efterlade løbet resultatløst.
 *
 * Begge wrappers kalder assertValidEntrantRows FØR RPC'en rammes — afviser en
 * batch med en deltager-løs række eller en intern kollision (#3022 forward-guard)
 * med et forklarende budskab, i stedet for et koldt unique_violation fra Postgres.
 */

import { assertValidEntrantRows } from "./raceResultEntrantKey.js";

export async function applyStageResultAtomic(
  client,
  { raceId, stageIndex, stageNumber, totalStages, resultRows },
) {
  if (!client?.rpc) {
    throw new Error("applyStageResultAtomic requires a Supabase client with rpc()");
  }
  if (!raceId) throw new Error("applyStageResultAtomic: raceId is required");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    throw new Error("applyStageResultAtomic: stageIndex must be a non-negative integer");
  }
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error("applyStageResultAtomic: stageNumber must be a positive integer");
  }
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    throw new Error("applyStageResultAtomic: resultRows must be a non-empty array");
  }
  assertValidEntrantRows(resultRows);

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

/**
 * Returnerer { rowsDeleted, rowsInserted }. Kaster hvis RPC'en fejler (hele
 * transaktionen — delete + insert — er da rullet tilbage af Postgres; ingen
 * partial state at rydde op i på JS-siden).
 */
export async function applyRaceResultsBatchAtomic(
  client,
  { raceId, stageNumbers, resultRows },
) {
  if (!client?.rpc) {
    throw new Error("applyRaceResultsBatchAtomic requires a Supabase client with rpc()");
  }
  if (!raceId) throw new Error("applyRaceResultsBatchAtomic: raceId is required");
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    throw new Error("applyRaceResultsBatchAtomic: resultRows must be a non-empty array");
  }
  assertValidEntrantRows(resultRows);

  const { data, error } = await client.rpc("apply_race_results_batch", {
    p_race_id: raceId,
    p_stage_numbers: Array.isArray(stageNumbers) && stageNumbers.length ? stageNumbers : null,
    p_result_rows: resultRows,
  });

  if (error) throw error;

  const rowsDeleted = Number(data?.rows_deleted) || 0;
  const rowsInserted = Number(data?.rows_inserted) || 0;
  return { rowsDeleted, rowsInserted };
}
