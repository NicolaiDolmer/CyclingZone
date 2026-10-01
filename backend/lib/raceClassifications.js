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

/**
 * #5914: hvem foerer point- og bjergkonkurrencen FOER dagens etape? Samme
 * rangering som troejerne (rankByCompDesc). En konkurrence uden point har
 * ingen foerer (null) — saa kaemper ingen "som troejefoerer" paa 1. etape.
 *
 * @param {Array<{rider_id:string}>} entrants  dagens felt (kun ryttere der stadig koerer)
 * @param {Map<string,number>} pointsComp
 * @param {Map<string,number>} komComp
 * @returns {{points: string|null, kom: string|null}}
 */
export function jerseyLeadersFromComps(entrants, pointsComp, komComp) {
  const leaderOf = (comp) => {
    const top = rankByCompDesc(entrants, comp)[0];
    return top && top.score > 0 ? top.rider_id : null;
  };
  return { points: leaderOf(pointsComp), kom: leaderOf(komComp) };
}

// Placering der mangler (rytter uden placering i opslaget) sorteres sidst. Et
// stort endeligt tal i stedet for Infinity, saa summer og differenser aldrig
// bliver NaN i en comparator.
const NO_PLACE = 1e9;

// Hvor mange gange holdet blev nr. 1, nr. 2, ... i etapens holdklassement,
// sammenlignet leksikografisk: flest 1.-pladser vinder, saa flest 2.-pladser osv.
function compareDailyPlaces(a = [], b = []) {
  const len = Math.max(a.length, b.length);
  for (let k = 0; k < len; k++) {
    const diff = (b[k] || 0) - (a[k] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Holdklassement: sum af holdets BEDSTE 3 rytteres tid, lavest vinder. Kun hold
 * med mindst 3 fuldførende ryttere rangeres (UCI-konvention, #2694) — et hold
 * med 1-2 finishers har ikke et gyldigt holdresultat og kan ikke vinde.
 *
 * Lige tid (#5952, UCI-reglen, ejer-godkendt 29/9). Uden tiebreak faldt lige
 * tid tilbage paa team_id, dvs. reelt alfabetisk — og v4 giver hele feltet
 * samme tid ved massespurt, saa det ramte naesten hvert fladt loeb.
 *  - mode "stage" (endagsloeb, etapens holdresultat): summen af placeringerne
 *    for holdets 3 taellende ryttere, derefter holdets bedste enkeltplacering.
 *  - mode "overall" (etapeloebets samlede holdklassement): flest 1.-pladser i
 *    etapernes holdklassement, saa flest 2.-pladser osv., derefter holdets
 *    bedste rytters placering i det samlede klassement.
 * team_id er kun sidste, deterministiske fallback.
 *
 * @param {Array<{rider_id:string, team_id:string|null}>} entrants
 * @param {Map<string,number>} cumTime  rytter -> tid
 * @param {{mode?: "stage"|"overall", placeByRider?: Map<string,number>,
 *          dailyPlacesByTeam?: Map<string,number[]>}} [tiebreak]
 * @returns {Array<{team_id:string, time:number, rank:number}>}
 */
export function teamClassification(entrants, cumTime, tiebreak = {}) {
  const { mode = "stage", placeByRider = null, dailyPlacesByTeam = null } = tiebreak;
  const placeOf = (riderId) => placeByRider?.get(riderId) ?? NO_PLACE;
  const byTeam = new Map();
  for (const e of entrants) {
    if (!e.team_id) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push({ rider_id: e.rider_id, time: cumTime.get(e.rider_id) || 0, place: placeOf(e.rider_id) });
  }
  const rows = [];
  for (const [team_id, riders] of byTeam) {
    if (riders.length < 3) continue; // <3 finishers → intet gyldigt holdresultat (#2694)
    // De 3 taellende: hurtigst, og ved lige tid den bedst placerede.
    riders.sort((a, b) => a.time - b.time || a.place - b.place || String(a.rider_id).localeCompare(String(b.rider_id)));
    const counting = riders.slice(0, 3);
    rows.push({
      team_id,
      time: counting.reduce((s, r) => s + r.time, 0),
      placeSum: counting.reduce((s, r) => s + r.place, 0),
      bestPlace: Math.min(...riders.map((r) => r.place)),
      dailyPlaces: dailyPlacesByTeam?.get(team_id) ?? [],
    });
  }
  const tieBreak = mode === "overall"
    ? (a, b) => compareDailyPlaces(a.dailyPlaces, b.dailyPlaces) || a.bestPlace - b.bestPlace
    : (a, b) => a.placeSum - b.placeSum || a.bestPlace - b.bestPlace;
  return rows
    .sort((a, b) => a.time - b.time || tieBreak(a, b) || String(a.team_id).localeCompare(String(b.team_id)))
    .map((r, i) => ({ team_id: r.team_id, time: r.time, rank: i + 1 }));
}

/**
 * #5952: holdenes placeringer i HVER etapes holdklassement, talt op — input til
 * det samlede holdklassements UCI-tiebreak. Regnes af de persisterede (eller
 * netop simulerede) 'stage'-raekker: etapetid = raekkens gap (uden
 * bonussekunder, som i UCI's holdklassement), placering = raekkens rank.
 *
 * @param {Array<{stage_number:number, rider_id:string, team_id:string|null, rank:number, finish_time:string|null}>} stageRows
 * @returns {Map<string, number[]>}  team_id -> [antal 1.-pladser, antal 2.-pladser, ...]
 */
export function dailyTeamPlacesFromStageRows(stageRows = []) {
  const byStage = new Map();
  for (const r of stageRows) {
    if (!r?.rider_id || !r.team_id) continue;
    const stageNo = r.stage_number || 1;
    if (!byStage.has(stageNo)) byStage.set(stageNo, []);
    byStage.get(stageNo).push(r);
  }
  const counts = new Map();
  for (const rows of byStage.values()) {
    const time = new Map(rows.map((r) => [r.rider_id, parseGapSeconds(r.finish_time)]));
    const placeByRider = new Map(rows.map((r) => [r.rider_id, Number(r.rank) || NO_PLACE]));
    for (const t of teamClassification(rows, time, { mode: "stage", placeByRider })) {
      if (!counts.has(t.team_id)) counts.set(t.team_id, []);
      const arr = counts.get(t.team_id);
      arr[t.rank - 1] = (arr[t.rank - 1] || 0) + 1;
    }
  }
  return counts;
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
    // Sub-2 (#2770): passage-lag persisterer sprint_points/kom_points/bonus_seconds
    // pr. etaperække. Findes de (mindst én non-null) → brug dem; ellers legacy
    // (classPointsForRank + CLIMB_PROFILES-heuristik), bit-identisk med før Sub-2.
    const hasPassageCols = r.sprint_points != null || r.kom_points != null || r.bonus_seconds != null;
    add(cumTime, r.rider_id, parseGapSeconds(r.finish_time) - (Number(r.bonus_seconds) || 0));
    add(posSum, r.rider_id, Number(r.rank) || 0);
    if (hasPassageCols) {
      add(pointsComp, r.rider_id, Number(r.sprint_points) || 0);
      add(komComp, r.rider_id, Number(r.kom_points) || 0);
    } else {
      add(pointsComp, r.rider_id, classPointsForRank(r.rank));
      if (CLIMB_PROFILES.has(profileTypeByStage.get(stageNo))) {
        add(komComp, r.rider_id, classPointsForRank(r.rank));
      }
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
