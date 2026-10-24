// backend/lib/raceEngineRulesRevision.ts
// #5955 (#5984 Task 2): immutable taktisk regel-revision pr. loeb.
//
// Ejer-godkendt releaseprincip (release A, 30/9): rettelser af beregnings-
// korrekthed maa gaelde fra naeste ikke-koerte etape, men NY taktik/balance
// gaelder kun loeb der STARTER efter den er aktiveret. Et igangvaerende
// etapeloeb faerdiggoeres med de regler det startede paa.
//
// Kontrakten (docs/RACE_ENGINE_RULES.md "Regel-revision pr. loeb"):
//   - Revisionen bindes ved loebets FOERSTE etape-claim og aendres aldrig siden.
//   - Et loeb der allerede er startet (en etape er afviklet) og ikke har en gemt
//     revision, er "legacy". Null paa et startet loeb er ALDRIG automatisk opt-in.
//   - Retry/genstart af samme foerste claim genbruger den gemte revision.
//   - En ukendt revision er en observerbar fejl: aldrig nyeste regler, aldrig et
//     v3-fallback for et v4-loeb.
//   - `engine_version = 4` alene betyder IKKE ny politik (det er motorens
//     major-version, ikke en regel-revision).
//
// REN: ingen IO. Kaldstedet (raceRunner.js) laeser og skriver kolonnen.

// #6084: "orders_gc_v2" = hele orders_gc_v1-pakken + bjergselektionen (feltet
// holder samlet til finalestigningen, udbruddet hentes dér). Aktuel for nye
// loeb 2/10-9/10; afloest af official_times_v2 (ejer-go 9/10).
// #6187: "orders_gc_v3" = hele orders_gc_v2-pakken + "eget hold jagter aldrig
// sine egne" (et hold foerer ikke jagten paa en gruppe med egen rytter i, og
// dets udbrydere sidder paa hjul ved en trussel mod holdets GC-rytter).
// Samlepunkt for uge 41-pakken. Aldrig aktuel; indgaar i official_times_v2.
// #6199 (ejer 8/10): "official_times_v2" = hele orders_gc_v3-pakken + den samlede
// tidsmodel (officielle etapetider #6284, fysisk kontakt #6327, faelles
// gruppeklokke #6199, kontaktsted #6329). Aktuel for nye loeb 9/10 indtil
// ejerens "taend" af official_times_v3 (#6452).
// #6200: "official_times_v3" = hele official_times_v2-pakken + nedkoerselsfinalen
// paa bjergetaper (sidste stigning spreder gruppen som en topankomst; loftet paa
// nedkoerslen gaelder ogsaa med et kort stykke til maal) og resten af den rene
// motor-revision (spec 2026-10-10-ren-motor-revision-design.md). Aktuel for nye
// loeb fra ejerens ordrette "taend" (#6452); migrationen
// 2026-10-11-race-engine-rules-revision-official-times-v3.sql goer vaerdien lovlig.
// #6464 + #6456 (ejer 11/10, slukket): "official_times_v4" = hele
// official_times_v3-pakken + bjergets tidsgab ens i alle divisioner (nr. 10 paa
// en topankomst maales i feltets egen evne-spredning, ikke i absolutte
// evne-point) + et maal for bjergetaper uden topankomst. Aktuel for nye loeb fra
// ejerens ordrette "taend"; migrationen
// 2026-10-12-race-engine-rules-revision-official-times-v4.sql goer vaerdien lovlig.
// #6369 (S5-etapeprofiler): "s5_profiles_v1" = hele official_times_v4-pakken
// + S5-motoren (#6363/#6362/#6368, engine/v4/s5Profiles.ts): S5-motorens
// nye finaler, mellembjerg-terraen og udbrud-som-adfaerd bag isS5ProfilesV1OrLater.
// Aktuel for nye loeb fra ejerens ordrette "taend" (taend-PR'en, #6369);
// races_engine_rules_revision_check goer vaerdien lovlig via
// 2026-10-16-6369-engine-rules-revision-s5.sql (applied og verificeret 16/10).
// #6462 (ejer 16/10): "official_times_v5" = hele official_times_v4-pakken + togreglen
// (sprint-toget er kun STANDARD paa en flad etape; bjerg, enkeltstart, kuperet og brosten har
// intet tog, medmindre manageren selv saetter det). Reglen ligger i ordre-adapteren
// (engine/v4/orders/teamOrdersAdapter.ts trainIsDefaultOnStage) bag isOfficialTimesV5OrLater;
// motoren selv er uaendret. s5_profiles_v1 arver den (S5 = official_times_v5 + S5-motoren).
// Aktuel for nye loeb fra ejerens ordrette "taend"; migrationen
// 2026-10-16-6462-engine-rules-revision-official-times-v5.sql goer vaerdien lovlig.
// #6156 (ejer 17/10): "s5_profiles_v2" = hele s5_profiles_v1-pakken +
// formtoppe i v4 (toppens tillaeg i vinduet, dykket bagefter; broen regner den
// samlede form) + udbrudsopfoelgningen (#6748). Aktuel for nye loeb fra ejerens
// ordrette "taend" (taend-PR'en, #6818); races_engine_rules_revision_check goer
// vaerdien lovlig via 2026-10-17-6818-engine-rules-revision-s5-v2.sql.
export const RACE_RULES_REVISIONS = ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", "official_times_v3", "official_times_v4", "s5_profiles_v1", "official_times_v5", "s5_profiles_v2", "s5_profiles_v3"] as const;
export type RaceRulesRevision = (typeof RACE_RULES_REVISIONS)[number];

export const LEGACY_RULES_REVISION: RaceRulesRevision = "legacy";

// #6187: revisionerne er en ARVELINJE: hver orders_gc-revision er hele den
// forrige plus sit eget. Kaldsteder spoerger derfor "mindst vN?" via
// helperne nedenfor i stedet for at sammenligne strenge. En sidegren skal
// angive sin mekaniske generation eksplicit; official_times_v1 arver v2,
// official_times_v2 arver v3.
const ORDERS_GC_GENERATION: Readonly<Record<RaceRulesRevision, number>> = Object.freeze({
  legacy: 0,
  orders_gc_v1: 1,
  orders_gc_v2: 2,
  orders_gc_v3: 3,
  // #6284: a v2 branch for official result integrity, NOT v3 mechanics.
  official_times_v1: 2,
  // #6199 (owner 8/10): the full orders_gc_v3 package + the shared time model.
  official_times_v2: 3,
  // #6200: official_times_v2 + the descent-finish package; same v3 mechanics.
  official_times_v3: 3,
  // #6464: official_times_v3 + mountain gaps in every division; same v3 mechanics.
  official_times_v4: 3,
  // #6369: official_times_v4 + the S5 engine (#6363); same v3 mechanics.
  s5_profiles_v1: 3,
  // #6462: official_times_v4 + the sprint-train default rule (order adapter only); same v3 mechanics.
  official_times_v5: 3,
  // #6156: s5_profiles_v1 + formtoppe i v4 (broen); same v3 mechanics.
  s5_profiles_v2: 3,
  // #6804: s5_profiles_v2 + v3-tilvalgene (slukket); same v3 mechanics.
  s5_profiles_v3: 3,
});

const OFFICIAL_TIMES_REVISIONS: ReadonlySet<unknown> = new Set(["official_times_v1", "official_times_v2", "official_times_v3", "official_times_v4", "s5_profiles_v1", "official_times_v5", "s5_profiles_v2", "s5_profiles_v3"]);

/** #6369: revisionerne der arver HELE official_times_v4-pakken (v4 selv + S5; #6462: + v5; #6156: + S5 v2). */
const OFFICIAL_TIMES_V4_LINEAGE: ReadonlySet<unknown> = new Set(["official_times_v4", "s5_profiles_v1", "official_times_v5", "s5_profiles_v2", "s5_profiles_v3"]);

/** #6462: revisionerne der arver togreglen (official_times_v5 selv + S5 v1 og v2). */
const OFFICIAL_TIMES_V5_LINEAGE: ReadonlySet<unknown> = new Set(["official_times_v5", "s5_profiles_v1", "s5_profiles_v2", "s5_profiles_v3"]);

/** #6156: revisionerne der arver HELE s5_profiles_v1-pakken (v1 selv + v2). */
const S5_PROFILES_V1_LINEAGE: ReadonlySet<unknown> = new Set(["s5_profiles_v1", "s5_profiles_v2", "s5_profiles_v3"]);

/** #6156: revisionerne med formtoppe i v4 (s5_profiles_v2 og senere). */
const S5_PROFILES_V2_LINEAGE: ReadonlySet<unknown> = new Set(["s5_profiles_v2", "s5_profiles_v3"]);

/** #6804: revisionerne med v3-tilvalgene (s5_profiles_v3, slukket). */
const S5_PROFILES_V3_LINEAGE: ReadonlySet<unknown> = new Set(["s5_profiles_v3"]);

/**
 * #6200: the shared time model's generation. 3 = official_times_v3 OR LATER
 * (the descent-finish package on top of official_times_v2; official_times_v4
 * inherits it whole); 0 for everything before official_times_v3. Never inferred
 * from the orders_gc generation. #6464: official_times_v4's own additions are
 * asked with isOfficialTimesV4OrLater, so every "generation 3" call site keeps
 * treating v4 exactly as v3.
 */
export function sharedTimeModelGeneration(value: unknown): 0 | 3 {
  return value === "official_times_v3" || OFFICIAL_TIMES_V4_LINEAGE.has(value) ? 3 : 0;
}

/** Den rene motor-revision (#6349/#6352/#6338 m.fl.): official_times_v3 eller senere. */
export function isOfficialTimesV3OrLater(revision: unknown): boolean {
  return sharedTimeModelGeneration(revision) >= 3;
}

/**
 * #6464 + #6456 (slukket): official_times_v4 eller senere. Bjergets tidsgab
 * maales i feltets egen evne-spredning (samme maal i alle divisioner), og
 * bjergetaper uden topankomst har et eget loft paa nr. 10.
 */
export function isOfficialTimesV4OrLater(revision: unknown): boolean {
  return OFFICIAL_TIMES_V4_LINEAGE.has(revision);
}

/**
 * #6462 (ejer 16/10, aktuel fra ejerens "taend"): official_times_v5 eller senere. Sprint-toget er
 * kun STANDARD paa en flad etape (ordre-adapterens trainIsDefaultOnStage);
 * resten er official_times_v4. s5_profiles_v1 arver reglen.
 */
export function isOfficialTimesV5OrLater(revision: unknown): boolean {
  return OFFICIAL_TIMES_V5_LINEAGE.has(revision);
}

/**
 * #6369 (aktuel fra ejerens "taend"): S5-etapeprofilernes motor-regler. Kaldsteder for S5-adfaerd
 * (nye finaler, mellembjerg, udbrud som adfaerd) spoerger HER, aldrig paa strengen.
 * #6363: S5-motoren (engine/v4/s5Profiles.ts) ligger bag denne; alt andet er official_times_v4.
 */
export function isS5ProfilesV1OrLater(revision: unknown): boolean {
  return S5_PROFILES_V1_LINEAGE.has(revision);
}

/**
 * #6156 (aktuel fra ejerens "taend", #6818): s5_profiles_v2 = HELE s5_profiles_v1-pakken +
 * formtoppe i v4. Broen (raceEngineV4Bridge.js) laegger formtoppens tillaeg oven
 * i rytterens form i peak-vinduet og traekker dykket fra bagefter (én samlet form,
 * spec 2026-10-04 §3.1). Motoren er s5_profiles_v1 + udbrudsopfoelgningen (#6748).
 * Nye loeb bindes hertil fra ejerens ordrette "taend" (#6818); migrationen
 * 2026-10-17-6818-engine-rules-revision-s5-v2.sql goer vaerdien lovlig.
 */
export function isS5ProfilesV2OrLater(revision: unknown): boolean {
  return S5_PROFILES_V2_LINEAGE.has(revision);
}

/**
 * #6804 (slukket): s5_profiles_v3 = HELE s5_profiles_v2-pakken + v3-tilvalgene
 * (spec 2026-10-23-6804-v3-tilvalg-design.md). Ikke aktuel; migrationen
 * 2026-10-23-6804-engine-rules-revision-s5-v3.sql goer vaerdien lovlig.
 */
export function isS5ProfilesV3OrLater(revision: unknown): boolean {
  return S5_PROFILES_V3_LINEAGE.has(revision);
}

/** Only the future pinned official-times revisions store uncapped official stage gaps. */
export function preservesOfficialStageTimes(value: unknown): boolean {
  return OFFICIAL_TIMES_REVISIONS.has(value);
}

/**
 * #6199: the shared group clock (one physical time account per group line,
 * physical contact, descent crossings and physical descent outcomes). Exactly
 * the official-times revisions; never inferred from the orders_gc generation.
 */
export function usesSharedGroupTime(value: unknown): boolean {
  return OFFICIAL_TIMES_REVISIONS.has(value);
}

/** 0 for legacy og alt ukendt; ellers revisionens plads i orders_gc-arvelinjen. */
export function ordersGcGeneration(value: unknown): number {
  return isKnownRulesRevision(value) ? ORDERS_GC_GENERATION[value] : 0;
}

/** orders_gc_v1 eller senere (ordrestyret udbrud, GC-reaktion, ...). */
export function isOrdersGcRulesRevision(value: unknown): boolean {
  return ordersGcGeneration(value) >= 1;
}

/** orders_gc_v2 eller senere (bjergselektion, rullende balance, AI-udbrud). */
export function isOrdersGcV2OrLater(value: unknown): boolean {
  return ordersGcGeneration(value) >= 2;
}

/** orders_gc_v3 eller senere (#6187: eget hold jagter aldrig sine egne). */
export function isOrdersGcV3OrLater(value: unknown): boolean {
  return ordersGcGeneration(value) >= 3;
}

/**
 * Den revision et NYT loeb bindes til ved sin foerste etape-claim.
 *
 * "orders_gc_v1" siden ejer-go 2/10 (#5955): pakken (ordrestyret dannelse,
 * rolle-tilladelser, GC-reaktion og -bremse, udbrud/jagt-balance, brostenslag)
 * er komplet og kalibreret. Loeb der allerede er startet beholder deres gemte
 * revision (eller legacy); kun loeb hvis foerste etape claimes efter deploy
 * bindes hertil. Et skifte tilbage er ogsaa et eksplicit ejer-go.
 *
 * "orders_gc_v2" siden ejer-go 2/10 (#6084): v1-pakken + bjergselektionen er
 * aktuel for de loeb der starter ved genstarten. Loeb der allerede er bundet
 * til orders_gc_v1 (eller legacy) faerdiggoeres paa den.
 *
 * "orders_gc_v3" (#6187) er bygget, men aldrig aktuel: den indgaar i
 * official_times_v2.
 *
 * "official_times_v2" siden ejer-go 9/10 (#6199): v3-pakken + den samlede
 * tidsmodel er aktuel for ALLE loeb hvis foerste etape claimes efter deploy
 * (Tour de l'Hexagone inkl.). Loeb der allerede er bundet til orders_gc_v2
 * faerdiggoeres paa den.
 *
 * "official_times_v3" fra ejerens ordrette "taend" (#6452): den rene
 * motor-revision er aktuel for ALLE loeb hvis foerste etape claimes efter
 * deploy (et loeb med engine_rules_revision = null binder til v3). Loeb der
 * allerede er bundet til official_times_v2 (eller aeldre) faerdiggoeres paa
 * den. Migrationen 2026-10-11-race-engine-rules-revision-official-times-v3.sql
 * SKAL vaere applied foer foerste claim; ellers fejler bindingen hoejlydt paa
 * CHECK-constrainten (ingen tavs fallback).
 *
 * "official_times_v4" fra ejerens ordrette "taend" (#6464 + #6456): bjergets
 * tidsgab ens i alle divisioner + bjergetaper uden topankomst er aktuel for ALLE
 * loeb hvis foerste etape claimes efter deploy. Loeb der allerede er bundet til
 * official_times_v3 (fx Touren) faerdiggoeres paa den. Migrationen
 * 2026-10-12-race-engine-rules-revision-official-times-v4.sql SKAL vaere applied
 * foer foerste claim; ellers fejler bindingen hoejlydt paa CHECK-constrainten.
 *
 * "official_times_v5" fra ejerens ordrette "taend" (#6462): togreglen (sprint-
 * toget er kun STANDARD paa en flad etape) er aktuel for ALLE loeb hvis foerste
 * etape claimes efter deploy. Loeb der allerede er bundet til official_times_v4
 * (eller aeldre) faerdiggoeres paa den. Migrationen
 * 2026-10-16-6462-engine-rules-revision-official-times-v5.sql SKAL vaere applied
 * foer foerste claim; ellers fejler bindingen hoejlydt paa CHECK-constrainten.
 *
 * "s5_profiles_v1" fra ejerens ordrette "taend" (#6369): S5-motoren (nye
 * finaler, mellembjerg, udbrud som adfaerd, enkeltstart, maalgab, GC-snor) +
 * togreglen fra v5 er aktuel for ALLE loeb hvis foerste etape claimes efter
 * deploy. Loeb der allerede er bundet til official_times_v5 (eller aeldre)
 * faerdiggoeres paa den. Migrationen 2026-10-16-6369-engine-rules-revision-s5.sql
 * er applied. Rollback = revert af denne konstant (migrationen kan blive staaende).
 *
 * "s5_profiles_v2" fra ejerens ordrette "taend" (#6818): hele S5 v1 + formtoppe i
 * v4 (#6156, broens samlede form) + udbrudsopfoelgningen (#6748) er aktuel for
 * ALLE loeb hvis foerste etape claimes efter deploy. Loeb der allerede er bundet
 * til s5_profiles_v1 (eller aeldre) faerdiggoeres paa den. Migrationen
 * 2026-10-17-6818-engine-rules-revision-s5-v2.sql SKAL vaere applied foer foerste
 * claim; ellers fejler bindingen hoejlydt paa CHECK-constrainten. Rollback =
 * revert af denne konstant (migrationen kan blive staaende).
 */
export const CURRENT_RACE_RULES_REVISION: RaceRulesRevision = "s5_profiles_v2";

export class RaceRulesRevisionError extends Error {
  readonly revision: unknown;
  constructor(message: string, revision: unknown) {
    super(message);
    this.name = "RaceRulesRevisionError";
    this.revision = revision;
  }
}

export function isKnownRulesRevision(value: unknown): value is RaceRulesRevision {
  return typeof value === "string" && (RACE_RULES_REVISIONS as readonly string[]).includes(value);
}

export type RulesRevisionRace = {
  id?: string | number | null;
  stages_completed?: number | string | null;
};

/**
 * Har loebet afviklet mindst én etape? Et ugyldigt/manglende tal behandles som
 * IKKE startet kun naar det er praecis 0/null; alt andet end et endeligt tal
 * >= 0 behandles defensivt som startet (aldrig opt-in paa usikkert grundlag).
 */
export function raceHasStarted(race: RulesRevisionRace | null | undefined): boolean {
  const raw = race?.stages_completed;
  if (raw === null || raw === undefined) return false;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return true;
  return n > 0;
}

/**
 * Afgoer hvilken taktisk regel-revision en etape-afvikling koerer paa.
 *
 * @param race            loebsraekken (kun `stages_completed` laeses)
 * @param firstStageClaim true KUN naar denne afvikling er loebets foerste etape
 *                        under en vundet claim, og kolonnen kan skrives. Er
 *                        kolonnen fravaerende (foer migrationen er applied),
 *                        skal kaldstedet sende false.
 * @param storedRevision  den gemte vaerdi (null/undefined = ingen gemt)
 * @param currentRevision revisionen nye loeb bindes til
 */
export function resolveRaceRulesRevision(input: {
  race: RulesRevisionRace | null | undefined;
  firstStageClaim: boolean;
  storedRevision: unknown;
  currentRevision: unknown;
}): RaceRulesRevision {
  const { race, firstStageClaim, storedRevision, currentRevision } = input;
  if (storedRevision !== null && storedRevision !== undefined) {
    if (isKnownRulesRevision(storedRevision)) return storedRevision;
    throw new RaceRulesRevisionError(
      `race ${race?.id ?? "?"}: ukendt engine_rules_revision ${JSON.stringify(storedRevision)} - etapen afvikles ikke`,
      storedRevision,
    );
  }
  // Ingen gemt revision: kun et IKKE-startet loeb paa sin foerste claim kan
  // bindes til den aktuelle revision. Alt andet er legacy.
  if (!firstStageClaim || raceHasStarted(race)) return LEGACY_RULES_REVISION;
  if (!isKnownRulesRevision(currentRevision)) {
    throw new RaceRulesRevisionError(
      `race ${race?.id ?? "?"}: aktuel regel-revision ${JSON.stringify(currentRevision)} er ukendt`,
      currentRevision,
    );
  }
  return currentRevision;
}

/**
 * #6462: den revision en spillerflade skal vise reglerne for, FOER motoren har
 * bundet noget. En gemt, kendt revision er svaret. Et ikke-startet loeb uden
 * gemt revision bindes til den aktuelle ved foerste etape-claim, saa fladen
 * viser den aktuelle (samme regel som resolveRaceRulesRevision). Et startet loeb
 * uden gemt revision er legacy; en ukendt gemt vaerdi ligesaa (motoren afviser
 * at koere den, og fladen maa aldrig vise nyeste regler paa usikkert grundlag).
 */
export function surfaceRulesRevision(input: {
  race: RulesRevisionRace | null | undefined;
  storedRevision: unknown;
  currentRevision?: unknown;
}): RaceRulesRevision {
  const { race, storedRevision, currentRevision = CURRENT_RACE_RULES_REVISION } = input;
  if (storedRevision !== null && storedRevision !== undefined) {
    return isKnownRulesRevision(storedRevision) ? storedRevision : LEGACY_RULES_REVISION;
  }
  if (raceHasStarted(race) || !isKnownRulesRevision(currentRevision)) return LEGACY_RULES_REVISION;
  return currentRevision;
}

/** Postgres/PostgREST-fejl for en kolonne der ikke findes (migrationen er ikke applied endnu). */
export function isMissingRulesRevisionColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (!message.includes("engine_rules_revision")) return false;
  // Kun "kolonnen findes ikke" - en constraint-fejl der naevner kolonnen er en
  // rigtig fejl og skal larme, ikke stille degradere til legacy.
  return e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find/i.test(message);
}
