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
// gruppeklokke #6199, kontaktsted #6329). Aktuel for nye loeb siden ejer-go
// 9/10 (se CURRENT_RACE_RULES_REVISION).
// #6200: "official_times_v3" = hele official_times_v2-pakken + nedkoerselsfinalen
// paa bjergetaper (sidste stigning spreder gruppen som en topankomst; loftet paa
// nedkoerslen gaelder ogsaa med et kort stykke til maal). SLUKKET: aldrig aktuel
// foer et ejer-go, og DB-constrainten kender den ikke endnu (kraever en migration
// ved flip).
export const RACE_RULES_REVISIONS = ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", "official_times_v3"] as const;
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
});

const OFFICIAL_TIMES_REVISIONS: ReadonlySet<unknown> = new Set(["official_times_v1", "official_times_v2", "official_times_v3"]);

/**
 * #6200: the shared time model's generation. 3 = official_times_v3 (the
 * descent-finish package on top of official_times_v2); 0 for everything that is
 * not official_times_v3. Never inferred from the orders_gc generation.
 */
export function sharedTimeModelGeneration(value: unknown): 0 | 3 {
  return value === "official_times_v3" ? 3 : 0;
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
 */
export const CURRENT_RACE_RULES_REVISION: RaceRulesRevision = "official_times_v2";

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
