// S-02b · Auto-accept-cron + tier-styrede reminders.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (S-02b leverer-listen)
// Q-bekræftelser 2026-05-05: B=b (default-focus afledes fra identity_basis),
//                            C   (T-3/T-1/auto-accept-tærskler — se #2463 for
//                                 den aktuelle enhed de måles i).
//
// #2463 · Tærsklerne var oprindeligt kalibreret mod seasons.race_days_completed
// (Q-C 2026-05-05) under antagelsen ~1 race-day pr. kalenderdag ⇒ et ~5-dages
// forhandlingsvindue. Men race_days_completed er SUM(stages) over ALLE
// completede løb i sæsonen på tværs af divisioner (seasonRaceDays.js) — vokser
// ~20+/dag. Prod-evidens 16/7: race_days_completed=524 (race_days_total=60!),
// 218 auto-accepts (bulk 54 stk. dagen efter sæsonstart), kun 25 T-3-reminders
// (ét kort vindue), 0 T-1-reminders NOGENSINDE. Fixet: kalenderdags-ur PR PLAN
// via resolveNegotiationOpenedAt() — anker = hvornår netop DENNE plan blev
// åbnet til forhandling, ikke et globalt sæson-race-day-ur. Samme underliggende
// enheds-bug rammer getBoardRenegotiationLock (boardRequests.js) + boardMidSeason
// midpoint + seasonRaceDays.js selv — fixes i separat issue, ikke her.
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
import { computeDnaSuggestions } from "./boardClubDna.js";
import { deriveDefaultFocusFromIdentity } from "./boardIdentity.js";
import { regenerateBoardMembersForTeam } from "./boardMembers.js";
import { DEFAULT_SPONSOR_INCOME } from "./economyEngine.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Tærskler — kalenderdage siden planen blev åbnet til forhandling (#2463).
// Navnesemantikken (T_MINUS_3/T_MINUS_1/AUTO_ACCEPT) er bevaret fra
// Q-bekræftelse C 2026-05-05 — kun enheden ændrede sig (race-days → dage).
export const AUTO_ACCEPT_THRESHOLDS = {
  T_MINUS_3: 2,   // dage siden åbning → info-reminder (board_update)
  T_MINUS_1: 4,   // dage siden åbning → kritisk reminder (board_critical)
  AUTO_ACCEPT: 5, // dage siden åbning → bestyrelsen tager over
};

// #2469 · Kolonnerne autoAcceptPendingPlan viderefører fra en EKSISTERENDE
// board-række. Enhver kolonne der læses som `existingBoard?.x ?? <default>` i
// upserten SKAL stå her — mangler den, læses den som undefined og defaulten
// overskriver spillerens optjente værdi i stedet for at bevare den.
// Forward-guard: boardAutoAccept.test.js låser dette mod upsert-payloaden.
// #2463 · created_at/updated_at tilføjet — de bærer anker-datoen som
// resolveNegotiationOpenedAt() læser (updated_at = hvornår DENNE rækkes
// forhandling blev åbnet; created_at = fallback når raden mangler helt).
export const BOARD_AUTO_ACCEPT_SELECT =
  "id, plan_type, focus, negotiation_status, is_baseline, satisfaction, budget_modifier, tradeoff_payload, created_at, updated_at";

/**
 * #2463 · Find hvornår en pending plan blev "åbnet til forhandling" — ankeret
 * kalenderdags-uret måler fra. Kalenderdags-uret er PR PLAN, ikke pr. sæson.
 *
 * 1. Pending-board-rækken findes → dens updated_at. Verificeret stabil:
 *    boardWeekendFinalization.js skipper ikke-completed boards (rører aldrig
 *    en pending rækkes updated_at), sæson-slut-flippet (economyEngine.js) og
 *    POST /board/renew (routes/api.js) sætter begge updated_at eksplicit ved
 *    åbning, og formations-boardet får updated_at=NOW() ved insert (schema.sql
 *    board_profiles.updated_at DEFAULT NOW()).
 * 2. Plan-rækken MANGLER (sekventiel onboarding — fx 5yr signeret, 3yr-rækken
 *    findes endnu ikke) → max(created_at) over holdets completede
 *    ikke-baseline board-rækker, dvs. da forrige plan blev signeret eller
 *    auto-accepteret. created_at røres aldrig af senere updates.
 * 3. Fallback: team.created_at (helt nyt hold, ingen board-historik endnu).
 * 4. Alt ugyldigt/manglende → null. Kaldestedet skipper holdet uden exception.
 *
 * @param {object} args
 * @param {object} [args.team]
 * @param {object|null} [args.pendingBoard]
 * @param {object[]} [args.realBoards] — alle ikke-baseline board-rækker for holdet
 * @returns {Date|null}
 */
export function resolveNegotiationOpenedAt({ team, pendingBoard, realBoards }) {
  if (pendingBoard?.updated_at) {
    const fromBoard = new Date(pendingBoard.updated_at);
    if (!Number.isNaN(fromBoard.getTime())) return fromBoard;
  }

  if (!pendingBoard) {
    const completedCreatedMs = (realBoards || [])
      .filter((b) => b.negotiation_status === "completed" && b.created_at)
      .map((b) => new Date(b.created_at).getTime())
      .filter((ms) => !Number.isNaN(ms));
    if (completedCreatedMs.length > 0) {
      return new Date(Math.max(...completedCreatedMs));
    }
  }

  if (team?.created_at) {
    const fromTeam = new Date(team.created_at);
    if (!Number.isNaN(fromTeam.getTime())) return fromTeam;
  }

  return null;
}

/**
 * Cron-entry: tjek alle human teams for pending board-planer og send
 * reminders / auto-accept baseret på kalenderdage siden planen blev åbnet
 * til forhandling (#2463 — se resolveNegotiationOpenedAt).
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

  const { data: humanTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, balance, sponsor_income, division, season_1_identity_basis, team_dna_key, created_at")
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
          extra: { teamId: team.id, seasonId: activeSeason?.id },
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
  notifyUser,
  now,
}) {
  const result = { reminder_sent: false, auto_accepted: false };

  // Find første pending plan_type i 5yr→3yr→1yr-orden.
  //
  // #2469 · Denne select SKAL bære hvert felt autoAcceptPendingPlan viderefører
  // fra den eksisterende række. Den hentede kun 5 kolonner, så `existingBoard`
  // manglede satisfaction/budget_modifier/tradeoff_payload — og fordi upserten
  // skriver `existingBoard?.satisfaction ?? 50`, blev `undefined ?? 50` til en
  // NULSTILLING af optjent tilfredshed og sponsor-modifier. /board/sign har
  // aldrig haft fejlen: den henter board-rækken via loadBoardPlanningContext
  // (routes/api.js) med .select("*"). Samme upsert-kode, modsat udfald — hele
  // divergensen lå i denne select. Udvid den, ikke kaldestedet.
  const { data: boards, error: boardsError } = await supabase
    .from("board_profiles")
    .select(BOARD_AUTO_ACCEPT_SELECT)
    .eq("team_id", team.id);
  if (boardsError) throw boardsError;

  const realBoards = (boards || []).filter((b) => !b.is_baseline && b.plan_type !== "baseline");
  const pendingPlanType = findPendingPlanType(realBoards);
  if (!pendingPlanType) return result;

  const pendingBoard = realBoards.find((b) => b.plan_type === pendingPlanType) || null;

  // #2463 · Kalenderdags-ur pr. plan i stedet for det globale race_days_completed-ur.
  const openedAt = resolveNegotiationOpenedAt({ team, pendingBoard, realBoards });
  if (!openedAt) return result; // Alt ugyldigt/manglende → skip holdet, ingen exception.

  const daysSinceOpen = (now.getTime() - openedAt.getTime()) / DAY_MS;

  if (daysSinceOpen >= AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT) {
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

  if (daysSinceOpen >= AUTO_ACCEPT_THRESHOLDS.T_MINUS_1) {
    const sent = await sendT1CriticalReminder({
      team,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser,
      now,
      daysSinceOpen,
    });
    result.reminder_sent = sent;
    return result;
  }

  if (daysSinceOpen >= AUTO_ACCEPT_THRESHOLDS.T_MINUS_3) {
    const sent = await sendT3InfoReminder({
      team,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser,
      now,
      daysSinceOpen,
    });
    result.reminder_sent = sent;
  }

  return result;
}

// Sequential onboarding-orden 5yr→3yr→1yr (ONBOARDING_PLAN_SEQUENCE).
// Returnér første plan_type der enten mangler eller har status='pending'.
// Eksporteret så GET /board/status (routes/api.js) kan genbruge samme logik
// til auto_accept.pending_plan_type i stedet for at duplikere den.
export function findPendingPlanType(realBoards) {
  for (const planType of ONBOARDING_PLAN_SEQUENCE) {
    const board = (realBoards || []).find((b) => b.plan_type === planType);
    if (!board) return planType;
    if (board.negotiation_status === "pending") return planType;
  }
  return null;
}

async function sendT3InfoReminder({
  team, planType, pendingBoard, notifyUser, now, daysSinceOpen,
}) {
  if (!team.user_id) return false;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  const daysLeft = Math.max(1, Math.ceil(AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT - daysSinceOpen));
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_update",
    title: `The board is waiting for your ${planLabelEn}`,
    message: `You have ${daysLeft} days left to negotiate your ${planLabelEn}. If you don't act, the board will decide.`,
    relatedId: pendingBoard?.id ?? null,
    metadata: {
      titleCode: "notif.boardT3Reminder.title",
      titleParams: { planLabelKey },
      messageCode: "notif.boardT3Reminder.message",
      messageParams: { daysLeft, planLabelKey },
    },
    now,
  });
  return Boolean(result?.delivered);
}

async function sendT1CriticalReminder({
  team, planType, pendingBoard, notifyUser, now, daysSinceOpen,
}) {
  if (!team.user_id) return false;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  const daysLeft = Math.max(1, Math.ceil(AUTO_ACCEPT_THRESHOLDS.AUTO_ACCEPT - daysSinceOpen));
  const isSingle = daysLeft === 1;
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_critical",
    title: `Last chance: ${planLabelEn}`,
    message: `The board takes over in ${daysLeft} day${isSingle ? "" : "s"}. Open the Board page and negotiate your ${planLabelEn} now.`,
    relatedId: pendingBoard?.id ?? null,
    metadata: {
      titleCode: "notif.boardT1Reminder.title",
      titleParams: { planLabelKey },
      messageCode: isSingle ? "notif.boardT1Reminder.messageSingle" : "notif.boardT1Reminder.messageMulti",
      messageParams: { daysLeft, planLabelKey },
    },
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
  let dnaKey = team.team_dna_key || null;

  if (identityBasis && !dnaKey) {
    const suggestedDna = computeDnaSuggestions(identityBasis)[0] || null;
    dnaKey = suggestedDna?.key || null;

    if (dnaKey) {
      const { error: dnaUpdateError } = await supabase
        .from("teams")
        .update({
          team_dna_key: dnaKey,
          team_dna_chosen_at: now.toISOString(),
        })
        .eq("id", team.id);
      if (dnaUpdateError) throw dnaUpdateError;

      // Atomicitet (#878): rul team_dna_key/team_dna_chosen_at tilbage hvis member-
      // regenereringen kaster efter team-UPDATE er committet. Ellers efterlades teamet
      // dna-sat-men-boardless, og 409-guarden i POST /board/dna-choose ville låse
      // manageren ude. Samme mønster som chooseDnaForTeam (boardMembers.js).
      try {
        await regenerateBoardMembersForTeam({
          supabase,
          teamId: team.id,
          identityBasis,
          dnaKey,
        });
      } catch (regenError) {
        await supabase
          .from("teams")
          .update({ team_dna_key: null, team_dna_chosen_at: null })
          .eq("id", team.id);
        throw regenError;
      }
    }
  }

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
    dnaKey,
    // S-02g/#2469 · Anvend deferred tradeoff-stramning fra forrige sæsons
    // approved request — præcis som /board/sign og /board/proposal gør.
    // Uden den her gav samme plan to udfald: signerede du selv, blev din
    // tradeoff anvendt; lod du planen udløbe, forsvandt den.
    // (buildBoardProposal har ingen `board`-parameter — kun tradeoffPayload
    // er kausal. api.js' `board:`-argument er en død prop, ryddet separat.)
    tradeoffPayload: existingBoard?.tradeoff_payload ?? null,
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
    // #2469 · Bevar optjent tilfredshed + sponsor-modifier. Ved sæson-slut
    // skriver economyEngine.processTeamSeasonEnd den netop optjente værdi ind
    // OG sætter negotiation_status='pending' (economyEngine.js) — så når
    // auto-accept-cron'en overtager planen, ER der en optjent værdi at bevare.
    // ?? 50 / ?? 1.0 gælder derfor kun den ægte nye-plan-case, hvor
    // findPendingPlanType returnerede en plan_type uden række (existingBoard=null).
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
    // S-02g/#2469 · Plan-renewal nulstiller tradeoff (stramningen er netop bagt
    // ind i finalGoals via buildBoardProposal ovenfor) + MAJOR-pivot cool-down.
    // Identisk med /board/sign — ellers ville stramningen blive anvendt igen
    // ved næste renewal og stable oven på sig selv.
    tradeoff_active_until_season_id: null,
    tradeoff_payload: null,
    major_pivot_used_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("board_profiles")
    .upsert(upsertData, { onConflict: "team_id,plan_type" });
  if (upsertError) throw upsertError;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  if (team.user_id) {
    await notifyUser({
      userId: team.user_id,
      type: "board_update",
      title: `The board chose ${planLabelEn} for you`,
      message: `You didn't negotiate your ${planLabelEn} in time — the board picked focus "${focus}" and default goals. You can still request changes once the plan is running.`,
      relatedId: null,
      metadata: {
        titleCode: "notif.boardAutoAccepted.title",
        titleParams: { planLabelKey },
        messageCode: "notif.boardAutoAccepted.message",
        messageParams: { planLabelKey, focus },
      },
      now,
    });
  }

  return true;
}

// #666: EN fallback brugt i title/message — i18n-key driver fuld locale.
function formatPlanLabelEn(planType) {
  if (planType === "5yr") return "5-year plan";
  if (planType === "3yr") return "3-year plan";
  if (planType === "1yr") return "1-year plan";
  return planType;
}

function planLabelI18nKey(planType) {
  if (planType === "1yr" || planType === "3yr" || planType === "5yr") {
    return `planLabel.${planType}`;
  }
  return "planLabel.unknown";
}
