// #2081 — vælg de rigtige race_results-rækker for "etape N × klassement K" på
// RaceDetailPage's etape-fane. En etape kan have to slags rækker for samme
// klassement: dag-typen (leader/points_day/mountain_day/young_day/team_day,
// skrevet for HVER etape) og fina-typen (gc/points/mountain/young/team, skrevet
// KUN på løbets sidste etape). Reglen: fina-rækker vinder hvis de findes for
// netop denne stage_number (kan kun være sandt for løbets faktiske sidste
// etape); ellers dag-rækkerne. Sådan virker "Overall efter etape 3" ens for et
// igangværende OG et afsluttet løb, uden caller skal vide hvilket.
//
// Hold-fallback: løb kørt FØR #2081 (team_day findes ikke) deriverer holdstil-
// lingen af den etapes 'leader'-rækkers gap, samme regel som raceLiveStandings.js.

import { deriveTeamStandings } from "./raceLiveStandings.js";

const FINAL_TYPE = { gc: "gc", points: "points", mountain: "mountain", young: "young", team: "team" };
const DAY_TYPE = { gc: "leader", points: "points_day", mountain: "mountain_day", young: "young_day", team: "team_day" };

function byRank(a, b) {
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

function atStage(results, resultType, stageNumber) {
  return (results || []).filter((r) => r.result_type === resultType && (r.stage_number ?? 1) === stageNumber);
}

export function classificationRowsForStage(results, stageNumber, key) {
  if (key === "stage") {
    return atStage(results, "stage", stageNumber).sort(byRank);
  }
  const finalRows = atStage(results, FINAL_TYPE[key], stageNumber);
  if (finalRows.length) return finalRows.sort(byRank);

  if (key === "team") {
    const dayRows = atStage(results, "team_day", stageNumber);
    if (dayRows.length) return dayRows.sort(byRank);
    const leaderRows = atStage(results, "leader", stageNumber).sort(byRank);
    return leaderRows.length ? deriveTeamStandings(leaderRows) : [];
  }

  return atStage(results, DAY_TYPE[key], stageNumber).sort(byRank);
}
