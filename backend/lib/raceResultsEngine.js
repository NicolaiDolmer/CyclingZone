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

export const PRIZE_PER_POINT = 1_500;

const RESULT_TYPE_TO_RACE_POINTS = {
  stage_race: {
    stage: "Etapeplacering",
    gc: "Klassement",
    points: "Pointtroje",
    mountain: "Bjergtroje",
    young: "Ungdomstroje",
    team: "EtapelobHold",
    leader: "Forertroje",
  },
  single: {
    gc: "Klassiker",
    points: "Pointtroje",
    mountain: "Bjergtroje",
    young: "Ungdomstroje",
    team: "KlassikerHold",
  },
};

export function buildRacePointsLookup({ racePoints = [], raceType = "stage_race" } = {}) {
  const typeMap = RESULT_TYPE_TO_RACE_POINTS[raceType] ?? RESULT_TYPE_TO_RACE_POINTS.stage_race;
  const lookup = {};
  for (const [enType, dkType] of Object.entries(typeMap)) {
    for (const row of racePoints || []) {
      if (row.result_type === dkType) {
        lookup[`${enType}__${row.rank}`] = row.points || 0;
      }
    }
  }
  return lookup;
}

export function buildRaceResultsFromPending({ pendingRows = [], pointsLookup = {}, raceId } = {}) {
  return (pendingRows || []).map((row) => {
    const pts = pointsLookup[`${row.result_type}__${row.rank}`] || 0;
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
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
    };
  });
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
    points_earned: row.points_earned ?? 0,
  }));

  const { error: insertError } = await supabase.from("race_results").insert(normalizedRows);
  if (insertError) throw new Error(insertError.message);

  await ensureSeasonStandings(race.season_id);
  await updateStandings(race.season_id, race.id);

  return {
    rowsImported: normalizedRows.length,
  };
}
