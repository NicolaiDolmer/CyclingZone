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
//
// ── Brosten rettet 6 → 5 (ejer-beslutning 31/8, #4103 punkt "valg A") ──────────────
// §11 punkt 6 i CALENDAR_RULES.md dokumenterede at to KONKURRERENDE brosten-mål levede
// i denne fil samtidig: K-B's egen 6 % ovenfor og #4103's uniforme pr.-division-mål på
// 5 % (TIER_UNIFORM_TARGET_FRACTIONS.cobbles nedenfor, ejer-beslutning 23/8). Ejeren
// afgjorde det 31/8: 5 % gælder — for BEGGE systemer, ikke kun #4103's. Den tabte
// procentpoint lægges på kuperet (30 → 31 / 32 → 33), samme "kuperet er den mindst
// forvridende placering"-begrundelse som TTT-omfordelingen ovenfor bruger — ikke en ny
// balance-beslutning, samme princip anvendt igen. Den gamle "brosten 4 → 6"-forhøjelse
// (linje 21 ovenfor) er dermed reduceret til "brosten 4 → 5"; researchgrundlaget (4,2 %)
// ændrer sig ikke, kun hvor meget K-B løftede den fra det.

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
  // itt_hilly (#3546 D): stadig en TIDSKØRSEL for K-B-budgetteringens formål (den er en
  // GT's ANDEN enkeltstart, ikke en ny kategori spilleren oplever anderledes i budgettet).
  itt: "itt", itt_hilly: "itt",
  cobbles: "cobbles",
  ttt: "ttt",
});

export function compositionCategory(profileType) {
  return PROFILE_TO_CATEGORY[profileType] ?? null;
}

// Ejerens fulde K-B-beslutning (% af løbsdage), brosten rettet 6 → 5 31/8 (se docstring
// ovenfor; +1 pp lagt på kuperet). Summer til 100.
export const KB_TARGET_FULL = Object.freeze({ flat: 24, hilly: 31, mountain: 28, itt: 8, cobbles: 5, ttt: 4 });

// Interim indtil race-motoren understøtter ægte holdtidskørsel (se docstring). Summer til 100.
export const KB_TARGET_INTERIM = Object.freeze({ flat: 24, hilly: 33, mountain: 28, itt: 10, cobbles: 5, ttt: 0 });

// ÉT sted at flippe når TTT-motoren lander. Sæt til KB_TARGET_FULL sammen med at
// "ttt"-filleren genindføres i ARCHETYPE_PROFILES (raceStageProfileGenerator.js).
export const TTT_ENGINE_SUPPORTED = false;
export const ACTIVE_TARGET = TTT_ENGINE_SUPPORTED ? KB_TARGET_FULL : KB_TARGET_INTERIM;

// Tolerance i procentpoint pr. kategori (#3295: "±2 pp pr. terræntype, målt over hele
// sæsonen"). Kategorier med mål 0 tolererer ikke afvigelse OPAD ud over tolerancen —
// en TTT-etape der slipper igennem mens motoren ikke kan score den, er en fejl vi vil se.
export const COMPOSITION_TOLERANCE_PP = 2;

// Pr.-tier-tolerance (generisk sikkerhedsnet). Tier 4 har kun 56 løbsdage, så ÉN etape
// flytter 1,8 pp — en ±2 pp-tolerance dér er reelt "±1 etape" og umulig at ramme stabilt.
// Tolerancen skaleres derfor med stikprøvestørrelsen: en tier må afvige ±2 pp ELLER
// ±2 løbsdage, hvad der er størst. Samme erkendelse som #3347's docstring gør for
// realisme-båndene (små tiers har ægte spredning, det er ikke et kalibreringsproblem).
// Bruges nu som GULV under TIER_COMPOSITION_TOLERANCE_PP (se nedenfor), ikke som
// eneste kilde — se den tabels docstring for hvorfor.
export const TIER_MIN_TOLERANCE_RACE_DAYS = 2;

// ── Pr.-tier-tolerance som DATA (#3469, ejer-beslutning 8/8) ──────────────────────
//
// PROBLEMET (#3469 leverance 4, opdaget da pr.-tier-gaten blev tilføjet i gatePlan()):
// season-aggregatet rammer K-B fint (±2 pp), men de 4 tiers afviger hver for sig langt
// mere — ARCHETYPE_PROFILES's filler-vægte (#3295) er kalibreret mod SÆSON-AGGREGATET,
// ikke pr. tier, og hver tier trækker fra en anden delmængde af kataloget (klasse-
// whitelist, jf. tierRaceSelection.js), så tier-specifik skævhed er et reelt, MÅLT
// katalog-loft — ikke en fejl i selve trækket. En pr.-tier-gate med FAST ±2 pp ville
// derfor være rød FRA FØDSLEN på enhver realistisk plan, hvilket lærer alle at bruge
// --allow-tier-composition-drift som standard-reflex — og så vogter gaten reelt intet
// (jf. #3295's egen frys-det-gode-doktrin: en gate der altid kræver et flag er en gate
// ingen længere læser).
//
// LØSNINGEN: tolerancen er PR.-TIER DATA, sat til den STØRSTE afvigelse MÅLT på den
// nuværende S3-plan (node scripts/buildSeasonCalendar.js --season 3 --first-day
// 2026-08-24, 2026-08-08) + 1 pp buffer, minimum 3 pp — så dagens plan består UDEN
// flag, mens en NY regression (fx et fremtidigt katalog-skred der presser en tier
// endnu længere væk fra K-B) stadig fanges.
//
//   tier 1 (140 løbsdage): værste afvigelse kuperet +5,14 pp → tolerance 7 pp
//   tier 2 (111 løbsdage): værste afvigelse brosten +3,01 pp → tolerance 5 pp
//   tier 3 ( 82 løbsdage): værste afvigelse bjerg   -6,05 pp → tolerance 8 pp
//   tier 4 ( 56 løbsdage): værste afvigelse kuperet -8,79 pp → tolerance 10 pp
//
// Mønstret (mindre tier → større tolerance) matcher TIER_MIN_TOLERANCE_RACE_DAYS'
// stikprøve-logik ovenfor, men er nu et MÅLT tal pr. tier i stedet for en generisk
// formel — formlen undervurderede systematisk (den antog kun "færre løbsdage", ikke
// at hver tier OGSÅ trækker fra et andet klasse-vindue af kataloget).
//
// DETTE ER EN KENDT KALIBRERINGSOPGAVE, IKKE EN PERMANENT AFSLAPNING: at stramme mod
// sæson-niveauets ±2 pp pr. tier kræver at ARCHETYPE_PROFILES's filler-vægte
// kalibreres PR. TIER (i dag: én global vægt-tabel for alle tiers), en opgave #3295's
// egen kalibrerings-dokumentation allerede pegede på ("tier-spredningen er katalogets
// loft", se raceStageProfileGenerator.js's #3295-kalibrerings-kommentar og
// scripts/calibrateCalendarComposition.js). Indtil den kalibrering laves, er
// --allow-tier-composition-drift bevaret til nødstilfælde (fx en midlertidig
// katalog-mangel der presser én tier hårdere end tabellen tillader) — men default-
// stien kræver den IKKE længere for en normal plan.
export const TIER_COMPOSITION_TOLERANCE_PP = Object.freeze({ 1: 7, 2: 5, 3: 8, 4: 10 });

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

// ── #4103 (ejer-beslutning 23/8) — UNIFORM PR.-TIER MÅL for ITT/brosten/high_mountain ──
//
// PROBLEMET: S3's D3-verifikation (#4103) fandt at ITT/brosten/high_mountain-andelene
// spredte sig VOLDSOMT på tværs af de 4 tiers, langt ud over hvad KB_TARGET/
// TIER_COMPOSITION_TOLERANCE_PP ovenfor accepterer som "katalog-loft" — fx ITT fra
// 1,8 % (tier 4) til 15,5 % (tier 3). Ejeren besluttede SAMME mål i alle divisioner
// (ikke KB-schemaets sæson-aggregat med tier-specifik tolerance): ITT 10 % · brosten
// 5 % · high_mountain 12 %, målt som andel af DIVISIONENS EGNE løbsdage (alle etaper
// inkl. endagsløb i nævneren, samme nævner som computeCompositionStats ovenfor).
//
// FORSKELLEN til KB_TARGET/PROFILE_TO_CATEGORY ovenfor:
//   1) KB's "mountain"-kategori lægger mountain+high_mountain sammen (§ #3295-
//      beslutningen "gameplay-oplevet kuperet/bjerg"); denne måling holder
//      high_mountain ADSKILT fra almindelig mountain — #4103 handler specifikt om
//      SUMMIT-tætheden, ikke den bredere bjerg-familie.
//   2) KB's tolerance er PR.-TIER DATA (kalibreret til den nuværende, skæve plan —
//      se TIER_COMPOSITION_TOLERANCE_PP's docstring). #4103's pointe er netop at
//      tier-spredningen IKKE længere skal accepteres for disse 3 kategorier — samme
//      mål, samme (lave) tolerance for alle fire tiers.
//   3) itt her tæller BÅDE "itt" og "itt_hilly" (en GT's anden enkeltstart, #3546 D) —
//      begge er tidskørsler i spillerens oplevelse, samme gruppering compositionCategory
//      bruger for "itt"-kategorien ovenfor.
//
// SCOPE: dette er en MÅLE-/scorecard-kontrakt (bruges af
// scripts/dev/recomposeSeason3Stages4103.mjs's dry-run-rapport og kan genbruges af en
// fremtidig efterverifikation). Den ER nu koblet ind i ARCHETYPE_PROFILES's filler-vægte
// (ejer-beslutning 31/8, #4103 "valg A" — se `backend/lib/tierUniformFillerTilt.js`) —
// opt-in via `materializeTierCalendars({ useUniformTierTilt: true })`, default FRA så S3
// (allerede materialiseret) ikke røres. S4-genereringen skal eksplicit slå den til.
//
// BROSTEN-MODSIGELSEN (§11 punkt 6 i CALENDAR_RULES.md) er lukket samme dag: KB_TARGET
// ovenfor brugte 6 %, denne tabel 5 % — ejeren valgte 5 % for BEGGE, så tallet herunder
// er nu det ENESTE brosten-mål i filen (se KB_TARGET_FULL/INTERIM's docstring ovenfor).
export const TIER_UNIFORM_TARGET_CATEGORIES = Object.freeze(["itt", "cobbles", "high_mountain"]);

// Fraktion (0-1) af divisionens løbsdage, samme for alle tiers (ejer-beslutning 23/8).
export const TIER_UNIFORM_TARGET_FRACTIONS = Object.freeze({ itt: 0.10, cobbles: 0.05, high_mountain: 0.12 });

// Tolerance i procentpoint — samme lave tolerance for alle tiers (modsat
// TIER_COMPOSITION_TOLERANCE_PP's pr.-tier-skala ovenfor): #4103's hele pointe er at
// tiers IKKE længere må sprede sig efter katalog-tilfældigheder for disse 3 kategorier.
export const TIER_UNIFORM_TOLERANCE_PP = 2;

/**
 * Tæl løbsdage pr. #4103-kategori (itt inkl. itt_hilly, cobbles, high_mountain) for ét
 * sæt genererede løb — samme input-form som computeCompositionStats (races med
 * .stages[].profile_type), men grupperingen er #4103's egen (se docstring ovenfor),
 * IKKE PROFILE_TO_CATEGORY. Ren funktion — ingen DB/RNG.
 *
 * @param {Array<{stages: Array<{profile_type: string}>}>} races
 * @returns {{raceDays:number, counts:object, pct:object}}
 */
export function computeUniformTierStats(races = []) {
  const counts = Object.fromEntries(TIER_UNIFORM_TARGET_CATEGORIES.map((c) => [c, 0]));
  let raceDays = 0;
  for (const r of races) {
    for (const s of Array.isArray(r?.stages) ? r.stages : []) {
      raceDays += 1;
      const pt = s?.profile_type;
      if (pt === "itt" || pt === "itt_hilly") counts.itt += 1;
      else if (pt === "cobbles") counts.cobbles += 1;
      else if (pt === "high_mountain") counts.high_mountain += 1;
    }
  }
  const pct = Object.fromEntries(
    TIER_UNIFORM_TARGET_CATEGORIES.map((c) => [c, raceDays > 0 ? (100 * counts[c]) / raceDays : 0])
  );
  return { raceDays, counts, pct };
}

/**
 * Det TALMÆSSIGE mål (antal løbsdage, ikke pp) for én #4103-kategori i en division med
 * `raceDays` løbsdage i alt. Rundet til nærmeste heltal (almindelig afrunding, .5 op).
 * Rene divisioner (`raceDays`=0) giver 0.
 */
export function uniformTargetCount(raceDays, category) {
  const fraction = TIER_UNIFORM_TARGET_FRACTIONS[category] ?? 0;
  return raceDays > 0 ? Math.round(raceDays * fraction) : 0;
}

/**
 * Sammenlign stats mod #4103's uniforme mål. Samme rows/violations-facon som
 * detectCompositionViolations ovenfor (rows for ALLE kategorier, violations kun for brud).
 *
 * @param {{stats:object, label?:string, tolerancePp?:number}} args
 */
export function detectUniformTierViolations({ stats, label = "division", tolerancePp = TIER_UNIFORM_TOLERANCE_PP } = {}) {
  const rows = [];
  const violations = [];
  if (!stats) return { rows, violations };

  for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
    const goalPct = (TIER_UNIFORM_TARGET_FRACTIONS[cat] ?? 0) * 100;
    const actual = stats.pct[cat] ?? 0;
    const delta = actual - goalPct;
    const pass = Math.abs(delta) <= tolerancePp + 1e-9;
    rows.push({ category: cat, target: goalPct, actual, delta, tolerance: tolerancePp, pass });
    if (!pass) {
      violations.push(
        `${label}: ${cat} ${actual.toFixed(1)} % mod mål ${goalPct.toFixed(1)} % ` +
        `(afvigelse ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp, tolerance ±${tolerancePp.toFixed(1)} pp) (#4103)`
      );
    }
  }

  return { rows, violations };
}
