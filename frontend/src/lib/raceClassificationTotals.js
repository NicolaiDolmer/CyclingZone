// #3519: visningslag der afslører den FAKTISKE bjerg-/pointkonkurrence-total
// pr. rytter — værdien der forklarer RANGORDENEN i mountain/points-klassement-
// erne. mountain_day/points_day-rækkerne (buildLiveStandings.js) bærer kun
// selve placeringen (rank 1..N), aldrig pointtallet bag den, så en spiller der
// vinder etaper uden at ramme podiet i bjergkonkurrencen har ingen måde at se
// hvorfor — nøjagtig den klage #3519 blev åbnet på (7/8, friisisch).
//
// Ingen ny simulation her: "stage"-rækkerne bærer allerede sprint_points/
// kom_points pr. etape (Sub-2 #2770, race_stage_passages-aggregatet skrevet af
// motoren) — vi SUMMERER blot de allerede-korrekte tal på tværs af etaper.
//
// SSOT-ADVARSEL: CLASSIFICATION_POINTS/CLIMB_PROFILES herunder er en BEVIDST
// kopi af backend/lib/raceClassifications.js's samme konstanter (legacy-
// fallback for etaper uden passage-kolonner — før Sub-2 #2770). Frontend
// bundler ikke backend/lib i browser-runtime (ingen eksisterende præcedens,
// Vite fs-boundary), så værdierne duplikeres her og holdes i sync af en
// parity-test (raceClassificationTotals.test.js) der importerer BEGGE og
// assert'er lighed — samme mønster som frontend/src/lib/rulesNumbers.test.js's
// backend-parity-imports for economyConstants/marketUtils/squadEnforcement.
// RØR ALDRIG disse tal uden FØRST at opdatere backend/lib/raceClassifications.js
// — de styrer den faktiske klassements-rangering i motoren, denne fil styrer
// kun visningen.
const CLASSIFICATION_POINTS = Object.freeze([25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
function classPointsForRank(rank) {
  return CLASSIFICATION_POINTS[rank - 1] || 0;
}
const CLIMB_PROFILES = new Set(["mountain", "high_mountain", "hilly"]);

/**
 * Akkumulerer sprint- (grøn) og bjergkonkurrence-point-totaler pr. rytter fra
 * "stage"-rækker, op til (og med) en given etape. Bit-identisk regel med
 * backend's accumulateStageRows (raceClassifications.js) for netop
 * pointsComp/komComp — GC-tid/countback/stagesByRider er UDELADT her
 * (visningslaget har kun brug for point-summerne).
 *
 * @param {Array} results  race_results-rækker (alle typer; filtreres internt til "stage")
 * @param {Object<number,{profile_type:string}>} profileByStage  stage_number → profil
 * @param {number|null} uptoStage  null = alle etaper (slut-klassement); ellers "efter etape N"
 * @returns {{ mountain: Map<string,number>, sprint: Map<string,number> }}
 */
export function classificationPointTotals(results, profileByStage, uptoStage = null) {
  const mountain = new Map();
  const sprint = new Map();
  const add = (m, k, v) => {
    if (!v) return;
    m.set(k, (m.get(k) || 0) + v);
  };

  for (const r of results || []) {
    if (r.result_type !== "stage" || !r.rider_id) continue;
    const stageNo = r.stage_number ?? 1;
    if (uptoStage != null && stageNo > uptoStage) continue;

    const hasPassageCols = r.sprint_points != null || r.kom_points != null;
    if (hasPassageCols) {
      add(sprint, r.rider_id, Number(r.sprint_points) || 0);
      add(mountain, r.rider_id, Number(r.kom_points) || 0);
    } else {
      add(sprint, r.rider_id, classPointsForRank(r.rank));
      if (CLIMB_PROFILES.has(profileByStage?.[stageNo]?.profile_type)) {
        add(mountain, r.rider_id, classPointsForRank(r.rank));
      }
    }
  }
  return { mountain, sprint };
}
