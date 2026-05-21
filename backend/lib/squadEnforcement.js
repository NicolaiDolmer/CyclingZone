/**
 * S-03 Trupstørrelse-håndhævelse
 *
 * Når et transfervindue lukker, sikrer cron at hver human-manager har:
 *   - D1: 20-30 ryttere
 *   - D2: 14-20 ryttere
 *   - D3: 8-10 ryttere
 *
 * Mekanik pr. afvigende manager:
 *   - Under min: auto-køb cheapeste tilgængelige AI-/fri-rytter til 150% market_value
 *     (opretter nødlån via createEmergencyLoan hvis balance utilstrækkelig)
 *   - Over max: auto-sælg seneste-erhvervede rytter tilbage til ai_team_id (eller fri agent)
 *     med fuld market_value som kredit
 *   - Bøde: 100K CZ$ + 200 fradrag-points pr. afvigende rytter (begge retninger)
 *
 * Idempotency: window-level atomic claim på squad_enforcement_completed_at,
 * samme mønster som final_whistle_sent_at. Cron skal kunne re-køre uden at
 * dobbelt-straffe nogen.
 */

import {
  ensureNoError,
  expectMaybeSingle,
  expectMutation,
  expectSingle,
} from "./marketUtils.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

const NOOP = async () => {};
export const SQUAD_FINE_AMOUNT = 100000;
export const SQUAD_PENALTY_POINTS = 200;
export const SQUAD_PURCHASE_MARKUP = 1.5;

// ─── Utility helpers ──────────────────────────────────────────────────────────

async function getSquadSnapshot(supabase, teamId) {
  const team = await expectSingle(
    supabase
      .from("teams")
      .select("id, name, balance, division, user_id, is_ai, is_bank, is_frozen")
      .eq("id", teamId)
  );

  const { data: ownedRiders, error: ownedError } = await supabase
    .from("riders")
    .select("id, firstname, lastname, ai_team_id, market_value, acquired_at, created_at")
    .eq("team_id", teamId);
  ensureNoError(ownedError);

  const { data: activeLoans, error: loanError } = await supabase
    .from("loan_agreements")
    .select("id")
    .eq("to_team_id", teamId)
    .eq("status", "active");
  ensureNoError(loanError);

  return {
    team,
    ownedRiders: ownedRiders || [],
    activeLoanCount: (activeLoans || []).length,
  };
}

function getSquadLimitsForDivision(division) {
  switch (division) {
    case 1: return { min: 20, max: 30 };
    case 2: return { min: 14, max: 20 };
    default: return { min: 8, max: 10 };
  }
}

// Sælg-kandidater: ejede ryttere sorteret efter senest erhvervet (DESC).
// Bruger created_at som tiebreak for ryttere med ens acquired_at (efter backfill).
function pickRidersToSell(ownedRiders, count) {
  const sorted = [...ownedRiders].sort((a, b) => {
    const aTs = new Date(a.acquired_at || a.created_at || 0).getTime();
    const bTs = new Date(b.acquired_at || b.created_at || 0).getTime();
    return bTs - aTs;
  });
  return sorted.slice(0, count);
}

async function findCheapestAvailableRiders(supabase, count, excludedTeamIds) {
  // Tilgængelige = ingen team_id, eller ejet af AI-team. Begge kategorier kan auto-købes.
  const { data: aiTeams, error: aiError } = await supabase
    .from("teams")
    .select("id")
    .eq("is_ai", true);
  ensureNoError(aiError);
  const aiTeamIds = new Set((aiTeams || []).map(t => t.id));
  for (const id of excludedTeamIds) aiTeamIds.delete(id);

  // Hent rigeligt med kandidater: fri agents først, derefter AI-ejede.
  // Vi henter 3x count for at have buffer mod race conditions / duplicate-team-ownership.
  const limit = Math.max(count * 3, count + 10);

  const { data: freeAgents, error: faError } = await supabase
    .from("riders")
    .select("id, firstname, lastname, team_id, ai_team_id, market_value, uci_points")
    .is("team_id", null)
    .order("uci_points", { ascending: true })
    .limit(limit);
  ensureNoError(faError);

  let pool = freeAgents || [];

  if (pool.length < count && aiTeamIds.size > 0) {
    const { data: aiOwned, error: aiOwnedError } = await supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, ai_team_id, market_value, uci_points")
      .in("team_id", [...aiTeamIds])
      .order("uci_points", { ascending: true })
      .limit(limit);
    ensureNoError(aiOwnedError);
    pool = pool.concat(aiOwned || []);
  }

  pool.sort((a, b) => (a.uci_points || 0) - (b.uci_points || 0));
  return pool.slice(0, count);
}

// ─── Effekter pr. rytter ──────────────────────────────────────────────────────

async function executeAutoPurchase({
  supabase,
  team,
  rider,
  seasonId,
  createEmergencyLoanFn,
  now,
}) {
  const price = Math.round((rider.market_value || 0) * SQUAD_PURCHASE_MARKUP);

  // Frisk balance — hvis foregående køb i denne kørsel har drænet kontoen.
  const freshTeam = await expectSingle(
    supabase.from("teams").select("balance").eq("id", team.id)
  );

  const shortfall = price - freshTeam.balance;
  if (shortfall > 0) {
    await createEmergencyLoanFn(team.id, shortfall, supabase, seasonId);
  }

  // Slice 07c: balance + finance_transactions atomic via RPC.
  // 07d Fase B: cron-trigger via processSquadEnforcementCron.
  await incrementBalanceWithAudit(supabase, {
    teamId: team.id,
    delta: -price,
    payload: {
      type: "auto_squad_purchase",
      amount: -price,
      description: `Auto-køb (trupstørrelse): ${rider.firstname} ${rider.lastname}`,
      season_id: seasonId,
      actor_type: FINANCE_ACTOR_TYPE.CRON,
      actor_id: null,
      source_path: "squadEnforcement.executeAutoPurchase",
      reason_code: FINANCE_REASON.SQUAD_AUTO_PURCHASE,
      related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
      related_entity_id: seasonId || null,
    },
  });

  await expectMutation(
    supabase
      .from("riders")
      .update({
        team_id: team.id,
        pending_team_id: null,
        acquired_at: now.toISOString(),
      })
      .eq("id", rider.id)
  );

  return { riderId: rider.id, riderName: `${rider.firstname} ${rider.lastname}`, price };
}

async function executeAutoSale({
  supabase,
  team,
  rider,
  seasonId,
}) {
  const credit = rider.market_value || 0;

  // Slice 07c: balance + finance_transactions atomic via RPC.
  await incrementBalanceWithAudit(supabase, {
    teamId: team.id,
    delta: credit,
    payload: {
      type: "auto_squad_sale",
      amount: credit,
      description: `Auto-salg (trupstørrelse): ${rider.firstname} ${rider.lastname}`,
      season_id: seasonId,
      actor_type: FINANCE_ACTOR_TYPE.CRON,
      actor_id: null,
      source_path: "squadEnforcement.executeAutoSale",
      reason_code: FINANCE_REASON.SQUAD_AUTO_SALE,
      related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
      related_entity_id: seasonId || null,
    },
  });

  await expectMutation(
    supabase
      .from("riders")
      .update({
        team_id: rider.ai_team_id || null,
        pending_team_id: null,
      })
      .eq("id", rider.id)
  );

  return { riderId: rider.id, riderName: `${rider.firstname} ${rider.lastname}`, credit };
}

async function applyFinesAndPenalty({
  supabase,
  team,
  deviatingCount,
  seasonId,
}) {
  if (deviatingCount <= 0) return { fineAmount: 0, penaltyPoints: 0 };

  const fineAmount = SQUAD_FINE_AMOUNT * deviatingCount;
  const penaltyPoints = SQUAD_PENALTY_POINTS * deviatingCount;

  // Slice 07c: balance + finance_transactions atomic via RPC.
  await incrementBalanceWithAudit(supabase, {
    teamId: team.id,
    delta: -fineAmount,
    payload: {
      type: "squad_violation_fine",
      amount: -fineAmount,
      description: `Trupstørrelse-bøde: ${deviatingCount} afvigende rytter${deviatingCount === 1 ? "" : "e"} × ${SQUAD_FINE_AMOUNT.toLocaleString("da-DK")} CZ$`,
      season_id: seasonId,
      actor_type: FINANCE_ACTOR_TYPE.CRON,
      actor_id: null,
      source_path: "squadEnforcement.applyFinesAndPenalty",
      reason_code: FINANCE_REASON.SQUAD_VIOLATION_FINE,
      related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
      related_entity_id: seasonId || null,
    },
  });

  // Increment penalty_points på det aktive sæsons standings-row.
  // Hvis der ikke findes en row endnu (sæsonen er lige startet), opretter vi den.
  if (seasonId) {
    const existing = await expectMaybeSingle(
      supabase
        .from("season_standings")
        .select("id, penalty_points")
        .eq("season_id", seasonId)
        .eq("team_id", team.id)
    );

    if (existing) {
      await expectMutation(
        supabase
          .from("season_standings")
          .update({
            penalty_points: (existing.penalty_points || 0) + penaltyPoints,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
      );
    } else {
      await expectMutation(
        supabase.from("season_standings").insert({
          season_id: seasonId,
          team_id: team.id,
          division: team.division || 3,
          total_points: 0,
          penalty_points: penaltyPoints,
        })
      );
    }
  }

  return { fineAmount, penaltyPoints };
}

// ─── Hovedfunktion: enforce et hold ──────────────────────────────────────────

export async function enforceTeamSquadCompliance({
  supabase,
  teamId,
  seasonId = null,
  notifyTeamOwner = NOOP,
  createEmergencyLoanFn,
  now = new Date(),
}) {
  const snapshot = await getSquadSnapshot(supabase, teamId);
  const { team, ownedRiders, activeLoanCount } = snapshot;

  if (team.is_ai || team.is_bank || !team.user_id) {
    return { ok: true, code: "skipped_non_human", teamId };
  }
  if (team.is_frozen) {
    return { ok: true, code: "skipped_frozen", teamId };
  }

  const limits = getSquadLimitsForDivision(team.division);
  const effectiveCount = ownedRiders.length + activeLoanCount;

  let purchases = [];
  let sales = [];
  let deviatingCount = 0;
  let creditedFromSales = 0;

  if (effectiveCount < limits.min) {
    deviatingCount = limits.min - effectiveCount;
    const ownedTeamIds = new Set([teamId]);
    const candidates = await findCheapestAvailableRiders(
      supabase,
      deviatingCount,
      ownedTeamIds
    );

    if (candidates.length < deviatingCount) {
      // Pool tom — kan ikke ske i praksis (tusinde+ ryttere). Fail-soft, log.
      return {
        ok: false,
        code: "rider_pool_empty",
        teamId,
        needed: deviatingCount,
        available: candidates.length,
      };
    }

    for (const rider of candidates) {
      const result = await executeAutoPurchase({
        supabase,
        team,
        rider,
        seasonId,
        createEmergencyLoanFn,
        now,
      });
      purchases.push(result);
    }
  } else if (effectiveCount > limits.max) {
    deviatingCount = effectiveCount - limits.max;
    const candidates = pickRidersToSell(ownedRiders, deviatingCount);

    for (const rider of candidates) {
      const result = await executeAutoSale({
        supabase,
        team,
        rider,
        seasonId,
      });
      sales.push(result);
      creditedFromSales += result.credit;
    }
  } else {
    return { ok: true, code: "within_limits", teamId, totalCount: effectiveCount };
  }

  const { fineAmount, penaltyPoints } = await applyFinesAndPenalty({
    supabase,
    team,
    deviatingCount,
    seasonId,
  });

  // Notifikation til ramt manager (ikke spam — én pr. enforcement).
  const summaryLines = [];
  if (purchases.length) {
    summaryLines.push(
      `Auto-købt ${purchases.length} rytter${purchases.length === 1 ? "" : "e"}: ${purchases.map(p => p.riderName).join(", ")}`
    );
  }
  if (sales.length) {
    summaryLines.push(
      `Auto-solgt ${sales.length} rytter${sales.length === 1 ? "" : "e"}: ${sales.map(s => s.riderName).join(", ")}`
    );
  }
  summaryLines.push(
    `Bøde: ${fineAmount.toLocaleString("da-DK")} CZ$ · Fradrag: ${penaltyPoints} point`
  );

  await notifyTeamOwner(
    teamId,
    "squad_enforced",
    "Trupstørrelse-håndhævet",
    summaryLines.join("\n"),
    null
  );

  return {
    ok: true,
    code: purchases.length ? "auto_purchased" : "auto_sold",
    teamId,
    deviatingCount,
    purchases,
    sales,
    fineAmount,
    penaltyPoints,
  };
}

// ─── Cron-entrypoint: window-level claim + iter alle human teams ─────────────

export async function processSquadEnforcementCron({
  supabase,
  notifyTeamOwner = NOOP,
  createEmergencyLoanFn,
  now = new Date(),
  onError = () => {},
}) {
  // Find seneste lukkede vindue der ikke er enforced endnu.
  const window = await expectMaybeSingle(
    supabase
      .from("transfer_windows")
      .select("id, season_id, status, closes_at, squad_enforcement_completed_at")
      .eq("status", "closed")
      .is("squad_enforcement_completed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
  );

  if (!window) return { enforced: 0, claimed: false };

  // Atomic claim — samme mønster som final_whistle_sent_at.
  const nowIso = now.toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("transfer_windows")
    .update({ squad_enforcement_completed_at: nowIso })
    .eq("id", window.id)
    .is("squad_enforcement_completed_at", null)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return { enforced: 0, claimed: false };

  // Hent alle human-managers (ikke bank, ikke AI, ikke frosset, har user_id).
  // is_frozen=false matcher samme filter som processSeasonStart + seasonTransition
  // så frosne hold ikke får forceret køb/salg + bøder på trods af at de er
  // ekskluderet fra sponsor + payroll.
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .not("user_id", "is", null);
  if (teamsError) throw teamsError;

  const results = [];
  for (const t of teams || []) {
    try {
      const result = await enforceTeamSquadCompliance({
        supabase,
        teamId: t.id,
        seasonId: window.season_id,
        notifyTeamOwner,
        createEmergencyLoanFn,
        now,
      });
      results.push(result);
    } catch (error) {
      onError({ teamId: t.id, error });
      results.push({ ok: false, code: "error", teamId: t.id, error: error.message });
    }
  }

  const enforced = results.filter(
    r => r.ok && (r.code === "auto_purchased" || r.code === "auto_sold")
  ).length;

  return {
    enforced,
    claimed: true,
    windowId: window.id,
    results,
  };
}
