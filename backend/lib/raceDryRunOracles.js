// Strukturelle motor-oracles for race-dry-run-gaten (#1102 → #1198).
//
// Disse er IKKE kalibrerings-bånd (ejer-mål som "sprinter ≥90%" tunes separat og
// afventer ejer-beslutning, jf. kalibrerings-loggen i simulateSeasonDryRun.js) —
// de er engine-invarianter der gælder for ENHVER sund kalibrering:
//
//   1. Vinderne skal i snit være BEDRE end felt-medianen i terrænets nøgle-evne.
//      En motor der ikke belønner evnen er inverteret/død (#1198 race-M1).
//   2. Ingen monopol-degeneration: ét terræn må ikke vindes af én og samme
//      rytter i SAMTLIGE løb hele sæsonen. Acceptance-kriteriet i
//      raceSimulator.js er "stjerner vinder oftest, men ikke 100%" (#1198
//      race-M2). Gulvet er det absolutte minimum (≥2 distinkte vindere) — se
//      minDistinctWinners for hvorfor andels-gulve er falske ved små pools.
//   3. GC-vinderen skal have feltets laveste samlede etape-tid (klassement =
//      kumulativ tid ascenderende). buildRaceResults er den ÆGTE prod-resultatsti,
//      så en inverteret GC her er en prod-katastrofe (#1198 race-M6).
//   4. Værdi-sanity: feltets bedste (overall) skal være mere værd end bunden —
//      en flad/inverteret værdimodel må ikke passere ordløst (#1198 race-M5).
//
// Brud ⇒ process.exitCode 1 i scripts/simulateSeasonDryRun.js (gate-promotion
// per #1144 step 1; kalibrerings-bånd håndhæves kun med --enforce-targets).

// Empirisk kalibrering (#1198): gulvet er ABSOLUT 2, ikke en andel af løbene.
// "Distinkte vindere" afhænger stærkt af pool-størrelsen: ved count=140 hvor
// hele puljen stiller op i hvert løb, er 2-5 distinkte vindere over 300 løb en
// LEGITIM tilstand (samme topstjerner kører alle løb) — kun den totale monopol-
// degeneration (én eneste vinder, dvs. præcis "100%") er ubetinget broken.
export function minDistinctWinners(races) {
  return Number(races) > 1 ? 2 : 1;
}

/**
 * Evaluér de strukturelle motor-oracles.
 * @param {object} args
 *   terrainResults: [{ terrain, keyAb, races, winnerKeyAvg, fieldMedianKey, distinct }]
 *   gc: { winnerCumSeconds, minCumSeconds } | null  (kumulativt etape-gab i sek.)
 *   value: { topDecileMedian, bottomDecileMedian } | null  (base_value pr. overall-decil)
 * @returns {string[]} brud (tom = OK)
 */
export function evaluateRaceStructuralOracles({ terrainResults = [], gc = null, value = null } = {}) {
  const failures = [];

  for (const tr of terrainResults) {
    if (!(tr.winnerKeyAvg > tr.fieldMedianKey)) {
      failures.push(
        `${tr.terrain}: vinder-⌀ i nøgle-evnen (${tr.keyAb} ${tr.winnerKeyAvg}) er ikke over felt-medianen (${tr.fieldMedianKey}) — motoren belønner ikke evnen`
      );
    }
    const minDistinct = minDistinctWinners(tr.races);
    if (tr.distinct < minDistinct) {
      failures.push(
        `${tr.terrain}: kun ${tr.distinct} distinkt(e) vinder(e) på ${tr.races} løb (kræver ≥${minDistinct}) — monopol-degeneration`
      );
    }
  }

  if (gc) {
    if (!(Number.isFinite(gc.winnerCumSeconds) && Number.isFinite(gc.minCumSeconds))) {
      failures.push("GC-oracle: kunne ikke udlede kumulative tider fra etape-rækkerne");
    } else if (gc.winnerCumSeconds > gc.minCumSeconds) {
      failures.push(
        `GC-vinderen har ${gc.winnerCumSeconds}s samlet etape-gab men feltets minimum er ${gc.minCumSeconds}s — klassementet er ikke laveste-tid-vinder`
      );
    }
  }

  if (value) {
    if (!(value.topDecileMedian > value.bottomDecileMedian)) {
      failures.push(
        `værdi-sanity: median base_value for top-decilen (overall) er ${value.topDecileMedian} ≤ bund-decilens ${value.bottomDecileMedian} — værdimodellen er flad/inverteret`
      );
    }
  }

  return failures;
}

// Ability-liveness (#1122): hver evne motoren PÅSTÅR den scorer, skal måles til at
// rykke slutplaceringen. ⌀rank-gevinst under gulvet = dødvægt. Adskilt fra de
// strukturelle oracles, fordi den fodres med sensitivitets-måling (raceSensitivity.js)
// og håndhæves bag --enforce-liveness (jf. simulateSeasonDryRun.js).
//
// @param {Array<{ability,terrain,mode,rankGain}>} sensitivities
// @param {{floor?:number}} opts  gulv for ⌀rank-gevinst (default 0.05)
// @returns {string[]} brud (tom = OK)
export function evaluateAbilityLivenessOracle(sensitivities = [], { floor = 0.05 } = {}) {
  const failures = [];
  for (const s of sensitivities) {
    if (!(Number(s.rankGain) >= floor)) {
      failures.push(
        `evne '${s.ability}' på ${s.terrain} (${s.mode}): ⌀rank-gevinst ${Number(s.rankGain).toFixed(2)} < gulv ${floor} — evnen påvirker ikke resultatet (dødvægt)`
      );
    }
  }
  return failures;
}
