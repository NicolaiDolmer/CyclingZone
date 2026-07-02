// #2081 — Løbende stilling for igangværende etapeløb (ren logik, testbar med node --test).
//
// Motoren persisterer fulde klassementer pr. mellem-etape under dag-typerne:
// leader (GC m. "+M:SS"-gap), points_day, mountain_day, young_day (rank 1..N).
// Hold-stillingen persisteres bevidst IKKE (race_points har team__1 → payout-
// risiko under re-derivering, jf. #2072-PR'en); den deriveres her af GC-rækkernes
// gap: sum af holdets 3 bedste gaps — samme rangorden som motorens
// teamClassification (den fælles leder-tid forkortes ud af sammenligningen).

const DAY_TO_FINAL = { leader: "gc", points_day: "points", mountain_day: "mountain", young_day: "young" };

function byRank(a, b) {
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

export function parseGapSeconds(finishTime) {
  const m = /^\+?(\d+):(\d{1,2})$/.exec(finishTime || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function deriveTeamStandings(gcRows) {
  const byTeam = new Map();
  for (const r of gcRows || []) {
    if (!r.team_id) continue;
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, { team_id: r.team_id, team_name: r.team_name, team: r.team, gaps: [] });
    byTeam.get(r.team_id).gaps.push(parseGapSeconds(r.finish_time));
  }
  return [...byTeam.values()]
    .map(({ gaps, ...rest }) => ({ ...rest, total: gaps.sort((a, b) => a - b).slice(0, 3).reduce((s, g) => s + g, 0) }))
    .sort((a, b) => a.total - b.total || String(a.team_id).localeCompare(String(b.team_id)))
    .map((row, i) => ({
      id: `live-team-${row.team_id}`,
      result_type: "team",
      rank: i + 1,
      rider_id: null,
      team_id: row.team_id,
      team_name: row.team_name,
      team: row.team,
      finish_time: null,
      points_earned: 0,
    }));
}

// Seneste etape med fuldt persisteret klassement (>1 leader-række). Etaper kørt
// FØR #2081-motoren har kun rank-1-trøjerækker → ingen løbende stilling at vise.
// Returnerer { stage, byType: { gc, points, mountain, young, team } } eller null.
export function buildLiveStandings(results) {
  const countByStage = new Map();
  for (const r of results || []) {
    if (r.result_type !== "leader") continue;
    const s = r.stage_number ?? 1;
    countByStage.set(s, (countByStage.get(s) || 0) + 1);
  }
  const fullStages = [...countByStage.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  if (!fullStages.length) return null;
  const stage = Math.max(...fullStages);
  const byType = {};
  for (const [dayType, finalKey] of Object.entries(DAY_TO_FINAL)) {
    byType[finalKey] = (results || [])
      .filter(r => r.result_type === dayType && (r.stage_number ?? 1) === stage)
      .sort(byRank);
  }
  byType.team = deriveTeamStandings(byType.gc);
  return { stage, byType };
}
