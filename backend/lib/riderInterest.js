// Interesse-fanens datalag (#2000) — GET /api/riders/:id/interest.
//
// Aggregerer ÆGTE interesse-signaler: scout_actions (hvem har brugt scout-slots
// på rytteren) + rider_watchlist (hvornår blev han føjet til lister). Visnings-
// tallene Følger/Profilvisninger kommer fra de eksisterende watchlist-count/
// view-count-endpoints — dette endpoint dækker resten.
//
// Privacy-kontrakt:
//   - Team-navne på scout-handlinger er KUN synlige for rytterens ejer
//     ("Hvem scouter din rytter?" er en ejer-flade i designet). Alle andre får
//     anonymiserede feed-events (kun dato + sæson) — ellers ville enhver rival
//     kunne aflæse konkurrenters scouting-strategi.
//   - Watchlist-events er ALTID anonyme (kun dato): rider_watchlist er knyttet
//     til brugere, ikke hold, og en managers liste er privat.
//   - Rytterens NUVÆRENDE ejerhold filtreres ud af scout-listen (et hold der
//     scoutede ham og siden købte ham er ikke længere "interesse").

export function buildRiderInterest({ scoutRows = [], watchRows = [], isOwner = false, ownerTeamId = null } = {}) {
  const byTeam = new Map();
  for (const row of scoutRows || []) {
    const teamId = row?.team_id ?? row?.team?.id;
    if (!teamId || (ownerTeamId && teamId === ownerTeamId)) continue;
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, { team_id: teamId, team_name: row.team?.name ?? null, level: 0, last_at: null, season: null });
    }
    const entry = byTeam.get(teamId);
    entry.level += 1;
    const at = row.created_at ? new Date(row.created_at).getTime() : null;
    if (at != null && (entry.last_at == null || at > new Date(entry.last_at).getTime())) {
      entry.last_at = row.created_at;
      entry.season = row.season?.number ?? entry.season;
    }
  }
  const scouts = [...byTeam.values()].sort(
    (a, b) => new Date(b.last_at ?? 0).getTime() - new Date(a.last_at ?? 0).getTime(),
  );

  const scoutEvents = (scoutRows || [])
    .filter((row) => {
      const teamId = row?.team_id ?? row?.team?.id;
      return teamId && !(ownerTeamId && teamId === ownerTeamId);
    })
    .map((row) => ({
      type: "scout",
      date: row.created_at ?? null,
      team_name: isOwner ? row.team?.name ?? null : null,
      season: row.season?.number ?? null,
    }));
  const watchEvents = (watchRows || []).map((row) => ({ type: "watch", date: row?.created_at ?? null }));

  const feed = [...scoutEvents, ...watchEvents]
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);

  return {
    scouted_by_count: byTeam.size,
    scouts: isOwner ? scouts : null,
    feed,
  };
}
