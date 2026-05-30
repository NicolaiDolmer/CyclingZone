// Board test-mode orkestrering (#805)
// ====================================
// Atomisk åbn/luk af board-test-tilstanden. Holdt adskilt fra boardTestMode.js
// (som economyEngine.js importerer) for at undgå import-cyklus
// economyEngine → boardTestMode → betaResetService → economyEngine.
// Kun api.js (admin-routes) importerer denne fil.

import { resetBetaBoardProfiles } from "./betaResetService.js";
import { startSequentialNegotiation } from "./boardSequentialNegotiation.js";
import { setLatestWindowTestMode } from "./boardTestMode.js";

/**
 * Åbn bestyrelsen for test med frosset økonomi (#805).
 *
 * Atomisk, idempotent sekvens der genbruger eksisterende byggeklodser:
 *   1. resetBetaBoardProfiles — B1: ryd signerede planer, genskab ren baseline.
 *   2. startSequentialNegotiation — slet baseline-rows + tildel board-medlemmer
 *      + sæt seneste window board_negotiation_state = 'pending_5yr' (genåbner
 *      UI + crons via den eksisterende sæson-2-onboarding-sti).
 *   3. board_test_mode = true på seneste window → økonomi-laget neutraliseres.
 *
 * @param {object} supabase — Supabase client
 * @param {object} [deps] — dependency-injection for tests
 * @returns {Promise<object>} sammendrag af de tre trin
 */
export async function openBoardTestMode(supabase, deps = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  const resetFn = deps.resetBetaBoardProfiles ?? resetBetaBoardProfiles;
  const startFn = deps.startSequentialNegotiation ?? startSequentialNegotiation;
  const setFlagFn = deps.setLatestWindowTestMode ?? setLatestWindowTestMode;
  const reset = await resetFn(supabase);
  const negotiation = await startFn({ supabase });
  const flag = await setFlagFn(supabase, true);
  return {
    ok: true,
    board_profiles_reset: reset,
    negotiation,
    window_id: flag.window_id,
    board_test_mode: true,
  };
}

/**
 * Luk board-test-tilstanden (idempotent rollback): board_test_mode = false.
 * Board-data + window-state efterlades urørt — kun økonomi-frysningen ophæves.
 *
 * @param {object} supabase — Supabase client
 * @returns {Promise<object>}
 */
export async function closeBoardTestMode(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  const flag = await setLatestWindowTestMode(supabase, false);
  return { ok: true, window_id: flag.window_id, board_test_mode: false };
}
