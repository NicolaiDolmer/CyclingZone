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

import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  TeamOrder,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { BREAKAWAY_EXTRA_TUNING, EFFORT_GAIN_EXTRA_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { helperCostMultiplier } from "./teamPlay.ts";

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

/**
 * En leder trækker ikke jagten: kaptajnen og sprint-kaptajnen er dem holdet
 * jager FOR (samme rolle-skel som M16's WORKER_ROLES/protectedRoleOrder).
 */
const CHASE_EXEMPT_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

function teamIdOf(entrant: Entrant | undefined): string | null {
  const raw = entrant?.team_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
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
}): TeamChasePlan {
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
}): number {
  const extra = BREAKAWAY_EXTRA_TUNING;
  const fieldRiderIds =
    input.fieldRiderIds && input.fieldRiderIds.length > 0
      ? input.fieldRiderIds
      : [...input.chaseGroupRiderIds, ...input.breakawayRiderIds];
  const abilityScale = chaseAbilityScale(fieldRiderIds, input.entrants);

  const sprinterInterest =
    collectiveAbility(input.chaseGroupRiderIds, input.entrants, ["sprint"]) * abilityScale * finaleTypeChaseWeight(input.finaleType);
  const gcThreat = collectiveAbility(input.breakawayRiderIds, input.entrants, GC_THREAT_KEYS) * abilityScale;
  const lateRaceUrgency = clamp(input.remainingKmFraction, 0, 1);

  const enginePower = collectiveAbility(input.breakawayRiderIds, input.entrants, CHASE_ENGINE_KEYS) * abilityScale;
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
  const segmentLengthKm = Math.max(0, ctx.segment.to_km - ctx.segment.from_km);
  // Evne-referencen (#4707) er hele det koerende felt — ikke kun de to grupper
  // jagten staar imellem — saa en afhaegtet grupetto som "jagt-gruppe" ikke
  // selv flytter skalaen den maales paa.
  const fieldRiderIds = state.groups.flatMap((g) => g.rider_ids);
  // #5570: holdspecifik jagt gennem holdenes egne ryttere i jagt-gruppen.
  // Regnes én gang pr. segment — jagt-gruppen er den samme for alle udbrud.
  const chasePlan = teamChasePlan({
    orders: parseBreakawayOrders(ctx.orders),
    chaseGroupRiderIds: chaseGroup.rider_ids,
    entrants: ctx.entrants,
    riders: state.riders,
    fieldRiderIds,
  });
  const stance = chasePlan.signal;

  let groups = state.groups;
  let changed = false;
  let chased = false;
  const isLastSegment = ctx.segmentIndex === ctx.route.segments.length - 1;

  for (const breakaway of breakawayGroups) {
    // WIRING-GUARD (#4615): en gruppe med kind "breakaway" er ikke
    // noedvendigvis ET udbrud M5 selv dannede — M3's descent attack bruger
    // samme art. Er "udbruddet" ikke foran jagt-gruppen, er der intet hul at
    // lukke, og et blindt kald ville emittere et falsk breakaway_caught.
    if (breakaway.gap_seconds > chaseGroup.gap_seconds) continue;
    chased = true;

    const netAdvantage = computeNetChaseAdvantage({
      chaseGroupRiderIds: chaseGroup.rider_ids,
      breakawayRiderIds: breakaway.rider_ids,
      entrants: ctx.entrants,
      finaleType: ctx.route.finale_type,
      remainingKmFraction,
      stance,
      fieldRiderIds,
    });
    // WIRING-GUARD (#4615): jagt-interessen kan KUN lukke et hul, aldrig aabne
    // et. Farten (og dermed hvor meget et udbrud traekker fra) afgoeres af
    // segmentLoop's egen tempo-model; lod vi et negativt netto tilfoeje
    // sekunder her, ville M5 bogfoere det samme forspring to gange — og en
    // holdordre kunne dermed SKABE et forspring i stedet for at paavirke
    // jagten paa det (mor-spec §5: spillerens valg kan aldrig vaelte et loeb).
    const closingSeconds = Math.max(
      0,
      netAdvantage * segmentLengthKm * BREAKAWAY_EXTRA_TUNING.closingSecondsPerKmPerUnit,
    );

    // Jagten maales paa SEPARATIONEN mellem de to grupper, ikke paa jagt-
    // gruppens absolutte gap (#4615). Begge felter er "sekunder bag fronten",
    // og hvem der ER fronten afhaenger af hvornaar i segmentet hooket kaldes:
    // paa formations-segmentet er pelotonen stadig 0 og udbruddet negativt,
    // paa alle senere segmenter er det omvendt (segmentLoop rebaseliner efter
    // hvert hook-kald). Blev jagten maalt paa jagt-gruppens eget gap, ville et
    // udbrud dannet i dette segment fremstaa fanget med det samme.
    //
    // Det er UDBRUDDETS gap der flyttes mod jagt-gruppen: separationen kan
    // dermed aldrig blive negativ (jagten overhaler ikke det den jager), og
    // jagt-gruppens eget gap — som segmentLoop's tempo-model ejer — roeres ikke.
    const currentChase = groups.find((g) => g.id === chaseGroup.id);
    const currentBreakaway = groups.find((g) => g.id === breakaway.id);
    if (!currentChase || !currentBreakaway) continue;
    const separation = currentChase.gap_seconds - currentBreakaway.gap_seconds;
    const newSeparation = Math.max(0, separation - closingSeconds);
    const newBreakawayGap = currentChase.gap_seconds - newSeparation;
    groups = groups.map((g) => (g.id === breakaway.id ? { ...g, gap_seconds: newBreakawayGap } : g));
    changed = true;

    const newGap = newSeparation;
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

  // #5570: jagten koster. Kun naar der faktisk var et udbrud foran at jage
  // (wiring-guarden ovenfor), og kun én gang pr. segment uanset antal udbrud.
  const segmentShare = ctx.route.distance_km > 0 ? clamp(segmentLengthKm / ctx.route.distance_km, 0, 1) : 0;
  const riders = chased ? applyChaseCost(state.riders, chasePlan.chaserWork, segmentShare) : null;

  if (!changed && !riders) return { state, events };
  return { state: { ...state, groups, ...(riders ? { riders } : {}) }, events };
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
    const tryBreakRiderIds = flattenTryBreakRiderIds(parseBreakawayOrders(ctx.orders));
    const formationResult = attemptFormation(state, ctx, tryBreakRiderIds);
    // Dannede vi et udbrud i DETTE segment, faar det sit hovedstart uantastet:
    // jagten begynder foerst paa det naeste segment (#4615). Ellers ville en
    // fuld segment-laengdes jagt-fremdrift blive bogfoert i samme kald som
    // formationen og udslette forspringet foer det var kort.
    if (findBreakawayGroups(formationResult.state.groups).length > 0) return formationResult;
    return progressChase(formationResult.state, ctx);
  }
  return progressChase(state, ctx);
};
