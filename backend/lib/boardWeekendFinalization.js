// #1187 · Live-wiring af løbende bestyrelses-tilfredshed (weekend-finalization).
// =============================================================================
// Kobler den rene weekend-mekanik (boardWeekendUpdate.js, PR #1265 — scorecard
// ejer-godkendt 11/6) på de eksisterende weekend-finalization-stier:
//   - pcmResultsImport.importPcmResults   (PCM-upload, nød-fallback efter relaunch)
//   - raceRunner.simulateRace             (egen race-motor, #1102 — relaunch 20/6)
//   (raceResultsSheetSync var tredje sti indtil Sheets-importen blev fjernet
//    2026-06-12, #1180 pkt 3 / #1179.)
// Begge kalder processBoardWeekendFinalization efter recomputeSeasonRaceDays,
// dvs. én opdatering pr. finaliserings-event (typisk = én løbsweekend).
//
// Ejer-beslutninger 11/6 (issue #1187):
//   1. Trigger pr. løbsweekend (her), ingen ny cron.
//   2. Clamp ±5/weekend (WEEKEND_SATISFACTION_CLAMP i boardWeekendUpdate.js).
//   3. Hårde konsekvens-lag (2-5) KUN ved checkpoints: mid-season (her, via
//      race-days-krydsning af midpoint = floor(total/2), samme formel som
//      boardMidSeason.js) + sæson-slut (uændret i processTeamSeasonEnd).
//      Blød genforhandlings-trigger (<50, boardMidSeason-cron) er uændret.
//   4. Budget-modifier følger LIVE (satisfactionToModifier persiseres pr. weekend;
//      processSeasonStart + finance-forecast læser den aktuelle DB-værdi).
//   5. board_test_mode (#805): satisfaction/modifier må bevæge sig synligt, men
//      økonomi-effekten neutraliseres dér hvor udbetalinger sker
//      (processSeasonStart tvinger 1.0; lag 4/5 suppress i evaluateAndApply-
//      Consequences via boardTestMode-flaget vi sender med her).
//
// Anker (target-tracking): target = sæson-start-satisfaction + sæson-delta.
// Sæson-start-værdien persisteres på board_profiles (season_start_satisfaction +
// season_start_anchor_season_id, migration 2026-06-11) ved første weekend i
// sæsonen og genbruges resten af sæsonen. processTeamSeasonEnd læser samme
// anker, så sæson-slut-evalueringen lander på anker+delta (= præcis dagens
// resultat) i stedet for at dobbelt-anvende deltaet oven i den konvergerede
// løbende værdi.
//
// Idempotens/re-import: recomputeSeasonRaceDays er idempotent, så et re-import
// af samme løb ændrer ikke race_days → ingen ny mid-checkpoint-krydsning. Selve
// satisfaction-opdateringen er target-trackende og konvergerende: et ekstra
// kald flytter højst tallet ÉT clamp-skridt nærmere det (stabile) target —
// aldrig forbi det.
//
// Population: SAMME diskriminator som UI/boardMidSeason (match-UI-filter-reglen):
// rigtige hold = is_ai=false, is_bank=false, is_frozen=false, is_test_account=false.
// Planer: is_baseline=false + negotiation_status='completed' (samme som sæson-slut).

import {
  computeWeekendSatisfactionUpdate,
  CHECKPOINT_KINDS,
} from "./boardWeekendUpdate.js";
import { evaluateAndApplyConsequences as evaluateAndApplyConsequencesShared } from "./boardConsequences.js";
import { isBoardTestModeActive } from "./boardTestMode.js";
import { loadGoalContextForBoard } from "./boardGoalContext.js";
import { getPlanDuration, U25_ABILITY_KEYS } from "./boardGoals.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { notifyTeamOwner } from "./notificationService.js";

function toFiniteOr(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Afgør om DENNE finalization krydsede mid-season-checkpointet.
 * Mid-point = floor(race_days_total / 2) — samme formel som boardMidSeason.js.
 * Sæson-slut (done >= total) håndteres IKKE her: de hårde lag ved sæson-slut
 * kører uændret i processTeamSeasonEnd.
 */
export function resolveCrossedCheckpoint({
  previousRaceDaysCompleted,
  raceDaysCompleted,
  raceDaysTotal,
} = {}) {
  const prev = previousRaceDaysCompleted === null || previousRaceDaysCompleted === undefined
    ? null
    : toFiniteOr(previousRaceDaysCompleted, null);
  if (prev === null) return null; // ukendt udgangspunkt → aldrig hårde lag uden evidens
  const done = toFiniteOr(raceDaysCompleted, 0);
  const total = Math.max(1, toFiniteOr(raceDaysTotal, 0));
  const midpoint = Math.floor(total / 2);
  if (midpoint <= 0) return null;
  if (prev < midpoint && done >= midpoint && done < total) return CHECKPOINT_KINDS.MID_SEASON;
  return null;
}

/**
 * Hoved-entry: opdater satisfaction + budget_modifier for alle aktive planer på
 * rigtige human-hold efter en finaliseret løbsweekend, og kør de hårde
 * konsekvens-lag hvis mid-season-checkpointet netop blev krydset.
 *
 * @param {object} args
 * @param {object} args.supabase  — Supabase client (service role)
 * @param {object} args.season    — { id, number, status, race_days_total } +
 *                                  race_days_completed = NY værdi (efter recompute)
 * @param {number|null} args.previousRaceDaysCompleted — race_days_completed FØR
 *                                  denne finalization (til checkpoint-krydsning)
 * @param {Date}   [args.now]
 * @param {object} [args.deps]    — test-injektion: { isBoardTestModeActive,
 *                                  evaluateAndApplyConsequences, loadGoalContext,
 *                                  notifyTeamOwner }
 * @returns {Promise<object>} summary
 */
export async function processBoardWeekendFinalization({
  supabase,
  season,
  previousRaceDaysCompleted = null,
  now = new Date(),
  captureExceptionFn = null,
  deps = {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");

  const summary = {
    season_id: season?.id ?? null,
    teams_checked: 0,
    boards_updated: 0,
    checkpoint: null,
    consequences_applied: 0,
    errors: 0,
    skipped_reason: null,
  };

  if (!season?.id) {
    summary.skipped_reason = "no_season";
    return summary;
  }
  // Kun den aktive sæson har en levende bestyrelse — historiske re-imports
  // (fx Sheets-sync af gamle sæsoner) må ikke flytte satisfaction.
  if (season.status !== "active") {
    summary.skipped_reason = "season_not_active";
    return summary;
  }

  const isTestModeActiveFn = deps.isBoardTestModeActive ?? isBoardTestModeActive;
  const evaluateAndApplyConsequencesFn =
    deps.evaluateAndApplyConsequences ?? evaluateAndApplyConsequencesShared;
  const loadGoalContextFn = deps.loadGoalContext ?? loadGoalContextForBoard;
  const notifyTeamOwnerFn = deps.notifyTeamOwner ?? notifyTeamOwner;
  const computeWeekendUpdateFn = deps.computeWeekendUpdate ?? computeWeekendSatisfactionUpdate;

  // 1. Rigtige human-hold (match-UI-filter: ikke-AI/bank/test/frosne).
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, division, sponsor_income, season_1_identity_basis, team_dna_key")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsError) throw new Error(`Could not load teams for weekend board update: ${teamsError.message}`);
  if (!teams?.length) {
    summary.skipped_reason = "no_human_teams";
    return summary;
  }
  const teamIds = teams.map((t) => t.id);

  // 2. Aktive planer + standings + riders + lån (batch).
  const [boardsRes, standingsRes, ridersRes, loansRes] = await Promise.all([
    supabase.from("board_profiles").select("*").in("team_id", teamIds),
    supabase
      .from("season_standings")
      .select("*, team:team_id(is_ai)")
      .eq("season_id", season.id),
    supabase
      .from("riders")
      // Paritet med loadHumanSeasonEndTeams: identity-felter + U25-abilities,
      // så weekend-targettet evaluerer mod SAMME mål-kontekst som sæson-slut.
      .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}, rider_derived_abilities(${U25_ABILITY_KEYS.join(", ")})`)
      .in("team_id", teamIds),
    supabase
      .from("loans")
      .select("id, team_id")
      .eq("status", "active")
      .in("team_id", teamIds),
  ]);
  for (const [label, res] of [
    ["board_profiles", boardsRes],
    ["season_standings", standingsRes],
    ["riders", ridersRes],
    ["loans", loansRes],
  ]) {
    if (res.error) throw new Error(`Could not load ${label} for weekend board update: ${res.error.message}`);
  }

  const standings = standingsRes.data || [];
  const standingByTeam = new Map(standings.map((s) => [s.team_id, s]));

  const boardsByTeam = new Map();
  for (const board of boardsRes.data || []) {
    if (board.is_baseline || board.plan_type === "baseline") continue;
    if (board.negotiation_status !== "completed") continue;
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }

  const ridersByTeam = new Map();
  for (const rider of ridersRes.data || []) {
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const loanCountByTeam = new Map();
  for (const loan of loansRes.data || []) {
    loanCountByTeam.set(loan.team_id, (loanCountByTeam.get(loan.team_id) || 0) + 1);
  }

  // 3. Checkpoint + test-mode (én gang pr. kørsel).
  const checkpoint = resolveCrossedCheckpoint({
    previousRaceDaysCompleted,
    raceDaysCompleted: season.race_days_completed,
    raceDaysTotal: season.race_days_total,
  });
  summary.checkpoint = checkpoint;
  const boardTestMode = await isTestModeActiveFn(supabase);

  for (const team of teams) {
    const boards = boardsByTeam.get(team.id) || [];
    const standing = standingByTeam.get(team.id) || null;
    if (!boards.length || !standing) continue;
    summary.teams_checked += 1;

    const riders = ridersByTeam.get(team.id) || [];
    const teamWithRiders = { ...team, riders };

    // recentSnapshots pr. team — samme query-form som processTeamSeasonEnd.
    let recentSnapshots = [];
    try {
      const { data: snapshotRows, error: snapshotError } = await supabase
        .from("board_plan_snapshots")
        .select("goals_met, goals_total, satisfaction_delta")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (snapshotError) throw new Error(snapshotError.message);
      recentSnapshots = snapshotRows || [];
    } catch (error) {
      summary.errors += 1;
      console.error(`  ⚠️  weekend board snapshots failed for ${team.name}:`, error.message);
      if (captureExceptionFn) captureExceptionFn(error, { tags: { hook: "board-weekend" }, extra: { teamId: team.id } });
      continue;
    }

    for (const board of boards) {
      try {
        const planDuration = getPlanDuration(board.plan_type);
        const seasonsCompleted = (board.seasons_completed || 0) + 1;

        const goalContext = await loadGoalContextFn({
          supabase,
          teamId: team.id,
          boardId: board.id,
          currentSeasonId: season.id,
          division: standing.division,
          standings,
          planStartSeasonNumber: board.plan_start_season_number,
        });

        const context = {
          isFinalSeason: seasonsCompleted >= planDuration,
          activeLoanCount: loanCountByTeam.get(team.id) || 0,
          planStartSponsorIncome: board.plan_start_sponsor_income,
          currentSponsorIncome: team.sponsor_income,
          planDuration,
          seasonsCompleted,
          recentSnapshots,
          hasSeasonData: true,
          cumulativeStats: {
            stageWins: (board.cumulative_stage_wins || 0) + (standing.stage_wins || 0),
            gcWins: (board.cumulative_gc_wins || 0) + (standing.gc_wins || 0),
          },
          ...goalContext,
        };

        // Anker: sæson-start-satisfaction. Selv-healende ved sæson-skift —
        // første weekend i en ny sæson ser anchor-season-mismatch og re-ankrer
        // på den (endnu uberørte) løbende værdi.
        const hasValidAnchor =
          board.season_start_anchor_season_id === season.id &&
          Number.isFinite(Number(board.season_start_satisfaction)) &&
          board.season_start_satisfaction !== null;
        const anchor = hasValidAnchor
          ? Number(board.season_start_satisfaction)
          : toFiniteOr(board.satisfaction, 50);

        const update = computeWeekendUpdateFn({
          board,
          standing,
          team: teamWithRiders,
          context,
          seasonStartSatisfaction: anchor,
        });
        if (!update) continue;

        const { error: updateError } = await supabase
          .from("board_profiles")
          .update({
            satisfaction: update.newSatisfaction,
            budget_modifier: update.newModifier,
            season_start_satisfaction: anchor,
            season_start_anchor_season_id: season.id,
            updated_at: now.toISOString(),
          })
          .eq("id", board.id);
        if (updateError) throw new Error(updateError.message);
        summary.boards_updated += 1;

        // Hårde konsekvens-lag KUN ved mid-season-checkpoint (beslutning 3).
        // Sæson-slut-checkpointet kører uændret i processTeamSeasonEnd.
        if (checkpoint === CHECKPOINT_KINDS.MID_SEASON) {
          const result = await evaluateAndApplyConsequencesFn({
            supabase,
            team: teamWithRiders,
            board,
            newSatisfaction: update.newSatisfaction,
            goalsMet: update.goalsMet,
            goalsTotal: update.goalsTotal,
            planIsComplete: false,
            seasonId: season.id,
            consecutiveLowExpirations: 0,
            boardTestMode,
            notify: ({ type, title, message, metadata }) => notifyTeamOwnerFn({
              supabase,
              teamId: team.id,
              type,
              title,
              message,
              metadata: metadata ?? null,
              now,
            }),
          });
          summary.consequences_applied += (result?.applied || []).length;
        }
      } catch (error) {
        summary.errors += 1;
        console.error(`  ⚠️  weekend board update failed for ${team.name} (${board.plan_type}):`, error.message);
        if (captureExceptionFn) {
          captureExceptionFn(error, {
            tags: { hook: "board-weekend" },
            extra: { teamId: team.id, boardId: board.id, seasonId: season.id },
          });
        }
      }
    }
  }

  return summary;
}
