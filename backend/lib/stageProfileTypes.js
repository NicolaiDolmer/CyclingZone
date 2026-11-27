// backend/lib/stageProfileTypes.js
// #6369 Fase 0 (S5-etapeprofiler): det DELTE ordforraad for etapetyper og afslutninger.
//
// Spec: docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md (design-go ejer 12/10).
// Byg-plan: docs/superpowers/plans/2026-10-13-s5-etapeprofiler-byg-plan.md, Fase 0.
//
// HVORFOR EN EGEN FIL. S5 bygges i fire parallelle spor (generator, motor, benchmark-gate,
// etapekortet). De skal kunne bygges uafhaengigt af hinanden, og det kan de kun hvis
// vaerdierne de udveksler (DB-kolonnernes lovlige vaerdier, de tre akser fra spec §1 og
// matrixen fra spec §3) staar ÉT sted foerst. Generatoren (raceStageProfileGenerator.js)
// re-eksporterer listerne herfra som PROFILE_TYPES/FINALE_TYPES, saa alle eksisterende
// importer og regressionsvagter (handheldCopyGuards, calendarCompositionTargets,
// stageFinaleMetrics, frontendens stageProfileConfig.js) foelger med automatisk.
//
// HVAD FILEN IKKE GOER: den aendrer ingen adfaerd. Generatoren producerer stadig kun de
// gamle vaerdier, motoren koerer uaendret, og de nye vaerdier bliver foerst lovlige i DB
// naar migrationen database/2026-10-13-6369-s5-stage-profile-types.sql er applied
// (post-merge via auto-migrate.yml, #2642).
//
// REN: ingen IO, ingen RNG. Kun ordforraad + spec'ens matrix som data, og (afsnit 5, #8259)
// de afslutnings-vaegte og det nedkoersels-vindue generator og benchmark-gate deler.

// ── 1. DB-vaerdier (race_stage_profiles CHECK-constraints) ─────────────────────────

/** profile_type-vaerdier S1-S4 kender. Bevares til historik; fjernes aldrig. */
export const LEGACY_PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "itt_hilly", "ttt", "cobbles", "gravel", "classic",
]);

/** Nye profile_type-vaerdier fra S5 (#6360: mellembjerg). */
export const S5_NEW_PROFILE_TYPES = Object.freeze(["medium_mountain"]);

/**
 * Alle lovlige profile_type-vaerdier = race_stage_profiles_profile_type_check efter
 * migrationen. Raekkefoelgen er visnings-orden (frontendens stageProfileConfig.js spejler
 * den, handheldCopyGuards.test.js laaser det): mellembjerg ligger mellem kuperet og bjerg.
 */
export const STAGE_PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "itt", "itt_hilly", "ttt", "cobbles", "gravel", "classic",
]);

/** finale_type-vaerdier S1-S4 kender. Bevares til historik; fjernes aldrig. */
export const LEGACY_FINALE_TYPES = Object.freeze([
  "bunch_sprint", "reduced_sprint", "punch", "long_climb", "descent", "solo_tt", "breakaway",
]);

/**
 * Nye finale_type-vaerdier fra S5. `flat_sprint` er spec §3's "flad spurt", der afloeser
 * massespurt + reduceret spurt (feltets stoerrelse er motorens udfald, ikke etapens
 * geometri). `uphill_sprint` (#6362, stigende spurt) og `wall_finish` (#6363, mur) er nye.
 */
export const S5_NEW_FINALE_TYPES = Object.freeze(["flat_sprint", "uphill_sprint", "wall_finish"]);

/** Alle lovlige finale_type-vaerdier = race_stage_profiles_finale_type_check efter migrationen. */
export const STAGE_FINALE_TYPES = Object.freeze([...LEGACY_FINALE_TYPES, ...S5_NEW_FINALE_TYPES]);

/**
 * flat_sprint som alias (byg-plan Fase 0): de to gamle spurt-vaerdier ER en flad spurt i
 * S5-sproget. Gamle raekker beholder deres vaerdi i DB; laesere oversaetter med
 * canonicalFinaleType().
 */
export const FINALE_TYPE_ALIASES = Object.freeze({
  bunch_sprint: "flat_sprint",
  reduced_sprint: "flat_sprint",
});

/** Gammel eller ny finale_type -> S5-navnet (alias opløst). Ukendt/tom -> null. */
export function canonicalFinaleType(finaleType) {
  if (typeof finaleType !== "string" || !STAGE_FINALE_TYPES.includes(finaleType)) return null;
  return FINALE_TYPE_ALIASES[finaleType] ?? finaleType;
}

// ── 2. De tre akser (spec §1) ─────────────────────────────────────────────────────

/** A. Terraen (af stigningerne, spec §2 B+): seks trin, lettest foerst. */
export const TERRAIN_TYPES = Object.freeze(["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain"]);

/**
 * B. Afslutning (de sidste km, geometri, ikke udfald). Spec §1/§3's otte afslutninger:
 * flad spurt · stigende spurt · bakke (`punch`) · mur · bjergtop (`long_climb`) ·
 * nedkoersel · enkeltstart (`solo_tt`) · holdtidskoersel (`ttt`).
 *
 * `breakaway` er IKKE en afslutning i S5 (spec §3: udbrud er motoradfaerd, #6368).
 * `ttt` er ikke en finale_type-vaerdi i DB: en holdtidskoersel har profile_type `ttt`
 * (finale_type `solo_tt`), og aksen udleder den derfra (stageProfileLegacyMapping.js).
 */
export const FINISH_TYPES = Object.freeze([
  "flat_sprint", "uphill_sprint", "punch", "wall_finish", "long_climb", "descent", "solo_tt", "ttt",
]);

/** C. Underlag: asfalt, eller sektorer af brosten/grus (spec §1C). */
export const SURFACE_TYPES = Object.freeze(["asphalt", "cobbles", "gravel"]);

/**
 * Underlaget bor i den EKSISTERENDE kolonne race_stage_profiles.sectors (jsonb), ikke i
 * en ny kolonne. Beslutning i Fase 0 (byg-planen: "beslut i PR'en ud fra hvad motoren
 * allerede laeser"): motoren laeser allerede `sectors[].kind` via routeSegments.js
 * buildSegments -> "cobbles"-segmenter (grus er fysisk et cobbles-segment, se
 * engine/v4/types.ts ProfileType), og rutegeneratoren skriver allerede
 * `{ kind, start_km, length_km, name }` (raceRouteGenerator.js buildSectors). Antal og
 * laengde (spec §1C) laeses af listen; svaerhed er ikke gemt i dag (motorens stars traekkes
 * ved segment-bygning) og er en senere, additiv felt-udvidelse af sektoren.
 */
export const SECTOR_KINDS = Object.freeze(["cobbles", "gravel"]);

// ── 3. Matrixen (spec §3): hvilke afslutninger hvert terraen tillader ──────────────
//
// Generatoren vaelger kun inden for matrixen (Spor 1), benchmark-gaten afviser en etape
// uden for den (Spor 3), og motor-tests fejler ved en ulovlig kombination (Spor 2).
// Spec'ens betingelser inden for en celle (mellembjerg: flad spurt kun "langt efter sidste
// top", bjergtop kun kat. 2; bjerg: kat. 1; hoejbjerg: kat. 1/HC; nedkoersel: sidste top
// kat. 3 eller haardere 5-25 km foer maal) kraever ruten og ejes af generator/gate.
// Enkeltstart/holdtidskoersel er etapeformater og staar uden for terraen-matrixen.
export const FINISH_MATRIX = Object.freeze({
  flat:            Object.freeze(["flat_sprint", "uphill_sprint"]),
  rolling:         Object.freeze(["flat_sprint", "uphill_sprint", "punch"]),
  hilly:           Object.freeze(["flat_sprint", "uphill_sprint", "punch", "wall_finish", "descent"]),
  medium_mountain: Object.freeze(["flat_sprint", "punch", "wall_finish", "long_climb", "descent"]),
  mountain:        Object.freeze(["long_climb", "descent"]),
  high_mountain:   Object.freeze(["long_climb", "descent"]),
});

/** Tidskoersels-afslutningerne, der ikke er bundet af terraen-matrixen. */
export const TIME_TRIAL_FINISH_TYPES = Object.freeze(["solo_tt", "ttt"]);

/** Er (terraen, afslutning) lovlig efter spec §3? Ukendte vaerdier er aldrig lovlige. */
export function isFinishAllowed(terrain, finish) {
  if (TIME_TRIAL_FINISH_TYPES.includes(finish)) return TERRAIN_TYPES.includes(terrain);
  const allowed = FINISH_MATRIX[terrain];
  return Array.isArray(allowed) && allowed.includes(finish);
}

// ── 4. Pladsholdere for nye profiltyper (Fase 0) ────────────────────────────────
//
// En ny profile_type skal have en demand-vektor, en kompositions-kategori osv., ellers
// fejler regressionsvagterne ("alle generator-profiltyper har ..."). Fase 0 udfylder dem
// med en EKSISTERENDE types vaerdier i stedet for at opfinde nye tal: kalibreringen er
// Spor 1/2's (generator/motor) og Spor 3's (komposition, finale-baand). Ingen etape har
// typen foer generatoren begynder at skrive den, saa pladsholderen aendrer intet i dag.
export const S5_PLACEHOLDER_SOURCE_PROFILE = Object.freeze({ medium_mountain: "mountain" });

/**
 * Tilfoejer pladsholder-raekker for de nye profiltyper til en tabel noeglet paa
 * profile_type (fx DEMAND_VECTORS). Eksisterende noegler roeres aldrig; mangler kilden,
 * tilfoejes intet.
 */
export function withS5ProfilePlaceholders(byProfileType) {
  const out = { ...byProfileType };
  for (const [type, source] of Object.entries(S5_PLACEHOLDER_SOURCE_PROFILE)) {
    if (!(type in out) && source in out) out[type] = out[source];
  }
  return out;
}

// ── 5. S6-afslutningerne (#8259, ejerbeslutninger 26/11 paa #5841) ─────────────────
//
// RODAARSAGEN. S5-generatorens afslutnings-vaegte (S5_FINISH_WEIGHTS) er talt op af
// benchmarkens Grand Tour-etaper og blev brugt paa ALLE etaper. En kuperet GT-etape er
// oftest en overgangsetape til en spurt eller et udbrud ned ad bakke, men en kuperet
// klassiker eller etape i et kort etapeloeb ender langt oftere op ad en bakke eller mur.
// Resultatet i S5: for mange kuperede etaper endte i flad spurt eller nedkoersel, og
// klassikerne endte for ofte i en nedkoersel langt efter den sidste stigning.
//
// REGLEN NU. Grand Tours beholder benchmarkens vaegte (benchmark-gatens del 3 maaler dem
// mod rigtige Grand Tours). Alle andre landevejsetaper traekker fra vaegtene herunder.
// Bjerg og hoejbjerg er uaendrede (ejer: "Bjerg og hoejbjerg er uaendret"): de har ingen
// raekke her, og generatoren bruger dem fra S5-tabellen. Brosten faar sin egen tabel, saa
// en brostensetape naesten aldrig ender i en nedkoersel. Tallene og maalingen bag dem
// ligger i balance-internals/2026-11-26-8259/.
//
// Hver vaerdi ligger inden for FINISH_MATRIX for terraenet; testen holder det fast.
export const ROAD_FINISH_WEIGHTS = Object.freeze({
  flat: Object.freeze([{ value: "flat_sprint", weight: 76 }, { value: "uphill_sprint", weight: 24 }]),
  rolling: Object.freeze([{ value: "flat_sprint", weight: 44 }, { value: "uphill_sprint", weight: 24 }, { value: "punch", weight: 32 }]),
  hilly: Object.freeze([
    { value: "flat_sprint", weight: 8 }, { value: "uphill_sprint", weight: 12 }, { value: "punch", weight: 34 },
    { value: "wall_finish", weight: 32 }, { value: "descent", weight: 14 },
  ]),
  medium_mountain: Object.freeze([
    { value: "flat_sprint", weight: 10 }, { value: "punch", weight: 16 }, { value: "wall_finish", weight: 12 },
    { value: "long_climb", weight: 46 }, { value: "descent", weight: 16 },
  ]),
});

/**
 * #8830 (ejer 27/11, "Ret D1 nu"): D1's World Tour-loeb (klassen OtherWorldTourA findes kun i
 * D1) ender oftere op ad bakke end resten af kalenderen. Klassen er fast pr. loeb, saa samme
 * loeb har stadig samme parcours i alle divisioner (#2276). Kun flad og boelget; resten som ROAD.
 */
export const WORLD_TOUR_A_FINISH_WEIGHTS = Object.freeze({
  flat: Object.freeze([{ value: "flat_sprint", weight: 55 }, { value: "uphill_sprint", weight: 45 }]),
  rolling: Object.freeze([{ value: "flat_sprint", weight: 14 }, { value: "uphill_sprint", weight: 20 }, { value: "punch", weight: 66 }]),
});

/**
 * #8830 (ejer 27/11, "ret gerne D3's spurt med"): ProSeries (D3's loeb) faar lidt flere flade
 * etaper med spurt op ad bakke; spurten er stadig den hyppigste afslutning paa flad.
 */
export const PRO_SERIES_FINISH_WEIGHTS = Object.freeze({
  flat: Object.freeze([{ value: "flat_sprint", weight: 64 }, { value: "uphill_sprint", weight: 36 }]),
});

/** #8830: klasse-vaegte uden for Grand Tours (klassen er fast pr. loeb, #2276). */
export const CLASS_FINISH_WEIGHTS = Object.freeze({
  OtherWorldTourA: WORLD_TOUR_A_FINISH_WEIGHTS,
  ProSeries: PRO_SERIES_FINISH_WEIGHTS,
});

/** Brosten (profile_type cobbles): spurten og de korte ramper dominerer, nedkoersel er sjaelden. */
export const COBBLES_FINISH_WEIGHTS = Object.freeze({
  flat: ROAD_FINISH_WEIGHTS.flat,
  rolling: Object.freeze([{ value: "flat_sprint", weight: 72 }, { value: "uphill_sprint", weight: 20 }, { value: "punch", weight: 8 }]),
  hilly: Object.freeze([
    { value: "flat_sprint", weight: 42 }, { value: "uphill_sprint", weight: 16 }, { value: "punch", weight: 18 },
    { value: "wall_finish", weight: 16 }, { value: "descent", weight: 8 },
  ]),
  medium_mountain: Object.freeze([
    { value: "flat_sprint", weight: 40 }, { value: "punch", weight: 22 }, { value: "wall_finish", weight: 20 },
    { value: "long_climb", weight: 10 }, { value: "descent", weight: 8 },
  ]),
});

/**
 * #8830 (ejer 26/11): afslutningsmaal pr. niveau. Senior og U23: opad (punch, mur,
 * bjergtop) 33-40 %, flad spurt 25-32 %; junior: opad 28-35 %, flad spurt 30-37 %.
 * Ungdommens kalender er mini-udgaver af D1 (#7471), saa dens Grand Tours er korte (7/4
 * etaper) og bruger IKKE benchmarkens GT-vaegte: tabellerne her gaelder alle ungdommens
 * landevejsetaper, ogsaa mini-GT'ernes. Junior er fladere end U23 (ejer). Senior-reglen
 * "bjerg og hoejbjerg uaendret" gaelder senior; ungdommens bjergetaper ender oftere paa
 * toppen, saa opad-maalet kan naas med mini-GT'ernes to tidskoersler. Maalingen: PR #8836.
 */
export const YOUTH_FINISH_WEIGHTS = Object.freeze({
  u23: Object.freeze({
    flat: Object.freeze([{ value: "flat_sprint", weight: 75 }, { value: "uphill_sprint", weight: 25 }]),
    rolling: Object.freeze([{ value: "flat_sprint", weight: 35 }, { value: "uphill_sprint", weight: 15 }, { value: "punch", weight: 50 }]),
    hilly: Object.freeze([
      { value: "flat_sprint", weight: 6 }, { value: "uphill_sprint", weight: 6 }, { value: "punch", weight: 40 },
      { value: "wall_finish", weight: 38 }, { value: "descent", weight: 10 },
    ]),
    medium_mountain: Object.freeze([
      { value: "flat_sprint", weight: 6 }, { value: "punch", weight: 16 }, { value: "wall_finish", weight: 14 },
      { value: "long_climb", weight: 58 }, { value: "descent", weight: 6 },
    ]),
    mountain: Object.freeze([{ value: "long_climb", weight: 92 }, { value: "descent", weight: 8 }]),
    high_mountain: Object.freeze([{ value: "long_climb", weight: 92 }, { value: "descent", weight: 8 }]),
  }),
  junior: Object.freeze({
    // #8830 (ejer 27/11): junior-GT'en har nu een enkeltstart; den frigjorte landevejsetape
    // maa ikke traekke flad spurt over maalet, saa flad faar flere spurter op ad bakke.
    flat: Object.freeze([{ value: "flat_sprint", weight: 56 }, { value: "uphill_sprint", weight: 44 }]),
    rolling: Object.freeze([{ value: "flat_sprint", weight: 42 }, { value: "uphill_sprint", weight: 18 }, { value: "punch", weight: 40 }]),
    hilly: Object.freeze([
      { value: "flat_sprint", weight: 6 }, { value: "uphill_sprint", weight: 4 }, { value: "punch", weight: 44 },
      { value: "wall_finish", weight: 42 }, { value: "descent", weight: 4 },
    ]),
    medium_mountain: Object.freeze([
      { value: "flat_sprint", weight: 14 }, { value: "punch", weight: 16 }, { value: "wall_finish", weight: 14 },
      { value: "long_climb", weight: 50 }, { value: "descent", weight: 6 },
    ]),
    mountain: Object.freeze([{ value: "long_climb", weight: 92 }, { value: "descent", weight: 8 }]),
    high_mountain: Object.freeze([{ value: "long_climb", weight: 92 }, { value: "descent", weight: 8 }]),
  }),
});

/**
 * #8830 (ejer 26/11, afslutningsmaal pr. division): D1's Grand Tours ender i spurt paa 43 %
 * af de kuperede etaper (benchmarkens vaegte), og det loefter D1's flade spurt over 32 %.
 * Fra S6 flyttes en del af GT'ernes kuperede og mellembjergs-spurter mest til spurt op ad
 * bakke, lidt til bakke og mur; begge holdes lave, for rigtige GT'er ender sjaeldent paa en mur.
 * Benchmark-gatens del (3) maaler GT-afslutningerne mod rigtige Grand Tours (flad spurt
 * 33,7 % +-13,1 pp, mur 2,5 % +-4,4 pp). Bjerg, hoejbjerg og flad er uaendrede.
 */
export const GT_FINISH_WEIGHTS_S6 = Object.freeze({
  hilly: Object.freeze([
    { value: "flat_sprint", weight: 8 }, { value: "uphill_sprint", weight: 20 }, { value: "punch", weight: 10 },
    { value: "wall_finish", weight: 7 }, { value: "descent", weight: 22 },
  ]),
  medium_mountain: Object.freeze([
    { value: "flat_sprint", weight: 4 }, { value: "punch", weight: 2 }, { value: "wall_finish", weight: 1 },
    { value: "long_climb", weight: 12 }, { value: "descent", weight: 8 },
  ]),
});

/**
 * #8830: ungdommens afslutnings-vaegte for terraenet, eller null (senior, ukendt terraen): kalderen bruger saa senior-reglen.
 * @param {string} terrain @param {string | null | undefined} squad
 * @returns {ReadonlyArray<{ value: string, weight: number }> | null}
 */
export function youthFinishWeightsFor(terrain, squad) {
  const table = squad ? /** @type {any} */ (YOUTH_FINISH_WEIGHTS)[squad] : null;
  return table?.[terrain] ?? null;
}

/**
 * Afslutnings-vaegtene for en etape uden for en Grand Tour. null = ingen S6-raekke (bjerg,
 * hoejbjerg, ukendt terraen): kalderen bruger S5-tabellen uaendret.
 * @param {string} terrain  B+-terraenet for etapens stigninger
 * @param {string | null | undefined} profileType  etapens profile_type (brosten har egen tabel)
 * @param {string | null} [raceClass]  loebets klasse (#8830: OtherWorldTourA har egne vaegte)
 * @returns {ReadonlyArray<{ value: string, weight: number }> | null}
 */
export function roadFinishWeightsFor(terrain, profileType, raceClass = null) {
  const byClass = profileType !== "cobbles" && raceClass ? /** @type {any} */ (CLASS_FINISH_WEIGHTS)[raceClass] : null;
  if (byClass?.[terrain]) return byClass[terrain];
  const table = profileType === "cobbles" ? COBBLES_FINISH_WEIGHTS : ROAD_FINISH_WEIGHTS;
  return /** @type {Record<string, ReadonlyArray<{ value: string, weight: number }>>} */ (table)[terrain] ?? null;
}

/**
 * Nedkoersel (ejer 26/11, punkt 6): sidste top kort foer maal, kat. 3 eller haardere.
 * Foer var vinduet saa bredt, at en etape med sidste bakke langt fra maal hed
 * "nedkoersel". Bjerg og hoejbjerg beholder det gamle vindue (en lang nedkoersel fra et
 * stort bjerg ER en nedkoerselsafslutning).
 */
export const DESCENT_LAST_TOP_WINDOW_KM = Object.freeze([5, 12]);
export const MOUNTAIN_DESCENT_LAST_TOP_WINDOW_KM = Object.freeze([5, 25]);

/** [min, max] km fra sidste top til maal for en nedkoersel paa terraenet. */
export function descentTopWindowFor(terrain) {
  return terrain === "mountain" || terrain === "high_mountain" ? MOUNTAIN_DESCENT_LAST_TOP_WINDOW_KM : DESCENT_LAST_TOP_WINDOW_KM;
}
