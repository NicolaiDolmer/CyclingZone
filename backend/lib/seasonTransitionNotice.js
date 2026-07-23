// backend/lib/seasonTransitionNotice.js
// #2700 · Varsel til managere FØR sæsonskiftet: hvilke af deres ryttere udløber
// (kontrakt, #2744) eller er i pensionsrisiko (#1137/#2748) ved den kommende
// transition. Lovet offentligt i Discord 18/7 — SKAL ud FØR skiftet (27/7 09:00
// UTC), derfor en selvstændig, manuelt kørt fase (IKKE en del af selve
// season-transition-koden, som først kører PÅ dagen — for sent til et varsel).
//
// Kør ALDRIG denne fil direkte mod prod fra en agent-session. Leveres som
// scripts/notifySeasonTransitionRisk.js (dry-run som default) og køres af
// ejeren/orkestratoren.
//
// Klassifikation deles med squad-spærren (#2748, samme mekanik-par) via
// squadRiskGuard.js, så varslets tal og spærrens beregning ALDRIG kan drive fra
// hinanden — begge læser samme isContractExpiringAtTransition/
// isRetirementRiskAtTransition.

import { fetchAllRows } from "./supabasePagination.js";
import {
  isContractExpiringAtTransition,
  isRetirementRiskAtTransition,
} from "./squadRiskGuard.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { captureException } from "./sentry.js";

export const SEASON_TRANSITION_RISK_TYPE = "season_transition_risk";

// EN-first (#1068). DA-oversættelse + i18n-koder ligger i backendMessages.json
// (notif.seasonTransitionRisk.*) — samme messageBoth/messageExpiringOnly/
// messageRetirementOnly-mønster som boardT1Reminder (messageSingle/messageMulti).
function buildMessage({ expiringCount, retirementRiskCount }) {
  if (expiringCount > 0 && retirementRiskCount > 0) {
    return {
      messageCode: "notif.seasonTransitionRisk.messageBoth",
      message: `Your squad is affected by the upcoming season change: ${expiringCount} rider(s) will be released as free agents because their contract expires, and ${retirementRiskCount} rider(s) (age 36+) are at risk of retiring. Extend a rider's contract from his profile before the change to prevent release; retirement can't be prevented, but you can bid for replacements once the season changes.`,
    };
  }
  if (expiringCount > 0) {
    return {
      messageCode: "notif.seasonTransitionRisk.messageExpiringOnly",
      message: `Your squad is affected by the upcoming season change: ${expiringCount} rider(s) will be released as free agents because their contract expires. Extend their contract from the rider's profile before the change to keep them.`,
    };
  }
  return {
    messageCode: "notif.seasonTransitionRisk.messageRetirementOnly",
    message: `Your squad is affected by the upcoming season change: ${retirementRiskCount} rider(s) (age 36+) are at risk of retiring. Retirement can't be prevented, but you can bid for replacements once the season changes.`,
  };
}

export function buildSeasonTransitionRiskNotification({ expiringCount, retirementRiskCount }) {
  const { messageCode, message } = buildMessage({ expiringCount, retirementRiskCount });
  return {
    type: SEASON_TRANSITION_RISK_TYPE,
    title: "Season change: contract and retirement risk",
    message,
    relatedId: null,
    metadata: {
      titleCode: "notif.seasonTransitionRisk.title",
      titleParams: {},
      messageCode,
      messageParams: { expiringCount, retirementRiskCount },
    },
  };
}

// Samme menneske-manager-diskriminator som resten af motoren (is_ai=false,
// is_bank=false, is_frozen=false, is_test_account=false, user_id IS NOT NULL —
// se getSquadSnapshot/emitContractExpiringNotifications/DashboardPage.jsx).
async function defaultFetchHumanTeamRiskRows({ supabase, activeSeasonNumber }) {
  const teams = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, user_id, name")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .not("user_id", "is", null)
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));
  if (teamById.size === 0) return [];

  const riders = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, team_id, birthdate, contract_end_season")
      .eq("is_academy", false)
      .eq("is_retired", false)
      .in("team_id", [...teamById.keys()])
  );

  const byTeam = new Map();
  for (const r of riders) {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }

  const rows = [];
  for (const [teamId, team] of teamById) {
    const teamRiders = byTeam.get(teamId) || [];
    const expiringCount = teamRiders.filter((r) => isContractExpiringAtTransition(r, activeSeasonNumber)).length;
    const retirementRiskCount = teamRiders.filter(
      (r) => isRetirementRiskAtTransition(r, activeSeasonNumber) && !isContractExpiringAtTransition(r, activeSeasonNumber)
    ).length;
    if (expiringCount > 0 || retirementRiskCount > 0) {
      rows.push({ teamId, userId: team.user_id, teamName: team.name, expiringCount, retirementRiskCount });
    }
  }
  return rows;
}

/**
 * #2700 · Byg (og valgfrit send) sæsonskifte-risiko-varslet til alle berørte
 * menneske-managers. dryRun (default true) sender INTET — returnerer blot
 * statistik + et eksempel, så orkestratoren kan verificere antal FØR --live.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} args.activeSeasonNumber — den AKTIVE (endnu ikke-afsluttede) sæson
 * @param {boolean} [args.dryRun=true]
 * @param {Function} [args.notify]
 * @param {Function} [args.fetchTeamRiskRows]
 */
export async function emitSeasonTransitionRiskNotice({
  supabase,
  activeSeasonNumber,
  dryRun = true,
  notify = defaultNotifyUser,
  fetchTeamRiskRows = defaultFetchHumanTeamRiskRows,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!Number.isFinite(activeSeasonNumber)) throw new Error("activeSeasonNumber required");

  const rows = await fetchTeamRiskRows({ supabase, activeSeasonNumber });
  const stats = {
    dryRun,
    teamsAffected: rows.length,
    totalExpiring: rows.reduce((n, r) => n + r.expiringCount, 0),
    totalRetirementRisk: rows.reduce((n, r) => n + r.retirementRiskCount, 0),
    delivered: 0,
    deduped: 0,
    failed: 0,
    sample: rows.slice(0, 3).map((r) => ({
      teamName: r.teamName,
      expiringCount: r.expiringCount,
      retirementRiskCount: r.retirementRiskCount,
      ...buildSeasonTransitionRiskNotification(r),
    })),
  };

  if (dryRun) return stats;

  for (const row of rows) {
    const payload = buildSeasonTransitionRiskNotification(row);
    try {
      const res = await notify({ supabase, userId: row.userId, ...payload });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ season-transition-risk-varsel fejlede (hold ${row.teamId}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "season-transition-risk" }, teamId: row.teamId });
    }
  }

  return stats;
}
