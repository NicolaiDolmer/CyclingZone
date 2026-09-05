// #3514: kill-switch for mandat-modellen. Mønster kopieret fra
// raceDayEngineFlag.js / dailyTrainingFlag.js.
//
// OFF (default) = BIT-FOR-BIT nuværende adfærd: `board_profiles` og de 3
// satisfaction-tal er stadig sandheden; `board_relations`, `board_mandates` og
// `board_vision_milestones` læses ikke af nogen kodesti.
//
// Flaget bor i app_config, så det kan flippes runtime UDEN re-deploy, fail-safe:
// fejl/fravær → false (ingen utilsigtet aktivering). Kill-switchen er rollback,
// ikke beta-gate (ejer-politik, spec §"Fase 2"): flippet 23/8 gælder ALLE.
//
// #4839 — SKRIVE-gate ≠ LÆSE-gate. Flaget stod på `beta` fra 1/9, men alle
// motor-/cron-indgange kalder uden en viewer og fik derfor `false`: motoren
// skrev INTET i beta, så skyggemodellen stod stille (max(board_relations
// .updated_at) = rebuild-tidspunktet, 0 kvitteringer med mandate_id). Ved flip
// til `on` ville kvitterings-feed, "Last movement" og medlems-stemning være
// tomme for alle hold indtil første løbsdag efter flippet.
//
// Derfor to eksplicitte options:
//   { isBetaTester: true } — LÆSE-gaten. UI/API for ÉN viewer. Uændret: i
//     `beta` ser kun admin/beta-testere Boardroom.
//   { engineWrite: true }  — SKRIVE-gaten. Motor-/cron-kald uden viewer
//     (kvitteringer, tillids-bevægelser, milepæls-evaluering, auto-accept,
//     sæsonskifte). `beta` behandles som `on`, så skyggedata bygges op for
//     ALLE hold mens fladen stadig er skjult — så er historikken der den dag
//     flaget flippes.
// `off` er stadig kill-switch for BEGGE: ingen skrivning, ingen læsning.
// Selve tre-tilstands-logikken bor ét sted: featureStage.js::evaluateFlagStage.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const BOARD_MANDATE_MODEL_FLAG_KEY = "board_mandate_model_enabled";

/**
 * @param {object} supabase
 * @param {object} [opts]
 * @param {boolean} [opts.isBetaTester] læse-gate for én viewer (admin/beta-tester)
 * @param {boolean} [opts.engineWrite]  skrive-gate for motor/cron (beta ⇒ true)
 */
export async function isBoardMandateModelEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, BOARD_MANDATE_MODEL_FLAG_KEY), opts);
}
