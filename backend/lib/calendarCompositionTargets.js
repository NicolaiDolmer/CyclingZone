// backend/lib/calendarCompositionTargets.js
// #3295 (ejer-beslutning 6/8): S3-kalenderens MÅL-KOMPOSITION — hvor stor en andel af
// sæsonens løbsdage hver terræntype skal udgøre. Data, ikke kode-konstanter, samme
// princip som tierCalendarGuarantees.js (#3327/#3328) og raceStageOrderProfiles.js
// (#3326): vægtene kan justeres uden deploy.
//
// FORSKELLEN til tierCalendarGuarantees.js: den fil sætter FLOORS ("mindst 5 brosten-
// etaper i tier 3") og beskytter mod regression. Denne fil sætter en MÅLPROFIL med
// tolerance i BEGGE retninger — for meget flad er lige så meget et problem som for lidt
// brosten, fordi andelene summer til 100 %. De to lag er komplementære og håndhæves
// begge: et floor kan være opfyldt mens profilen stadig er skæv.
//
// ── Ejer-beslutningen (issue #3295, 6/8) ───────────────────────────────────────
// Valgt komposition: K-B "gameplay-justeret" — flad 24 · kuperet 30 · bjerg 28 ·
// ITT 8 · brosten 6 · TTT 4 (% af løbsdage). Grundlaget er en research-optælling af
// virkelige sæsoner 2023-2025 (WT-kalender 2025 beregnet til 165 løbsdage: flad 19,8 ·
// kuperet 34,7 · bjerg 31,3 · ITT 8,1 · brosten 4,2 · TTT 2,0) med tre BEVIDSTE
// afvigelser, hver begrundet i issue-tråden:
//   · flad 20 → 24  — sprint er et tilgængeligt, populært format; halvér ikke det
//                     spillerne kender.
//   · brosten 4 → 6 og TTT 2 → 4 — proportional kopiering af virkeligheden
//                     marginaliserer netop de to arketyper mest; de løftes så begge
//                     har nok betydningsfulde dage til at være draft-værdige.
// Kuperet er virkelighedens STØRSTE segment (~35 %), ikke fladt eller bjerg — K-B
// afbøder til 30, men bevarer rækkefølgen kuperet > bjerg > flad > ITT > brosten > TTT.
//
// ── TTT-forbeholdet (ejer, samme kommentar) ────────────────────────────────────
// "race-motorens TTT-understøttelse verificeres FØR TTT-andelen materialiseres
// (ellers interim ITT 10 %/TTT 0 med indfasning)."
//
// VERIFIKATIONEN ER KØRT (6/8, se ACTIVE_TARGET nedenfor + PR-body): motoren scorer en
// TTT-etape som en INDIVIDUEL enkeltstart — terrainBucket("ttt") → "itt"
// (raceTerrain.js:13) og raceSimulator.js:501 sender "itt" og "ttt" ad præcis samme
// gren, så ni ryttere fra samme hold får hver deres tid. Der findes ingen holdtids-
// beregning nogen steder i motoren. #2411/#2561 pausede derfor allerede TTT-GENERERING
// (ttt-filleren fjernet fra alle arketyper). En TTT-andel ville i dag være en
// enkeltstart med et andet navn — derfor kører vi på INTERIM-profilen indtil motoren
// kan simulere ægte holdtidskørsel.
//
// De 4 procentpoint TTT frigiver fordeles: ITT 8 → 10 (ejerens eksplicitte tal) og
// kuperet 30 → 32 (de resterende 2 pp; kuperet er virkelighedens største segment og
// K-B afbøder det allerede nedad, så det er den mindst forvridende placering).
// Flaget i ACTIVE_TARGET er ÉT sted at skifte tilbage når TTT-motoren findes.

// Løbsdags-kategorier. Rækkefølgen er rapport-rækkefølgen.
export const COMPOSITION_CATEGORIES = Object.freeze(["flat", "hilly", "mountain", "itt", "cobbles", "ttt"]);

// Danske rapport-labels (scorecard-output er dansk, som resten af backend/scripts).
export const CATEGORY_LABELS = Object.freeze({
  flat: "flad", hilly: "kuperet", mountain: "bjerg", itt: "ITT", cobbles: "brosten", ttt: "TTT",
});

// profile_type (race_stage_profiles CHECK, jf. PROFILE_TYPES i raceStageProfileGenerator.js)
// → kompositions-kategori. Grupperingen er ejerens egen fra #3295-oplægget
// ("Kuperet (hilly+classic+rolling)") — IKKE den snævrere TERRAIN_FAMILY_BY_PROFILE_TYPE
// i tierCalendarGuarantees.js, som bevidst kun tæller `cobbles` i brosten-familien og
// lader `classic` stå udenfor. Begge grupperinger er korrekte for hver deres formål:
// garanti-floors måler determinististisk terræn, kompositionen måler hvad en spiller
// oplever som "en kuperet dag".
const PROFILE_TO_CATEGORY = Object.freeze({
  flat: "flat",
  rolling: "hilly", hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  itt: "itt",
  cobbles: "cobbles",
  ttt: "ttt",
});

export function compositionCategory(profileType) {
  return PROFILE_TO_CATEGORY[profileType] ?? null;
}

// Ejerens fulde K-B-beslutning (% af løbsdage). Summer til 100.
export const KB_TARGET_FULL = Object.freeze({ flat: 24, hilly: 30, mountain: 28, itt: 8, cobbles: 6, ttt: 4 });

// Interim indtil race-motoren understøtter ægte holdtidskørsel (se docstring). Summer til 100.
export const KB_TARGET_INTERIM = Object.freeze({ flat: 24, hilly: 32, mountain: 28, itt: 10, cobbles: 6, ttt: 0 });

// ÉT sted at flippe når TTT-motoren lander. Sæt til KB_TARGET_FULL sammen med at
// "ttt"-filleren genindføres i ARCHETYPE_PROFILES (raceStageProfileGenerator.js).
export const TTT_ENGINE_SUPPORTED = false;
export const ACTIVE_TARGET = TTT_ENGINE_SUPPORTED ? KB_TARGET_FULL : KB_TARGET_INTERIM;

// Tolerance i procentpoint pr. kategori (#3295: "±2 pp pr. terræntype, målt over hele
// sæsonen"). Kategorier med mål 0 tolererer ikke afvigelse OPAD ud over tolerancen —
// en TTT-etape der slipper igennem mens motoren ikke kan score den, er en fejl vi vil se.
export const COMPOSITION_TOLERANCE_PP = 2;

// Pr.-tier-tolerance. Tier 4 har kun 56 løbsdage, så ÉN etape flytter 1,8 pp — en
// ±2 pp-tolerance dér er reelt "±1 etape" og umulig at ramme stabilt. Tolerancen
// skaleres derfor med stikprøvestørrelsen: en tier må afvige ±2 pp ELLER ±2 løbsdage,
// hvad der er størst. Samme erkendelse som #3347's docstring gør for realisme-båndene
// (små tiers har ægte spredning, det er ikke et kalibreringsproblem).
export const TIER_MIN_TOLERANCE_RACE_DAYS = 2;

/**
 * Tæl løbsdage pr. kompositions-kategori for ét sæt genererede løb.
 *
 * NÆVNEREN er ANTAL ETAPER (= løbsdage). Et endagsløb bidrager med præcis 1 (det har
 * én række i race_stage_profiles, stage_number 1); et 21-etapers grand tour bidrager
 * med 21. For én tier summer det til tierens game-day-kvote (TIER_DENSITY × reelle
 * dage = 140/112/84/56, jf. tierCalendarMaterializer.js), og målingen svarer dermed
 * præcis til "andel af de dage der bliver kørt i divisionen".
 *
 * Puljer i samme tier deler identisk løbssæt (#2276) og identisk parcours (seed-nøglen
 * er division-uafhængig), så ÉN repræsentativ pulje pr. tier er hele tieren — kald
 * aldrig denne funktion med alle puljer, det ville blot gange hver tier op med sit
 * puljeantal og vægte tiers forkert i sæson-aggregatet.
 *
 * Ren funktion — ingen DB/RNG.
 *
 * @param {Array<{stages: Array<{profile_type: string}>}>} races
 * @returns {{raceDays:number, counts:object, pct:object, unknown:object}}
 */
export function computeCompositionStats(races = []) {
  const counts = Object.fromEntries(COMPOSITION_CATEGORIES.map((c) => [c, 0]));
  const unknown = {};
  let raceDays = 0;

  for (const r of races) {
    for (const s of Array.isArray(r?.stages) ? r.stages : []) {
      const cat = compositionCategory(s?.profile_type);
      raceDays += 1;
      if (cat) counts[cat] += 1;
      // En profiltype uden kategori forsvinder ikke tavst: den tælles i nævneren OG
      // rapporteres, så en fremtidig ny profil-type ikke kan skævvride andelene
      // usynligt (#2854-princippet: manglende evidens må aldrig ligne grønt).
      else unknown[s?.profile_type ?? "(null)"] = (unknown[s?.profile_type ?? "(null)"] ?? 0) + 1;
    }
  }

  const pct = Object.fromEntries(
    COMPOSITION_CATEGORIES.map((c) => [c, raceDays > 0 ? (100 * counts[c]) / raceDays : 0])
  );
  return { raceDays, counts, pct, unknown };
}

/**
 * Læg flere tiers stats sammen til ét sæson-aggregat. Tiers vægtes med deres FAKTISKE
 * løbsdage (dvs. game-day-kvoterne 140/112/84/56), ikke ligeligt — sæson-tallet skal
 * afspejle hvor mange dage der reelt køres.
 */
export function aggregateCompositionStats(statsList = []) {
  const counts = Object.fromEntries(COMPOSITION_CATEGORIES.map((c) => [c, 0]));
  const unknown = {};
  let raceDays = 0;
  for (const s of statsList) {
    if (!s) continue;
    raceDays += s.raceDays;
    for (const c of COMPOSITION_CATEGORIES) counts[c] += s.counts[c] ?? 0;
    for (const [k, v] of Object.entries(s.unknown ?? {})) unknown[k] = (unknown[k] ?? 0) + v;
  }
  const pct = Object.fromEntries(
    COMPOSITION_CATEGORIES.map((c) => [c, raceDays > 0 ? (100 * counts[c]) / raceDays : 0])
  );
  return { raceDays, counts, pct, unknown };
}

/**
 * Effektiv tolerance for en given stikprøvestørrelse: max(±2 pp, ±2 løbsdage udtrykt
 * i pp). raceDays = 0 → tolerancen er meningsløs, returnér basis-tolerancen.
 */
export function toleranceFor(raceDays, { tolerancePp = COMPOSITION_TOLERANCE_PP, minRaceDays = TIER_MIN_TOLERANCE_RACE_DAYS } = {}) {
  if (!raceDays || raceDays <= 0) return tolerancePp;
  return Math.max(tolerancePp, (100 * minRaceDays) / raceDays);
}

/**
 * Sammenlign stats mod målprofilen. Returnerer én række pr. kategori (altid alle
 * kategorier, også dem der består — scorecardet viser hele profilen, ikke kun brud)
 * plus violation-strings i samme form som detectCoverageViolations/detectCalendarViolations.
 *
 * @param {{stats:object, target?:object, label?:string, applyMinRaceDayTolerance?:boolean}} args
 */
export function detectCompositionViolations({
  stats, target = ACTIVE_TARGET, label = "sæson", applyMinRaceDayTolerance = false,
  tolerancePp = COMPOSITION_TOLERANCE_PP,
} = {}) {
  const rows = [];
  const violations = [];
  if (!stats) return { rows, violations };

  const tol = applyMinRaceDayTolerance ? toleranceFor(stats.raceDays, { tolerancePp }) : tolerancePp;

  for (const cat of COMPOSITION_CATEGORIES) {
    const goal = target[cat] ?? 0;
    const actual = stats.pct[cat] ?? 0;
    const delta = actual - goal;
    const pass = Math.abs(delta) <= tol + 1e-9;
    rows.push({ category: cat, label: CATEGORY_LABELS[cat], target: goal, actual, delta, tolerance: tol, pass });
    if (!pass) {
      violations.push(
        `${label}: ${CATEGORY_LABELS[cat]} ${actual.toFixed(1)} % mod mål ${goal} % ` +
        `(afvigelse ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp, tolerance ±${tol.toFixed(1)} pp) (#3295)`
      );
    }
  }

  for (const [pt, n] of Object.entries(stats.unknown ?? {})) {
    violations.push(`${label}: ${n} løbsdag(e) med profil-type "${pt}" uden kompositions-kategori — profilen kan ikke måles korrekt (#3295)`);
  }

  return { rows, violations };
}
