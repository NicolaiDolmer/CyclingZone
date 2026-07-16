// Palmarès-fanens datalag for HOLDSIDEN (#1997 holdside-slice — spejler
// rytterside-fundamentet i lib/riderPalmares.js). Rene, testbare funktioner
// over allerede-hentede season_standings/hall_of_fame-rækker — ingen fetch her.
//
// Datakontrakt: season_standings har ÉN række pr. (season_id, team_id), med
// division = TIER (1 er top, 4 er bund). hall_of_fame har team_id + team_name-
// snapshot + season_number — samme snapshot-mønster som race_results (#1993).
//
// Op-/nedrykning udledes RETROSPEKTIVT af faktisk divisions-ændring mellem to
// på hinanden følgende sæson-numre for HOLDET (issuets egen anvisning) — det er
// et andet begreb end StandingsPage's live op-/nedrykningszoner (som markerer
// hvem der ER i zonen for kommende sæsonskifte, ikke hvad der SKETE).

// Sæson-for-sæson-historik: season_standings-rækker (skal have `season:{number,status}`
// joinet på), sorteret NYESTE FØRST med en movement-markør pr. række.
// movement er null for en holds FØRSTE registrerede sæson (intet at sammenligne med).
export function buildSeasonHistory(standingsRows = []) {
  const withSeason = (standingsRows || []).filter((r) => r.season?.number != null);
  const ascending = [...withSeason].sort((a, b) => a.season.number - b.season.number);
  const withMovement = ascending.map((row, idx) => {
    const prev = idx > 0 ? ascending[idx - 1] : null;
    let movement = null;
    if (prev && prev.division != null && row.division != null) {
      if (row.division < prev.division) movement = "promoted";
      else if (row.division > prev.division) movement = "relegated";
      else movement = "maintained";
    }
    return { ...row, movement };
  });
  return withMovement.sort((a, b) => b.season.number - a.season.number);
}

// Karrieretotaler: sæsoner spillet, sejre i alt (etape + GC/endagssejre — samme
// definition som "Sæsonresultater"-boksens to felter, blot summeret), samlet
// pointsum, og holdets BEDSTE sæson (laveste division, ties brydes af laveste
// rank_in_division) som "bedste division/placering"-tile.
export function teamCareerTotals(standingsRows = []) {
  const rows = standingsRows || [];
  const seasonsPlayed = rows.length;
  const stageWins = rows.reduce((sum, r) => sum + (r.stage_wins || 0), 0);
  const gcWins = rows.reduce((sum, r) => sum + (r.gc_wins || 0), 0);
  const totalPoints = rows.reduce((sum, r) => sum + (r.total_points || 0), 0);

  let best = null;
  for (const r of rows) {
    if (r.division == null) continue;
    if (
      !best ||
      r.division < best.division ||
      (r.division === best.division && (r.rank_in_division ?? Infinity) < (best.rank_in_division ?? Infinity))
    ) {
      best = r;
    }
  }

  return {
    seasonsPlayed,
    stageWins,
    gcWins,
    totalWins: stageWins + gcWins,
    totalPoints,
    bestDivision: best?.division ?? null,
    bestRank: best?.rank_in_division ?? null,
  };
}

// Æresliste: hall_of_fame-rækker for holdet, sorteret nyeste sæson først
// (null-season-entries — hvis nogen skulle findes — til sidst).
export function groupHallOfFame(hofRows = []) {
  return [...(hofRows || [])].sort((a, b) => (b.season_number ?? -1) - (a.season_number ?? -1));
}
