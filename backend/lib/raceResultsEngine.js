function ensureSupabase(supabase) {
  if (!supabase?.from) {
    throw new Error("Supabase client is required");
  }
}

function ensureRace(race) {
  if (!race?.id || !race?.season_id) {
    throw new Error("Race context is required");
  }
}

export function buildRacePrizeLookup({ prizes = [], defaultsByType = {} } = {}) {
  const lookup = {};

  for (const prize of prizes || []) {
    if (!prize?.result_type || prize.rank === undefined || prize.rank === null) continue;
    lookup[`${prize.result_type}__${prize.rank}`] = prize.prize_amount || 0;
  }

  for (const [resultType, ranks] of Object.entries(defaultsByType || {})) {
    for (const [rank, amount] of Object.entries(ranks || {})) {
      const key = `${resultType}__${rank}`;
      if (lookup[key] === undefined) {
        lookup[key] = amount || 0;
      }
    }
  }

  return lookup;
}

export function buildRaceResultsFromPending({ pendingRows = [], prizeLookup = {}, raceId } = {}) {
  return (pendingRows || []).map((row) => {
    const prize = prizeLookup[`${row.result_type}__${row.rank}`] || 0;
    const teamId = row.rider?.team_id || null;
    const riderName = row.rider ? `${row.rider.firstname} ${row.rider.lastname}` : null;

    return {
      race_id: raceId,
      rider_id: row.rider_id,
      rider_name: riderName,
      team_id: teamId,
      team_name: null,
      result_type: row.result_type,
      rank: row.rank,
      stage_number: row.stage_number || 1,
      finish_time: null,
      prize_money: prize,
      points_earned: prize,
    };
  });
}

async function clearExistingPrizeFinance({ supabase, raceId }) {
  const { data: existingPrizes, error: existingError } = await supabase
    .from("finance_transactions")
    .select("id, team_id, amount")
    .eq("race_id", raceId)
    .eq("type", "prize");
  if (existingError) throw new Error(existingError.message);

  for (const prize of existingPrizes || []) {
    if (!prize.team_id || !prize.amount) continue;

    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("balance")
      .eq("id", prize.team_id)
      .single();
    if (teamError) throw new Error(teamError.message);

    if (team) {
      const { error: balanceError } = await supabase
        .from("teams")
        .update({ balance: team.balance - prize.amount })
        .eq("id", prize.team_id);
      if (balanceError) throw new Error(balanceError.message);
    }
  }

  if (existingPrizes?.length) {
    const { error: deleteError } = await supabase
      .from("finance_transactions")
      .delete()
      .eq("race_id", raceId)
      .eq("type", "prize");
    if (deleteError) throw new Error(deleteError.message);
  }
}

export async function applyRaceResults({
  supabase,
  race,
  resultRows = [],
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
} = {}) {
  ensureSupabase(supabase);
  ensureRace(race);

  if (!resultRows.length) {
    throw new Error("No rows found");
  }

  const normalizedRows = resultRows.map((row) => ({
    race_id: race.id,
    rider_id: row.rider_id || null,
    rider_name: row.rider_name || null,
    team_id: row.team_id || null,
    team_name: row.team_name || null,
    result_type: row.result_type,
    rank: row.rank,
    stage_number: row.stage_number || 1,
    finish_time: row.finish_time || null,
    prize_money: Number(row.prize_money) || 0,
    points_earned: row.points_earned ?? (Number(row.prize_money) || 0),
  }));

  await clearExistingPrizeFinance({ supabase, raceId: race.id });

  const { error: insertError } = await supabase.from("race_results").insert(normalizedRows);
  if (insertError) throw new Error(insertError.message);

  const teamPrizes = {};
  for (const row of normalizedRows) {
    if (row.team_id && row.prize_money > 0) {
      teamPrizes[row.team_id] = (teamPrizes[row.team_id] || 0) + row.prize_money;
    }
  }

  for (const [teamId, amount] of Object.entries(teamPrizes)) {
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("balance")
      .eq("id", teamId)
      .single();
    if (teamError) throw new Error(teamError.message);

    if (team) {
      const { error: balanceError } = await supabase
        .from("teams")
        .update({ balance: team.balance + amount })
        .eq("id", teamId);
      if (balanceError) throw new Error(balanceError.message);

      const { error: financeError } = await supabase.from("finance_transactions").insert({
        team_id: teamId,
        type: "prize",
        amount,
        description: "Præmiepenge fra løb",
        season_id: race.season_id,
        race_id: race.id,
      });
      if (financeError) throw new Error(financeError.message);
    }
  }

  await ensureSeasonStandings(race.season_id);
  await updateStandings(race.season_id, race.id);

  return {
    rowsImported: normalizedRows.length,
    teamsPaid: Object.keys(teamPrizes).length,
  };
}
