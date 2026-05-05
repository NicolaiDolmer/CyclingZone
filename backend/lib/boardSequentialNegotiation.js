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
//
// S-02b · Tilføjelse 2026-05-05:
// Før baseline-rows slettes, beregnes computeSeasonOneIdentity for hver human team
// fra deres aktuelle hold-state og persisteres på teams.season_1_identity_basis.
// Dette er den frosne sandhed for identity-feeding-badge ("Bygger på din franske kerne"),
// 5yr-mål-weighting, 1yr-auto-gen og default-focus ved auto-accept.
//
// S-02c · Tilføjelse 2026-05-05:
// Efter identity_basis er persistet, tildeler vi 5 board-medlemmer pr. human team
// (3 identity-matched + 2 non-conflicting wildcards). Idempotent — skipper teams
// der allerede har 5 medlemmer i team_board_members.

import { BOARD_IDENTITY_RIDER_SELECT, BOARD_NEGOTIATION_STATES } from "./boardConstants.js";
import { computeSeasonOneIdentity } from "./boardIdentity.js";
import { assignBoardMembersForTeam } from "./boardMembers.js";

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
    .select("id, division, season_1_identity_basis, team_dna_key")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
  throwIfSupabaseError(humanTeamsError, "Could not load human teams for sequential negotiation");

  const teamIds = (humanTeams || []).map((row) => row.id);
  let baselineRowsDeleted = 0;
  let identityBasesWritten = 0;
  let boardMembersAssignedTotal = 0;

  // S-02b: Compute + persist identity_basis pr. team før baseline slettes.
  // Skip teams der allerede har et frosset basis (idempotent ved cron-replay).
  // S-02c: Efter identity_basis er persistet (eller allerede findes), tildel 5 board-medlemmer.
  if (teamIds.length > 0) {
    const teamsNeedingBasis = (humanTeams || []).filter((row) => !row.season_1_identity_basis);
    const teamBasisMap = new Map();
    (humanTeams || []).forEach((row) => {
      if (row.season_1_identity_basis) teamBasisMap.set(row.id, row.season_1_identity_basis);
    });

    if (teamsNeedingBasis.length > 0) {
      const { data: ridersByTeam, error: ridersError } = await supabase
        .from("riders")
        .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`)
        .in("team_id", teamsNeedingBasis.map((row) => row.id));
      throwIfSupabaseError(ridersError, "Could not load riders for identity basis");

      const riderMap = new Map();
      (ridersByTeam || []).forEach((rider) => {
        if (!rider.team_id) return;
        if (!riderMap.has(rider.team_id)) riderMap.set(rider.team_id, []);
        riderMap.get(rider.team_id).push(rider);
      });

      for (const teamRow of teamsNeedingBasis) {
        const identityBasis = computeSeasonOneIdentity({
          team: teamRow,
          riders: riderMap.get(teamRow.id) || [],
          seasonNumber: 1,
        });

        const { error: updateError } = await supabase
          .from("teams")
          .update({ season_1_identity_basis: identityBasis })
          .eq("id", teamRow.id);
        throwIfSupabaseError(updateError, `Could not persist identity_basis for team ${teamRow.id}`);
        teamBasisMap.set(teamRow.id, identityBasis);
        identityBasesWritten += 1;
      }
    }

    // S-02c · Tildel 5 board-medlemmer pr. human team (3 identity + 2 non-conflicting wildcards).
    // Idempotent — skipper teams der allerede har 5 medlemmer.
    // S-02f · DNA er typisk null ved første assignment (manageren vælger DNA i sæson 2,
    // medlemmerne tildeles ved sæson-1-slut). DNA-bias slår først ind ved chairman-replacement.
    const teamDnaMap = new Map();
    (humanTeams || []).forEach((row) => {
      teamDnaMap.set(row.id, row.team_dna_key || null);
    });

    for (const teamId of teamIds) {
      const basis = teamBasisMap.get(teamId);
      if (!basis) continue;
      const result = await assignBoardMembersForTeam({
        supabase,
        teamId,
        identityBasis: basis,
        dnaKey: teamDnaMap.get(teamId) || null,
      });
      if (!result.skipped) boardMembersAssignedTotal += result.assigned;
    }

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
    identity_bases_written: identityBasesWritten,
    board_members_assigned: boardMembersAssignedTotal,
    window_state: windowState,
    completed_season_id: completedSeasonId,
  };
}
