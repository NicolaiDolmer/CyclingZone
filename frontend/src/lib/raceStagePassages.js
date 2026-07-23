// Sub-2 (#2770): passage-lag — ren gruppering af persisterede race_stage_passages
// rækker til visning på etapesiden. Ren præsentation, ingen ny spilmekanik her
// (samme mønster som raceStageMoments.js/raceStageClassifications.js).
//
// Finish-waypoints springes bevidst over: mål-passagen ER etaperesultat-tabellen
// (ResultTable ovenfor på siden) — at gengive den her ville bare duplikere
// samme rækkefølge under et andet overskrift.
export function groupPassagesForStage(rows, stageNumber) {
  if (!rows?.length) return [];

  const scoped = rows.filter(
    (r) => (r.stage_number ?? 1) === stageNumber && r.waypoint_kind !== "finish"
  );

  const groups = new Map();
  for (const r of scoped) {
    const key = `${r.waypoint_kind}:${r.waypoint_index}`;
    if (!groups.has(key)) {
      groups.set(key, {
        waypoint_kind: r.waypoint_kind,
        waypoint_index: r.waypoint_index,
        waypoint_name: r.waypoint_name,
        waypoint_km: r.waypoint_km,
        climb_category: r.climb_category ?? null,
        results: [],
      });
    }
    groups.get(key).results.push(r);
  }

  const out = [...groups.values()];
  for (const g of out) g.results.sort((a, b) => (a.passage_rank ?? 0) - (b.passage_rank ?? 0));
  out.sort((a, b) => (a.waypoint_km ?? 0) - (b.waypoint_km ?? 0));
  return out;
}

/**
 * Sub-4 (#2448): slå ét waypoints passage-resultat op, så et klik på grafen kan
 * vise hvem der tog point/bonussekunder der. Nøglen (kind, index) er den samme
 * som race_stage_passages.(waypoint_kind, waypoint_index) — se waypointsFor()
 * i stageRouteProfile.js. Ingen rækker (etape ikke kørt / tabel ikke migreret)
 * → tom liste, aldrig et kast.
 */
export function passageResultsForWaypoint(passages, stageNumber, kind, index) {
  return (passages || [])
    .filter((p) => (p.stage_number ?? 1) === stageNumber
      && p.waypoint_kind === kind
      && (p.waypoint_index ?? 0) === index)
    .sort((a, b) => (a.passage_rank ?? 99) - (b.passage_rank ?? 99));
}
