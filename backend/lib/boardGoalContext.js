// S-02d · Loader cumulative + plan-start kontekst-felter til de 7 nye mål-typer.
// Bruges af både economyEngine.processTeamSeasonEnd (sæson-evaluering) og
// api.js /board/status (live BoardPage-outlook). Holder query-pattern på ét sted.
//
// Q-bekræftelser:
//   A: monument_podium = cumulative over plan-perioden
//   B: jersey_wins = cumulative for 3yr/5yr, per-sæson for 1yr (vi returnerer begge)
//   D: profitable_transfers = SUM(amount) finance_transactions type IN (transfer_in, transfer_out)
//   E1: planStart-baseline fra første board_plan_snapshots-row i planen
//   F: divisionManagerCount = is_ai=false-teams i samme division for sæsonen

export async function loadGoalContextForBoard({
  supabase,
  teamId,
  boardId,
  currentSeasonId,
  division = null,
  standings = null,
  planStartSeasonNumber = null,
}) {
  // Plan-season-ids: alle tidligere snapshots i denne plan + nuværende sæson.
  // (Nuværende sæson har endnu ikke et snapshot på dette tidspunkt — den
  // tilføjes efter evaluateBoardSeason.)
  //
  // #54 · Afgræns til den AKTUELLE plan-cyklus. board_plan_snapshots akkumulerer
  // under samme board_id på tværs af cyklusser: ved plan-fornyelse genbruges
  // board-rowet (seasons_completed nulstilles, plan_start_season_number rykker
  // frem), så season_within_plan kolliderer mellem cyklusser. Uden cyklus-filter
  // ville cumulative monument/jersey/transfer + u25-baselinen spænde over hele
  // boardets historik (gamle planer). Læse-stien i /board/status filtrerer
  // allerede sådan (season_number >= plan_start_season_number, api.js:6196).
  // season_number indgår ikke i select'en — .gte() filtrerer server-side på
  // kolonnen uanset om den returneres, og vi bruger den ikke i resultatet.
  let snapshotQuery = supabase
    .from("board_plan_snapshots")
    .select("season_id, u25_stat_sum, u25_count, season_within_plan")
    .eq("board_id", boardId);
  if (planStartSeasonNumber != null) {
    snapshotQuery = snapshotQuery.gte("season_number", planStartSeasonNumber);
  }
  const { data: prevSnapshots } = await snapshotQuery
    .order("season_within_plan", { ascending: true });

  const planSeasonIds = [
    ...((prevSnapshots || []).map((s) => s.season_id).filter(Boolean)),
    currentSeasonId,
  ].filter(Boolean);

  // Plan-start U25 baseline fra første snapshot. Hvis ingen tidligere snapshots
  // (= dette er første sæson i planen), returner null så u25_development_delta
  // returnerer awaiting_data — målet evaluerer først fra sæson 2 i planen.
  const firstSnapshot = (prevSnapshots || [])[0] || null;
  const planStartU25StatSum = firstSnapshot?.u25_stat_sum ?? null;
  const planStartU25Count = firstSnapshot?.u25_count ?? null;

  // Defaults — null betyder "missing data" så evaluator returnerer awaiting_data
  let cumulativeMonumentPodiums = null;
  let cumulativeJerseyWins = null;
  let seasonJerseyWins = null;
  let cumulativeTransferBalance = null;

  if (planSeasonIds.length > 0) {
    // Monument podie-placeringer (rank 1-3 i GC for race_class='Monuments')
    const { data: monumentResults, error: monErr } = await supabase
      .from("race_results")
      .select("rank, races!inner(race_class, season_id)")
      .eq("team_id", teamId)
      .eq("result_type", "gc")
      .lte("rank", 3)
      .eq("races.race_class", "Monuments")
      .in("races.season_id", planSeasonIds);
    if (!monErr) cumulativeMonumentPodiums = (monumentResults || []).length;

    // Etapeløb-trøjer (point/bjerg/young, rank=1)
    const { data: jerseyResults, error: jerErr } = await supabase
      .from("race_results")
      .select("rank, races!inner(season_id)")
      .eq("team_id", teamId)
      .in("result_type", ["points", "mountain", "young"])
      .eq("rank", 1)
      .in("races.season_id", planSeasonIds);
    if (!jerErr) {
      cumulativeJerseyWins = (jerseyResults || []).length;
      seasonJerseyWins = (jerseyResults || [])
        .filter((r) => r.races?.season_id === currentSeasonId)
        .length;
    }

    // Netto transfer-balance (positive = transfer_in/salg, negative = transfer_out/køb)
    const { data: transferTxs, error: trxErr } = await supabase
      .from("finance_transactions")
      .select("amount, type")
      .eq("team_id", teamId)
      .in("type", ["transfer_in", "transfer_out"])
      .in("season_id", planSeasonIds);
    if (!trxErr) {
      cumulativeTransferBalance = (transferTxs || [])
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    }
  }

  // Antal humane managers i samme division. Fra pre-loaded standings hvis
  // muligt (sparer en query), ellers løs fra DB.
  let divisionManagerCount = null;
  if (division != null && Array.isArray(standings)) {
    divisionManagerCount = standings
      .filter((s) => s.division === division && s.team && !s.team.is_ai)
      .length;
  } else if (division != null) {
    const { data: divisionStandings, error: divErr } = await supabase
      .from("season_standings")
      .select("team:team_id(is_ai)")
      .eq("season_id", currentSeasonId)
      .eq("division", division);
    if (!divErr) {
      divisionManagerCount = (divisionStandings || [])
        .filter((s) => s.team && !s.team.is_ai)
        .length;
    }
  }

  return {
    planStartU25StatSum,
    planStartU25Count,
    cumulativeMonumentPodiums,
    cumulativeJerseyWins,
    seasonJerseyWins,
    cumulativeTransferBalance,
    divisionManagerCount,
  };
}
