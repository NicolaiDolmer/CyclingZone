// Klassements-kerne for race-motoren (#2072/#2081). Rene funktioner — ingen DB.
//
// SSOT-princippet (#2072): et etapeløbs klassementer (GC/point/bjerg/ungdom/hold)
// AKKUMULERES fra de persisterede race_results-etaperækker (gaps + ranks findes i
// DB) — de re-simuleres ALDRIG. Etape-resultater er publiceret; spillerne kan regne
// efter (Vuelta Burgalesa: publicerede gaps gav Adamczyk 61s mod Wilsons 76s, men
// slut-GC fra en frisk re-simulation sagde det modsatte — tilliden knækkede).
//
// Delt af raceRunner.buildRaceResults (helt-løb-i-ét, in-memory akkumulering) og
// raceRunner.simulateStageByIndex (stage-by-stage, akkumulering fra persisterede
// rækker), så ranking/tie-break-semantikken er defineret ét sted.

// Intern klassements-point (grøn/bjerg) — afgør KUN rækkefølgen i de respektive
// trøje-konkurrencer; selve præmie-pointene kommer fra race_points via rank.
// Top-15 aftagende (samme form som rigtige point/bjerg-konkurrencer). Tunbar ÉT sted.
const CLASSIFICATION_POINTS = Object.freeze([25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export function classPointsForRank(rank) {
  return CLASSIFICATION_POINTS[rank - 1] || 0;
}

// Bjerg-point uddeles kun på klatre-egnede etaper (KOM-logik).
export const CLIMB_PROFILES = new Set(["mountain", "high_mountain", "hilly"]);

// "+M:SS" tids-gab til display (F3). 0 → "+0:00".
export function formatGap(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `+${m}:${String(s % 60).padStart(2, "0")}`;
}

// Invers af formatGap: "+M:SS" → sekunder. Defensiv: null/uparsebar → 0 (PCM-
// importerede etaperækker har finish_time null; de finaliseres ikke via motoren,
// men akkumuleringen må aldrig kaste på dem).
export function parseGapSeconds(finishTime) {
  if (typeof finishTime !== "string") return 0;
  const m = finishTime.match(/^\+?(\d+):(\d{1,2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// GC: kumulativ tid asc. Tids-ties brydes på countback (sum af etapeplaceringer),
// så etapevinderen leder efter en felt-finish (flad etape: alle gap=0). Til sidst
// rider_id for fuld determinisme.
export function rankByCumTimeAsc(entrants, cumTime, posSum) {
  return entrants
    .map((e) => ({
      rider_id: e.rider_id,
      team_id: e.team_id,
      time: cumTime.get(e.rider_id) || 0,
      pos: posSum.get(e.rider_id) || 0,
    }))
    .sort((a, b) =>
      a.time - b.time ||
      a.pos - b.pos ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export function rankByCompDesc(entrants, compMap) {
  return entrants
    .map((e) => ({ rider_id: e.rider_id, team_id: e.team_id, score: compMap.get(e.rider_id) || 0 }))
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)))
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// Holdklassement: sum af holdets BEDSTE 3 rytteres kumulative tid, lavest vinder.
export function teamClassification(entrants, cumTime) {
  const byTeam = new Map();
  for (const e of entrants) {
    if (!e.team_id) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push(cumTime.get(e.rider_id) || 0);
  }
  const rows = [];
  for (const [team_id, times] of byTeam) {
    times.sort((a, b) => a - b);
    rows.push({ team_id, time: times.slice(0, 3).reduce((s, t) => s + t, 0) });
  }
  return rows
    .sort((a, b) => a.time - b.time || String(a.team_id).localeCompare(String(b.team_id)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Akkumulér klassements-input fra etaperækker ('stage'-rækker, persisterede eller
 * netop simulerede): kumulativ tid (parsede gaps), countback (sum af placeringer),
 * point-/bjerg-konkurrence-point samt hvilke etaper hver rytter har fuldført.
 *
 * @param {Array<{stage_number:number, rider_id:string, rank:number, finish_time:string|null}>} stageRows
 * @param {Map<number,string>} profileTypeByStage  stage_number → profile_type (KOM-etaper)
 * @returns {{ cumTime:Map, posSum:Map, pointsComp:Map, komComp:Map,
 *             stagesByRider:Map<string,Set<number>>, stageNumbers:Set<number> }}
 */
export function accumulateStageRows({ stageRows = [], profileTypeByStage = new Map() }) {
  const cumTime = new Map();
  const posSum = new Map();
  const pointsComp = new Map();
  const komComp = new Map();
  const stagesByRider = new Map();
  const stageNumbers = new Set();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  for (const r of stageRows) {
    if (!r?.rider_id) continue;
    const stageNo = r.stage_number || 1;
    stageNumbers.add(stageNo);
    add(cumTime, r.rider_id, parseGapSeconds(r.finish_time));
    add(posSum, r.rider_id, Number(r.rank) || 0);
    add(pointsComp, r.rider_id, classPointsForRank(r.rank));
    if (CLIMB_PROFILES.has(profileTypeByStage.get(stageNo))) {
      add(komComp, r.rider_id, classPointsForRank(r.rank));
    }
    if (!stagesByRider.has(r.rider_id)) stagesByRider.set(r.rider_id, new Set());
    stagesByRider.get(r.rider_id).add(stageNo);
  }
  return { cumTime, posSum, pointsComp, komComp, stagesByRider, stageNumbers };
}

/**
 * Klassements-berettigede ryttere: fuldført ALLE etaper der har rækker (accept
 * #2072: "Slut-GC = sum af persisterede etape-gaps for alle ryttere der fuldførte").
 * En rytter der forlod feltet mid-race (solgt/slettet) beholder sine kørte etapers
 * rækker/præmier, men udgår af klassementerne. Kravet er "alle etaper der HAR rækker"
 * (ikke 1..N teoretisk), så et evt. data-hul i én etape ikke tømmer hele GC'en.
 *
 * @param {Array<{rider_id:string}>} entrants  dagens (frosne) felt
 * @param {Map<string,Set<number>>} stagesByRider  fra accumulateStageRows
 * @param {Set<number>} stageNumbers  alle etaper med rækker
 * @returns {object[]} entrants-subset der har fuldført alle etaper
 */
export function filterCompletedEntrants(entrants, stagesByRider, stageNumbers) {
  const required = stageNumbers.size;
  return entrants.filter((e) => (stagesByRider.get(e.rider_id)?.size || 0) >= required);
}
