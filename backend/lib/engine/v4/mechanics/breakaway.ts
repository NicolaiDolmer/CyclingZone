import { GROUP_CLOCK_CONTACT_EPSILON } from "../groupClock.ts";
import { findChaseGroup, isBreakawayPiece, rejoinBreakawayPiece, withBreakawayDrops } from "./chaseGroup.ts";
import { pursuitContactKm } from "../exactPlace.ts";
// backend/lib/engine/v4/mechanics/breakaway.ts
// Race Engine v4 F3 (#4030, #3855): M5 - udbrud v2, jagt-interesse-modellen
// fra #2416, foldet ind som v4's udbrudsmekanik (mor-spec §3.3/§4 M5).
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §3.3/§4 M5. Ordre-kontrakt: docs/superpowers/specs/2026-08-21-race-tactics-
// orders-v1-design.md (T3: breakaway_stance + try_break, bounded).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. rng bruges
// KUN via ctx.rngFor (seedet, per-rytter-hash). Muterer aldrig input-state.
//
// ARKITEKTUR-NOTE:
//
//  1. WIRET 3/9 (#4615): `SegmentHookContext` baerer nu `orders: readonly
//     TeamOrder[]` (den AABNE konvolut fra types.ts), `MechanicHooks` har et
//     `breakaway`-felt, og `index.ts`'s LIVE_MECHANIC_HOOKS kalder dette hook
//     paa HVERT segment — efter climb/descent, foer finale. Ordrerne laeses via
//     `parseBreakawayOrders` (kind === "team_tactics"), samme moenster som
//     `mechanics/leadout.ts`'s `parseLeadoutOrders` (kind === "leadout").
//  2. `TeamOrder` er BEVIDST stadig konvolutten og ikke T3-formen: rolle-vs-
//     ordre-modsigelsen (#4246, `hunter` vs `try_break`) er ejer-gated og ikke
//     afgjort. `BreakawayTeamOrder` nedenfor er specens T3-form 1:1; naar #4246
//     er afgjort og konvolutten fryses, kollapser parseren til identitet.
//  3. HOLDSPECIFIK JAGT (#5570, ejer 23/9: lag 1 i "Holdmoedet"). Foer tog
//     `stanceSignal` gennemsnittet over ALLE hold med en ordre, og
//     teamOrdersAdapter giver hvert hold paa startlisten en ordre (default
//     neutral) — én spillers "jag" flyttede derfor signalet med 1/N, og jagten
//     var gratis. `Entrant.team_id` findes nu (M16), saa `teamChasePlan` goer
//     det holdvist: et holds "jag" virker GENNEM holdets egne ryttere i
//     jagtgruppen (antal, evne relativt til feltet, effort, og hvor meget de
//     allerede har brugt), neutrale hold udvander intet, og "lad gaa" traekker
//     holdets andel af jagtgruppen ud af den naturlige jagt. Jagten koster
//     jaegerne hold-CP (`team_cp_factor`, samme valuta og samme gulv/loft som
//     M16's holdspil) — se `applyChaseCost`. `try_break` laeses stadig direkte
//     fra `order.riders[].rider_id`. En startliste uden `team_id` har ingen
//     hold at jage med: signalet er 0 og ingen betaler (golden fixtures uaendret).
//
// MEKANIK (mor-spec §3.3 + §4 M5 + #2416):
//  - Formation: forsoeges PRAECIS ÉN gang pr. etape, paa det foerste segment
//    (segmentIndex === 0). Kandidat-score pr. rytter = vaegtet
//    aggression/endurance/tempo, `try_break` OEGER scoren BOUNDED (garanterer
//    ALDRIG medlemskab — score->sandsynlighed, seeded rng-rul pr. rytter).
//    Gruppestoerrelsen er BOUNDED ([MIN,MAX]) via deterministisk score-baseret
//    fyld/trim naar antallet af rul falder uden for baandet — se
//    `selectBreakawayRiders` for det fulde, testbare kontrakt-udkast.
//  - Jagt-interesse (#2416): hvert efterfoelgende segment (mens en udbruds-
//    gruppe eksisterer og ikke er indhentet) beregnes en NETTO jagt-fordel af
//    sprinterhold-interesse (finale-type-vaegtet feltets kollektive sprint-evne)
//    + GC-trussel-proxy (udbrydernes kollektive climbing/tempo/tt — F2 har intet
//    reelt GC, jf. `virtual_gc`-kommentaren i types.ts) + sen-etape-uro, MINUS
//    udbruddets egen motorstyrke (kollektiv endurance/tempo + antal-bonus).
//    Hold-ordrers `breakaway_stance` justerer nettofordelen BOUNDED (chase
//    forstaerker, let_go daemper — clamp forhindrer fortegns-omvending), nu
//    holdspecifikt og med en pris (punkt 3 ovenfor, #5570).
//  - Fanget: naar den akkumulerede lukning bringer jagt-gruppens gap under
//    `tuning.groups.mergeThresholdSeconds`, emitteres `breakaway_caught` —
//    den FAKTISKE sammensmeltning sker af segmentLoop's egen `mergeGroups`-kald
//    (som koerer LIGE EFTER hooks, samme moenster som descent.ts/climbSelection.ts).
//  - Overlevet: hvis udbruddet stadig eksisterer som egen gruppe paa etapens
//    SIDSTE segment, emitteres `breakaway_survived` (finale.ts afgoer derefter
//    om forspringet baeres helt i maal eller indhentes i selve finalen).

import { bookFinishDescentClosure, finishDescentRemainingCapSeconds, timeModelTuningFor } from "./timeModel.ts";
import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  ProfileType,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  TeamOrder,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { fieldFinaleTypeBehindBreakaway, isBunchCatchRoute } from "../finale.ts";
import { BREAKAWAY_EXTRA_TUNING, EFFORT_GAIN_EXTRA_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { helperCostMultiplier } from "./teamPlay.ts";
import {
  applySmallBreakPullCost,
  breakawayMaxSizeV3,
  breakawaySizeProfileV3,
  DANGEROUS_ATTEMPT_TUNING,
  effectiveTryBreakByRider,
  resolveMorningBreakFormation,
  smallBreakPaceV3,
  type FormationRider,
  type FormationStance,
} from "./breakawayPermission.ts";
import {
  assessGcThreat,
  formationDangerTeams,
  normalizeGcContext,
  oneDayProtectedRider,
  protectedRiderForTeam,
  type DangerModel,
  type GcDangerTuning,
  type GcThreat,
} from "./gcThreat.ts";
import {
  advanceTeamReaction,
  availableReactionWorkers,
  capPreventiveIntensity,
  brakedLetGoGrowth,
  letGoBrake,
  letGoBrakingTeams,
  LET_GO_BRAKE_TUNING,
  planTeamReaction,
  type ReactionStance,
  type TeamReactionPlan,
} from "./teamChaseReaction.ts";
import type { EngineTuning, GcContext, RouteV2, TeamReactionState } from "../types.ts";
import { mountainSelectionKnobsFor, phaseChaseClosingScale, phaseLetGoMaxGapScale } from "./mountainSelection.ts";
import { rollingLetGoBalance } from "./rollingBreakaway.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// ── Ordre-kontrakt (T3, tactics-orders-v1-design.md) ─────────────────────────
// Se filens toppe-kommentar punkt 2: matcher specens form 1:1 og parses ud af
// types.ts's aabne TeamOrder-konvolut.

export type BreakawayStance = "chase" | "neutral" | "let_go";

export type BreakawayTeamOrder = {
  team_id: string;
  breakaway_stance: BreakawayStance;
  riders: Array<{ rider_id: string; try_break: boolean }>;
};

/** Konvolut-`kind` M5 fortolker (orders/teamOrdersAdapter.ts's toEngineTeamOrder skriver den). */
export const TEAM_TACTICS_ORDER_KIND = "team_tactics";

const VALID_STANCES: ReadonlySet<string> = new Set(["chase", "neutral", "let_go"]);

/**
 * Udtraekker M5's T3-ordrer fra den aabne `TeamOrder`-konvolut (samme moenster
 * som leadout.ts's parseLeadoutOrders). Defensiv mod drift: ukendt stance
 * falder til "neutral", ikke-arrays til tom rytterliste, ryttere uden
 * `rider_id` droppes — en korrupt ordre maa aldrig vaelte en simulering.
 * Ét hold kan kun have ÉN team_tactics-ordre pr. etape; ved dubletter vinder
 * den sidste (array-raekkefolge, deterministisk).
 */
export function parseBreakawayOrders(orders: readonly TeamOrder[] | undefined): BreakawayTeamOrder[] {
  if (!orders || orders.length === 0) return [];
  const byTeam = new Map<string, BreakawayTeamOrder>();
  for (const order of orders) {
    if (order.kind !== TEAM_TACTICS_ORDER_KIND) continue;
    const params = order.params ?? {};
    const rawStance = params["breakaway_stance"];
    const stance: BreakawayStance = VALID_STANCES.has(rawStance as string)
      ? (rawStance as BreakawayStance)
      : "neutral";
    const rawRiders = Array.isArray(params["riders"]) ? (params["riders"] as unknown[]) : [];
    const riders = rawRiders
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .filter((r) => typeof r["rider_id"] === "string")
      .map((r) => ({ rider_id: r["rider_id"] as string, try_break: r["try_break"] === true }));
    byTeam.set(order.team_id, { team_id: order.team_id, breakaway_stance: stance, riders });
  }
  return [...byTeam.values()].sort((a, b) => a.team_id.localeCompare(b.team_id));
}

export type BreakawayHookContext = SegmentHookContext;

export type BreakawayHook = (state: EngineState, ctx: BreakawayHookContext) => SegmentHookResult;

// ── Formation (lokale konstanter — samme "intern implementeringsdetalje"-
// praecedens som climbSelection.ts's GRADIENT_NORM_PCT: kun de reelt kali-
// brerbare haandtag ligger i tuning.ts's BREAKAWAY_EXTRA_TUNING) ──────────────

const FORMATION_SEGMENT_INDEX = 0;
const MIN_BREAKAWAY_SIZE = 2;
const MAX_BREAKAWAY_SIZE = 8;
const INITIAL_GAP_SECONDS = 25; // hovedstart ved formation (reelle udbrud har typisk allerede et forspring km 1)
// #5812: udbruddet gaar kort inde i foerste segment, ikke paa dets to_km. Paa en
// rute hvor foerste segment er langt (en flad etape skrevet som ét segment)
// ville "udbrud gaar" ellers staa paa maalstregen.
const FORMATION_WINDOW_KM = 12;

/** Km hvor udbruddet dannes paa formations-segmentet (#5812). Eksporteret for kontrakt-tests. */
export function formationKmFor(segment: { from_km: number; to_km: number }): number {
  return round2(Math.min(segment.to_km, segment.from_km + FORMATION_WINDOW_KM));
}

const JOIN_SCORE_WEIGHTS: Readonly<Record<"aggression" | "endurance" | "tempo", number>> = {
  aggression: 0.45,
  endurance: 0.3,
  tempo: 0.25,
};
const TRY_BREAK_SCORE_BOOST = 0.12; // bounded additiv boost — "oeger sandsynligheden, garanterer ALDRIG" (T3)
const JOIN_PROBABILITY_BASE = 0.05;
const JOIN_PROBABILITY_SCORE_GAIN = 0.35;
const JOIN_PROBABILITY_BOUNDS: readonly [number, number] = [0.02, 0.5];

type JoinCandidate = { riderId: string; score: number; wantsToJoin: boolean };

/**
 * Kandidat-score (stoej-fri): vaegtet aggression/endurance/tempo + bounded
 * try_break-boost + (#5580) indsats-plus for en leder paa `protect`.
 */
export function computeJoinScore(
  abilities: Record<AbilityKey, number>,
  tryBreak: boolean,
  effortBoost = 0,
): number {
  const base =
    JOIN_SCORE_WEIGHTS.aggression * normAbility(abilities.aggression) +
    JOIN_SCORE_WEIGHTS.endurance * normAbility(abilities.endurance) +
    JOIN_SCORE_WEIGHTS.tempo * normAbility(abilities.tempo);
  const boost = Number.isFinite(effortBoost) ? Math.max(0, effortBoost) : 0;
  return clamp(base + (tryBreak ? TRY_BREAK_SCORE_BOOST : 0) + boost, 0, 1);
}

/** Roller der er holdets leder (modtager arbejdet) og dermed kan "angribe" paa protect. */
const LEADER_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

/**
 * #5580 (M1 punkt 3, ejer 23/9 valg 1c: `protect` = "arbejd eller angrib"):
 * en kaptajn/sprint-kaptajn paa `protect` foelger angreb, dvs. et lille plus i
 * join-scoren. For hjaelpere, jaegere og fri rolle er plusset ALTID 0: for dem
 * betyder `protect` at arbejde for holdet. Mindre end try_break-boostet (laast
 * af test), saa en eksplicit ordre vejer tungere end indsatstrinnet.
 *
 * Eksporteret for direkte kontrakt-tests.
 */
export function effortJoinBoost(
  role: string | undefined,
  effort: string | undefined,
  boost: number = EFFORT_GAIN_EXTRA_TUNING.leaderProtectJoinBoost,
): number {
  if (effort !== "protect" || !role || !LEADER_ROLES.has(role)) return 0;
  return Number.isFinite(boost) ? Math.max(0, boost) : 0;
}

/** try_break-boostet, eksporteret saa testen kan laase at indsats-plusset er mindre. */
export const TRY_BREAK_JOIN_SCORE_BOOST = TRY_BREAK_SCORE_BOOST;

/** Score -> sandsynlighed, bounded [0.02, 0.5] — aldrig 0 (fuldstaendig umulig) eller 1 (garanteret). */
export function joinProbability(score: number): number {
  return clamp(JOIN_PROBABILITY_BASE + JOIN_PROBABILITY_SCORE_GAIN * score, ...JOIN_PROBABILITY_BOUNDS);
}

/**
 * Udbruds-udvaelgelse (eksporteret for direkte kontrakt-tests). Rene input
 * (candidateIds, score-lookup, rng-lookup) -> deterministisk udvalgt delmaengde,
 * BOUNDED til [MIN_BREAKAWAY_SIZE, MAX_BREAKAWAY_SIZE] naar feltet er stort nok.
 * Rul afgoer FOERST hvem der "vil med" (score-drevet sandsynlighed, seeded pr.
 * rytter); et deterministisk score-sorteret fyld/trim retter derefter KUN
 * stoerrelsen til baandet — try_break-flaget paavirker ALDRIG fyld/trim-trinnet
 * (kun selve join-rullet), saa flaget aldrig kan "garantere" medlemskab.
 */
export function selectBreakawayRiders(
  candidates: JoinCandidate[],
  minSize: number = MIN_BREAKAWAY_SIZE,
  maxSize: number = MAX_BREAKAWAY_SIZE,
): string[] {
  const bySeed = candidates.filter((c) => c.wantsToJoin).map((c) => c.riderId);
  const scoreDesc = [...candidates].sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId));

  let selected = new Set(bySeed);
  if (selected.size < Math.min(minSize, candidates.length)) {
    for (const c of scoreDesc) {
      if (selected.size >= Math.min(minSize, candidates.length)) break;
      selected.add(c.riderId);
    }
  } else if (selected.size > maxSize) {
    const kept = scoreDesc.filter((c) => selected.has(c.riderId)).slice(0, maxSize);
    selected = new Set(kept.map((c) => c.riderId));
  }
  return [...selected].sort();
}

/**
 * Formations-forsoeg (kaldes kun paa FORMATION_SEGMENT_INDEX). Behandler den
 * (typisk ene) start-peloton uafhaengigt af antal grupper — hvis flere grupper
 * allerede eksisterer (usaedvanligt paa segment 0), forsoeges formation KUN i
 * den stoerste (peloton-lignende) gruppe.
 */
function attemptFormation(
  state: EngineState,
  ctx: BreakawayHookContext,
  tryBreakRiderIds: ReadonlySet<string>,
): SegmentHookResult {
  const events: TimelineEvent[] = [];
  const sourceGroup = [...state.groups].sort((a, b) => b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id))[0];
  if (!sourceGroup || sourceGroup.rider_ids.length < MIN_BREAKAWAY_SIZE + 1) return { state, events };

  const candidates: JoinCandidate[] = [];
  for (const riderId of sourceGroup.rider_ids) {
    const entrant = ctx.entrants[riderId];
    const riderState = state.riders[riderId];
    if (!entrant || !riderState || riderState.status !== "racing") continue;
    // M12-wiring (#4632, ejer-beslutning 6/9): en rytter i grupettoen forsoeger
    // ALDRIG at komme med i udbruddet. Det er ikke en sandsynligheds-daempning
    // men en udelukkelse af KANDIDAT-listen: "grupetto" betyder ordret at
    // rytteren har opgivet dagen og koerer med for at komme hjem inden for
    // tidsgraensen (M15), og et udbrud er det stik modsatte valg. Udelukkelsen
    // sker FOER rullet, saa den hverken bruger eller forbruger rng-stroemmen
    // for rytteren — determinismen for de OEVRIGE ryttere er dermed uaendret
    // (hver rytters rul er seedet paa hans eget rider_id, ikke paa et index).
    if (entrant.effort === "grupetto") continue;
    const tryBreak = tryBreakRiderIds.has(riderId);
    const score = computeJoinScore(entrant.abilities, tryBreak, effortJoinBoost(entrant.role, entrant.effort));
    const p = joinProbability(score);
    const roll = ctx.rngFor("breakaway_join", riderId)();
    candidates.push({ riderId, score, wantsToJoin: roll < p });
  }
  if (candidates.length < MIN_BREAKAWAY_SIZE + 1) return { state, events };

  const maxSize = Math.min(MAX_BREAKAWAY_SIZE, candidates.length - 1);
  const selected = selectBreakawayRiders(candidates, MIN_BREAKAWAY_SIZE, maxSize);
  if (selected.length === 0) return { state, events };

  const newGroupId = makeGroupId("breakaway", ctx.segmentIndex * 1000);
  const groups = splitGroup(state.groups, sourceGroup.id, selected, {
    id: newGroupId,
    kind: "breakaway",
    gapSecondsDelta: -INITIAL_GAP_SECONDS,
    // #5578: dagens udbrud. Udbrudsankeret taeller kun sejre herfra.
    origin: "breakaway",
  });

  events.push({
    km: formationKmFor(ctx.segment),
    type: "breakaway_formed",
    params: { group_id: newGroupId, rider_ids: [...selected] },
  });

  return { state: { ...state, groups }, events };
}

/**
 * #5955 (orders_gc_v1): ordrestyret, omstridt morgenudbrud. Samme kildegruppe
 * og samme udbrudsgruppe-form som legacy (`attemptFormation`), men hvem der
 * kommer afsted afgoeres af mechanics/breakawayPermission.ts: tilladelse ->
 * forsoeg med pris -> rivalholdenes faktiske modreaktion -> eventuel dannelse.
 * Ingen fyldning: lykkes ingen forsoeg, er der intet morgenudbrud.
 *
 * Events: `breakaway_attempt` (hvem forsoegte, hvem kom afsted, hvilke hold
 * reagerede — ingen sandsynligheder/vaegte, fog-gate #1791) og, kun ved mindst
 * én udbryder, `breakaway_formed` i samme form som legacy.
 */
function attemptOrderedFormation(state: EngineState, ctx: BreakawayHookContext): SegmentHookResult {
  const events: TimelineEvent[] = [];
  const sourceGroup = [...state.groups].sort((a, b) => b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id))[0];
  if (!sourceGroup) return { state, events };

  const tryBreakByRider = effectiveTryBreakByRider(ctx.orders);
  const formationRiders: FormationRider[] = [];
  for (const riderId of sourceGroup.rider_ids) {
    const entrant = ctx.entrants[riderId];
    const riderState = state.riders[riderId];
    if (!entrant || !riderState || riderState.status !== "racing") continue;
    const strength = computeJoinScore(entrant.abilities, false, 0);
    const factor = riderState.team_cp_factor;
    formationRiders.push({
      rider_id: riderId,
      team_id: teamIdOf(entrant),
      role: entrant.role,
      effort: entrant.effort,
      tryBreak: tryBreakByRider.get(riderId),
      strength,
      spontaneousChance: joinProbability(strength),
      engine: collectiveAbility([riderId], ctx.entrants, CHASE_ENGINE_KEYS),
      freshness: clamp(Number.isFinite(factor) ? (factor as number) : 1, 0, 1),
    });
  }
  // Et udbrud kraever et felt at koere fra.
  if (formationRiders.length < 2) return { state, events };

  const stances = new Map<string, FormationStance>();
  for (const order of parseBreakawayOrders(ctx.orders)) stances.set(order.team_id, order.breakaway_stance);

  // #5978 (KUN orders_gc_v3): et forsoeg fra en farlig rytter moeder haardere
  // modreaktion fra de hold der har noget at forsvare (gcThreat.formationDangerTeams).
  const gcContext = ctx.ordersGcV3 === true ? normalizeGcContext(ctx.gcContext) : null;
  const dangerTeams = gcContext && (gcContext.status === "standings" || gcContext.status === "one_day")
    ? formationDangerLookup(state, ctx, gcContext, sourceGroup)
    : undefined;
  const formation = resolveMorningBreakFormation({
    riders: formationRiders,
    stances,
    roll: (stream, riderId) => ctx.rngFor(stream === "attempt" ? "breakaway_attempt" : "breakaway_attempt_success", riderId)(),
    maxSize: Math.min(ctx.ordersGcV3 === true ? breakawayMaxSizeV3(ctx.route.profile_type) : MAX_BREAKAWAY_SIZE, formationRiders.length - 1),
    ...(dangerTeams ? { dangerTeams } : {}),
    // #5578 robust (KUN official_times_v2): klassementets forreste moeder den haardeste modstand.
    ...(dangerTeams && gcContext ? rankedFormationPressure(gcContext, timeModelTuningFor(ctx).gcDanger) : {}),
    ...(ctx.ordersGcV3 === true && breakawaySizeProfileV3(ctx.route.profile_type) ? { sizeProfile: breakawaySizeProfileV3(ctx.route.profile_type)! } : {}), // #6201
  });
  if (formation.attempted.length === 0) return { state, events };

  // Pris: forsoeget (én gang, ogsaa ved fiasko) og modreaktionen, i samme
  // team_cp_factor-valuta og med samme gulv/loft som M16/jagten.
  const floor = TEAM_PLAY_EXTRA_TUNING.minCpFactor;
  const ceiling = 1 + TEAM_PLAY_EXTRA_TUNING.captainMaxBonusFraction;
  let riders: Record<string, RiderState> | null = null;
  for (const costs of [formation.attemptCost, formation.reactionCost]) {
    for (const [riderId, paid] of [...costs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const current = (riders ?? state.riders)[riderId];
      if (!current || !(paid > 0)) continue;
      const factor = Number.isFinite(current.team_cp_factor) ? (current.team_cp_factor as number) : 1;
      riders ??= { ...state.riders };
      riders[riderId] = { ...current, team_cp_factor: clamp(factor - paid, floor, ceiling) };
    }
  }

  const km = formationKmFor(ctx.segment);
  events.push({
    km,
    type: "breakaway_attempt",
    params: {
      rider_ids: [...formation.attempted],
      escaped_rider_ids: [...formation.escaped],
      reacting_team_ids: [...formation.reactingTeamIds],
    },
  });

  let groups = state.groups;
  if (formation.escaped.length > 0) {
    const newGroupId = makeGroupId("breakaway", ctx.segmentIndex * 1000);
    groups = splitGroup(state.groups, sourceGroup.id, formation.escaped, {
      id: newGroupId,
      kind: "breakaway",
      gapSecondsDelta: -INITIAL_GAP_SECONDS,
      origin: "breakaway",
    });
    events.push({ km, type: "breakaway_formed", params: { group_id: newGroupId, rider_ids: [...formation.escaped] } });
  }

  return { state: { ...state, groups, ...(riders ? { riders } : {}) }, events };
}

/**
 * #5978 (KUN orders_gc_v3): for hvilke hold er et forsoeg fra rytteren farligt?
 * Vurderet fra kildegruppen uden forspring, paa hele dagens rute.
 */
function formationDangerLookup(
  state: EngineState,
  ctx: BreakawayHookContext,
  gcContext: GcContext,
  sourceGroup: RaceGroup,
): ((riderId: string) => readonly string[]) | undefined {
  const dangerModel = dangerModelFor(ctx, gcContext);
  if (gcContext.status === "one_day" && !dangerModel.routeDemand) return undefined;
  const racingRiderIds = new Set(Object.values(state.riders).filter((r) => r.status === "racing").map((r) => r.rider_id));
  const teamIds = [...new Set(sourceGroup.rider_ids.map((id) => teamIdOf(ctx.entrants[id])).filter((id): id is string => !!id))];
  return (riderId: string) => formationDangerTeams({
    gcContext, riderId, teamIds, groups: [sourceGroup], entrants: ctx.entrants, route: ctx.route,
    km: ctx.route.segments[0]?.from_km ?? 0, racingRiderIds, dangerModel,
  });
}

/**
 * #5578 robust (KUN official_times_v2): et forsoeg fra en af klassementets
 * forreste (rang <= rivalRankAlways) moeder de forsvarende holds modstand med
 * sin egen vaegt; alle andre farlige forsoeg som under orders_gc_v3. Uden
 * knappen (orders_gc_v3 og aeldre): intet (bit-identisk).
 */
export function rankedFormationPressure(gcContext: GcContext, danger: GcDangerTuning | null): { dangerPressureWeight?: (riderId: string) => number } {
  const weight = danger?.formationRankedPressureWeight;
  const rankLimit = danger?.rivalRankAlways;
  if (typeof weight !== "number" || typeof rankLimit !== "number" || gcContext.status !== "standings") return {};
  const ranked = new Set(gcContext.standings.filter((s) => s.rank <= rankLimit).map((s) => s.rider_id));
  return { dangerPressureWeight: (riderId) => (ranked.has(riderId) ? weight : DANGEROUS_ATTEMPT_TUNING.pressureWeight) };
}

// ── Jagt-interesse (#2416) ─────────────────────────────────────────────────────

const CHASE_ENGINE_KEYS: AbilityKey[] = ["endurance", "tempo"];
const GC_THREAT_KEYS: AbilityKey[] = ["climbing", "tempo", "time_trial"];
/**
 * Feltets evne-reference (#4707) maales paa PRAECIS de evner jagt-modellens
 * evne-afledte led selv laeser (sprint + GC-trussel + motor), saa referencen
 * og leddene skalerer med samme faktor naar feltet bliver staerkere/svagere.
 */
const CHASE_REFERENCE_KEYS: AbilityKey[] = ["sprint", "climbing", "tempo", "time_trial", "endurance"];

function collectiveAbility(riderIds: string[], entrants: Readonly<Record<string, Entrant>>, keys: AbilityKey[]): number {
  if (riderIds.length === 0 || keys.length === 0) return 0;
  let total = 0;
  let n = 0;
  for (const riderId of riderIds) {
    const abilities = entrants[riderId]?.abilities;
    if (!abilities) continue;
    let s = 0;
    for (const key of keys) s += normAbility(abilities[key]);
    total += s / keys.length;
    n++;
  }
  return n > 0 ? total / n : 0;
}

// ── Holdspecifik jagt (#5570) ─────────────────────────────────────────────────
// Lokale START-KANDIDATER (samme "intern implementeringsdetalje"-praecedens som
// formations-konstanterne ovenfor). De er reelt kalibrerbare og hoerer paa sigt
// i tuning.ts's BREAKAWAY_EXTRA_TUNING; de bor her, fordi denne aendring kun
// ejer breakaway.ts (boelge-lane), og flyttes naar tuning.ts alligevel roeres.
const TEAM_CHASE = {
  // Effektive jagt-ryttere (fuld effort, friske, feltets gennemsnits-motor) der
  // giver ét hold dets FULDE bidrag. Flere end det flytter ikke signalet mere,
  // men deler prisen (se applyChaseCost).
  referenceChasers: 4,
  // Ét holds maks. bidrag til stance-signalet i [-1, 1]. Under 1 med vilje:
  // ét hold alene kan aldrig naa multiplikatorens loft — to hold i fuld jagt kan.
  maxTeamSignal: 0.5,
  // Rytterens motor (endurance/tempo) relativt til feltets gennemsnit — clampet,
  // saa én staerk rouleur ikke er et helt hold, og en svag stadig taeller.
  relativeEngineBounds: [0.5, 1.5] as readonly [number, number],
  // Prisen for at jage en HEL etape alene, som andel af rytterens egen CP —
  // samme valuta som M16's helperCostFraction*. Betales pr. km-andel, kun
  // mens der faktisk jages, og deles naar flere hold jager.
  chaseCostFraction: 0.15,
};

// ── #5955 (#5984 Task 3+6, KUN orders_gc_v1): udbrud/jagt-balance ───────────
// Under orders_gc_v1 bestaar morgenudbruddet af de ryttere der FAKTISK fik en
// udbrudsordre (typisk jaegere og frie roller) — ikke laengere af kaptajner der
// blev fyldt ind som under legacy. Den lad-gaa-model legacy er kalibreret paa,
// forudsatte de staerke ryttere i udbruddet; med de faktiske udbrydere blev
// udbruddet hentet paa naesten hver etape. Feltet giver derfor et ikke-farligt
// udbrud mere plads under denne regel-revision, pr. profil:
//  - maxGapFactor: ganges paa letGoMaxGapSeconds (hvor meget feltet giver).
//  - letGoRateFactor: ganges paa letGoSecondsPerKm (hvor hurtigt hullet
//    vokser). Paa bjergetaper skal hullet vaere bygget foer foerste stigning.
// Jagt-modellen, jagt-gulvet og klatre-selektionen er uaendrede. Legacy laeser
// intet herfra (golden fixtures uaendrede). Lokale kalibrerings-kandidater (samme
// praecedens som TEAM_CHASE ovenfor); tallene og maalingen ligger i den private
// kalibreringsrapport, kvalitetsmaalene er ejer-gated (#5984 Task 6).
// Genkalibreret 2/10 (#5955) oven paa GC-reaktionen (#6033) og GC-bremsen:
// med reaktionen taendt holdt udbruddet langt sjaeldnere end under legacy, saa
// pladsen og vaeksten er haevet (ogsaa paa rullende/kuperet terraen), indtil
// overlevelsen pr. profil ligger paa legacy-niveau. Reaktionen og bremsen
// rammer stadig de farlige udbrud (de kan holde hullet nede inden for budgettet).
const ORDERS_GC_V1_LET_GO: Readonly<{
  maxGapFactorByProfile: Readonly<Partial<Record<ProfileType, number>>>;
  letGoRateFactorByProfile: Readonly<Partial<Record<ProfileType, number>>>;
}> = Object.freeze({
  maxGapFactorByProfile: Object.freeze({ flat: 1.9, rolling: 4, hilly: 2.4, mountain: 2.7, high_mountain: 5.5 }),
  letGoRateFactorByProfile: Object.freeze({ rolling: 2, hilly: 1.3, mountain: 2.5, high_mountain: 3.5 }),
});

// #6074 (KUN orders_gc_v1): loft paa det ekstra lad-gaa-forspring, naar mange
// hold i jagtgruppen SAMTIDIG lader gaa. Faktorerne ovenfor er kalibreret paa
// et felt hvor en del af holdene lader gaa; lader naesten alle det gaa, stabler
// den ekstra plads oven i et felt der slet ikke jager, og udbruddet holder langt
// oftere end under legacy. Over `fromShare` (andel af jagtgruppens hold med
// "let_go") trappes det ekstra (faktor - 1) lineaert ned til `floorAtAll` af sig
// selv, naar alle hold lader gaa. Under taersklen er intet aendret.
const ORDERS_GC_V1_LET_GO_CROWD: Readonly<{ fromShare: number; floorAtAll: number }> = Object.freeze({
  fromShare: 0.8,
  floorAtAll: 0.45,
});

/**
 * #6074: daempning [floorAtAll, 1] af det ekstra lad-gaa-forspring ud fra
 * andelen af hold der lader gaa. 1 = ingen daempning. Monotont ikke-stigende
 * i andelen. Eksporteret for kontrakt-tests.
 */
export function letGoCrowdDamping(letGoShare: number): number {
  const { fromShare, floorAtAll } = ORDERS_GC_V1_LET_GO_CROWD;
  if (!Number.isFinite(letGoShare) || letGoShare <= fromShare) return 1;
  const t = clamp((letGoShare - fromShare) / Math.max(1e-9, 1 - fromShare), 0, 1);
  return 1 - t * (1 - floorAtAll);
}

/**
 * #6074: andelen af hold med koerende ryttere i jagtgruppen, hvis ordre er
 * "let_go". Hold uden ordre taeller som neutrale. 0 naar gruppen er tom.
 * Deterministisk, ingen evne-akse. Eksporteret for kontrakt-tests.
 */
export function letGoTeamShare(input: {
  orders: readonly BreakawayTeamOrder[];
  chaseGroupRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  riders: Readonly<Record<string, RiderState>>;
}): number {
  const teams = new Set<string>();
  for (const id of input.chaseGroupRiderIds) {
    if (input.riders[id]?.status !== "racing") continue;
    const teamId = teamIdOf(input.entrants[id]);
    if (teamId) teams.add(teamId);
  }
  if (teams.size === 0) return 0;
  let letGo = 0;
  for (const order of input.orders) if (order.breakaway_stance === "let_go" && teams.has(order.team_id)) letGo += 1;
  return Math.min(1, letGo / teams.size);
}

// #6088 (KUN orders_gc_v1, kun terraen med stigninger): den ekstra plads ovenfor
// kompenserer for at udbruddet under orders_gc_v1 er SVAGERE end under legacy
// (ingen kaptajner fyldt ind), saa stigningerne ellers spiste det. Sender
// holdene staerke ryttere med (en ordre til en kaptajn/hjaelper), klatrer
// udbruddet ikke laengere fra hinanden, og hele det ekstra loft blev etapens
// forspring: kaptajnerne bag tabte langt mere tid end under legacy (beregningsfejl:
// kompensationen blev givet ogsaa der hvor det den kompenserer for ikke findes).
// Det ekstra loft (ikke vaeksthastigheden) trappes derfor ned, men KUN for et
// udbrud der er staerkt paa begge maal: samlet trussel (udbrud-/felt-forholdet,
// samme som letGoMaxGapSeconds) OG en klatrer paa favoritniveau (udbruddets
// bedste klatrer mod snittet af feltets bedste klatrere). Hvert maal giver en
// andel, fuld ved baandets `[0]` og ingen ved `[1]`; den STOERSTE andel gaelder,
// saa et bredt men harmloest udbrud (mange jaegere) beholder pladsen.
// Profiler uden noegle er uaendrede.
const ORDERS_GC_V1_LET_GO_THREAT_BAND: Readonly<Partial<Record<ProfileType, readonly [number, number]>>> = Object.freeze({
  hilly: Object.freeze([1.25, 1.55] as const),
  mountain: Object.freeze([1.2, 1.5] as const),
  high_mountain: Object.freeze([1.2, 1.4] as const),
});
const ORDERS_GC_V1_LET_GO_CLIMB_LEAD: Readonly<{ band: readonly [number, number]; fieldTopN: number }> = Object.freeze({
  band: Object.freeze([0.75, 0.95] as const),
  fieldTopN: 10,
});

/** #6088: maalene for hvor staerkt et udbrud er (se breakawayStrength). */
export type BreakawayStrength = { threatRatio: number; climbLead: number };

/**
 * #6088: andel [0, 1] af det ekstra lad-gaa-loft et udbrud faar. 1 = fuld plads,
 * 0 = intet ekstra (kun naar udbruddet er staerkt paa BEGGE maal). Monotont
 * ikke-stigende i hvert maal. Udeladt/ugyldigt = 1. Eksporteret for kontrakt-tests.
 */
export function letGoThreatDamping(profileType: ProfileType, strength: BreakawayStrength | undefined): number {
  const band = ORDERS_GC_V1_LET_GO_THREAT_BAND[profileType];
  if (!band || !strength || !Number.isFinite(strength.threatRatio) || !Number.isFinite(strength.climbLead)) return 1;
  const share = (value: number, [lo, hi]: readonly [number, number]) => clamp((hi - value) / Math.max(1e-9, hi - lo), 0, 1);
  return Math.max(share(strength.threatRatio, band), share(strength.climbLead, ORDERS_GC_V1_LET_GO_CLIMB_LEAD.band));
}

/**
 * #6088: udbruddets styrke. `threatRatio`: GC-trussel som forhold til feltets
 * (1 naar feltet er tomt). `climbLead`: udbruddets bedste klatrer mod snittet
 * af feltets bedste klatrere (0 naar feltet er tomt). Ren, ingen rng.
 */
export function breakawayStrength(
  breakawayRiderIds: string[],
  fieldRiderIds: string[],
  entrants: Readonly<Record<string, Entrant>>,
): BreakawayStrength {
  const fieldThreat = collectiveAbility(fieldRiderIds, entrants, GC_THREAT_KEYS);
  const threatRatio = fieldThreat > 0 ? collectiveAbility(breakawayRiderIds, entrants, GC_THREAT_KEYS) / fieldThreat : 1;
  const climbing = (id: string) => normAbility(entrants[id]?.abilities?.climbing);
  const top = fieldRiderIds.map(climbing).sort((a, b) => b - a).slice(0, ORDERS_GC_V1_LET_GO_CLIMB_LEAD.fieldTopN);
  const topMean = top.length > 0 ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  const best = breakawayRiderIds.length > 0 ? Math.max(...breakawayRiderIds.map(climbing)) : 0;
  return { threatRatio, climbLead: topMean > 0 ? best / topMean : 0 };
}

/**
 * #5955: lad-gaa-faktorerne for en etape. Legacy (og enhver anden revision)
 * faar altid 1/1, saa legacy-stien er bit-identisk. Eksporteret for kontrakt-tests.
 * #6074: `letGoShare` (andel af jagtgruppens hold der lader gaa) daemper det
 * ekstra over 1 via letGoCrowdDamping. Udeladt = ingen daempning.
 * #6088: `strength` (breakawayStrength) daemper det ekstra LOFT via
 * letGoThreatDamping. Udeladt = ingen daempning.
 */
export function letGoBalanceFor(
  rulesRevision: string | undefined,
  profileType: ProfileType,
  letGoShare?: number,
  strength?: BreakawayStrength,
): { maxGapFactor: number; rateFactor: number } {
  if (rulesRevision !== "orders_gc_v1") return { maxGapFactor: 1, rateFactor: 1 };
  const damping = letGoShare === undefined ? 1 : letGoCrowdDamping(letGoShare);
  const damp = (factor: number) => 1 + (factor - 1) * damping;
  const threatDamping = letGoThreatDamping(profileType, strength);
  return {
    maxGapFactor: 1 + (damp(ORDERS_GC_V1_LET_GO.maxGapFactorByProfile[profileType] ?? 1) - 1) * threatDamping,
    rateFactor: damp(ORDERS_GC_V1_LET_GO.letGoRateFactorByProfile[profileType] ?? 1),
  };
}

/**
 * En leder trækker ikke jagten: kaptajnen og sprint-kaptajnen er dem holdet
 * jager FOR (samme rolle-skel som M16's WORKER_ROLES/protectedRoleOrder).
 */
const CHASE_EXEMPT_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

function teamIdOf(entrant: Entrant | undefined): string | null {
  const raw = entrant?.team_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * #6050: aktoeren bag en indhentning, til loebsfilmen (ren beskrivelse, ingen tal).
 * chase_group_kind = jagt-gruppens art (fx "peloton"/"chase"); chasing_team_ids =
 * sorterede team_ids med ryttere i jagt-arbejde, udeladt naar ingen hold jagede.
 */
export function catchActorParams(
  chase: { id: string; kind: string },
  chaserWork: ReadonlyMap<string, number> | undefined,
  entrants: Readonly<Record<string, Entrant>>,
): Record<string, unknown> {
  const teamIds = new Set<string>();
  for (const [riderId, work] of chaserWork ?? []) {
    const teamId = work > 0 ? teamIdOf(entrants[riderId]) : null;
    if (teamId) teamIds.add(teamId);
  }
  return {
    chase_group_id: chase.id,
    chase_group_kind: chase.kind,
    ...(teamIds.size > 0 ? { chasing_team_ids: [...teamIds].sort((a, b) => a.localeCompare(b)) } : {}),
  };
}

export type TeamChasePlan = {
  /** Signeret stance-signal i [-1, 1] — samme akse som computeNetChaseAdvantage's `stance`. */
  signal: number;
  /** rider_id -> arbejds-vaegt (0, 1] for de ryttere der jager dette segment (betaler i applyChaseCost). */
  chaserWork: Map<string, number>;
};

/**
 * Holdspecifik jagt (#5570). Erstatter det gamle 1/N-gennemsnit over alle hold.
 *
 *  - "chase": holdets EGNE ryttere i jagtgruppen trækker. Hver rytters traek =
 *    effort-vaegt (M16's helperCostMultiplier: all_out arbejder ikke for
 *    holdet, save/grupetto halvt) x friskhed (hans nuvaerende team_cp_factor,
 *    saa et hold der har jaget laenge trækker svagere) x motor relativt til
 *    feltet. Holdets bidrag = maxTeamSignal x min(1, sum / referenceChasers).
 *    Et hold uden ryttere i jagtgruppen (alle i udbruddet, sat af, udgaaet)
 *    kan ikke jage. Ledere trækker ikke.
 *  - "let_go": holdets andel af jagtgruppens ryttere traekkes ud af den
 *    naturlige jagt. Lader ALLE hold i jagtgruppen det gaa, er signalet -1.
 *  - "neutral": 0 — og, modsat foer, udvander et neutralt hold intet.
 *
 * Summen clampes til [-1, 1], og computeNetChaseAdvantage's multiplikator-
 * bounds er uaendrede: ét valg kan stadig aldrig vaelte et loeb.
 *
 * SKALA-INVARIANT (#4707): motor-leddet er et FORHOLD til feltets egen motor
 * (homogent af grad 0), friskhed og effort har ingen evne-akse.
 * MONOTONI: signalet paavirker kun gruppens jagt, aldrig en rytters placering
 * direkte; prisen er en andel af rytterens EGEN CP (se applyChaseCost).
 * DETERMINISTISK: ingen rng, fast hold- og rytter-raekkefoelge.
 */
export function teamChasePlan(input: {
  orders: readonly BreakawayTeamOrder[];
  chaseGroupRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  riders: Readonly<Record<string, RiderState>>;
  /** Feltet motor-referencen maales paa (typisk hele det koerende felt). Default: jagtgruppen. */
  fieldRiderIds?: readonly string[];
  /**
   * #5978 (KUN orders_gc_v1): holdenes GC-reaktion i DENNE jagtgruppe,
   * team_id -> intensitet (0, 1] + de hjaelpere der reagerer. Udeladt = den
   * uaendrede legacy-beregning nedenfor (bit-identisk).
   */
  reactions?: ReadonlyMap<string, { intensity: number; workers: readonly string[] }>;
  /**
   * #6187 (KUN orders_gc_v3): hold med en egen koerende rytter i den gruppe der
   * jages. De foerer ikke jagten: hverken jagt-ordren eller GC-reaktionen
   * saetter deres ryttere til at trække ("let_go" er uaendret). Udeladt =
   * ingen saadan regel (bit-identisk).
   */
  ownRiderAheadTeamIds?: ReadonlySet<string>;
}): TeamChasePlan {
  if (input.reactions && input.reactions.size > 0) return teamChasePlanWithReactions(input, input.reactions);
  const chaserWork = new Map<string, number>();
  if (input.orders.length === 0) return { signal: 0, chaserWork };

  const racing = [...input.chaseGroupRiderIds]
    .filter((id) => input.entrants[id] && input.riders[id]?.status === "racing")
    .sort((a, b) => a.localeCompare(b));
  if (racing.length === 0) return { signal: 0, chaserWork };

  const membersByTeam = new Map<string, string[]>();
  for (const riderId of racing) {
    const teamId = teamIdOf(input.entrants[riderId]);
    if (!teamId) continue;
    const list = membersByTeam.get(teamId) ?? [];
    list.push(riderId);
    membersByTeam.set(teamId, list);
  }
  if (membersByTeam.size === 0) return { signal: 0, chaserWork };

  const fieldIds =
    input.fieldRiderIds && input.fieldRiderIds.length > 0 ? [...input.fieldRiderIds] : racing;
  const fieldEngine = collectiveAbility(fieldIds, input.entrants, CHASE_ENGINE_KEYS);
  const [engineLo, engineHi] = TEAM_CHASE.relativeEngineBounds;

  let signal = 0;
  for (const order of [...input.orders].sort((a, b) => a.team_id.localeCompare(b.team_id))) {
    const members = membersByTeam.get(order.team_id);
    if (!members || members.length === 0) continue;

    if (order.breakaway_stance === "let_go") {
      signal -= members.length / racing.length;
      continue;
    }
    if (order.breakaway_stance !== "chase") continue;
    if (input.ownRiderAheadTeamIds?.has(order.team_id)) continue; // #6187: egen mand foran slaar jagt-ordren fra

    let pull = 0;
    for (const riderId of members) {
      const entrant = input.entrants[riderId];
      if (!entrant || CHASE_EXEMPT_ROLES.has(entrant.role)) continue;
      const work = helperCostMultiplier(entrant.effort);
      if (!(work > 0)) continue;
      const factor = input.riders[riderId]?.team_cp_factor;
      const freshness = clamp(Number.isFinite(factor) ? (factor as number) : 1, 0, 1);
      const relativeEngine =
        fieldEngine > 0
          ? clamp(collectiveAbility([riderId], input.entrants, CHASE_ENGINE_KEYS) / fieldEngine, engineLo, engineHi)
          : 1;
      pull += work * freshness * relativeEngine;
      chaserWork.set(riderId, work);
    }
    signal += TEAM_CHASE.maxTeamSignal * clamp(pull / TEAM_CHASE.referenceChasers, 0, 1);
  }

  return { signal: clamp(signal, -1, 1), chaserWork };
}

/**
 * #5978 (orders_gc_v1): samme holdvise jagt som teamChasePlan, men et hold med
 * en GC-reaktion (og uden eksplicit "chase") trækker med sine REAGERENDE
 * hjaelpere, skaleret med reaktionens intensitet, i stedet for sin stance
 * ("neutral" = 0, "let_go" = trukket ud). Eksplicit "chase" er uaendret og
 * ignorerer reaktionen (den er ikke begraenset af undtagelsens budget).
 */
function teamChasePlanWithReactions(
  input: Parameters<typeof teamChasePlan>[0],
  reactions: ReadonlyMap<string, { intensity: number; workers: readonly string[] }>,
): TeamChasePlan {
  const chaserWork = new Map<string, number>();
  const racing = [...input.chaseGroupRiderIds]
    .filter((id) => input.entrants[id] && input.riders[id]?.status === "racing")
    .sort((a, b) => a.localeCompare(b));
  if (racing.length === 0) return { signal: 0, chaserWork };

  const membersByTeam = new Map<string, string[]>();
  for (const riderId of racing) {
    const teamId = teamIdOf(input.entrants[riderId]);
    if (!teamId) continue;
    const list = membersByTeam.get(teamId) ?? [];
    list.push(riderId);
    membersByTeam.set(teamId, list);
  }
  if (membersByTeam.size === 0) return { signal: 0, chaserWork };

  const fieldIds = input.fieldRiderIds && input.fieldRiderIds.length > 0 ? [...input.fieldRiderIds] : racing;
  const fieldEngine = collectiveAbility(fieldIds, input.entrants, CHASE_ENGINE_KEYS);
  const [engineLo, engineHi] = TEAM_CHASE.relativeEngineBounds;
  const stanceByTeam = new Map<string, BreakawayStance>();
  for (const order of input.orders) stanceByTeam.set(order.team_id, order.breakaway_stance);
  const teamIds = [...new Set([...stanceByTeam.keys(), ...reactions.keys()])].sort((a, b) => a.localeCompare(b));

  const pullOf = (riderId: string, intensity: number): number => {
    const entrant = input.entrants[riderId];
    if (!entrant || CHASE_EXEMPT_ROLES.has(entrant.role)) return 0;
    const work = helperCostMultiplier(entrant.effort);
    if (!(work > 0)) return 0;
    const factor = input.riders[riderId]?.team_cp_factor;
    const freshness = clamp(Number.isFinite(factor) ? (factor as number) : 1, 0, 1);
    const relativeEngine =
      fieldEngine > 0
        ? clamp(collectiveAbility([riderId], input.entrants, CHASE_ENGINE_KEYS) / fieldEngine, engineLo, engineHi)
        : 1;
    chaserWork.set(riderId, work * intensity);
    return work * freshness * relativeEngine * intensity;
  };

  let signal = 0;
  for (const teamId of teamIds) {
    const members = membersByTeam.get(teamId);
    if (!members || members.length === 0) continue;
    const stance = stanceByTeam.get(teamId) ?? "neutral";
    // #6187: et hold med egen mand i den jagede gruppe foerer hverken med sin
    // GC-reaktion eller sin jagt-ordre. "let_go" traekker stadig ud som foer.
    const ownAhead = input.ownRiderAheadTeamIds?.has(teamId) === true;
    const reaction = stance === "chase" || ownAhead ? undefined : reactions.get(teamId);
    if (reaction && reaction.intensity > 0) {
      const intensity = clamp(reaction.intensity, 0, 1);
      const allowed = new Set(reaction.workers);
      let pull = 0;
      for (const riderId of members) if (allowed.has(riderId)) pull += pullOf(riderId, intensity);
      signal += TEAM_CHASE.maxTeamSignal * clamp(pull / TEAM_CHASE.referenceChasers, 0, 1);
      continue;
    }
    if (stance === "let_go") {
      signal -= members.length / racing.length;
      continue;
    }
    if (stance !== "chase" || ownAhead) continue;
    let pull = 0;
    for (const riderId of members) pull += pullOf(riderId, 1);
    signal += TEAM_CHASE.maxTeamSignal * clamp(pull / TEAM_CHASE.referenceChasers, 0, 1);
  }
  return { signal: clamp(signal, -1, 1), chaserWork };
}

/** #5978: arbejdet pr. rytter flettet som max (fast, sorteret raekkefoelge). */
export function mergeWork(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x.localeCompare(y))) {
    out.set(id, Math.max(a.get(id) ?? 0, b.get(id) ?? 0));
  }
  return out;
}

/**
 * #5978 (review af #6213, punkt 1, KUN orders_gc_v3): to jagtplaner for samme
 * jagtgruppe (hver sit udbrud) flettet: en rytter der jager mindst ét af
 * udbruddene, betaler sit stoerste arbejde én gang.
 */
export function mergeChasePlans(a: TeamChasePlan, b: TeamChasePlan): TeamChasePlan {
  return { signal: Math.max(a.signal, b.signal), chaserWork: mergeWork(a.chaserWork, b.chaserWork) };
}

/**
 * Jagtens pris (#5570): hver jaeger betaler en andel af sin EGEN CP via
 * `team_cp_factor` — samme valuta, samme additive bogfoering og samme
 * [minCpFactor, 1 + captainMaxBonusFraction]-clamp som M16's holdspil, saa de
 * to priser deler gulv og aldrig kan stable en rytter under det.
 *
 * Arbejdet DELES: jager flere ryttere end referenceChasers (et stort hold, eller
 * flere hold sammen), betaler hver mindre. Et hold der jager alene, baerer
 * hele prisen selv. Prisen er km-andels-skaleret (samme granularitets-
 * uafhaengighed som M16) og betales ogsaa naar jagten ikke lukker hullet —
 * man har stadig koert forrest.
 *
 * GARANTIER: prisen er ALDRIG negativ (ingen gratis CP), og den er en andel af
 * rytterens egen CP, saa to jaegere med samme effort beholder deres indbyrdes
 * CP-orden (monotoni). Returnerer null naar ingen betaler (state uaendret).
 */
export function applyChaseCost(
  riders: Readonly<Record<string, RiderState>>,
  chaserWork: ReadonlyMap<string, number>,
  segmentShare: number,
): Record<string, RiderState> | null {
  if (!(segmentShare > 0) || chaserWork.size === 0) return null;
  let totalWork = 0;
  for (const work of chaserWork.values()) totalWork += Math.max(0, work);
  if (!(totalWork > 0)) return null;
  const loadShare = Math.min(1, TEAM_CHASE.referenceChasers / totalWork);
  const floor = TEAM_PLAY_EXTRA_TUNING.minCpFactor;
  const ceiling = 1 + TEAM_PLAY_EXTRA_TUNING.captainMaxBonusFraction;

  let next: Record<string, RiderState> | null = null;
  for (const [riderId, work] of [...chaserWork.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const riderState = riders[riderId];
    if (!riderState) continue;
    const paid = Math.max(0, TEAM_CHASE.chaseCostFraction * work * segmentShare * loadShare);
    if (paid <= 0) continue;
    const current = Number.isFinite(riderState.team_cp_factor) ? (riderState.team_cp_factor as number) : 1;
    next ??= { ...riders };
    next[riderId] = { ...riderState, team_cp_factor: clamp(current - paid, floor, ceiling) };
  }
  return next;
}

function finaleTypeChaseWeight(finaleType: FinaleType | null): number {
  if (!finaleType) return BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeightDefault;
  return BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeight[finaleType] ?? BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeightDefault;
}

/**
 * Evne-skalaen jagt-modellens evne-afledte led maales i (#4707): forholdet
 * mellem kalibrerings-referencen (`abilityReferenceLevel`) og feltets EGEN
 * kollektive evne paa `CHASE_REFERENCE_KEYS`. Et felt der er praecis saa
 * staerkt som referencen faar skala 1; et felt der er dobbelt saa staerkt faar
 * 0,5 — saa et evne-led der fordobles med feltet, forbliver uaendret.
 * Et felt uden maalbar evne (alle 0) har ingen evne-led at skalere: 1.
 */
export function chaseAbilityScale(fieldRiderIds: string[], entrants: Readonly<Record<string, Entrant>>): number {
  const fieldReference = collectiveAbility(fieldRiderIds, entrants, CHASE_REFERENCE_KEYS);
  if (!(fieldReference > 0)) return 1;
  return BREAKAWAY_EXTRA_TUNING.abilityReferenceLevel / fieldReference;
}

/**
 * Netto jagt-fordel for ÉT segment (eksporteret for direkte kontrakt-tests).
 * Positiv => jagt-gruppen lukker hullet; negativ => udbruddet trækker fra.
 * BOUNDED af stance-multiplikatoren (clamp forhindrer fortegns-omvending fra
 * en enkelt holdordre alene, jf. mor-spec §5's "spillerens valg aldrig kan
 * vaelte et loeb").
 *
 * SKALA-INVARIANT (#4707, RULES §7 raekke 14): de evne-afledte led
 * (sprinter-interesse, GC-trussel, motorstyrke) maales RELATIVT til feltets
 * egen evne-reference (`chaseAbilityScale`), mens sen-etape-uroen og udbruddets
 * stoerrelse er strukturelle led (etape-fremdrift og rytterantal) uden en
 * evne-akse. Foer stod de to strukturelle led som absolutte konstanter mod
 * evne-led der skalerede med populationen: det samme scenarie gav en anden
 * jagt ved median-evne 11 end ved 60, og enhver populationsaendring flyttede
 * balancen mellem "hvem er i udbruddet" og "hvor langt er vi". Nu er netto-
 * fordelen homogen af grad 0 i evne-niveauet: skaleres hele feltet (jagt,
 * udbrud og reference) med samme faktor, er jagten identisk. Kalibrerings-
 * referencen er valgt saa den aegte population ligger taet paa skala 1, saa
 * bjerg-ankeret (overskuds-grenen i fart-modellen) ikke flyttes af omlaegningen.
 */
export function computeNetChaseAdvantage(input: {
  chaseGroupRiderIds: string[];
  breakawayRiderIds: string[];
  entrants: Readonly<Record<string, Entrant>>;
  finaleType: FinaleType | null;
  remainingKmFraction: number; // 0 (etapestart) .. 1 (maal)
  stance: number; // [-1, 1], se teamChasePlan (#5570: holdspecifikt)
  /** Feltet evne-referencen maales paa (typisk alle ryttere i loebet). Default: jagt-gruppe + udbrud. */
  fieldRiderIds?: string[];
  /**
   * #6187 (KUN orders_gc_v3): de udbrydere der faktisk koerer foran. Ryttere
   * paa hjul (ownRidersOnWheel) bidrager hverken med motor eller antal til
   * udbruddets modstand; de er stadig en trussel (gcThreat). Udeladt = hele
   * udbruddet koerer (bit-identisk).
   */
  pullingBreakawayRiderIds?: string[];
}): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  const pullers = input.pullingBreakawayRiderIds ?? input.breakawayRiderIds;
  const fieldRiderIds =
    input.fieldRiderIds && input.fieldRiderIds.length > 0
      ? input.fieldRiderIds
      : [...input.chaseGroupRiderIds, ...input.breakawayRiderIds];
  const abilityScale = chaseAbilityScale(fieldRiderIds, input.entrants);

  const sprinterInterest =
    collectiveAbility(input.chaseGroupRiderIds, input.entrants, ["sprint"]) * abilityScale * finaleTypeChaseWeight(input.finaleType);
  const gcThreat = collectiveAbility(input.breakawayRiderIds, input.entrants, GC_THREAT_KEYS) * abilityScale;
  const lateRaceUrgency = clamp(input.remainingKmFraction, 0, 1);

  // #6187: en rytter paa hjul bidrager med 0 (summen over de koerende delt med
  // hele udbruddet), saa modstanden aldrig kan stige af at nogen sidder paa hjul.
  const pullerShare = pullers === input.breakawayRiderIds || input.breakawayRiderIds.length === 0 ? 1 : pullers.length / input.breakawayRiderIds.length;
  const enginePower = collectiveAbility(pullers, input.entrants, CHASE_ENGINE_KEYS) * abilityScale * pullerShare;
  const countFactor = clamp(pullers.length / extra.breakawayReferenceCount, 0, 1.5);

  const chaseForce =
    extra.sprinterInterestWeight * sprinterInterest +
    extra.gcThreatWeight * gcThreat +
    extra.lateRaceUrgencyWeight * lateRaceUrgency;
  const breakawayResistance = extra.enginePowerResistanceWeight * enginePower + extra.countResistanceWeight * countFactor;

  const netAdvantage = chaseForce - breakawayResistance;
  const stanceMultiplier = clamp(1 + extra.stanceEffectWeight * input.stance, extra.stanceMultiplierBounds[0], extra.stanceMultiplierBounds[1]);
  return netAdvantage * stanceMultiplier;
}

/**
 * #5812 (a): loftet paa "lad gaa"-hullet — hvor meget forspring feltet giver
 * dette udbrud, foer det begynder at jage. Terraenets grundloft
 * (`maxGapSecondsByProfile`) ganget med en trussel-faktor: udbruddets
 * kollektive GC-trussel (samme evner som jagt-modellens gcThreat) som FORHOLD
 * til feltets. Et udbrud af feltets farligste ryttere faar mindre, et af
 * harmloese ryttere faar mere — bounded af `maxGapFactorBounds`.
 *
 * SKALA-INVARIANT (#4707): forholdet er homogent af grad 0 i evne-niveauet.
 * MONOTONI: faktoren er ikke-stigende i udbruddets trussel. Ingen rng.
 * Eksporteret for direkte kontrakt-tests.
 */
export function letGoMaxGapSeconds(input: {
  breakawayRiderIds: string[];
  fieldRiderIds: string[];
  entrants: Readonly<Record<string, Entrant>>;
  profileType: ProfileType;
  finaleType?: FinaleType | null;
  /** #5578 (KUN official_times_v2): finalens faktor i stedet for maxGapFinaleFactor. Udeladt = tabellen. */
  finaleFactor?: number;
}): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  const profileBase = extra.maxGapSecondsByProfile[input.profileType] ?? extra.maxGapSecondsDefault;
  const finaleFactor = input.finaleFactor ?? (input.finaleType ? (extra.maxGapFinaleFactor[input.finaleType] ?? 1) : 1);
  const base = profileBase * Math.max(0, finaleFactor);
  const fieldThreat = collectiveAbility(input.fieldRiderIds, input.entrants, GC_THREAT_KEYS);
  const breakawayThreat = collectiveAbility(input.breakawayRiderIds, input.entrants, GC_THREAT_KEYS);
  const ratio = fieldThreat > 0 ? breakawayThreat / fieldThreat : 1;
  const [lo, hi] = extra.maxGapFactorBounds;
  const reference = extra.threatReferenceRatio > 0 ? extra.threatReferenceRatio : 1;
  const factor = clamp(1 - extra.threatGapSensitivity * (ratio / reference - 1), lo, hi);
  return Math.max(0, base * factor);
}

/**
 * #5813 (del 2): jagt-gulvet. Hvor mange af segmentets JAGT-km ligger i
 * etapens sidste `chaseFloorFinalKm` km paa aabent terraen (flad/rullende
 * profil), hvor feltet altid overtager jagten sent? Jagt-km er segmentets
 * sidste `chaseKm` (lad-gaa-fasen ligger foerst, se letGoSplitKm). 0 paa
 * alle andre profiler og foer vinduet.
 *
 * Strukturelt led (etape-fremdrift og profil), ingen evne-akse og ingen rng.
 * Eksporteret for direkte kontrakt-tests.
 */
export function chaseFloorKm(input: {
  profileType: ProfileType;
  distanceKm: number;
  toKm: number;
  chaseKm: number;
}): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  if (!extra.chaseFloorProfileTypes.includes(input.profileType)) return 0;
  if (!(extra.chaseFloorFinalKm > 0) || !(input.chaseKm > 0)) return 0;
  const windowStart = input.distanceKm - extra.chaseFloorFinalKm;
  const chaseStart = input.toKm - input.chaseKm;
  return clamp(input.toKm - Math.max(chaseStart, windowStart), 0, input.chaseKm);
}

/**
 * #5813 (del 2): hvilket forspring feltet koerer udbruddet ned til ved maal
 * paa DENNE etape. Paa en massefinale `chaseFloorTargetGapSeconds` (et hul
 * finalens antals-vindue altid henter); paa andre finaler 0 (feltet koerer
 * det helt ind, der er intet antals-vindue). Med sandsynligheden for
 * finaletypen (`chaseFloorLateChanceByFinale`, ellers
 * `chaseFloorLateChanceDefault`) regner feltet forkert og kommer for sent:
 * `chaseFloorLateTargetGapSeconds`, og et udbrud med et reelt forspring kan
 * holde. `lateRoll` er etapens ene lodtraekning (uniform 0-1).
 * Eksporteret for direkte kontrakt-tests.
 */
export function chaseFloorTargetGapSeconds(
  route: { finale_type: FinaleType | null; profile_type: ProfileType },
  lateRoll: number,
): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  const lateChance = (route.finale_type ? extra.chaseFloorLateChanceByFinale[route.finale_type] : undefined)
    ?? extra.chaseFloorLateChanceDefault;
  if (lateRoll < lateChance) return extra.chaseFloorLateTargetGapSeconds;
  // Paa en massefinale henter finalens antals-vindue et kort forspring
  // (finale.ts isBunchCatchRoute); ellers koerer feltet hullet helt i.
  return isBunchCatchRoute(route) ? extra.chaseFloorTargetGapSeconds : 0;
}

/**
 * #5813 (del 2): sekunder jagt-gulvet lukker paa segmentets gulv-km. Inden for
 * vinduet koerer sprinterholdene hullet ned mod dagens maal (`targetGapSeconds`)
 * ved maalstregen, jaevnt over de km der er tilbage: paa hvert segment lukkes
 * segmentets andel af resten (`floorKm / kmToFinish`), saa hullet ved maal
 * hoejst er maalet, uanset hvor stort det var da vinduet begyndte. Aldrig
 * negativ, og et hul under maalet roeres ikke. Uafhaengigt af holdordrer (en
 * ordre kan hverken fjerne gulvet eller skabe et forspring).
 * Eksporteret for direkte kontrakt-tests.
 */
export function chaseFloorClosingSeconds(input: {
  separationSeconds: number;
  floorKm: number;
  kmToFinish: number;
  targetGapSeconds: number;
}): number {
  if (!(input.floorKm > 0)) return 0;
  const excess = Math.max(0, input.separationSeconds - Math.max(0, input.targetGapSeconds));
  if (excess === 0) return 0;
  const share = input.kmToFinish > 0 ? clamp(input.floorKm / input.kmToFinish, 0, 1) : 1;
  return excess * share;
}

/**
 * #5812 (a): er jagtgruppen et FELT der kan lade et udbrud gaa? Delt af M5
 * (lad-gaa-fasen) og segmentLoop (nulstillet tempo-drift), saa de to halvdele
 * af mekanikken altid er slaaet til og fra sammen. #5578: `minRiders` er
 * official_times_v2's egen graense (timeModel.letGoMinChaseRiders); udeladt =
 * BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders (alle andre revisioner).
 */
export function isLetGoChaseGroup(chaseRiderCount: number, minRiders: number = BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders): boolean {
  return Number.isFinite(chaseRiderCount) && chaseRiderCount >= minRiders;
}

/**
 * #5812 (a): hvor mange af segmentets km der hoerer til "lad gaa"-fasen, og
 * hvor mange til jagten. Fasen er STATELESS afledt af distancen: udbruddet
 * dannes altid paa rutens foerste segment (`formationKmFor`), og fasen varer
 * de km det tager hullet at vokse fra hovedstarten til loftet med
 * `letGoSecondsPerKm`. Et segment kan derfor rumme begge faser (fx et langt
 * foerste segment paa en legacy-rute). Kun km EFTER dannelsen taeller.
 * Eksporteret for direkte kontrakt-tests.
 */
export function letGoSplitKm(input: {
  formationKm: number;
  maxGapSeconds: number;
  fromKm: number;
  toKm: number;
  /** #5955 (KUN orders_gc_v1): lad-gaa-hastighed. Udeladt = BREAKAWAY_EXTRA_TUNING.letGoSecondsPerKm. */
  secondsPerKm?: number;
}): { letGoKm: number; chaseKm: number } {
  const rate = input.secondsPerKm ?? BREAKAWAY_EXTRA_TUNING.letGoSecondsPerKm;
  const start = Math.max(input.fromKm, input.formationKm);
  const span = Math.max(0, input.toKm - start);
  const letGoEndKm = rate > 0
    ? input.formationKm + Math.max(0, input.maxGapSeconds - INITIAL_GAP_SECONDS) / rate
    : input.formationKm;
  const letGoKm = clamp(letGoEndKm - start, 0, span);
  return { letGoKm, chaseKm: span - letGoKm };
}

function flattenTryBreakRiderIds(orders: readonly BreakawayTeamOrder[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!orders) return set;
  for (const order of orders) {
    for (const rider of order.riders) {
      if (rider.try_break) set.add(rider.rider_id);
    }
  }
  return set;
}

/** Finder alle grupper med kind==='breakaway', sorteret for deterministisk behandlingsraekkefolge. */
function findBreakawayGroups(groups: RaceGroup[]): RaceGroup[] {
  return groups.filter((g) => g.kind === "breakaway").sort((a, b) => a.id.localeCompare(b.id));
}



// ── #5978 (orders_gc_v1): GC-kontekst og reaktionsbudget ─────────────────────

type TeamGcDecision = {
  teamId: string;
  threat: GcThreat;
  stance: ReactionStance;
  workers: string[];
  plan: TeamReactionPlan;
};

type GcReactionSetup = {
  decisions: TeamGcDecision[];
  /** jagtgruppe-id -> (team_id -> reaktion), til teamChasePlan's `reactions`. */
  reactionsByChaseGroup: Map<string, Map<string, { intensity: number; workers: readonly string[] }>>;
  /** #5978 (KUN orders_gc_v3): snoren er i spil (se planTeamReaction). */
  leash?: boolean;
};

/** Er GC-reaktionen i spil for dette hook-kald? KUN orders_gc_v1. */
function gcReactionActive(ctx: BreakawayHookContext): boolean {
  return ctx.rulesRevision === "orders_gc_v1";
}

/**
 * #5978 (KUN orders_gc_v3): hvad farlighed maales paa. Etapeloeb: etaper tilbage
 * (klassement-konteksten). Endagsloeb: dagens evne-vektor (finalens krav; en
 * udbrudsfinale maales paa feltets finale bag udbruddet).
 */
function dangerModelFor(ctx: BreakawayHookContext, gcContext: GcContext): DangerModel {
  return dangerModelOf(ctx.route, ctx.tuning, gcContext, timeModelTuningFor(ctx).gcDanger);
}

/** #5978: dangerModelFor uden hook-konteksten (segmentLoop's hjul-kobling). */
function dangerModelOf(route: RouteV2, tuning: EngineTuning, gcContext: GcContext, gcDanger: GcDangerTuning | null = null): DangerModel {
  if (gcContext.status === "standings") {
    // #5578 (KUN official_times_v2): den kalibrerede farligheds-tuning (timeModel.ts).
    const danger = gcDanger ? { tuning: gcDanger } : {};
    return gcContext.stages_remaining !== undefined ? { stagesRemaining: gcContext.stages_remaining, ...danger } : { ...danger };
  }
  if (gcContext.status !== "one_day") return {};
  const finaleType = route.finale_type === "breakaway" ? fieldFinaleTypeBehindBreakaway(route) : route.finale_type;
  const demand = finaleType ? tuning.finale.demandVectorByFinaleType[finaleType] : undefined;
  return demand ? { routeDemand: demand } : {};
}

/**
 * Hvert holds GC-vurdering og reaktionsplan for segmentet, ud fra tilstanden
 * ved segmentets start. Kun hold med en klassificeret GC-rytter vurderes; et
 * hold uden GC-interesse har intet at reagere paa (almindelig default).
 */
function gcReactionSetup(state: EngineState, ctx: BreakawayHookContext, gcContext: GcContext): GcReactionSetup {
  const decisions: TeamGcDecision[] = [];
  const reactionsByChaseGroup: GcReactionSetup["reactionsByChaseGroup"] = new Map();
  // #5978 (KUN orders_gc_v3): farlighed med potentiale, snoren og endagsloebet.
  const dangerModel = ctx.ordersGcV3 === true ? dangerModelFor(ctx, gcContext) : undefined;
  const oneDay = gcContext.status === "one_day" && dangerModel?.routeDemand !== undefined;
  if (gcContext.status !== "standings" && !oneDay) return { decisions, reactionsByChaseGroup, ...(dangerModel ? { leash: true } : {}) };

  const breakawayGroups = findBreakawayGroups(state.groups);
  const chasingGroupIds = new Set<string>();
  for (const breakaway of breakawayGroups) {
    const chase = findChaseGroup(state.groups, breakaway);
    if (chase && breakaway.gap_seconds <= chase.gap_seconds) chasingGroupIds.add(chase.id);
  }
  const racingRiderIds = new Set(Object.values(state.riders).filter((r) => r.status === "racing").map((r) => r.rider_id));
  const stanceByTeam = new Map<string, BreakawayStance>();
  for (const order of parseBreakawayOrders(ctx.orders)) stanceByTeam.set(order.team_id, order.breakaway_stance);

  const teamIds = new Set<string>();
  for (const riderId of racingRiderIds) {
    const teamId = teamIdOf(ctx.entrants[riderId]);
    if (teamId) teamIds.add(teamId);
  }
  const segmentShareBound = ctx.route.distance_km > 0
    ? clamp(Math.max(0, ctx.segment.to_km - ctx.segment.from_km) / ctx.route.distance_km, 0, 1)
    : 0;

  for (const teamId of [...teamIds].sort((a, b) => a.localeCompare(b))) {
    const protectedRiderId = oneDay
      ? oneDayProtectedRider({ teamId, groups: state.groups, entrants: ctx.entrants, routeDemand: dangerModel!.routeDemand!, racingRiderIds })
      : protectedRiderForTeam({ gcContext, teamId, entrants: ctx.entrants });
    if (!protectedRiderId) continue;
    // Truslen vurderes KUN mod dagens udbrudsgrupper (det M5's jagt kan virke
    // paa) og GC-rytterens egen gruppe.
    const threatGroups = state.groups.filter((g) => g.kind === "breakaway" || g.rider_ids.includes(protectedRiderId));
    const threat = assessGcThreat({
      gcContext,
      groups: threatGroups,
      entrants: ctx.entrants,
      route: ctx.route,
      protectedRiderId,
      km: ctx.segment.from_km,
      racingRiderIds,
      chasingGroupIds,
      // #6187: under orders_gc_v3 jager et hold aldrig en gruppe med egen mand i.
      ...(ctx.ordersGcV3 ? { ownTeamId: teamId, skipOwnRiderGroups: true } : {}),
      ...(dangerModel ? { dangerModel } : {}),
    });
    const stance: ReactionStance = stanceByTeam.get(teamId) ?? "neutral";
    const groupRiderIds = threat.chase_group_id
      ? state.groups.find((g) => g.id === threat.chase_group_id)?.rider_ids ?? []
      : [];
    const workers = availableReactionWorkers({ teamId, groupRiderIds, entrants: ctx.entrants, riders: state.riders });
    const prior = state.team_reactions?.[teamId];
    let plan = planTeamReaction({ prior, threat, stance, availableWorkers: workers, ...(dangerModel ? { leash: true } : {}) });
    if (plan.mode === "preventive") {
      // OEVRE skon paa segmentets pris ved fuld intensitet: alle hjaelpere
      // jager hele segmentet alene (ingen deling). Den faktiske pris er <= den.
      let bound = 0;
      for (const riderId of workers) {
        bound += TEAM_CHASE.chaseCostFraction * helperCostMultiplier(ctx.entrants[riderId]?.effort) * segmentShareBound;
      }
      plan = { ...plan, intensity: capPreventiveIntensity(plan, bound) };
    }
    decisions.push({ teamId, threat, stance, workers, plan });
    if (plan.intensity > 0 && threat.chase_group_id) {
      const byTeam = reactionsByChaseGroup.get(threat.chase_group_id) ?? new Map();
      byTeam.set(teamId, { intensity: plan.intensity, workers });
      reactionsByChaseGroup.set(threat.chase_group_id, byTeam);
    }
  }
  return { decisions, reactionsByChaseGroup, ...(dangerModel ? { leash: true } : {}) };
}

// ── #6187 (KUN orders_gc_v3): eget hold jagter aldrig sine egne ──────────────

/** Et holds ryttere paa hjul i én udbrudsgruppe (se ownRidersOnWheel). */
export type OwnRidersOnWheel = { team_id: string; group_id: string; rider_ids: string[]; protected_rider_id: string };

/**
 * "Paa hjul" (ejer 5/10): holdets egne udbrydere foerer ikke i udbruddet, naar
 * gruppen rummer en trussel mod holdets GC-rytter bag dem. Truslen er samme
 * vurdering som GC-reaktionens (assessGcThreat), minus holdets egne. Holdets
 * GC-rytter selv i gruppen = intet at beskytte (han koerer sit eget loeb).
 * #5978 (review af #5978, punkt 1): under orders_gc_v3 faar vurderingen samme
 * DangerModel som reaktionen (potentiale, resterende etaper, hvem har noget at
 * forsvare, endagsloebets kaptajn), og snoren taeller som trussel (det hold der
 * holder snoren, jager stadig). Udeladt dangerModel = #6187-vurderingen.
 * Ren og deterministisk (hold og grupper sorteret).
 */
export function ownRidersOnWheel(input: {
  groups: readonly RaceGroup[];
  riders: Readonly<Record<string, RiderState>>;
  entrants: Readonly<Record<string, Entrant>>;
  gcContext: GcContext;
  route: RouteV2;
  km: number;
  dangerModel?: DangerModel;
}): OwnRidersOnWheel[] {
  const out: OwnRidersOnWheel[] = [];
  const model = input.dangerModel;
  const oneDay = input.gcContext.status === "one_day" && model?.routeDemand !== undefined;
  if (input.gcContext.status !== "standings" && !oneDay) return out;
  const racing = new Set(Object.values(input.riders).filter((r) => r.status === "racing").map((r) => r.rider_id));
  for (const group of findBreakawayGroups([...input.groups])) {
    const byTeam = new Map<string, string[]>();
    for (const riderId of group.rider_ids) {
      const teamId = racing.has(riderId) ? teamIdOf(input.entrants[riderId]) : null;
      if (teamId) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), riderId]);
    }
    for (const teamId of [...byTeam.keys()].sort((a, b) => a.localeCompare(b))) {
      const protectedRiderId = oneDay
        ? oneDayProtectedRider({ teamId, groups: input.groups, entrants: input.entrants, routeDemand: model!.routeDemand!, racingRiderIds: racing })
        : protectedRiderForTeam({ gcContext: input.gcContext, teamId, entrants: input.entrants });
      if (!protectedRiderId || group.rider_ids.includes(protectedRiderId)) continue;
      const protectedGroup = input.groups.find((g) => g.rider_ids.includes(protectedRiderId));
      if (!protectedGroup) continue;
      const threat = assessGcThreat({
        gcContext: input.gcContext,
        groups: [group, protectedGroup],
        entrants: input.entrants,
        route: input.route,
        protectedRiderId,
        km: input.km,
        racingRiderIds: racing,
        ownTeamId: teamId,
        ...(model ? { dangerModel: model } : {}),
      });
      if (threat.severity === "none" && threat.leash_hold !== true) continue;
      out.push({ team_id: teamId, group_id: group.id, rider_ids: [...(byTeam.get(teamId) ?? [])].sort((a, b) => a.localeCompare(b)), protected_rider_id: protectedRiderId });
    }
  }
  return out;
}

/**
 * #5978 (review af #6213, punkt 2): segmentLoop's kobling. Hjulsidderne ved
 * segmentets start (raa klassement-kontekst), saa tempoet og hooket bruger
 * samme saet (SegmentHookContext.ownRidersOnWheel). Kaldes KUN under
 * orders_gc_v3, og faar derfor altid reaktionens DangerModel (review af #5978,
 * punkt 1): etaper tilbage fra klassement-konteksten, endagsloebets krav-vektor
 * fra finalen.
 */
export function ownRidersOnWheelRaw(
  input: Omit<Parameters<typeof ownRidersOnWheel>[0], "gcContext" | "dangerModel"> & { gcContext: unknown; tuning: EngineTuning; sharedGroupTime?: true },
): OwnRidersOnWheel[] {
  const { tuning, sharedGroupTime, ...rest } = input;
  const gcContext = normalizeGcContext(input.gcContext);
  // Kaldes KUN under orders_gc_v3 og senere; med den faelles gruppeklokke er det official_times_v2 (#5578).
  const gcDanger = timeModelTuningFor({ ordersGcV3: true, ...(sharedGroupTime ? { sharedGroupTime } : {}) }).gcDanger;
  return ownRidersOnWheel({ ...rest, gcContext, dangerModel: dangerModelOf(input.route, tuning, gcContext, gcDanger) });
}

/** #6187: holdets koerende ryttere i gruppen, sorteret. */
function teamRacingRiderIds(group: RaceGroup, teamId: string, riders: Readonly<Record<string, RiderState>>, entrants: Readonly<Record<string, Entrant>>): string[] {
  return group.rider_ids
    .filter((id) => riders[id]?.status === "racing" && teamIdOf(entrants[id]) === teamId)
    .sort((a, b) => a.localeCompare(b));
}

/** #6187: hold med mindst én koerende rytter i gruppen. */
function racingTeamIdsIn(group: RaceGroup, riders: Readonly<Record<string, RiderState>>, entrants: Readonly<Record<string, Entrant>>): Set<string> {
  const teams = new Set<string>();
  for (const riderId of group.rider_ids) {
    if (riders[riderId]?.status !== "racing") continue;
    const teamId = teamIdOf(entrants[riderId]);
    if (teamId) teams.add(teamId);
  }
  return teams;
}

/**
 * #6187: etapens ene linje pr. hold om at holdet ikke foerer, fordi det har
 * folk foran. Kun naar reglen faktisk aendrer noget (en GC-reaktion eller en
 * jagt-ordre der ikke koeres, eller ryttere paa hjul). Ingen tal (fog-gate).
 */
function ownRiderAheadEvent(km: number, teamId: string, groupId: string, riderIds: readonly string[], reason: "gc_reaction" | "chase_order" | "on_wheel", protectedRiderId: string | null): TimelineEvent {
  return {
    km,
    type: "own_riders_ahead",
    params: {
      team_id: teamId,
      group_id: groupId,
      rider_ids: [...riderIds],
      reason,
      ...(protectedRiderId ? { protected_rider_id: protectedRiderId } : {}),
    },
  };
}

/**
 * Bogfoerer segmentets FAKTISKE reaktionsarbejde (hjaelpernes betalte
 * team_cp_factor, inkl. gulvet) og fremskriver hvert holds tilstand. Arbejdet
 * er kumulativt for hele etapen (EngineState.team_reactions).
 */
function finishGcReactions(input: {
  setup: GcReactionSetup;
  before: Readonly<Record<string, RiderState>>;
  after: Readonly<Record<string, RiderState>>;
  prior: Readonly<Record<string, TeamReactionState>> | undefined;
  km: number;
  /** #5978 (review af #5978, punkt 7): etapens sidste segment (kun brugt med snoren, v3). */
  lastSegment: boolean;
}): { teamReactions: Record<string, TeamReactionState> | null; events: TimelineEvent[] } {
  const events: TimelineEvent[] = [];
  let teamReactions: Record<string, TeamReactionState> | null = null;
  for (const decision of input.setup.decisions) {
    let performed = 0;
    if (decision.plan.intensity > 0) {
      for (const riderId of decision.workers) {
        const was = input.before[riderId]?.team_cp_factor;
        const now = input.after[riderId]?.team_cp_factor;
        const wasF = Number.isFinite(was) ? (was as number) : 1;
        const nowF = Number.isFinite(now) ? (now as number) : 1;
        performed += Math.max(0, wasF - nowF);
      }
    }
    const prior = input.prior?.[decision.teamId];
    const advanced = advanceTeamReaction({
      prior,
      threat: decision.threat,
      stance: decision.stance,
      availableWorkers: decision.workers,
      performedWork: performed,
      teamId: decision.teamId,
      km: input.km,
      plan: decision.plan,
      ...(input.setup.leash ? { leash: true, ...(input.lastSegment ? { lastSegment: true } : {}) } : {}),
    });
    events.push(...advanced.events);
    if (advanced.next !== prior && !(prior === undefined && advanced.next.status === "idle" && advanced.next.reason === null)) {
      teamReactions ??= { ...(input.prior ?? {}) };
      teamReactions[decision.teamId] = advanced.next;
    }
  }
  return { teamReactions, events };
}

/**
 * #5978: ét aerligt diagnose-event pr. etape (formations-segmentet) om hvilken
 * GC-kontekst reaktionen arbejder med. Kun under orders_gc_v1; params er kun
 * tilstanden (ingen tal).
 */
function gcContextEvents(ctx: BreakawayHookContext): TimelineEvent[] {
  if (!gcReactionActive(ctx)) return [];
  const gcContext = normalizeGcContext(ctx.gcContext);
  return [{ km: round2(ctx.segment.from_km), type: "gc_context", params: { status: gcContext.status } }];
}

function progressChase(state: EngineState, ctx: BreakawayHookContext): SegmentHookResult {
  const events: TimelineEvent[] = [];
  const breakawayGroups = findBreakawayGroups(state.groups);
  // #5978: under orders_gc_v1 skal et hold der reagerer, kvittere for stoppet
  // ogsaa naar udbruddet er vaek (indhentet): bogfoeringen koerer da alene.
  const gcContext = gcReactionActive(ctx) ? normalizeGcContext(ctx.gcContext) : null;
  const anyReacting = Object.values(state.team_reactions ?? {}).some((r) => r.status === "reacting");
  const gcSetup = gcContext && (breakawayGroups.length > 0 || anyReacting) ? gcReactionSetup(state, ctx, gcContext) : null;
  if (breakawayGroups.length === 0) {
    if (!gcSetup) return { state, events };
    const finished = finishGcReactions({ setup: gcSetup, before: state.riders, after: state.riders, prior: state.team_reactions, km: round2(ctx.segment.to_km), lastSegment: ctx.segmentIndex === ctx.route.segments.length - 1 });
    if (!finished.teamReactions) return { state, events: finished.events };
    return { state: { ...state, team_reactions: finished.teamReactions }, events: finished.events };
  }

  const remainingKmFraction = ctx.route.distance_km > 0 ? clamp(ctx.segment.to_km / ctx.route.distance_km, 0, 1) : 0;
  const segmentLengthKm = Math.max(0, ctx.segment.to_km - ctx.segment.from_km);
  // Evne-referencen (#4707) er hele det koerende felt — ikke kun de to grupper
  // jagten staar imellem — saa en afhaegtet grupetto som "jagt-gruppe" ikke
  // selv flytter skalaen den maales paa.
  const fieldRiderIds = state.groups.flatMap((g) => g.rider_ids);
  const parsedOrders = parseBreakawayOrders(ctx.orders);
  const workByChaseGroup = new Map<string, { plan: ReturnType<typeof teamChasePlan>; km: number }>();
  const pursuitByBreakaway = new Map<string, string>();
  const contactKmByBreakaway = new Map<string, number>(); // #6199, KUN official_times_v2
  const brakeByChaseGroup = new Map<string, { work: Map<string, number>; km: number }>();
  const smallBreakWork: Array<{ riderIds: readonly string[]; pace: ReturnType<typeof smallBreakPaceV3>; km: number }> = []; // #6201

  let groups = state.groups;
  let changed = false;

  const isLastSegment = ctx.segmentIndex === ctx.route.segments.length - 1;
  const formationSegment = ctx.route.segments[FORMATION_SEGMENT_INDEX];
  const formationKm = formationSegment ? formationKmFor(formationSegment) : ctx.segment.from_km;
  const ordersGcV1 = ctx.rulesRevision === "orders_gc_v1";

  // #6187 (KUN orders_gc_v3): et hold foerer aldrig jagten paa en gruppe med
  // egen mand i, og dets udbrydere sidder paa hjul ved en trussel mod holdets
  // GC-rytter. Holdet faar etapens ene forklarende linje foerste gang reglen
  // aendrer noget for det. Under orders_gc_v1/v2 er alt herunder tomt.
  const ordersGcV3 = ctx.ordersGcV3 === true;
  // #5978 (review af #6213, punkt 2): segmentLoop har sat hjulsidderne ud fra
  // tilstanden ved segmentets start (det tempoet blev regnet paa); hooket bruger
  // samme saet. Kaldt uden (direkte hook-tests) regnes det her.
  const onWheel = ordersGcV3 && gcContext
    ? (ctx.ownRidersOnWheel ? [...ctx.ownRidersOnWheel] : ownRidersOnWheel({ groups: state.groups, riders: state.riders, entrants: ctx.entrants, gcContext, route: ctx.route, km: ctx.segment.from_km, dangerModel: dangerModelFor(ctx, gcContext) }))
    : [];
  const wheelSitterIds = new Set(onWheel.flatMap((w) => w.rider_ids));
  const planByBreakaway = new Map<string, ReturnType<typeof teamChasePlan>>();
  const announcedTeams = new Set(state.own_rider_ahead_teams ?? []);
  const ownAheadEvents: TimelineEvent[] = [];
  const announce = (teamId: string, groupId: string, riderIds: readonly string[], reason: "gc_reaction" | "chase_order" | "on_wheel", protectedRiderId: string | null) => {
    if (announcedTeams.has(teamId) || riderIds.length === 0) return;
    announcedTeams.add(teamId);
    // Aldrig foer udbruddet er dannet (linjen ville staa foer "udbrud dannet" i filmen).
    ownAheadEvents.push(ownRiderAheadEvent(round2(Math.max(ctx.segment.from_km, formationKm)), teamId, groupId, riderIds, reason, protectedRiderId));
  };
  if (ordersGcV3 && gcSetup) {
    for (const d of gcSetup.decisions) {
      // Kun naar holdet ellers ville have reageret (neutral, med hjaelpere).
      if (d.threat.reason !== "own_rider_ahead" || d.stance !== "neutral" || d.workers.length === 0) continue;
      const group = state.groups.find((g) => g.id === d.threat.own_rider_group_id);
      if (group) announce(d.teamId, group.id, teamRacingRiderIds(group, d.teamId, state.riders, ctx.entrants), "gc_reaction", d.threat.protected_rider_id);
    }
  }

  for (const breakaway of breakawayGroups) {
    const chaseGroup = findChaseGroup(state.groups, breakaway);
    if (!chaseGroup) continue;
    const ownAheadTeamIds = ordersGcV3 ? racingTeamIdsIn(breakaway, state.riders, ctx.entrants) : undefined;
    // #5955: lad-gaa-balancen under orders_gc_v1 (legacy: 1/1, bit-identisk).
    // #6074: daempet naar mange af jagtgruppens hold lader gaa.
    const letGoShare = ordersGcV1 ? letGoTeamShare({ orders: parsedOrders, chaseGroupRiderIds: chaseGroup.rider_ids, entrants: ctx.entrants, riders: state.riders }) : undefined;
    // #6089: det ekstra lad-gaa-forspring er til et IKKE-farligt udbrud. Rummer
    // udbruddet en alvorlig GC-trussel som et hold i jagtgruppen reagerer paa
    // (samme dom som GC-bremsen), daempes det ekstra som naar hele feltet lader
    // gaa (#6074's gulv), saa en GC-rytter med udbrudsordre ikke faar et forspring
    // der goer ham til klassementets foerer etape efter etape.
    // #5978 (KUN orders_gc_v3): ogsaa et hold der holder snoren paa en rytter i udbruddet.
    const inBreak = (d: TeamGcDecision) => d.threat.threat_rider_ids.some((id) => breakaway.rider_ids.includes(id))
      || (ordersGcV3 && (d.threat.leash_rider_ids ?? []).some((id) => breakaway.rider_ids.includes(id)));
    // #5578 robust (KUN official_times_v2): paa en profil med troje-tolerance goer
    // en trussel kun mod troejen (en svagere udbryder) ikke udbruddet farligt og
    // bremser ikke; den lofter kun forspringet (snoren i gcThreat). Ellers som foer.
    const letGoTuning = timeModelTuningFor(ctx);
    const jerseyTolerance = letGoTuning.gcDanger?.jerseyAllowanceSeconds?.[ctx.route.profile_type] !== undefined;
    const letGoDecisions = gcSetup && jerseyTolerance
      ? gcSetup.decisions.filter((d) => !(d.threat.reason === "leader_jersey_at_risk" && d.threat.leash_hold !== true))
      : gcSetup?.decisions ?? [];
    const dangerous = gcSetup !== null
      && letGoBrakingTeams(letGoDecisions.filter(inBreak), chaseGroup.id, ordersGcV3).size > 0;
    // #6088: et udbrud med staerke ryttere faar ikke det ekstra loft.
    const strength = ordersGcV1 ? breakawayStrength(breakaway.rider_ids, fieldRiderIds, ctx.entrants) : undefined;
    // #6073 (KUN orders_gc_v2 paa rullende): mindre ekstra plads (rollingBreakaway.ts).
    const letGoBalance = rollingLetGoBalance(ctx.rollingBreakawayV2, letGoBalanceFor(ctx.rulesRevision, ctx.route.profile_type, dangerous ? 1 : letGoShare, strength), ORDERS_GC_V1_LET_GO.maxGapFactorByProfile.rolling ?? 1);
    // #6201 (KUN orders_gc_v3): farten foelger antallet der deler foeringerne i dagens udbrud
    // (1-3 mand er langsommere). Ryttere paa hjul (#6187) koerer ikke foran og betaler ikke.
    const smallBreakPullers = breakaway.rider_ids.filter((id) => state.riders[id]?.status === "racing" && !wheelSitterIds.has(id));
    const smallPace = ordersGcV3 && breakaway.origin === "breakaway" ? smallBreakPaceV3(smallBreakPullers.length) : null;
    const letGoRate = BREAKAWAY_EXTRA_TUNING.letGoSecondsPerKm * letGoBalance.rateFactor * (smallPace?.growthScale ?? 1);
    const reactions = gcSetup?.reactionsByChaseGroup.get(chaseGroup.id);
    const chasePlan = teamChasePlan({ orders: parsedOrders, chaseGroupRiderIds: chaseGroup.rider_ids, entrants: ctx.entrants, riders: state.riders, fieldRiderIds, ...(reactions ? { reactions } : {}), ...(ownAheadTeamIds ? { ownRiderAheadTeamIds: ownAheadTeamIds } : {}) });
    const stance = chasePlan.signal;
    // WIRING-GUARD (#4615): en gruppe med kind "breakaway" er ikke
    // noedvendigvis ET udbrud M5 selv dannede — M3's descent attack bruger
    // samme art. Er "udbruddet" ikke foran jagt-gruppen, er der intet hul at
    // lukke, og et blindt kald ville emittere et falsk breakaway_caught.
    if (breakaway.gap_seconds > chaseGroup.gap_seconds) continue;
    // #6187: en jagt-ordre der ikke koeres, fordi holdet har egen mand foran.
    if (ownAheadTeamIds) {
      for (const order of parsedOrders) {
        if (order.breakaway_stance !== "chase" || !ownAheadTeamIds.has(order.team_id)) continue;
        if (teamRacingRiderIds(chaseGroup, order.team_id, state.riders, ctx.entrants).length === 0) continue;
        const protectedId = gcContext ? protectedRiderForTeam({ gcContext, teamId: order.team_id, entrants: ctx.entrants }) : null;
        announce(order.team_id, breakaway.id, teamRacingRiderIds(breakaway, order.team_id, state.riders, ctx.entrants), "chase_order", protectedId);
      }
    }

    // #5812 (a): "lad gaa"-fasen. Kun dagens udbrud (M5's egen oprindelse)
    // faar den — et nedkoerselsangreb (M3) er et angreb feltet reagerer paa
    // med det samme. Segmentets km deles i lad-gaa-km (hullet vokser mod
    // loftet) og jagt-km (jagt-modellen nedenfor lukker).
    let letGoKm = 0;
    // Dagens udbrud findes foerst fra dannelses-km: paa formations-segmentet
    // jages kun resten af segmentet (CodeRabbit-fund), ogsaa uden lad-gaa-fase.
    let chaseKm = breakaway.origin === "breakaway"
      ? Math.max(0, ctx.segment.to_km - Math.max(ctx.segment.from_km, formationKm))
      : segmentLengthKm;
    let maxGapSeconds = 0;
    // #5578: official_times_v2's kalibrerede lad-gaa-knapper (timeModel.ts); neutrale ellers.
    if (breakaway.origin === "breakaway" && isLetGoChaseGroup(chaseGroup.rider_ids.length, letGoTuning.letGoMinChaseRiders ?? undefined)) {
      const finaleFactor = ctx.route.finale_type ? letGoTuning.letGoFinaleFactorByFinale[ctx.route.finale_type] : undefined;
      maxGapSeconds = letGoMaxGapSeconds({
        breakawayRiderIds: breakaway.rider_ids,
        fieldRiderIds,
        entrants: ctx.entrants,
        profileType: ctx.route.profile_type,
        finaleType: ctx.route.finale_type,
        ...(finaleFactor !== undefined ? { finaleFactor } : {}),
      });
      maxGapSeconds *= letGoBalance.maxGapFactor;
      // #6084 (KUN orders_gc_v2 paa bjerg): feltet holder samlet, saa loftet skaleres (mountainSelection.ts).
      if (ctx.mountainSelectionPhase) maxGapSeconds *= phaseLetGoMaxGapScale(ctx.mountainSelectionPhase, mountainSelectionKnobsFor(ctx.route.profile_type).letGoMaxGapScale);
      // #6199 (KUN official_times_v2): uden v3s ikke-fysiske lukning paa nedkoerslen
      // skal jagten hente det fysisk; feltet giver derfor et andet lad-gaa-loft,
      // #5578: kalibreret pr. etapeprofil mod udbrudsmaalene.
      maxGapSeconds *= letGoTuning.letGoMaxGapScaleByProfile[ctx.route.profile_type] ?? letGoTuning.letGoMaxGapScale;
      // #5578 (KUN official_times_v2, udbrudsmaal 6): et farligt udbrud vokser aldrig
      // forbi det mindste forspring de bremsende hold tolererer. #5578 robust: ogsaa
      // troejens tolerance lofter (alle reagerende hold, ikke kun de farlige).
      if (letGoTuning.letGoCapAtTolerated && gcSetup) {
        const tolerated = [...letGoBrakingTeams(gcSetup.decisions.filter(inBreak), chaseGroup.id, ordersGcV3).values()];
        if (tolerated.length > 0) maxGapSeconds = Math.min(maxGapSeconds, Math.max(INITIAL_GAP_SECONDS, Math.min(...tolerated)));
      }
      ({ letGoKm, chaseKm } = letGoSplitKm({
        formationKm,
        maxGapSeconds,
        fromKm: ctx.segment.from_km,
        toKm: ctx.segment.to_km,
        secondsPerKm: letGoRate,
      }));
    }
    const priorWork = workByChaseGroup.get(chaseGroup.id);
    // #5978 (review af #6213, punkt 1, KUN orders_gc_v3): planerne kan vaere
    // forskellige pr. udbrud (egne ryttere foran). Arbejdet flettes pr. rytter
    // (max) paa tvaers af udbruddene bag samme jagtgruppe, saa raekkefoelgen
    // aldrig afgoer om et hold betaler. Under v1/v2 er planerne ens: sidste vinder.
    const mergedPlan = ordersGcV3 && priorWork ? mergeChasePlans(priorWork.plan, chasePlan) : chasePlan;
    workByChaseGroup.set(chaseGroup.id, { plan: mergedPlan, km: Math.max(priorWork?.km ?? 0, chaseKm) });
    if (ordersGcV3) planByBreakaway.set(breakaway.id, chasePlan); // #6187: filmens "hvem hentede" pr. udbrud
    // #5955 (ejer-valg B, KUN orders_gc_v1 via gcSetup): GC-bremsen i lad-gaa-fasen.
    const brake = gcSetup && letGoKm > 0 ? letGoBrake({ chaserWork: chasePlan.chaserWork, braking: letGoBrakingTeams(letGoDecisions, chaseGroup.id, ordersGcV3), entrants: ctx.entrants, riders: state.riders, ...(ordersGcV3 ? { maxBrake: LET_GO_BRAKE_TUNING.leashMaxBrake } : {}) }) : null;
    const braked = brake ? brakedLetGoGrowth({ separationSeconds: chaseGroup.gap_seconds - breakaway.gap_seconds, growthSeconds: letGoKm * letGoRate, fraction: brake.fraction, toleratedSeconds: brake.toleratedSeconds, ceilingSeconds: maxGapSeconds }) : null;
    if (brake && braked && braked.brakedShare > 0) {
      const priorBrake = brakeByChaseGroup.get(chaseGroup.id);
      const work = ordersGcV3 && priorBrake ? mergeWork(priorBrake.work, brake.work) : brake.work; // #5978: som jagt-arbejdet
      brakeByChaseGroup.set(chaseGroup.id, { work, km: Math.max(priorBrake?.km ?? 0, letGoKm * braked.brakedShare) });
    }

    const netAdvantage = computeNetChaseAdvantage({
      chaseGroupRiderIds: chaseGroup.rider_ids,
      breakawayRiderIds: breakaway.rider_ids,
      entrants: ctx.entrants,
      finaleType: ctx.route.finale_type,
      remainingKmFraction,
      stance,
      fieldRiderIds,
      // #6187: ryttere paa hjul koerer ikke foran i udbruddet.
      ...(breakaway.rider_ids.some((id) => wheelSitterIds.has(id)) ? { pullingBreakawayRiderIds: breakaway.rider_ids.filter((id) => !wheelSitterIds.has(id)) } : {}),
    });
    // WIRING-GUARD (#4615): jagt-interessen kan KUN lukke et hul, aldrig aabne
    // et. En holdordre (stancen) virker kun gennem jagten, saa den kan aldrig
    // SKABE et forspring (mor-spec §5: spillerens valg kan aldrig vaelte et
    // loeb). Hullet vokser KUN i lad-gaa-fasen ovenfor, som ingen ordre roerer
    // under legacy (under orders_gc_v1 kan GC-bremsen kun DAEMPE vaeksten, #5955).
    // #5813 (del 2): paa aabent terraen overtager feltet jagten i etapens
    // sidste km (jagt-gulvet). De km jages ikke af netto-fordelen.
    const floorKm = chaseFloorKm({
      profileType: ctx.route.profile_type,
      distanceKm: ctx.route.distance_km,
      toKm: ctx.segment.to_km,
      chaseKm,
    });
    // #5812: jagten virker kun paa segmentets jagt-km.

    const netClosingRaw = Math.max(
      0,
      netAdvantage * (chaseKm - floorKm) * BREAKAWAY_EXTRA_TUNING.closingSecondsPerKmPerUnit,
    );
    // #6084 (KUN orders_gc_v2 paa bjerg): kontrolleret jagt foer finalestigningen (mountainSelection.ts).
    // En GC-reaktion (et farligt udbrud) jager uden daempning.
    const netClosingSeconds = (ctx.mountainSelectionPhase && !(reactions && reactions.size > 0) ? netClosingRaw * phaseChaseClosingScale(ctx.mountainSelectionPhase, mountainSelectionKnobsFor(ctx.route.profile_type).preFinalChaseClosingScale, mountainSelectionKnobsFor(ctx.route.profile_type).finalChaseClosingScale) : netClosingRaw) * (smallPace?.closingScale ?? 1);
    if (smallPace) smallBreakWork.push({ riderIds: smallBreakPullers, pace: smallPace, km: letGoKm + chaseKm });
    const letGoGrowth = braked ? braked.growthSeconds : letGoKm * letGoRate;

    // Jagten maales paa SEPARATIONEN mellem de to grupper, ikke paa jagt-
    // gruppens absolutte gap (#4615). Begge felter er "sekunder bag fronten",
    // og hvem der ER fronten afhaenger af hvornaar i segmentet hooket kaldes:
    // paa formations-segmentet er pelotonen stadig 0 og udbruddet negativt,
    // paa alle senere segmenter er det omvendt (segmentLoop rebaseliner efter
    // hvert hook-kald). Blev jagten maalt paa jagt-gruppens eget gap, ville et
    // udbrud dannet i dette segment fremstaa fanget med det samme.
    //
    // The pursuer closes by advancing. Closing alone never delays escapees.
    const currentChase = groups.find((g) => g.id === chaseGroup.id);
    const currentBreakaway = groups.find((g) => g.id === breakaway.id);
    if (!currentChase || !currentBreakaway) continue;
    const separation = chaseGroup.gap_seconds - breakaway.gap_seconds;
    // Lad gaa: hullet vokser mod loftet, men et hul der allerede er over
    // loftet (fx et nedkoerselsforspring) krympes aldrig af fasen selv.
    const grown = separation >= 0 && separation < maxGapSeconds ? Math.min(maxGapSeconds, separation + letGoGrowth) : separation;
    const beforeFloor = Math.max(0, grown - netClosingSeconds);
    // Jagt-gulvet: dagens maal er én lodtraekning pr. ETAPE (rngForStage, ikke
    // den segment-noeglede stream): "kommer sprinterholdene for sent i dag" er
    // en beslutning om etapen, og den maa ikke skifte med segmentinddelingen.
    // Streamen genskabes pr. kald, saa lodtraekningen er den samme paa hvert
    // segment i vinduet.
    const floorClosingSeconds = floorKm > 0
      ? chaseFloorClosingSeconds({
          separationSeconds: beforeFloor,
          floorKm,
          kmToFinish: ctx.route.distance_km - (ctx.segment.to_km - floorKm),
          targetGapSeconds: chaseFloorTargetGapSeconds(ctx.route, ctx.rngForStage("breakaway_chase_floor")()),
        })
      : 0;

    // Let-go growth advances the escape; active closing advances the pursuer.
    // Multiple targets share one pursuing group's movement instead of stacking it.
    const growthSeconds = grown - separation;
    const newBreakawayGap = breakaway.gap_seconds - growthSeconds;
    // #6199/#6200 (review af #6223, KUN orders_gc_v3): paa en nedkoersel mod maal deler
    // jagten loftet med regrupperingen, M3-angrebene og finalen (bogen, mechanics/timeModel.ts).
    const v3DescentBook = (ordersGcV3 || ctx.sharedGroupTime !== undefined) && isLastSegment && ctx.segment.kind === "descent" ? (state.finish_descent_regroup ?? {}) : null;
    const closingSeconds = Math.min(v3DescentBook ? finishDescentRemainingCapSeconds(separation, segmentLengthKm, v3DescentBook[chaseGroup.id]) : Infinity, netClosingSeconds + floorClosingSeconds);
    const newChaseGap = Math.min(currentChase.gap_seconds, Math.max(newBreakawayGap, chaseGroup.gap_seconds - closingSeconds));
    const v3Booked = v3DescentBook ? bookFinishDescentClosure(state.finish_descent_regroup, chaseGroup.id, chaseGroup.gap_seconds, currentChase.gap_seconds - newChaseGap) : undefined;
    if (v3Booked && v3Booked !== state.finish_descent_regroup) state = { ...state, finish_descent_regroup: v3Booked };
    groups = groups.map((g) => g.id === breakaway.id ? { ...g, gap_seconds: newBreakawayGap } : g.id === chaseGroup.id ? { ...g, gap_seconds: newChaseGap } : g);
    changed = true;
    pursuitByBreakaway.set(breakaway.id, chaseGroup.id);
    // #6199 (KUN official_times_v2): where this chase meets the break (exactPlace.ts).
    if (ctx.sharedGroupTime !== undefined && ordersGcV3) {
      const contactKm = pursuitContactKm({ toKm: ctx.segment.to_km, chaseKm, floorKm, netClosingSeconds, floorClosingSeconds, closingSeconds, separationSeconds: grown });
      if (contactKm !== null) contactKmByBreakaway.set(breakaway.id, Math.max(ctx.segment.from_km, contactKm));
    }
  }

  // All targets share the final advance. Only these final positions decide outcomes.
  for (const [breakawayId, chaseId] of pursuitByBreakaway) {
    const breakaway = groups.find(group => group.id === breakawayId);
    const chase = groups.find(group => group.id === chaseId);
    if (!breakaway || !chase) continue;
    const newGap = chase.gap_seconds - breakaway.gap_seconds;
    const caught = ctx.sharedGroupTime ? newGap <= GROUP_CLOCK_CONTACT_EPSILON : newGap < ctx.tuning.groups.mergeThresholdSeconds;
    // #6234 (KUN orders_gc_v3): et afsat stykke af udbruddet der lukker hullet, er kommet tilbage, ikke en indhentning.
    if (caught && ordersGcV3 && isBreakawayPiece(chase)) {
      groups = rejoinBreakawayPiece(groups, chase.id, breakawayId);
      events.push({ km: round2(ctx.segment.to_km), type: "group_merged", params: { group_id: chase.id, into_group_id: breakawayId, rider_ids: [...chase.rider_ids],
        ...(contactKmByBreakaway.has(breakawayId) ? { exact_km: contactKmByBreakaway.get(breakawayId) } : {}) } });
    } else if (caught) {
      groups = groups.map(group => group.id === breakawayId ? { ...group, gap_seconds: Math.min(group.gap_seconds, chase.gap_seconds) } : group);
      events.push({
        km: round2(ctx.segment.to_km),
        type: "breakaway_caught",
        // #6050 (ADDITIV, kun fortaelling): hvem hentede udbruddet. chasing_team_ids =
        // de hold der havde ryttere i jagt-arbejde i det segment hvor hullet lukkede.
        // #6187 (KUN orders_gc_v3): planen for netop DETTE udbrud, saa et hold der
        // ikke jagede det (egen mand foran) aldrig staar som den der hentede det.
        params: { group_id: breakaway.id, rider_ids: [...breakaway.rider_ids], ...catchActorParams(chase, (ordersGcV3 ? planByBreakaway.get(breakawayId) : workByChaseGroup.get(chaseId)?.plan)?.chaserWork, ctx.entrants),
          ...(contactKmByBreakaway.has(breakawayId) ? { exact_km: contactKmByBreakaway.get(breakawayId) } : {}) },
      });
    } else if (isLastSegment) {
      events.push({
        km: round2(ctx.segment.to_km),
        type: "breakaway_survived",
        params: { group_id: breakaway.id, rider_ids: [...breakaway.rider_ids], gap_seconds: round2(newGap) },
      });
    }
  }

  // #5570: jagten koster. Kun naar der faktisk var et udbrud foran at jage
  // (wiring-guarden ovenfor), og kun én gang pr. segment uanset antal udbrud.
  // #5812: kun for de km der faktisk jages — i lad-gaa-fasen jager ingen.
  let updatedRiders = state.riders;
  for (const { plan, km } of workByChaseGroup.values()) {
    const share = ctx.route.distance_km > 0 ? clamp(km / ctx.route.distance_km, 0, 1) : 0;
    updatedRiders = applyChaseCost(updatedRiders, plan.chaserWork, share) ?? updatedRiders;
  }
  // #5955: bremsen er arbejde — de bremsende betaler for de bremsede lad-gaa-km,
  // aldrig for km der allerede er betalt som jagt-km i samme segment.
  for (const [chaseId, { work, km }] of brakeByChaseGroup) {
    const brakeKm = Math.min(km, Math.max(0, segmentLengthKm - (workByChaseGroup.get(chaseId)?.km ?? 0)));
    const share = ctx.route.distance_km > 0 ? clamp(brakeKm / ctx.route.distance_km, 0, 1) : 0;
    updatedRiders = applyChaseCost(updatedRiders, work, share) ?? updatedRiders;
  }
  // #6201: faa deler foeringerne i et lille udbrud, og de betaler for det.
  for (const w of smallBreakWork) updatedRiders = applySmallBreakPullCost(updatedRiders, w.riderIds, w.pace, ctx.route.distance_km > 0 ? w.km / ctx.route.distance_km : 0) ?? updatedRiders;
  const riders = updatedRiders === state.riders ? null : updatedRiders;

  // #5978: bogfoer det faktiske reaktionsarbejde og kvitter tilstandsskift.
  let teamReactions: Record<string, TeamReactionState> | null = null;
  if (gcSetup) {
    const finished = finishGcReactions({ setup: gcSetup, before: state.riders, after: updatedRiders, prior: state.team_reactions, km: round2(ctx.segment.to_km), lastSegment: isLastSegment });
    events.push(...finished.events);
    teamReactions = finished.teamReactions;
  }

  // #6187: paa-hjul-linjen (efter reaktion/jagt-ordre, saa én grund pr. hold).
  for (const w of onWheel) announce(w.team_id, w.group_id, w.rider_ids, "on_wheel", w.protected_rider_id);
  events.push(...ownAheadEvents);
  const ownAheadTeams = ownAheadEvents.length > 0 ? [...announcedTeams].sort((a, b) => a.localeCompare(b)) : null;

  if (!changed && !riders && !teamReactions && !ownAheadTeams) return { state, events };
  const frontGap = Math.min(...groups.map((group) => group.gap_seconds));
  const rebasedGroups = !ctx.sharedGroupTime && frontGap < 0 ? groups.map((group) => ({ ...group, gap_seconds: group.gap_seconds - frontGap })) : groups;
  return {
    state: {
      ...state, groups: rebasedGroups, ...(riders ? { riders } : {}), ...(teamReactions ? { team_reactions: teamReactions } : {}),
      ...(ownAheadTeams ? { own_rider_ahead_teams: ownAheadTeams } : {}),
    },
    events,
  };
}

/**
 * M5-hook: udbrud v2 (jagt-interesse + T3-ordrer). Kaldes paa HVERT segment
 * (se filens toppe-kommentar punkt 2 for wiring-behov) — formation forsoeges
 * kun paa FORMATION_SEGMENT_INDEX, jagt-fremdrift evalueres paa alle
 * efterfoelgende segmenter mens en udbruds-gruppe eksisterer. REN: intet input
 * muteres, samme (state, ctx) -> samme output.
 */
export const breakawayHook: BreakawayHook = (state: EngineState, ctx: BreakawayHookContext): SegmentHookResult => {
  const result = breakawayHookCore(state, ctx);
  // #6185 del 2 (KUN orders_gc_v3): motoren melder selv "sat af fra udbruddet" (chaseGroup.ts).
  return ctx.ordersGcV3 === true ? withBreakawayDrops(result, round2(ctx.segment.to_km)) : result;
};

const breakawayHookCore: BreakawayHook = (state: EngineState, ctx: BreakawayHookContext): SegmentHookResult => {
  if (ctx.segmentIndex === FORMATION_SEGMENT_INDEX && findBreakawayGroups(state.groups).length === 0) {
    // #5955: regel-revisionen vaelger dannelses-politikken. Legacy (default,
    // fixtures og alle loeb bundet foer orders_gc_v1) er uaendret.
    const formationResult = ctx.rulesRevision === "orders_gc_v1"
      ? attemptOrderedFormation(state, ctx)
      : attemptFormation(state, ctx, flattenTryBreakRiderIds(parseBreakawayOrders(ctx.orders)));
    // #5812: dannede vi et udbrud i DETTE segment, koerer resten af segmentet
    // (fra dannelses-km) gennem samme lad-gaa/jagt-opdeling som alle andre
    // segmenter. Paa et kort foerste segment er det ren lad-gaa-fase; paa et
    // langt (legacy-rute) naar jagten ogsaa at begynde. Foer (#4615) fik
    // formations-segmentet ingen fremdrift, fordi en fuld segment-laengdes
    // jagt ellers udslettede hovedstarten.
    const progressed = progressChase(formationResult.state, ctx);
    return { state: progressed.state, events: [...gcContextEvents(ctx), ...formationResult.events, ...progressed.events] };
  }
  return progressChase(state, ctx);
};
