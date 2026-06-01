import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { fetchAllRows } from "./supabasePagination.js";
import { updateRiderValues } from "./economyEngine.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

export async function getSeasonPrizePreview(seasonId, supabase) {
  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, name, prize_paid_at, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) return { already_paid: [], pending_payment: [], total_pending: 0 };

  const raceIds = races.map(r => r.id);

  // Batch-fetch all relevant race_results. Paginér (PostgREST capper ved 1000) —
  // ellers underberegnes præmie-previewet stille for sæsoner med >1000 præmie-
  // rækker, og udbetalingen ville mangle nogle hold. .order("id") for stabile sider.
  const allResults = await fetchAllRows(() => supabase
    .from("race_results")
    .select("race_id, team_id, prize_money")
    .in("race_id", raceIds)
    .gt("prize_money", 0)
    .order("id", { ascending: true }));

  // Batch-fetch existing prize transactions for paid races (også pagineret).
  const paidRaceIds = races.filter(r => r.prize_paid_at).map(r => r.id);
  let paidTransactions = [];
  if (paidRaceIds.length) {
    paidTransactions = await fetchAllRows(() => supabase
      .from("finance_transactions")
      .select("race_id, team_id, amount")
      .in("race_id", paidRaceIds)
      .eq("type", "prize")
      .order("id", { ascending: true }));
  }

  // Batch-fetch team names
  const teamIds = [...new Set([
    ...(allResults || []).map(r => r.team_id),
    ...paidTransactions.map(t => t.team_id),
  ].filter(Boolean))];
  const teamNameById = new Map();
  if (teamIds.length) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds);
    for (const t of teams || []) teamNameById.set(t.id, t.name);
  }

  const resultsByRace = groupBy(allResults || [], r => r.race_id);
  const txByRace = groupBy(paidTransactions, t => t.race_id);

  const already_paid = [];
  const pending_payment = [];

  for (const race of races) {
    if (race.prize_paid_at) {
      const txs = txByRace.get(race.id) || [];
      already_paid.push({
        race_id: race.id,
        race_name: race.name,
        paid_at: race.prize_paid_at,
        total_paid: txs.reduce((s, t) => s + t.amount, 0),
        by_team: txs.map(t => ({
          team_id: t.team_id,
          team_name: teamNameById.get(t.team_id) ?? null,
          amount: t.amount,
        })),
      });
    } else {
      const results = resultsByRace.get(race.id) || [];
      const byTeam = new Map();
      for (const r of results) {
        if (!r.team_id) continue;
        byTeam.set(r.team_id, (byTeam.get(r.team_id) || 0) + r.prize_money);
      }
      if (!byTeam.size) continue;

      const teamBreakdown = [...byTeam.entries()].map(([team_id, prize]) => ({
        team_id,
        team_name: teamNameById.get(team_id) ?? null,
        prize,
      }));
      pending_payment.push({
        race_id: race.id,
        race_name: race.name,
        total_prize: teamBreakdown.reduce((s, t) => s + t.prize, 0),
        by_team: teamBreakdown,
      });
    }
  }

  return {
    already_paid,
    pending_payment,
    total_pending: pending_payment.reduce((s, r) => s + r.total_prize, 0),
  };
}

export async function paySeasonPrizesToDate(seasonId, adminUserId, supabase) {
  const preview = await getSeasonPrizePreview(seasonId, supabase);
  if (!preview.pending_payment.length) return { races_paid: 0, total_paid: 0, by_race: [] };

  const now = new Date().toISOString();

  for (const race of preview.pending_payment) {
    for (const team of race.by_team) {
      // Slice 07c: balance + finance_transactions atomic via RPC.
      // 07d Fase B: admin-trigger → actor_type=admin, actor_id=adminUserId.
      // idempotency_key (race_prize:race:team) supplerer prize_paid_at-gaten.
      await incrementBalanceWithAudit(supabase, {
        teamId: team.team_id,
        delta: team.prize,
        payload: {
          type: "prize",
          amount: team.prize,
          description: `Præmiepenge — ${race.race_name}`,
          season_id: seasonId,
          race_id: race.race_id,
          actor_type: FINANCE_ACTOR_TYPE.ADMIN,
          actor_id: adminUserId || null,
          source_path: "prizePayoutEngine.paySeasonPrizesToDate",
          reason_code: FINANCE_REASON.RACE_PRIZE_PAYOUT,
          related_entity_type: FINANCE_RELATED_ENTITY.RACE,
          related_entity_id: race.race_id,
          idempotency_key: `race_prize:${race.race_id}:${team.team_id}`,
        },
      }, { allowDuplicate: true });
    }

    const { error: raceError } = await supabase
      .from("races")
      .update({ prize_paid_at: now })
      .eq("id", race.race_id);
    if (raceError) throw new Error(raceError.message);
  }

  await supabase.from("import_log").insert({
    import_type: "prize_payout",
    rows_processed: preview.pending_payment.length,
    rows_updated: preview.pending_payment.length,
    rows_inserted: 0,
    errors: [],
    imported_by: adminUserId,
  });

  // R3 (#895): recalculate rider values now that this season's prizes are paid,
  // so the active season's prize earnings feed the progress-weighted value
  // average live — not only at season end. See economyEngine.updateRiderValues.
  let riders_updated = 0;
  try {
    ({ ridersUpdated: riders_updated } = await updateRiderValues(supabase));
  } catch (err) {
    // A value-recalc failure must not roll back a successful payout; surface it
    // in the response so the admin can re-run the recalc (idempotent) manually.
    console.error("⚠️  Rider-value recalc efter præmie-udbetaling fejlede:", err.message);
    riders_updated = null;
  }

  return {
    races_paid: preview.pending_payment.length,
    total_paid: preview.total_pending,
    riders_updated,
    by_race: preview.pending_payment.map(r => ({
      race_name: r.race_name,
      total_prize: r.total_prize,
    })),
  };
}

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
