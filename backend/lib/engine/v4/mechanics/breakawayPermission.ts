// backend/lib/engine/v4/mechanics/breakawayPermission.ts
// #5955 (#5984 Task 3): ordrestyret og omstridt morgenudbrud — KUN under
// regel-revisionen "orders_gc_v1" (StageInput.rules_revision). Legacy-stien i
// mechanics/breakaway.ts (attemptFormation/selectBreakawayRiders) er uaendret.
//
// Ejer-godkendte regler (#5955 30/9, #5978 30/9 aften), SSOT:
// docs/RACE_ENGINE_RULES.md "Morgenudbrud under orders_gc_v1":
//   1. TILLADELSE (canAttemptMorningBreak): captain/sprint_captain/helper kraever
//      en effektiv udbrudsordre. hunter forsoeger som standard; et eksplicit
//      fravalg (try_break=false) gaelder etapen. free_role kan forsoege selv paa
//      normal indsats; en ordre prioriterer forsoeget. save stopper SPONTANE
//      forsoeg, men en effektiv ordre tillader stadig forsoeget med normal pris.
//      grupetto forsoeger aldrig.
//   2. FORSOEG MED PRIS: hvert faktisk forsoeg koster én gang, ogsaa ved fiasko.
//   3. MODREAKTION: rivalhold (hold uden egen rytter i forsoeget) reagerer med
//      deres FAKTISKE arbejdere i feltet efter deres stance; reaktionen koster
//      dem arbejde. Ingen skjult svaekkelse af staerke ryttere: evne hjaelper
//      altid forsoeget (monotont).
//   4. DANNELSE: kun forsoeg der lykkes kommer med. Ingen fyldning med ryttere
//      hvis forsoeg fejlede; nul etablerede udbrydere er et gyldigt udfald.
//
// REN — ingen IO/Date/Math.random; lodtraekninger kommer ind som funktion.

import type { EffortLevel, RiderRole, RiderState, TeamOrder } from "../types.ts";
import { MORNING_BREAK_FORMATION_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { helperCostMultiplier } from "./teamPlay.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── 1. Tilladelse ─────────────────────────────────────────────────────────────

/**
 * "ordered"     = effektiv udbrudsordre (eksplicit, eller hunterens rolledefault)
 * "spontaneous" = free_role der selv kan vaelge at forsoege (paa normal indsats)
 * "none"        = forsoeger ikke
 */
export type MorningBreakIntent = "ordered" | "spontaneous" | "none";

const ORDER_REQUIRED_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain", "helper"]);

/**
 * Rytterens hensigt for morgenudbruddet.
 *
 * `tryBreak` er den EFFEKTIVE ordre efter rolledefault + etapens overlay
 * (orders/teamOrdersAdapter.ts). `undefined` betyder at der slet ingen
 * effektiv ordre findes for rytteren (fx en startliste uden hold) — saa
 * gaelder rollens egen standard: hunteren forsoeger, de andre ikke.
 */
export function morningBreakIntent(input: {
  role: RiderRole | string | undefined;
  effort: EffortLevel | string | undefined;
  tryBreak: boolean | undefined;
}): MorningBreakIntent {
  const { role, effort, tryBreak } = input;
  if (effort === "grupetto") return "none";
  if (role === "hunter") return tryBreak === false ? "none" : "ordered";
  if (tryBreak === true) return "ordered";
  if (role && ORDER_REQUIRED_ROLES.has(role)) return "none";
  // free_role (og en ukendt rolle, som adapteren selv mapper til free_role):
  // selvstaendig paa normal indsats. save stopper spontane forsoeg; protect er
  // "arbejd for holdet" og all_out er ikke en angrebsordre — begge kraever en
  // effektiv ordre for at forsoege.
  return effort === "normal" || effort === undefined ? "spontaneous" : "none";
}

/** Ejer-matricen som boolean: maa rytteren overhovedet forsoege morgenudbruddet? */
export function canAttemptMorningBreak(input: {
  role: RiderRole | string | undefined;
  effort: EffortLevel | string | undefined;
  tryBreak: boolean | undefined;
}): boolean {
  return morningBreakIntent(input) !== "none";
}

/**
 * Den effektive try_break pr. rytter fra team_tactics-ordrerne, MED skellet
 * mellem fravaer (undefined) og et eksplicit false. mechanics/breakaway.ts's
 * parseBreakawayOrders kollapser til `=== true` (legacy-kontrakten), saa denne
 * parser er orders_gc_v1's egen. Sidste ordre pr. hold vinder (samme regel).
 */
export function effectiveTryBreakByRider(orders: readonly TeamOrder[] | undefined): Map<string, boolean> {
  const lastByTeam = new Map<string, TeamOrder>();
  for (const order of orders ?? []) {
    if (order.kind === "team_tactics") lastByTeam.set(order.team_id, order);
  }
  const out = new Map<string, boolean>();
  for (const teamId of [...lastByTeam.keys()].sort((a, b) => a.localeCompare(b))) {
    const raw = lastByTeam.get(teamId)?.params?.["riders"];
    if (!Array.isArray(raw)) continue;
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const riderId = (r as Record<string, unknown>)["rider_id"];
      const tryBreak = (r as Record<string, unknown>)["try_break"];
      if (typeof riderId === "string" && typeof tryBreak === "boolean") out.set(riderId, tryBreak);
    }
  }
  return out;
}

// ── 2-4. Omstridt dannelse ────────────────────────────────────────────────────

export type FormationStance = "chase" | "neutral" | "let_go";

export type FormationRider = {
  rider_id: string;
  team_id: string | null;
  role: RiderRole | string;
  effort: EffortLevel | string;
  /** Effektiv ordre (undefined = ingen ordre for rytteren). */
  tryBreak: boolean | undefined;
  /** Stoej-fri udbrudsevne i [0, 1] (samme evne-vaegtning som legacy-scoren, uden ordre-boost). */
  strength: number;
  /** Sandsynlighed for at en free_role uden ordre selv forsoeger, [0, 1]. */
  spontaneousChance: number;
  /** Motor (endurance/tempo) i [0, 1] — bruges naar rytteren arbejder imod et forsoeg. */
  engine: number;
  /** Friskhed (team_cp_factor clampet til [0, 1]). */
  freshness: number;
};

export type MorningBreakFormation = {
  /** Ryttere der faktisk forsoegte (sorteret). */
  attempted: string[];
  /** Ryttere der kom afsted (sorteret). Kan vaere tom. */
  escaped: string[];
  /** Forsoegte der ikke kom afsted (sorteret). De bliver i feltet. */
  failed: string[];
  /** Hold hvis ryttere faktisk arbejdede imod forsoeget (sorteret). */
  reactingTeamIds: string[];
  /** rider_id -> CP-andel betalt for forsoeget (én gang, ogsaa ved fiasko). */
  attemptCost: Map<string, number>;
  /** rider_id -> CP-andel betalt for modreaktionen. */
  reactionCost: Map<string, number>;
};

export type FormationRoll = (stream: "attempt" | "success", riderId: string) => number;

const LEADER_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

/**
 * #5978 (KUN orders_gc_v3, ejer-design 5/10: hoej risiko, hoej gevinst):
 * et forsoeg fra en farlig rytter. START-KANDIDATER, kalibreres privat
 * (balance-internals/5978/).
 *  - pressureWeight: fradrag i succes pr. enhed ekstra modstand fra de hold der
 *    har noget at forsvare (hvert holds fulde reaktion = 1, fra dets arbejdere).
 *  - maxPressure: loft over den ekstra modstand.
 *  - attemptCostFactor: et farligt forsoeg koster rytteren dette gange normalprisen.
 */
export const DANGEROUS_ATTEMPT_TUNING = Object.freeze({
  pressureWeight: 0.12,
  maxPressure: 3,
  attemptCostFactor: 2.5,
});

/**
 * #6201 (KUN orders_gc_v3, ejer-beslutning 5/10): udbruddets stoerrelse foelger
 * etapens profil. Trappen (typisk / loft): flad 3-6 / 8 (uaendret), kuperet og
 * rullende 5-9 / 12, bjerg og hoejfjeld 6-12 / 16. START-KANDIDATER, kalibreret
 * privat (balance-internals/6201/).
 *  - maxSize: loftet over dem der kommer afsted.
 *  - room: hvor mange feltet typisk lader gaa; flere forsoeg end det goer det
 *    svaerere for alle (feltet lukker det overfyldte hul), uden at fylde op og
 *    uden at en travl morgen kollapser (skaleringen er multiplikativ).
 *  - successBonus: tillaeg til succes paa dage hvor udbrud har bedre chance
 *    (feltet lader lettere en stoerre gruppe gaa). Ingen garanti.
 * Flad har ingen profil her: dannelsen er praecis som under orders_gc_v2.
 */
export const BREAKAWAY_SIZE_V3_TUNING = Object.freeze({
  byProfile: Object.freeze({
    hilly: Object.freeze({ maxSize: 12, room: 10, successBonus: 0.15 }),
    rolling: Object.freeze({ maxSize: 12, room: 10, successBonus: 0.15 }),
    mountain: Object.freeze({ maxSize: 16, room: 12, successBonus: 0.2 }),
    high_mountain: Object.freeze({ maxSize: 16, room: 12, successBonus: 0.2 }),
  }) as Readonly<Partial<Record<string, Readonly<{ maxSize: number; room: number; successBonus: number }>>>>,
  /** Overfyldning: succes ganges med (room / forsoeg) ^ denne eksponent naar forsoeg > room. */
  roomCrowdWeight: 0.7,
  /** Loftet paa alle andre profiler (samme som orders_gc_v2). */
  defaultMaxSize: 8,
});

export type BreakawaySizeProfile = { maxSize: number; room: number; successBonus: number; roomCrowdWeight: number };

/**
 * #6201 (KUN official_times_v3): ekstra succes-tillaeg oveni profilens trin paa
 * bjerg og hoejfjeld, saa trappens bund holder i felter med mest menneskehold
 * (forsoegene kommer kun fra hunters, frie roller og ordrer, ejer 10/10 valg B).
 * Kalibreret privat (balance-internals/clean-revision/6201/).
 */
export const BREAKAWAY_SIZE_OFFICIAL_V3_EXTRA = Object.freeze({
  successBonusByProfile: Object.freeze({ mountain: 0.15, high_mountain: 0.15 }) as Readonly<Partial<Record<string, number>>>,
  /**
   * #6431 (KUN official_times_v3): flad faar sit eget trin (trappen: typisk 3-6,
   * loft 8). Under orders_gc_v3/official_times_v2 har flad intet trin, og paa
   * Giro-feltet kom hvert tredje flade morgenudbrud kun afsted med 1 mand, selv
   * med 6-9 forsoeg: flaskehalsen var succesraten, ikke antallet af forsoeg.
   * Loftet er uaendret (8). Kalibreret privat (balance-internals/clean-revision/6431/).
   */
  flat: Object.freeze({ maxSize: 8, room: 6, successBonus: 0.2 }),
});

/**
 * #6431 (KUN official_times_v3): profilens trin under den rene revision. Som
 * breakawaySizeProfileV3, men flad har sit eget trin (BREAKAWAY_SIZE_OFFICIAL_V3_EXTRA.flat).
 */
export function breakawaySizeProfileOfficialV3(profileType: string | undefined): BreakawaySizeProfile | null {
  if (profileType === "flat") return { ...BREAKAWAY_SIZE_OFFICIAL_V3_EXTRA.flat, roomCrowdWeight: BREAKAWAY_SIZE_V3_TUNING.roomCrowdWeight };
  return breakawaySizeProfileV3(profileType);
}

/** #6201: profilens trin, eller null (flad og alt andet: uaendret dannelse, loft 8). */
export function breakawaySizeProfileV3(profileType: string | undefined): BreakawaySizeProfile | null {
  const p = profileType ? BREAKAWAY_SIZE_V3_TUNING.byProfile[profileType] : undefined;
  return p ? { ...p, roomCrowdWeight: BREAKAWAY_SIZE_V3_TUNING.roomCrowdWeight } : null;
}

/** #6201: loftet over morgenudbruddet under orders_gc_v3 for profilen. */
export function breakawayMaxSizeV3(profileType: string | undefined): number {
  return breakawaySizeProfileV3(profileType)?.maxSize ?? BREAKAWAY_SIZE_V3_TUNING.defaultMaxSize;
}

/**
 * #6201 (KUN orders_gc_v3): farten foelger antallet. I et udbrud paa 1-3 mand
 * deler faa ryttere foeringerne: gruppen koerer langsommere (hullet vokser
 * langsommere og lukkes hurtigere) og rytterne bliver hurtigere traette (en
 * ekstra pris i team_cp_factor-valutaen pr. koert km-andel). Ingen terning:
 * en ren funktion af antallet. Fra `referenceRiders` mand og op er intet
 * aendret. START-KANDIDATER, kalibreret privat (balance-internals/6201/).
 */
export const SMALL_BREAK_PACE_V3_TUNING = Object.freeze({
  referenceRiders: 4,
  /** Hullets vaekst i lad-gaa-fasen ganges med 1 - growthLoss x underskud. */
  growthLoss: 0.5,
  /** Jagtens lukning ganges med 1 + closingGain x underskud. */
  closingGain: 0.6,
  /** Ekstra pris for en hel etape i front ved fuldt underskud (andel af CP). */
  pullCostFraction: 0.08,
});

export type SmallBreakPace = { growthScale: number; closingScale: number; pullCostFraction: number };

/**
 * #6201: udbruddets fart og pris ud fra antallet af koerende ryttere. Underskud
 * = (reference - antal) / (reference - 1): 1 for en solo, 0 fra referencen.
 * Null naar intet aendres (reference-antallet eller flere, eller tom gruppe).
 */
export function smallBreakPaceV3(riderCount: number, t: typeof SMALL_BREAK_PACE_V3_TUNING = SMALL_BREAK_PACE_V3_TUNING): SmallBreakPace | null {
  const n = Math.floor(riderCount);
  if (!(n >= 1) || n >= t.referenceRiders) return null;
  const deficit = (t.referenceRiders - n) / (t.referenceRiders - 1);
  return {
    growthScale: 1 - t.growthLoss * deficit,
    closingScale: 1 + t.closingGain * deficit,
    pullCostFraction: t.pullCostFraction * deficit,
  };
}

/**
 * #6201: udbrydernes ekstra pris for de km de koerte i et lille udbrud, i samme
 * valuta og med samme gulv/loft som jagtens pris. Null naar intet betales.
 */
export function applySmallBreakPullCost(
  riders: Readonly<Record<string, RiderState>>,
  breakawayRiderIds: readonly string[],
  pace: SmallBreakPace | null,
  kmShare: number,
): Record<string, RiderState> | null {
  if (!pace || !(kmShare > 0) || !(pace.pullCostFraction > 0)) return null;
  const floor = TEAM_PLAY_EXTRA_TUNING.minCpFactor;
  const ceiling = 1 + TEAM_PLAY_EXTRA_TUNING.captainMaxBonusFraction;
  const paid = pace.pullCostFraction * clamp(kmShare, 0, 1);
  let next: Record<string, RiderState> | null = null;
  for (const riderId of [...breakawayRiderIds].sort((a, b) => a.localeCompare(b))) {
    const current = riders[riderId];
    if (!current || current.status !== "racing") continue;
    const factor = Number.isFinite(current.team_cp_factor) ? (current.team_cp_factor as number) : 1;
    next ??= { ...riders };
    next[riderId] = { ...current, team_cp_factor: clamp(factor - paid, floor, ceiling) };
  }
  return next;
}

function emptyFormation(): MorningBreakFormation {
  return { attempted: [], escaped: [], failed: [], reactingTeamIds: [], attemptCost: new Map(), reactionCost: new Map() };
}

/**
 * Omstridt morgenudbrud (orders_gc_v1). Ren og deterministisk givet `roll`.
 *
 *  1. Hensigt pr. rytter (morningBreakIntent). "ordered" forsoeger altid;
 *     "spontaneous" forsoeger hvis roll("attempt") < spontaneousChance.
 *  2. Hvert forsoeg koster attemptCostFraction af egen CP, én gang.
 *  3. Rivalhold = hold med ryttere i feltet men INGEN i forsoeget. Deres
 *     arbejdere (ikke kaptajn/sprint-kaptajn, ikke selv forsoegende) trækker
 *     efter stance: jag fuldt, neutral delvist, lad gaa slet ikke. Et holds
 *     reaktion maettes ved referenceWorkers effektive arbejdere; feltets samlede
 *     modstand er summen, clampet. Arbejdet koster arbejderne CP.
 *  4. Succes pr. forsoeg: grundniveau + evne relativt til feltets snit, minus
 *     modstand og minus overfyldning (flere forsoeg end der er plads til).
 *     Kun succeser kommer med. Er der flere succeser end maxSize, beholdes dem
 *     med stoerst margin (feltet lukker det overfyldte hul) — aldrig fyld.
 *     #6079: et beordret forsoeg faar orderedSuccessBonus oveni, og ved for
 *     mange succeser beholdes beordrede foer spontane (dernaest margin).
 */
export function resolveMorningBreakFormation(input: {
  riders: readonly FormationRider[];
  stances: ReadonlyMap<string, FormationStance>;
  roll: FormationRoll;
  maxSize: number;
  tuning?: typeof MORNING_BREAK_FORMATION_TUNING;
  /**
   * #5978 (KUN orders_gc_v3): de hold for hvem et forsoeg fra rytteren er
   * farligt (gcThreat.formationDangerTeams). Kaldes kun for ryttere der faktisk
   * forsoeger. Udeladt = orders_gc_v1/v2-dannelsen, bit-identisk.
   */
  dangerTeams?: (riderId: string) => readonly string[];
  /** #5578 (KUN official_times_v2): modstandens vaegt mod rytterens farlige forsoeg. Udeladt = DANGEROUS_ATTEMPT_TUNING. */
  dangerPressureWeight?: (riderId: string) => number;
  /**
   * #6201 (KUN orders_gc_v3): profilens trin (breakawaySizeProfileV3). Udeladt
   * = orders_gc_v1/v2-dannelsen, bit-identisk.
   */
  sizeProfile?: BreakawaySizeProfile;
  /**
   * #6201 R3 (KUN official_times_v3): et farligt forsoeg (dangerTeams) taeller
   * ikke med i traengslen (crowd/room) for de andre. Den haarde modstand mod
   * netop ham er uaendret. Udeladt = alle forsoeg taeller (bit-identisk).
   */
  dangerousOutsideRoom?: boolean;
}): MorningBreakFormation {
  const t = input.tuning ?? MORNING_BREAK_FORMATION_TUNING;
  const riders = [...input.riders].sort((a, b) => a.rider_id.localeCompare(b.rider_id));
  if (riders.length === 0) return emptyFormation();

  // 1. Faktiske forsoeg.
  const attempted: FormationRider[] = [];
  const orderedIds = new Set<string>();
  for (const rider of riders) {
    const intent = morningBreakIntent({ role: rider.role, effort: rider.effort, tryBreak: rider.tryBreak });
    if (intent === "none") continue;
    if (intent === "ordered") orderedIds.add(rider.rider_id);
    if (intent === "spontaneous") {
      const chance = clamp(Number.isFinite(rider.spontaneousChance) ? rider.spontaneousChance : 0, 0, 1);
      if (!(input.roll("attempt", rider.rider_id) < chance)) continue;
    }
    attempted.push(rider);
  }
  if (attempted.length === 0) return emptyFormation();
  const attemptedIds = new Set(attempted.map((r) => r.rider_id));

  // #5978 (KUN orders_gc_v3): farlige forsoeg og de hold der har noget at forsvare imod dem.
  const represented = new Set(attempted.map((r) => r.team_id).filter((id): id is string => !!id));
  const dangerTo = new Map<string, string[]>();
  if (input.dangerTeams) {
    for (const rider of attempted) {
      const teams = [...input.dangerTeams(rider.rider_id)]
        .filter((teamId) => !represented.has(teamId) && (input.stances.get(teamId) ?? "neutral") !== "let_go")
        .sort((a, b) => a.localeCompare(b));
      if (teams.length > 0) dangerTo.set(rider.rider_id, teams);
    }
  }
  const defendingTeams = new Set([...dangerTo.values()].flat());

  // 2. Forsoegets pris. #5978: et farligt forsoeg skal koeres haardere og koster mere.
  const attemptCost = new Map<string, number>();
  for (const rider of attempted) {
    const factor = dangerTo.has(rider.rider_id) ? DANGEROUS_ATTEMPT_TUNING.attemptCostFactor : 1;
    attemptCost.set(rider.rider_id, Math.max(0, t.attemptCostFraction) * factor);
  }

  // 3. Rivalholdenes faktiske modreaktion.
  const fieldEngine = riders.reduce((s, r) => s + clamp(r.engine, 0, 1), 0) / riders.length;
  const [engineLo, engineHi] = t.relativeEngineBounds;
  const workersByTeam = new Map<string, Array<{ riderId: string; work: number; pull: number }>>();
  for (const rider of riders) {
    const teamId = rider.team_id;
    if (!teamId || represented.has(teamId) || attemptedIds.has(rider.rider_id)) continue;
    if (LEADER_ROLES.has(String(rider.role))) continue;
    const work = helperCostMultiplier(rider.effort as EffortLevel);
    if (!(work > 0)) continue;
    const relativeEngine = fieldEngine > 0 ? clamp(clamp(rider.engine, 0, 1) / fieldEngine, engineLo, engineHi) : 1;
    const list = workersByTeam.get(teamId) ?? [];
    list.push({ riderId: rider.rider_id, work, pull: work * clamp(rider.freshness, 0, 1) * relativeEngine });
    workersByTeam.set(teamId, list);
  }
  let pressure = 0;
  const reactingTeamIds: string[] = [];
  const reactionWork = new Map<string, number>();
  const teamPull = new Map<string, number>();
  for (const teamId of [...workersByTeam.keys()].sort((a, b) => a.localeCompare(b))) {
    const stance = input.stances.get(teamId) ?? "neutral";
    const share = stance === "chase" ? 1 : stance === "neutral" ? clamp(t.neutralReactionShare, 0, 1) : 0;
    if (!(share > 0)) continue;
    const workers = workersByTeam.get(teamId)!;
    const pull = workers.reduce((s, w) => s + w.pull, 0);
    if (!(pull > 0)) continue;
    pressure += share * clamp(pull / t.referenceWorkers, 0, 1);
    reactingTeamIds.push(teamId);
    // #5978: et hold med noget at forsvare lukker et farligt forsoeg fuldt (som jag).
    const workShare = defendingTeams.has(teamId) ? 1 : share;
    for (const w of workers) reactionWork.set(w.riderId, workShare * w.work);
    if (defendingTeams.has(teamId)) teamPull.set(teamId, clamp(pull / t.referenceWorkers, 0, 1));
  }
  pressure = clamp(pressure, 0, t.maxPressure);
  // #5978: den ekstra modstand mod netop et farligt forsoeg, fra de forsvarende
  // holds faktiske arbejdere (ingen arbejdere = ingen ekstra modstand).
  const dangerPressure = new Map<string, number>();
  for (const [riderId, teams] of dangerTo) {
    const sum = teams.reduce((s, teamId) => s + (teamPull.get(teamId) ?? 0), 0);
    dangerPressure.set(riderId, clamp(sum, 0, DANGEROUS_ATTEMPT_TUNING.maxPressure));
  }

  // Reaktionens pris deles som jagtens (applyChaseCost): flere arbejdere end
  // referencen betaler hver mindre.
  const reactionCost = new Map<string, number>();
  let totalWork = 0;
  for (const w of reactionWork.values()) totalWork += w;
  if (totalWork > 0) {
    const loadShare = Math.min(1, (t.referenceWorkers * Math.max(1, reactingTeamIds.length)) / totalWork);
    for (const [riderId, w] of [...reactionWork.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const paid = Math.max(0, t.oppositionCostFraction * w * loadShare);
      if (paid > 0) reactionCost.set(riderId, paid);
    }
  }

  // 4. Hvem kommer afsted.
  const maxSize = Math.max(0, Math.floor(input.maxSize));
  const fieldStrength = riders.reduce((s, r) => s + clamp(r.strength, 0, 1), 0) / riders.length;
  // #6201 R3 (KUN official_times_v3): farlige forsoeg fylder ikke i traengslen.
  const crowdCount = input.dangerousOutsideRoom ? attempted.filter((r) => !dangerTo.has(r.rider_id)).length : attempted.length;
  const crowd = maxSize > 0 ? Math.max(0, crowdCount - maxSize) / maxSize : 0;
  const [pLo, pHi] = t.successBounds;
  const successes: Array<{ riderId: string; margin: number; ordered: boolean }> = [];
  const orderedBonus = Math.max(0, Number.isFinite(t.orderedSuccessBonus) ? t.orderedSuccessBonus : 0);
  // #6201: profilens tillaeg, og et overfyldt forsoeg (flere end feltet typisk
  // lader gaa) goer det svaerere for alle. Skaleringen er multiplikativ, saa
  // en travl morgen aldrig kollapser til 0-1 mand (#5955-regressionen).
  const size = input.sizeProfile;
  const profileShift = size ? size.successBonus : 0;
  const crowdScale = size && crowdCount > size.room ? Math.pow(size.room / crowdCount, size.roomCrowdWeight) : 1;
  for (const rider of attempted) {
    const ordered = orderedIds.has(rider.rider_id);
    const raw = profileShift + t.successBase
      + (ordered ? orderedBonus : 0)
      + t.successStrengthGain * (clamp(rider.strength, 0, 1) - fieldStrength)
      - t.successPressureWeight * pressure
      - t.successCrowdWeight * crowd;
    const danger = dangerPressure.get(rider.rider_id);
    const p = clamp(danger === undefined ? raw : raw - (input.dangerPressureWeight?.(rider.rider_id) ?? DANGEROUS_ATTEMPT_TUNING.pressureWeight) * danger, pLo, pHi) * crowdScale;
    const r = input.roll("success", rider.rider_id);
    if (r < p) successes.push({ riderId: rider.rider_id, margin: p - r, ordered });
  }
  // #6079: ved flere succeser end maxSize beholdes beordrede foer spontane,
  // derefter stoerst margin.
  successes.sort((a, b) => Number(b.ordered) - Number(a.ordered) || b.margin - a.margin || a.riderId.localeCompare(b.riderId));
  const escaped = successes.slice(0, maxSize).map((s) => s.riderId).sort((a, b) => a.localeCompare(b));
  const escapedSet = new Set(escaped);
  const failed = [...attemptedIds].filter((id) => !escapedSet.has(id)).sort((a, b) => a.localeCompare(b));

  return {
    attempted: [...attemptedIds].sort((a, b) => a.localeCompare(b)),
    escaped,
    failed,
    reactingTeamIds,
    attemptCost,
    reactionCost,
  };
}
