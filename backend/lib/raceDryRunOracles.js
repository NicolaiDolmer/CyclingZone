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
// Mode-bevidst gulv (#1122, ejer-valgt C1): terræn-kraft-evner (neutral mode)
// holdes mod `floor`; seam/dynamik-evner (breakaway/condition/finale) virker
// gennem mindre seams og holdes mod `floorByMode[mode]` — gulvet tester "læses
// evnen overhovedet", ikke kalibrerings-styrke.
// @param {Array<{ability,terrain,mode,rankGain}>} sensitivities
// @param {{floor?:number, floorByMode?:Record<string,number>}} opts  default-gulv 0.05
// @returns {string[]} brud (tom = OK)
export function evaluateAbilityLivenessOracle(sensitivities = [], { floor = 0.05, floorByMode = {} } = {}) {
  const failures = [];
  for (const s of sensitivities) {
    const f = floorByMode[s.mode] ?? floor;
    if (!(Number(s.rankGain) >= f)) {
      failures.push(
        `evne '${s.ability}' på ${s.terrain} (${s.mode}): ⌀rank-gevinst ${Number(s.rankGain).toFixed(2)} < gulv ${f} — evnen påvirker ikke resultatet (dødvægt)`
      );
    }
  }
  return failures;
}

// ── S4 (#1176): uhelds/DNF-bånd (ejer-godkendt spec-scorecard) ───────────────
// Håndhæves sammen med --enforce-dominance i simulateSeasonDryRun.js Section F
// (samme gating-idiom som DOMINANCE_TARGETS) — rapport-only ellers. Defaults
// matcher spec-scorecardet; targets-param tillader override (kalibrerings-
// sweeps/tests) uden at ændre denne fils pure-lib-kontrakt (intet I/O/imports).
const DEFAULT_INCIDENT_TARGETS = Object.freeze({
  // Mean DNF-rate (abandon ALENE, ikke time_loss) pr. etape-instans, andel af feltet.
  dnfRatePctBand: Object.freeze({ min: 0.3, max: 1.5 }),
  // Matcher raceRoles.js's RACE_V3_TUNING.INCIDENT_MAX_FIELD_SHARE default (5%) —
  // harnesset sender den LEVENDE env-overridede værdi ind via targets ved kald.
  maxFieldSharePct: 5,
  // Abandon-andel af ALLE uheld: 25% ± 10pp (matcher INCIDENT_ABANDON_SHARE-default).
  abandonShareBand: Object.freeze({ min: 0.15, max: 0.35 }),
});

/**
 * Evaluér uhelds/DNF-båndene mod aggregateIncidentObservations()-output
 * (raceDominanceMetrics.js). Fem invarianter:
 *   1. Mean DNF-rate/etape ∈ dnfRatePctBand (spec-bånd).
 *   2. Højeste ENKELT-etape-uheldsandel ≤ maxFieldSharePct — beviser at motorens
 *      deterministiske hard cap (INCIDENT_MAX_FIELD_SHARE) faktisk holder.
 *   3. ITT/TTT skal have feltets LAVESTE uheldsrate blandt de målte profiler.
 *   4. Cobbles skal have feltets HØJESTE.
 *   5. Abandon-andelen af alle uheld ∈ abandonShareBand.
 *
 * @param {ReturnType<typeof import("./raceDominanceMetrics.js").aggregateIncidentObservations>} stats
 * @param {{dnfRatePctBand?:{min,max}, maxFieldSharePct?:number, abandonShareBand?:{min,max}}} [targets]
 * @returns {string[]} brud (tom = OK; ingen data ⇒ tom, ligesom de øvrige oracles' n/a-håndtering)
 */
export function evaluateIncidentBoundsOracle(stats, targets = {}) {
  const failures = [];
  if (!stats || !stats.stages) return failures;

  const dnfBand = targets.dnfRatePctBand ?? DEFAULT_INCIDENT_TARGETS.dnfRatePctBand;
  const maxSharePct = targets.maxFieldSharePct ?? DEFAULT_INCIDENT_TARGETS.maxFieldSharePct;
  const abandonBand = targets.abandonShareBand ?? DEFAULT_INCIDENT_TARGETS.abandonShareBand;

  if (stats.meanDnfRatePct != null && (stats.meanDnfRatePct < dnfBand.min || stats.meanDnfRatePct > dnfBand.max)) {
    failures.push(
      `DNF-rate: ⌀${stats.meanDnfRatePct.toFixed(3)}% af feltet/etape uden for bånd [${dnfBand.min}%, ${dnfBand.max}%]`
    );
  }

  if (stats.maxIncidentSharePct != null && stats.maxIncidentSharePct > maxSharePct) {
    failures.push(
      `hård cap brudt: højeste enkelt-etape-uheldsandel ${stats.maxIncidentSharePct.toFixed(2)}% overstiger INCIDENT_MAX_FIELD_SHARE (${maxSharePct}%)`
    );
  }

  if (stats.abandonShareOfIncidents != null) {
    const pct = stats.abandonShareOfIncidents * 100;
    const minPct = abandonBand.min * 100, maxPct = abandonBand.max * 100;
    if (pct < minPct || pct > maxPct) {
      failures.push(
        `abandon-andel af uheld ${pct.toFixed(1)}% uden for bånd [${minPct.toFixed(0)}%, ${maxPct.toFixed(0)}%] (mål 25% ± 10pp)`
      );
    }
  }

  const perProfile = stats.perProfile || {};
  const entries = Object.entries(perProfile).filter(([, v]) => v.stages > 0);
  if (entries.length > 1) {
    const rateOf = (key) => perProfile[key]?.meanIncidentRatePct;
    const nonSoloProfiles = entries.filter(([k]) => k !== "itt" && k !== "ttt");
    const minOtherRate = nonSoloProfiles.length ? Math.min(...nonSoloProfiles.map(([, v]) => v.meanIncidentRatePct)) : null;
    for (const key of ["itt", "ttt"]) {
      const r = rateOf(key);
      if (r != null && minOtherRate != null && r > minOtherRate) {
        failures.push(
          `${key}: uheldsrate ${r.toFixed(4)}% er ikke feltets laveste (min blandt øvrige profiler ${minOtherRate.toFixed(4)}%)`
        );
      }
    }

    const cobblesRate = rateOf("cobbles");
    const nonCobblesProfiles = entries.filter(([k]) => k !== "cobbles");
    const maxOtherRate = nonCobblesProfiles.length ? Math.max(...nonCobblesProfiles.map(([, v]) => v.meanIncidentRatePct)) : null;
    if (cobblesRate != null && maxOtherRate != null && cobblesRate < maxOtherRate) {
      failures.push(
        `cobbles: uheldsrate ${cobblesRate.toFixed(4)}% er ikke feltets højeste (max blandt øvrige profiler ${maxOtherRate.toFixed(4)}%)`
      );
    }
  }

  return failures;
}
