// S-02a · Sekventiel forhandling — sæson 2-onboarding (Q-batch 1A Q2 + Q7).
// Master roadmap: docs/slices/02-board-redesign-MASTER.md
//
// Når sæson 1 (baseline) afsluttes, åbner vi sæson 2's transfer_window i fasen
// 'pending_5yr' og sletter alle baseline-rows. Frontend BoardPage bruger window-state
// som global lås og row-eksistens i board_profiles som per-team-fremdrift
// (api.js:3093 PLAN_SEQUENCE.find — eksisterende sequential-detektion).
//
// Per-team-progression skal IKKE persistere i window-state (Q-B 2026-05-05):
// data findes allerede i board_profiles-rows.

import { BOARD_NEGOTIATION_STATES } from "./boardConstants.js";

function throwIfSupabaseError(error, message) {
  if (!error) return;
  throw new Error(`${message}: ${error.message}`);
}

/**
 * Starter sekventiel onboarding-forhandling for alle human teams.
 *
 * Trigger: kaldes inline i economyEngine.processSeasonEnd når sæson 1 afsluttes
 * (currentSeasonNumber === 1). IKKE en cron-loop (Q-A 2026-05-05).
 *
 * Effekt:
 *  1. Slet alle baseline-rows for human teams (deres "sæson 1 observation" er ovre).
 *  2. Sæt nyeste transfer_window.board_negotiation_state = 'pending_5yr'.
 *
 * Skalerer for variabelt manager-antal (CLAUDE.md skalerings-præmis):
 *  - Operationen er constant time uanset antal hold (én DELETE + én UPDATE).
 *
 * @param {{ supabase: object, completedSeasonId?: string|null }} args
 * @returns {Promise<{ baseline_rows_deleted: number, window_state: string|null }>}
 */
export async function startSequentialNegotiation({ supabase, completedSeasonId = null } = {}) {
  if (!supabase?.from) {
    throw new Error("Supabase client is required");
  }

  // 1. Slet baseline-rows for human teams (AI/bank/frozen får ingen baseline)
  const { data: humanTeams, error: humanTeamsError } = await supabase
    .from("teams")
    .select("id")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
  throwIfSupabaseError(humanTeamsError, "Could not load human teams for sequential negotiation");

  const teamIds = (humanTeams || []).map((row) => row.id);
  let baselineRowsDeleted = 0;

  if (teamIds.length > 0) {
    const { data: deletedRows, error: deleteError } = await supabase
      .from("board_profiles")
      .delete()
      .eq("plan_type", "baseline")
      .in("team_id", teamIds)
      .select("id");
    throwIfSupabaseError(deleteError, "Could not delete baseline board profiles");
    baselineRowsDeleted = (deletedRows || []).length;
  }

  // 2. Sæt nyeste transfer_window.board_negotiation_state = 'pending_5yr'.
  // Kun hvis et nyere window findes — hvis sæson 2's window endnu ikke er åbnet,
  // skal admin sætte det manuelt ved transfer-window-open. Vi opdaterer kun
  // det seneste eksisterende window for at undgå at oprette ghost-rows.
  const { data: latestWindow, error: windowReadError } = await supabase
    .from("transfer_windows")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(windowReadError, "Could not read latest transfer window");

  let windowState = null;
  if (latestWindow?.id) {
    const { error: windowUpdateError } = await supabase
      .from("transfer_windows")
      .update({ board_negotiation_state: BOARD_NEGOTIATION_STATES.PENDING_5YR })
      .eq("id", latestWindow.id);
    throwIfSupabaseError(windowUpdateError, "Could not set board_negotiation_state");
    windowState = BOARD_NEGOTIATION_STATES.PENDING_5YR;
  }

  return {
    baseline_rows_deleted: baselineRowsDeleted,
    window_state: windowState,
    completed_season_id: completedSeasonId,
  };
}
