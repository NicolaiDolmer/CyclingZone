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

import type { EffortLevel, RiderRole, TeamOrder } from "../types.ts";
import { MORNING_BREAK_FORMATION_TUNING } from "../tuning.ts";
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
  const crowd = maxSize > 0 ? Math.max(0, attempted.length - maxSize) / maxSize : 0;
  const [pLo, pHi] = t.successBounds;
  const successes: Array<{ riderId: string; margin: number; ordered: boolean }> = [];
  const orderedBonus = Math.max(0, Number.isFinite(t.orderedSuccessBonus) ? t.orderedSuccessBonus : 0);
  for (const rider of attempted) {
    const ordered = orderedIds.has(rider.rider_id);
    const raw = t.successBase
      + (ordered ? orderedBonus : 0)
      + t.successStrengthGain * (clamp(rider.strength, 0, 1) - fieldStrength)
      - t.successPressureWeight * pressure
      - t.successCrowdWeight * crowd;
    const danger = dangerPressure.get(rider.rider_id);
    const p = clamp(danger === undefined ? raw : raw - DANGEROUS_ATTEMPT_TUNING.pressureWeight * danger, pLo, pHi);
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
