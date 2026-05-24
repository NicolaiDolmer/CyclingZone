// S-02g · Mid-season auto-banner cron (Q-batch 1B Q15 + Q-batch 1C Q21).
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (S-02g leverer-listen)
//
// Når race_days_completed krydser midpoint (= floor(race_days_total / 2)) tjekker cron
// hver human team med en aktiv 1yr-plan. Hvis satisfaction < 50 ELLER ≥50% af målbare
// mål er 'behind'-status → fyrer board_critical-notif til Indbakke 'Skal handles'-tier.
//
// Idempotens: vi tjekker eksisterende notification med exact-match titel
// "Mid-season check (sæson N)" + related_id=board_id + type=board_critical. Ingen
// time-window-dedup — én fire pr. board pr. sæson. Resten af sæsonen er stabil
// indtil næste sæson, hvor ny titel ('sæson N+1') igen vil kunne fyre.
//
// Skip-betingelser:
//   - Window er 'locked' (sæson 1 baseline) → ingen 1yr-board endnu
//   - Window er sæson-2-onboarding (pending_*) → 1yr-plan er evt. ikke signed endnu
//   - completed < midpoint
//   - is_ai/is_bank/is_frozen team
//   - 1yr-board mangler eller er pending (ikke completed)
//
// Skalerings-præmis (CLAUDE.md): ingen kode-loops over fast manager-antal —
// kun human teams loades, division-standings batch-loades én gang.

import { BOARD_NEGOTIATION_STATES, BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { parseBoardGoals, evaluateGoalProgress } from "./boardGoals.js";

export const MID_SEASON_TITLE_PREFIX = "Mid-season check";

/**
 * Cron-entry: tjek alle human teams ved midpoint og fyr mid-season-banner ved trigger.
 *
 * @param {object} args
 * @param {object} args.supabase             — Supabase client
 * @param {Function} args.notifyUser         — fra notificationService.js
 * @param {Date} [args.now]                  — for tests
 * @returns {Promise<{ teams_checked: number, banners_sent: number, errors: number }>}
 */
export async function processMidSeasonReviewCron({
  supabase,
  notifyUser,
  now = new Date(),
  captureExceptionFn,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (typeof notifyUser !== "function") throw new Error("notifyUser is required");

  const summary = { teams_checked: 0, banners_sent: 0, errors: 0 };

  // 1. Skip hvis vi er i baseline-fasen eller mid-onboarding (sæson 2)
  const { data: latestWindow, error: windowError } = await supabase
    .from("transfer_windows")
    .select("id, board_negotiation_state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (windowError) throw windowError;

  const windowState = latestWindow?.board_negotiation_state ?? "locked";
  if (windowState !== BOARD_NEGOTIATION_STATES.COMPLETE) {
    // Onboarding-fasen kan have pending boards → vent indtil COMPLETE.
    return summary;
  }

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, race_days_completed, race_days_total")
    .eq("status", "active")
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!activeSeason) return summary;

  const completed = Number(activeSeason.race_days_completed ?? 0);
  const total = Number(activeSeason.race_days_total ?? 60);
  const midpoint = Math.floor(total / 2);
  if (completed < midpoint) return summary;

  // 2. Human teams
  const { data: humanTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, division, season_1_identity_basis")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsError) throw teamsError;
  if (!humanTeams?.length) return summary;

  // 3. Batch-load standings for sæsonen — bruges af evaluateGoalProgress + relative_rank
  const { data: standingsAll, error: standingsError } = await supabase
    .from("season_standings")
    .select("team_id, division, rank_in_division, total_points, stage_wins, gc_wins, prize_money")
    .eq("season_id", activeSeason.id);
  if (standingsError) throw standingsError;

  const standingsByTeam = new Map();
  const divisionManagerCounts = new Map();
  for (const standing of standingsAll || []) {
    standingsByTeam.set(standing.team_id, standing);
  }
  // Antal humane managers pr. division — bruges af relative_rank-evaluator.
  const humanTeamIds = new Set(humanTeams.map((t) => t.id));
  for (const standing of standingsAll || []) {
    if (!humanTeamIds.has(standing.team_id)) continue;
    const div = standing.division;
    if (div == null) continue;
    divisionManagerCounts.set(div, (divisionManagerCounts.get(div) || 0) + 1);
  }

  for (const team of humanTeams) {
    summary.teams_checked += 1;
    try {
      const result = await processTeamMidSeason({
        supabase,
        team,
        activeSeason,
        standing: standingsByTeam.get(team.id) || null,
        divisionManagerCount: divisionManagerCounts.get(team.division) || null,
        notifyUser,
        now,
      });
      if (result.banner_sent) summary.banners_sent += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`  ❌ mid-season check failed for team ${team.id}:`, error.message);
      if (captureExceptionFn) {
        captureExceptionFn(error, {
          tags: { cron: "board-mid-season" },
          extra: { teamId: team.id, seasonId: activeSeason?.id, seasonNumber: activeSeason?.number },
        });
      }
    }
  }

  return summary;
}

async function processTeamMidSeason({
  supabase,
  team,
  activeSeason,
  standing,
  divisionManagerCount,
  notifyUser,
  now,
}) {
  if (!team.user_id) return { banner_sent: false };

  // 1yr-plan = den aktive år-til-år-mål-pakke. 3yr/5yr har egne langsigtede mål.
  const { data: boards, error: boardsError } = await supabase
    .from("board_profiles")
    .select("id, plan_type, satisfaction, current_goals, negotiation_status, is_baseline")
    .eq("team_id", team.id)
    .eq("plan_type", "1yr");
  if (boardsError) throw boardsError;

  const board = (boards || []).find((b) =>
    !b.is_baseline && b.negotiation_status === "completed"
  );
  if (!board) return { banner_sent: false };

  // Idempotency-check: er der allerede sendt en mid-season-banner for denne sæson?
  const title = `${MID_SEASON_TITLE_PREFIX} (sæson ${activeSeason.number})`;
  const { data: existingNotifs, error: notifError } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("type", "board_critical")
    .eq("title", title)
    .eq("related_id", board.id)
    .limit(1);
  if (notifError) throw notifError;
  if (existingNotifs?.length) return { banner_sent: false };

  // Hent ryttere ved trigger-evaluering — vi har brug for is_u25 + popularity til
  // signature_rider/u25-mål. Holdt minimal: først tjek satisfaction, så lazy-load riders.
  const satisfaction = Number(board.satisfaction ?? 50);
  const goals = parseBoardGoals(board.current_goals);

  // Lazy-loaded — kun hvis satisfaction-tjek ikke giver klar trigger.
  let riders = null;
  async function getRiders() {
    if (riders !== null) return riders;
    const { data, error } = await supabase
      .from("riders")
      .select(BOARD_IDENTITY_RIDER_SELECT)
      .eq("team_id", team.id);
    if (error) throw error;
    riders = data || [];
    return riders;
  }

  const { trigger, reason } = await evaluateMidSeasonTrigger({
    satisfaction,
    goals,
    standing,
    team,
    getRiders,
    divisionManagerCount,
  });

  if (!trigger) return { banner_sent: false };

  const message = buildMidSeasonMessage({ reason, satisfaction });
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_critical",
    title,
    message,
    relatedId: board.id,
    now,
  });

  return { banner_sent: Boolean(result?.delivered) };
}

/**
 * Pure-function trigger-tjek. Kan testes uden DB.
 * Returnerer { trigger: bool, reason: 'low_satisfaction' | 'many_behind' | null }.
 */
export async function evaluateMidSeasonTrigger({
  satisfaction,
  goals,
  standing,
  team,
  getRiders,
  divisionManagerCount,
}) {
  if (Number(satisfaction) < 50) {
    return { trigger: true, reason: "low_satisfaction" };
  }

  if (!goals?.length) return { trigger: false, reason: null };

  const riders = typeof getRiders === "function" ? await getRiders() : (team?.riders || []);
  const teamWithRiders = { ...(team || {}), riders };

  const behindCount = countBehindGoals({
    goals,
    standing,
    team: teamWithRiders,
    divisionManagerCount,
  });
  const measurable = countMeasurableGoals({
    goals,
    standing,
    team: teamWithRiders,
    divisionManagerCount,
  });

  if (measurable === 0) return { trigger: false, reason: null };
  const behindPct = behindCount / measurable;
  if (behindPct >= 0.5) return { trigger: true, reason: "many_behind" };

  return { trigger: false, reason: null };
}

function countMeasurableGoals({ goals, standing, team, divisionManagerCount }) {
  return goals.filter((goal) => {
    const progress = evaluateGoalProgress(goal, standing, team, {
      divisionManagerCount,
      planDuration: 1,
      seasonsCompleted: 1,
      isFinalSeason: false,
    });
    return !progress.missing_data;
  }).length;
}

function countBehindGoals({ goals, standing, team, divisionManagerCount }) {
  return goals.filter((goal) => {
    const progress = evaluateGoalProgress(goal, standing, team, {
      divisionManagerCount,
      planDuration: 1,
      seasonsCompleted: 1,
      isFinalSeason: false,
    });
    if (progress.missing_data) return false;
    return progress.status === "behind";
  }).length;
}

function buildMidSeasonMessage({ reason, satisfaction }) {
  const intro = reason === "low_satisfaction"
    ? `Bestyrelsen er bekymret. Tilfredsheden er nede paa ${Math.round(satisfaction)}.`
    : "Bestyrelsen er bekymret. Mindst halvdelen af planens maal ligger bag tidsplanen.";
  const actions = "Du kan stadig dreje planen via en board-request — eller anmode om budget-laan paa Oekonomi-siden hvis presset er finansielt. Bestyrelsen forventer at se aktion inden saesonens slutning.";
  return `${intro} ${actions}`;
}
