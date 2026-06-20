// Sikr at season_standings har en række pr. (ægte) hold før resultater skrives.
//
// Udtrukket fra api.js (#203-logik) så BÅDE den admin-route-styrede afvikling OG
// stage-scheduler-cronen (WS1 Fase 3) deler én implementering. Test-konti udelukkes
// — ellers påvirker de leaderboards for ægte managers.
//
// Kald-form matcher applyRaceResults' kontrakt: ensureSeasonStandings(seasonId).
// Derfor curry'es supabase-klienten ind via makeEnsureSeasonStandings.

export async function ensureSeasonStandings(supabase, seasonId) {
  const [{ data: teams, error: teamsError }, { data: standings, error: standingsError }] = await Promise.all([
    supabase.from("teams").select("id, division").eq("is_test_account", false),
    supabase.from("season_standings").select("team_id").eq("season_id", seasonId),
  ]);

  if (teamsError) throw new Error(teamsError.message);
  if (standingsError) throw new Error(standingsError.message);

  const existingTeamIds = new Set((standings || []).map((row) => row.team_id));
  const missingRows = (teams || [])
    .filter((team) => !existingTeamIds.has(team.id))
    .map((team) => ({ season_id: seasonId, team_id: team.id, division: team.division }));

  if (missingRows.length > 0) {
    const { error: insertError } = await supabase.from("season_standings").insert(missingRows);
    if (insertError) throw new Error(insertError.message);
  }

  return { created: missingRows.length, total_teams: (teams || []).length };
}

// Binder en supabase-klient → ensureSeasonStandings(seasonId)-callback (applyRaceResults-form).
export function makeEnsureSeasonStandings(supabase) {
  return (seasonId) => ensureSeasonStandings(supabase, seasonId);
}
