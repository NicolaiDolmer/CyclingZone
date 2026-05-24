// S-02b · Auto-accept-cron + tier-styrede reminders.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (S-02b leverer-listen)
// Q-bekræftelser 2026-05-05: B=b (default-focus afledes fra identity_basis),
//                            C   (T-3 ved race_days_completed=2 → board_update,
//                                 T-1 ved =4 → board_critical,
//                                 auto-accept ved >=5)
//
// Daglig cron-job — idempotent via notification-dedup (24h vindue) + status-check
// (skipper teams der allerede har en signed plan for nuværende plan_type).
//
// Skalerings-præmis (CLAUDE.md): ingen kode-loops over fast manager-antal —
// vi loader kun human teams fra DB og itererer dem dynamisk.

import {
  BOARD_NEGOTIATION_STATES,
  BOARD_IDENTITY_RIDER_SELECT,
  ONBOARDING_PLAN_SEQUENCE,
} from "./boardConstants.js";
import {
  buildBoardProposal,
  finalizeBoardGoals,
  getPlanDuration,
} from "./boardGoals.js";
import { deriveDefaultFocusFromIdentity } from "./boardIdentity.js";
import { DEFAULT_SPONSOR_INCOME } from "./economyEngine.js";

// Tærskler — Q-bekræftelse C (2026-05-05).
// race_days_completed er counter på seasons-tabellen (schema.sql:100).
export const AUTO_ACCEPT_THRESHOLDS = {
  T_MINUS_3: 2,   // 3 race-days FØR auto-accept (5 - 3 = 2)
  T_MINUS_1: 4,   // 1 race-day FØR auto-accept (5 - 1 = 4)
  AUTO_ACCEPT: 5, // race_days_completed >= 5 → bestyrelsen tager over
};

/**
 * Cron-entry: tjek alle human teams for pending board-planer og send
 * reminders / auto-accept baseret på race_days_completed.
 *
 * @param {object} args
 * @param {object} args.supabase             — Supabase client
 * @param {Function} args.notifyUser         — fra notificationService.js
 * @param {Date} [args.now]                  — for tests
 * @returns {Promise<{ teams_checked: number, reminders_sent: number, auto_accepted: number, errors: number }>}
 */
export async function processBoardAutoAcceptCron({
  supabase,
  notifyUser,
  now = new Date(),
  captureExceptionFn,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (typeof notifyUser !== "function") throw new Error("notifyUser is required");

  const summary = {
    teams_checked: 0,
    reminders_sent: 0,
    auto_accepted: 0,
    errors: 0,
  };

  // Skip hvis vi er uden for sæson-2-onboarding-fasen (window er locked = baseline).
  const { data: latestWindow, error: windowError } = await supabase
    .from("transfer_windows")
    .select("id, board_negotiation_state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (windowError) throw windowError;

  const windowState = latestWindow?.board_negotiation_state ?? "locked";
  if (windowState === BOARD_NEGOTIATION_STATES.LOCKED
    || windowState === BOARD_NEGOTIATION_STATES.COMPLETE) {
    return summary;
  }

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, race_days_completed, race_days_total")
    .eq("status", "active")
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!activeSeason) return summary;

  const raceDaysCompleted = Number(activeSeason.race_days_completed ?? 0);
  if (raceDaysCompleted < AUTO_ACCEPT_THRESHOLDS.T_MINUS_3) {
    return summary;
  }

  const { data: humanTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, balance, sponsor_income, division, season_1_identity_basis")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsError) throw teamsError;

  for (const team of humanTeams || []) {
    summary.teams_checked += 1;
    try {
      const result = await processTeamAutoAccept({
        supabase,
        team,
        activeSeason,
        raceDaysCompleted,
        notifyUser,
        now,
      });
      if (result.reminder_sent) summary.reminders_sent += 1;
      if (result.auto_accepted) summary.auto_accepted += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`  ❌ board auto-accept failed for team ${team.id}:`, error.message);
      if (captureExceptionFn) {
        captureExceptionFn(error, {
          tags: { cron: "board-auto-accept" },
          extra: { teamId: team.id, seasonId: activeSeason?.id, raceDaysCompleted },
        });
      }
    }
  }

  return summary;
}

async function processTeamAutoAccept({
  supabase,
  team,
  activeSeason,
  raceDaysCompleted,
  notifyUser,
  now,
}) {
  const result = { reminder_sent: false, auto_accepted: false };

  // Find første pending plan_type i 5yr→3yr→1yr-orden.
  const { data: boards, error: boardsError } = await supabase
    .from("board_profiles")
    .select("id, plan_type, focus, negotiation_status, is_baseline")
    .eq("team_id", team.id);
  if (boardsError) throw boardsError;

  const realBoards = (boards || []).filter((b) => !b.is_baseline && b.plan_type !== "baseline");
  const pendingPlanType = findPendingPlanType(realBoards);
  if (!pendingPlanType) return result;

  const pendingBoard = realBoards.find((b) => b.plan_type === pendingPlanType) || null;

  if (raceDaysCompleted >= AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT) {
    const accepted = await autoAcceptPendingPlan({
      supabase,
      team,
      activeSeason,
      planType: pendingPlanType,
      existingBoard: pendingBoard,
      notifyUser,
      now,
    });
    result.auto_accepted = accepted;
    return result;
  }

  if (raceDaysCompleted >= AUTO_ACCEPT_THRESHOLDS.T_MINUS_1) {
    const sent = await sendT1CriticalReminder({
      supabase,
      team,
      activeSeason,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser,
      now,
      raceDaysCompleted,
    });
    result.reminder_sent = sent;
    return result;
  }

  if (raceDaysCompleted >= AUTO_ACCEPT_THRESHOLDS.T_MINUS_3) {
    const sent = await sendT3InfoReminder({
      supabase,
      team,
      activeSeason,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser,
      now,
      raceDaysCompleted,
    });
    result.reminder_sent = sent;
  }

  return result;
}

function findPendingPlanType(realBoards) {
  // Sequential onboarding-orden 5yr→3yr→1yr (ONBOARDING_PLAN_SEQUENCE).
  // Returnér første plan_type der enten mangler eller har status='pending'.
  for (const planType of ONBOARDING_PLAN_SEQUENCE) {
    const board = realBoards.find((b) => b.plan_type === planType);
    if (!board) return planType;
    if (board.negotiation_status === "pending") return planType;
  }
  return null;
}

async function sendT3InfoReminder({
  team, activeSeason, planType, pendingBoard, notifyUser, now, raceDaysCompleted,
}) {
  if (!team.user_id) return false;

  const planLabel = formatPlanLabel(planType);
  const raceDaysLeft = AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT - raceDaysCompleted;
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_update",
    title: `Bestyrelsen venter pa din ${planLabel}`,
    message: `Du har ${raceDaysLeft} race-days tilbage til at forhandle din ${planLabel}. Hvis du ikke gor noget, vaelger bestyrelsen selv.`,
    relatedId: pendingBoard?.id ?? null,
    now,
  });
  return Boolean(result?.delivered);
}

async function sendT1CriticalReminder({
  team, activeSeason, planType, pendingBoard, notifyUser, now, raceDaysCompleted,
}) {
  if (!team.user_id) return false;

  const planLabel = formatPlanLabel(planType);
  const raceDaysLeft = Math.max(1, AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT - raceDaysCompleted);
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_critical",
    title: `Sidste chance: ${planLabel}`,
    message: `Bestyrelsen tager over om ${raceDaysLeft} race-day${raceDaysLeft === 1 ? "" : "s"}. Aabn Bestyrelse-siden og forhandl din ${planLabel} nu.`,
    relatedId: pendingBoard?.id ?? null,
    now,
  });
  return Boolean(result?.delivered);
}

async function autoAcceptPendingPlan({
  supabase, team, activeSeason, planType, existingBoard, notifyUser, now,
}) {
  // Default focus afledes fra identity_basis (B=b 2026-05-05) — fallback til
  // existing focus (renewal-case) eller "balanced".
  const identityBasis = team.season_1_identity_basis || null;
  const focus = existingBoard?.focus || deriveDefaultFocusFromIdentity(identityBasis);

  // Load riders + standing til mål-generering.
  const [ridersRes, standingRes] = await Promise.all([
    supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", team.id),
    supabase.from("season_standings").select("*").eq("team_id", team.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (ridersRes.error) throw ridersRes.error;
  if (standingRes.error) throw standingRes.error;

  const proposal = buildBoardProposal({
    focus,
    planType,
    team,
    riders: ridersRes.data || [],
    standing: standingRes.data || null,
    identityBasis,
  });

  const planDuration = getPlanDuration(planType);
  const startSeasonNumber = activeSeason?.number ?? 1;
  const endSeasonNumber = startSeasonNumber + planDuration - 1;

  const finalGoals = finalizeBoardGoals({
    goals: proposal.goals,
    negotiationIndexes: [], // ingen forhandlinger ved auto-accept — status quo
  });

  const upsertData = {
    team_id: team.id,
    focus,
    plan_type: planType,
    current_goals: finalGoals,
    satisfaction: existingBoard?.satisfaction ?? 50,
    budget_modifier: existingBoard?.budget_modifier ?? 1.0,
    negotiation_status: "completed",
    plan_start_season_number: startSeasonNumber,
    plan_end_season_number: endSeasonNumber,
    plan_start_balance: team.balance ?? 0,
    plan_start_sponsor_income: team.sponsor_income ?? DEFAULT_SPONSOR_INCOME,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
    season_id: activeSeason?.id ?? null,
    is_baseline: false,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("board_profiles")
    .upsert(upsertData, { onConflict: "team_id,plan_type" });
  if (upsertError) throw upsertError;

  const planLabel = formatPlanLabel(planType);
  if (team.user_id) {
    await notifyUser({
      userId: team.user_id,
      type: "board_update",
      title: `Bestyrelsen valgte ${planLabel} for dig`,
      message: `Du naaede ikke at forhandle ${planLabel} — bestyrelsen valgte focus "${focus}" og standardmaal. Du kan stadig anmode om aendringer naar planen kører.`,
      relatedId: null,
      now,
    });
  }

  return true;
}

function formatPlanLabel(planType) {
  if (planType === "5yr") return "5-aarsplan";
  if (planType === "3yr") return "3-aarsplan";
  if (planType === "1yr") return "1-aarsplan";
  return planType;
}
