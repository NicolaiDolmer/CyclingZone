export async function getSeasonPrizePreview(seasonId, supabase) {
  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, name, prize_paid_at, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) return { already_paid: [], pending_payment: [], total_pending: 0 };

  const raceIds = races.map(r => r.id);

  // Batch-fetch all relevant race_results in one query
  const { data: allResults, error: resultsError } = await supabase
    .from("race_results")
    .select("race_id, team_id, prize_money")
    .in("race_id", raceIds)
    .gt("prize_money", 0);
  if (resultsError) throw new Error(resultsError.message);

  // Batch-fetch existing prize transactions for paid races
  const paidRaceIds = races.filter(r => r.prize_paid_at).map(r => r.id);
  let paidTransactions = [];
  if (paidRaceIds.length) {
    const { data: txs, error: txError } = await supabase
      .from("finance_transactions")
      .select("race_id, team_id, amount")
      .in("race_id", paidRaceIds)
      .eq("type", "prize");
    if (txError) throw new Error(txError.message);
    paidTransactions = txs || [];
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
      const { data: teamData, error: teamError } = await supabase
        .from("teams")
        .select("balance")
        .eq("id", team.team_id)
        .single();
      if (teamError) throw new Error(teamError.message);

      const { error: balError } = await supabase
        .from("teams")
        .update({ balance: teamData.balance + team.prize })
        .eq("id", team.team_id);
      if (balError) throw new Error(balError.message);

      const { error: txError } = await supabase.from("finance_transactions").insert({
        team_id: team.team_id,
        type: "prize",
        amount: team.prize,
        description: `Præmiepenge — ${race.race_name}`,
        season_id: seasonId,
        race_id: race.race_id,
      });
      if (txError) throw new Error(txError.message);
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

  return {
    races_paid: preview.pending_payment.length,
    total_paid: preview.total_pending,
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
