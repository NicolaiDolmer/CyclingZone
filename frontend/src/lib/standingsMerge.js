// #1718 — Ranglisten skal vise ALLE hold i en division, også AI-hold. Tidligere
// blev AI-hold filtreret væk (is_ai-filter på teams-queryen + på standings-rækkerne),
// så divisioner der (næsten) kun bestod af AI fremstod tomme.
//
// mergeStandings flettes nu fra den fulde holdliste (inkl. AI) mod standings-rækkerne:
// hvert hold får sin standings-række hvis den findes, ellers en 0-point-fallback der
// bærer hold-objektet (inkl. is_ai) videre, så tabellen kan markere AI-hold diskret.
//
// Ren funktion uden React/Supabase-afhængigheder, så den kan unit-testes med
// `node --test` (samme mønster som standingsPodiums.js).
export function mergeStandings(teams, standingsMap) {
  const map = standingsMap || {};
  return (teams || []).map(team =>
    map[team.id] || { id: team.id, team_id: team.id, team, total_points: 0, stage_wins: 0 }
  );
}
