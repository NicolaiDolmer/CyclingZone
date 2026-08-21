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
// ARKITEKTUR-NOTE (vigtig — laes foer wiring): dette modul er bygget som en NY
// fil under mechanics/ (hard rule for denne worker: ma IKKE aendre types.ts/
// index.ts/segmentLoop.ts/groups.ts). Konsekvenser af det:
//
//  1. types.ts's `TeamOrder` er I DAG et LOEST F3-placeholder-udkast
//     (`{ team_id, kind, params? }`, jf. types.ts's egen kommentar over typen)
//     — IKKE endnu tactics-orders-v1-specens frosne form. Dette modul definerer
//     derfor sin EGEN lokale ordre-type (`BreakawayTeamOrder`, se nedenfor) der
//     matcher specens T3-kontrakt 1:1. Naar arkitekten laaser `TeamOrder` om til
//     specens form, er `BreakawayTeamOrder` allerede strukturelt identisk —
//     ingen kode her aendrer sig, kun typen den importeres fra.
//  2. `SegmentHookContext` (types.ts) baerer i dag INGEN `orders`-felt. Dette
//     modul udvider konteksten lokalt (`BreakawayHookContext = SegmentHookContext
//     & { orders?: readonly BreakawayTeamOrder[] }`) saa hooket er kalbart UDEN
//     at types.ts's frosne kontrakt aendres. Wiring-behov (beskrevet fuldt i
//     PR-body): segmentLoop.ts skal (a) laese `input.orders` og laegge dem paa
//     ctx som `orders`, (b) kalde `breakawayHook(state, ctx)` PAA HVERT segment
//     (ikke kind-gated som climb/descent) — bade formation (segmentIndex===0)
//     og jagt-fremdrift (hvert efterfoelgende segment) sker inde i dette ETT
//     hook-kald — placeret EFTER climb/descent-hooket og FOER finale-hooket (saa
//     finale.ts ser det korrekte front-gruppe-billede naar en overlevet udbryder
//     skal placeres). `MechanicHooks` (types.ts) skal have et `breakaway`-felt;
//     `index.ts`'s `LIVE_MECHANIC_HOOKS` skal wire `breakawayHook` ind.
//  3. `Entrant` baerer intet `team_id` — dette modul har derfor IKKE behov for en
//     rider->team-mapping: `try_break` laeses direkte fra
//     `order.riders[].rider_id`, og hold-stance aggregeres holdvist (se
//     `stanceSignal`) uden at skulle vide HVILKE ryttere der hoerer til hvilket
//     hold. Bevidst forenkling for v1 (bounded, jf. specens T3-krav) — en
//     rigere per-hold-model (kun sprinterhold-stancer taeller) er en naturlig
//     F3+-opfoelgning naar team_id naar Entrant-kontrakten.
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
//    forstaerker, let_go daemper — clamp forhindrer fortegns-omvending).
//  - Fanget: naar den akkumulerede lukning bringer jagt-gruppens gap under
//    `tuning.groups.mergeThresholdSeconds`, emitteres `breakaway_caught` —
//    den FAKTISKE sammensmeltning sker af segmentLoop's egen `mergeGroups`-kald
//    (som koerer LIGE EFTER hooks, samme moenster som descent.ts/climbSelection.ts).
//  - Overlevet: hvis udbruddet stadig eksisterer som egen gruppe paa etapens
//    SIDSTE segment, emitteres `breakaway_survived` (finale.ts afgoer derefter
//    om forspringet baeres helt i maal eller indhentes i selve finalen).

import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  RaceGroup,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { BREAKAWAY_EXTRA_TUNING } from "../tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function normAbility(v: number | undefined): number {
  return clamp(Number(v) || 0, 0, 99) / 99;
}

// ── Lokal ordre-kontrakt (T3, tactics-orders-v1-design.md) ────────────────────
// Se filens toppe-kommentar punkt 1: matcher specens frosne form 1:1, men
// importeres IKKE fra types.ts (som endnu ikke baerer den).

export type BreakawayStance = "chase" | "neutral" | "let_go";

export type BreakawayTeamOrder = {
  team_id: string;
  breakaway_stance: BreakawayStance;
  riders: Array<{ rider_id: string; try_break: boolean }>;
};

// ── Lokal kontekst-udvidelse (se filens toppe-kommentar punkt 2) ──────────────

export type BreakawayHookContext = SegmentHookContext & {
  orders?: readonly BreakawayTeamOrder[];
};

export type BreakawayHook = (state: EngineState, ctx: BreakawayHookContext) => SegmentHookResult;

// ── Formation (lokale konstanter — samme "intern implementeringsdetalje"-
// praecedens som climbSelection.ts's GRADIENT_NORM_PCT: kun de reelt kali-
// brerbare haandtag ligger i tuning.ts's BREAKAWAY_EXTRA_TUNING) ──────────────

const FORMATION_SEGMENT_INDEX = 0;
const MIN_BREAKAWAY_SIZE = 2;
const MAX_BREAKAWAY_SIZE = 8;
const INITIAL_GAP_SECONDS = 25; // hovedstart ved formation (reelle udbrud har typisk allerede et forspring km 1)

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

/** Kandidat-score (stoej-fri): vaegtet aggression/endurance/tempo + bounded try_break-boost. */
export function computeJoinScore(abilities: Record<AbilityKey, number>, tryBreak: boolean): number {
  const base =
    JOIN_SCORE_WEIGHTS.aggression * normAbility(abilities.aggression) +
    JOIN_SCORE_WEIGHTS.endurance * normAbility(abilities.endurance) +
    JOIN_SCORE_WEIGHTS.tempo * normAbility(abilities.tempo);
  return clamp(base + (tryBreak ? TRY_BREAK_SCORE_BOOST : 0), 0, 1);
}

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
    const tryBreak = tryBreakRiderIds.has(riderId);
    const score = computeJoinScore(entrant.abilities, tryBreak);
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
  });

  events.push({
    km: round2(ctx.segment.to_km),
    type: "breakaway_formed",
    params: { group_id: newGroupId, rider_ids: [...selected] },
  });

  return { state: { ...state, groups }, events };
}

// ── Jagt-interesse (#2416) ─────────────────────────────────────────────────────

const CHASE_ENGINE_KEYS: AbilityKey[] = ["endurance", "tempo"];
const GC_THREAT_KEYS: AbilityKey[] = ["climbing", "tempo", "time_trial"];

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

/** Holdstance -> signeret signal i [-1, 1] (chase=+1, neutral=0, let_go=-1), gennemsnit over hold der HAR afgivet en ordre. */
export function stanceSignal(orders: readonly BreakawayTeamOrder[] | undefined): number {
  if (!orders || orders.length === 0) return 0;
  let sum = 0;
  for (const order of orders) {
    if (order.breakaway_stance === "chase") sum += 1;
    else if (order.breakaway_stance === "let_go") sum -= 1;
  }
  return clamp(sum / orders.length, -1, 1);
}

function finaleTypeChaseWeight(finaleType: FinaleType | null): number {
  if (!finaleType) return BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeightDefault;
  return BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeight[finaleType] ?? BREAKAWAY_EXTRA_TUNING.finaleTypeChaseWeightDefault;
}

/**
 * Netto jagt-fordel for ÉT segment (eksporteret for direkte kontrakt-tests).
 * Positiv => jagt-gruppen lukker hullet; negativ => udbruddet trækker fra.
 * BOUNDED af stance-multiplikatoren (clamp forhindrer fortegns-omvending fra
 * en enkelt holdordre alene, jf. mor-spec §5's "spillerens valg aldrig kan
 * vaelte et loeb").
 */
export function computeNetChaseAdvantage(input: {
  chaseGroupRiderIds: string[];
  breakawayRiderIds: string[];
  entrants: Readonly<Record<string, Entrant>>;
  finaleType: FinaleType | null;
  remainingKmFraction: number; // 0 (etapestart) .. 1 (maal)
  stance: number; // [-1, 1], se stanceSignal
}): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  const sprinterInterest = collectiveAbility(input.chaseGroupRiderIds, input.entrants, ["sprint"]) * finaleTypeChaseWeight(input.finaleType);
  const gcThreat = collectiveAbility(input.breakawayRiderIds, input.entrants, GC_THREAT_KEYS);
  const lateRaceUrgency = clamp(input.remainingKmFraction, 0, 1);

  const enginePower = collectiveAbility(input.breakawayRiderIds, input.entrants, CHASE_ENGINE_KEYS);
  const countFactor = clamp(input.breakawayRiderIds.length / extra.breakawayReferenceCount, 0, 1.5);

  const chaseForce =
    extra.sprinterInterestWeight * sprinterInterest +
    extra.gcThreatWeight * gcThreat +
    extra.lateRaceUrgencyWeight * lateRaceUrgency;
  const breakawayResistance = extra.enginePowerResistanceWeight * enginePower + extra.countResistanceWeight * countFactor;

  const netAdvantage = chaseForce - breakawayResistance;
  const stanceMultiplier = clamp(1 + extra.stanceEffectWeight * input.stance, extra.stanceMultiplierBounds[0], extra.stanceMultiplierBounds[1]);
  return netAdvantage * stanceMultiplier;
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

/** Den stoerste ikke-udbruds-gruppe = jagt-gruppen (typisk peloton). */
function findChaseGroup(groups: RaceGroup[]): RaceGroup | null {
  const rest = groups.filter((g) => g.kind !== "breakaway").sort((a, b) => b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id));
  return rest[0] ?? null;
}

function progressChase(state: EngineState, ctx: BreakawayHookContext): SegmentHookResult {
  const events: TimelineEvent[] = [];
  const breakawayGroups = findBreakawayGroups(state.groups);
  if (breakawayGroups.length === 0) return { state, events };

  const chaseGroup = findChaseGroup(state.groups);
  if (!chaseGroup) return { state, events };

  const remainingKmFraction = ctx.route.distance_km > 0 ? clamp(ctx.segment.to_km / ctx.route.distance_km, 0, 1) : 0;
  const stance = stanceSignal(ctx.orders);
  const segmentLengthKm = Math.max(0, ctx.segment.to_km - ctx.segment.from_km);

  let groups = state.groups;
  let changed = false;
  const isLastSegment = ctx.segmentIndex === ctx.route.segments.length - 1;

  for (const breakaway of breakawayGroups) {
    const netAdvantage = computeNetChaseAdvantage({
      chaseGroupRiderIds: chaseGroup.rider_ids,
      breakawayRiderIds: breakaway.rider_ids,
      entrants: ctx.entrants,
      finaleType: ctx.route.finale_type,
      remainingKmFraction,
      stance,
    });
    const closingSeconds = netAdvantage * segmentLengthKm * BREAKAWAY_EXTRA_TUNING.closingSecondsPerKmPerUnit;

    // Kun jagt-gruppens gap AENDRES (hoved-invarianten laner gap_seconds som
    // "afstand til fronten" — descent.ts/climbSelection.ts's samme moenster).
    const currentChase = groups.find((g) => g.id === chaseGroup.id);
    if (!currentChase) continue;
    const newGap = Math.max(0, currentChase.gap_seconds - closingSeconds);
    groups = groups.map((g) => (g.id === chaseGroup.id ? { ...g, gap_seconds: newGap } : g));
    changed = true;

    const caught = newGap < ctx.tuning.groups.mergeThresholdSeconds;
    if (caught) {
      events.push({
        km: round2(ctx.segment.to_km),
        type: "breakaway_caught",
        params: { group_id: breakaway.id, rider_ids: [...breakaway.rider_ids] },
      });
    } else if (isLastSegment) {
      events.push({
        km: round2(ctx.segment.to_km),
        type: "breakaway_survived",
        params: { group_id: breakaway.id, rider_ids: [...breakaway.rider_ids], gap_seconds: round2(newGap) },
      });
    }
  }

  if (!changed) return { state, events };
  return { state: { ...state, groups }, events };
}

/**
 * M5-hook: udbrud v2 (jagt-interesse + T3-ordrer). Kaldes paa HVERT segment
 * (se filens toppe-kommentar punkt 2 for wiring-behov) — formation forsoeges
 * kun paa FORMATION_SEGMENT_INDEX, jagt-fremdrift evalueres paa alle
 * efterfoelgende segmenter mens en udbruds-gruppe eksisterer. REN: intet input
 * muteres, samme (state, ctx) -> samme output.
 */
export const breakawayHook: BreakawayHook = (state: EngineState, ctx: BreakawayHookContext): SegmentHookResult => {
  if (ctx.segmentIndex === FORMATION_SEGMENT_INDEX && findBreakawayGroups(state.groups).length === 0) {
    const tryBreakRiderIds = flattenTryBreakRiderIds(ctx.orders);
    const formationResult = attemptFormation(state, ctx, tryBreakRiderIds);
    const chaseResult = progressChase(formationResult.state, ctx);
    return { state: chaseResult.state, events: [...formationResult.events, ...chaseResult.events] };
  }
  return progressChase(state, ctx);
};
