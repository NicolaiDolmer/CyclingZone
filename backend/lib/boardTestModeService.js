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
 * Fælles kerne: åbn bestyrelsen for alle testere via den eksisterende
 * sæson-2-onboarding-sti. Eneste forskel mellem test og live er board_test_mode-
 * flaget (sidste trin) — derfor deler de denne atomiske, idempotente sekvens:
 *   1. resetBetaBoardProfiles — B1: ryd signerede planer, genskab ren baseline.
 *   2. startSequentialNegotiation — slet baseline-rows + sæt seneste window
 *      board_negotiation_state = 'pending_5yr' (genåbner UI + crons).
 *   3. board_test_mode = <testMode> på seneste window.
 *
 * @param {object} supabase — Supabase client
 * @param {object} deps — dependency-injection for tests
 * @param {boolean} testMode — true = frys økonomi, false = ægte konsekvenser
 * @returns {Promise<object>} sammendrag af de tre trin
 */
async function openBoard(supabase, deps, testMode) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  const resetFn = deps.resetBetaBoardProfiles ?? resetBetaBoardProfiles;
  const startFn = deps.startSequentialNegotiation ?? startSequentialNegotiation;
  const setFlagFn = deps.setLatestWindowTestMode ?? setLatestWindowTestMode;
  const reset = await resetFn(supabase);
  const negotiation = await startFn({ supabase });
  const flag = await setFlagFn(supabase, testMode);
  return {
    ok: true,
    board_profiles_reset: reset,
    negotiation,
    window_id: flag.window_id,
    board_test_mode: testMode,
  };
}

/**
 * Åbn bestyrelsen for test med FROSSET økonomi (#805).
 * board_test_mode = true → sponsor-modifier tvinges 1.0, ingen board-bonus-
 * udbetalinger, tvangssalg/pullout suppress.
 *
 * @param {object} supabase — Supabase client
 * @param {object} [deps] — dependency-injection for tests
 * @returns {Promise<object>} sammendrag af de tre trin
 */
export async function openBoardTestMode(supabase, deps = {}) {
  return openBoard(supabase, deps, true);
}

/**
 * Åbn bestyrelsen LIVE med ÆGTE økonomi (#1062).
 * Samme onboarding-sti som test-varianten, men board_test_mode = false →
 * sponsor-modifier, board-bonusser og tvangssalg/pullout virker for alvor.
 * Til ende-til-ende-test af hele board-systemet uden økonomi-frysning.
 *
 * @param {object} supabase — Supabase client
 * @param {object} [deps] — dependency-injection for tests
 * @returns {Promise<object>} sammendrag af de tre trin
 */
export async function openBoardLive(supabase, deps = {}) {
  return openBoard(supabase, deps, false);
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
