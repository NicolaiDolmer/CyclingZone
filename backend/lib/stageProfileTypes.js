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
// REN: ingen IO, ingen RNG, ingen tal. Kun ordforraad + spec'ens matrix som data.

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
