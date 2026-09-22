// backend/lib/engine/v4/mechanics/breakaway.test.ts
// Kontrakt-tests for M5 (udbrud v2, #4030/#3855, #2416's jagt-interesse-model).
// Laaser HENSIGTEN (retning + bounded stoerrelse/effekt), ikke implementerings-
// detaljer — samme testfilosofi som descent.test.ts/climbSelection.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  breakawayHook,
  chaseAbilityScale,
  computeJoinScore,
  computeNetChaseAdvantage,
  joinProbability,
  selectBreakawayRiders,
  stanceSignal,
  type BreakawayHookContext,
  type BreakawayTeamOrder,
  TEAM_TACTICS_ORDER_KIND,
} from "./breakaway.ts";
import { makeHookCtx, rekeyHookCtxForSegment } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RiderState, RouteV2, TimelineEvent } from "../types.ts";

// ── Fixtures (samme moenster som descent.test.ts) ─────────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

function makeEntrant(riderId: string, overrides: Partial<Record<AbilityKey, number>> = {}): Entrant {
  return {
    rider_id: riderId,
    abilities: abilities(overrides),
    role: "free_role",
    effort: "normal",
    condition: 1,
  };
}

function makeRiderState(riderId: string, groupId: string): RiderState {
  return {
    rider_id: riderId,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 0.4,
    wprime: 0.4,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  };
}

const ROUTE_STUB: RouteV2 = {
  distance_km: 180,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [],
};

function routeWithSegments(count: number): RouteV2 {
  const segments: RouteV2["segments"] = [];
  const step = ROUTE_STUB.distance_km / count;
  for (let i = 0; i < count; i++) {
    segments.push({ kind: "flat", from_km: i * step, to_km: (i + 1) * step });
  }
  return { ...ROUTE_STUB, segments };
}

/** Bygger ét-gruppe start-scenarie med N ryttere (sprinter-tunge for realistisk jagt-interesse). */
function buildFieldScenario(
  riderCount: number,
  segmentIndex: number,
  route: RouteV2,
  seed = "breakaway-seed",
  orders?: readonly BreakawayTeamOrder[],
  riderOverrides?: (id: string) => Partial<Record<AbilityKey, number>>,
): { state: EngineState; ctx: BreakawayHookContext } {
  const entrantsById: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const riderIds: string[] = [];
  for (let i = 0; i < riderCount; i++) {
    const id = `r${i}`;
    riderIds.push(id);
    entrantsById[id] = makeEntrant(id, riderOverrides ? riderOverrides(id) : { sprint: 70 });
    riders[id] = makeRiderState(id, "peloton-0");
  }
  const group: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: riderIds, gap_seconds: 0, cohesion: 1 };
  const state: EngineState = { km: 0, groups: [group], riders, virtual_gc: {} };
  const segment = route.segments[segmentIndex] ?? { kind: "flat" as const, from_km: 0, to_km: 10 };
  // #4949: ctx spejler segmentLoop.ts's noegling (segment-noeglet rngFor).
  const ctx: BreakawayHookContext = makeHookCtx({
    segment,
    segmentIndex,
    route,
    entrants: entrantsById,
    tuning: RACE_V4_TUNING,
    seed,
    // Ordrerne naar hooket gennem den AABNE TeamOrder-konvolut (#4615) —
    // praecis som orders/teamOrdersAdapter.ts skriver dem i produktion.
    orders: (orders ?? []).map((o) => ({
      team_id: o.team_id,
      kind: TEAM_TACTICS_ORDER_KIND,
      params: { breakaway_stance: o.breakaway_stance, riders: o.riders },
    })),
  });
  return { state, ctx };
}

function eventsOfType(events: TimelineEvent[], type: string): TimelineEvent[] {
  return events.filter((e) => e.type === type);
}

// ── Kontrakt: join-score + sandsynlighed (T3) ─────────────────────────────────

test("try_break oeger join-scoren, men den forbliver bounded [0,1]", () => {
  const base = computeJoinScore(abilities({ aggression: 60, endurance: 60, tempo: 60 }), false);
  const boosted = computeJoinScore(abilities({ aggression: 60, endurance: 60, tempo: 60 }), true);
  assert.ok(boosted > base, "try_break skal oege scoren");
  assert.ok(boosted <= 1, "score er bounded til 1");
});

test("try_break ved maksimal score kan aldrig skubbe scoren over 1 (bounded)", () => {
  const maxed = computeJoinScore(abilities({ aggression: 99, endurance: 99, tempo: 99 }), true);
  assert.ok(maxed <= 1);
});

test("joinProbability er ALTID bounded [0.02, 0.5] uanset score", () => {
  for (const score of [0, 0.25, 0.5, 0.75, 1]) {
    const p = joinProbability(score);
    assert.ok(p >= 0.02 && p <= 0.5, `p=${p} for score=${score} skal ligge i [0.02,0.5]`);
  }
});

test("joinProbability er monoton stigende i score (retning, ikke absolut vaerdi)", () => {
  const pLow = joinProbability(0.1);
  const pHigh = joinProbability(0.8);
  assert.ok(pHigh > pLow);
});

// ── Kontrakt: udbruds-stoerrelse er BOUNDED (selectBreakawayRiders) ───────────

test("for faa spontane rul: fyldes deterministisk op til minSize", () => {
  const candidates = [
    { riderId: "a", score: 0.9, wantsToJoin: false },
    { riderId: "b", score: 0.7, wantsToJoin: false },
    { riderId: "c", score: 0.5, wantsToJoin: false },
    { riderId: "d", score: 0.1, wantsToJoin: false },
  ];
  const selected = selectBreakawayRiders(candidates, 2, 6);
  assert.equal(selected.length, 2, "skal fyldes op til minSize");
  assert.deepEqual(selected, ["a", "b"], "fyld skal tage de HOEJEST-scorede foerst, deterministisk");
});

test("for mange spontane rul: trimmes deterministisk ned til maxSize", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    riderId: `r${i}`,
    score: 1 - i * 0.05,
    wantsToJoin: true,
  }));
  const selected = selectBreakawayRiders(candidates, 2, 4);
  assert.equal(selected.length, 4, "skal trimmes ned til maxSize");
  assert.deepEqual(selected, ["r0", "r1", "r2", "r3"].sort(), "trim skal beholde de HOEJEST-scorede");
});

test("praecis minSize<=antal<=maxSize spontane rul: bevares uaendret", () => {
  const candidates = [
    { riderId: "a", score: 0.9, wantsToJoin: true },
    { riderId: "b", score: 0.7, wantsToJoin: true },
    { riderId: "c", score: 0.5, wantsToJoin: false },
  ];
  const selected = selectBreakawayRiders(candidates, 2, 6);
  assert.deepEqual(selected, ["a", "b"]);
});

// ── Kontrakt: hold-stance-signal (T3) ─────────────────────────────────────────

test("stanceSignal: ingen ordrer => neutral (0)", () => {
  assert.equal(stanceSignal(undefined), 0);
  assert.equal(stanceSignal([]), 0);
});

test("stanceSignal: rent chase => +1, rent let_go => -1", () => {
  const chaseOrders: BreakawayTeamOrder[] = [
    { team_id: "t1", breakaway_stance: "chase", riders: [] },
    { team_id: "t2", breakaway_stance: "chase", riders: [] },
  ];
  const letGoOrders: BreakawayTeamOrder[] = [
    { team_id: "t1", breakaway_stance: "let_go", riders: [] },
  ];
  assert.equal(stanceSignal(chaseOrders), 1);
  assert.equal(stanceSignal(letGoOrders), -1);
});

test("stanceSignal er ALTID bounded [-1, 1]", () => {
  const orders: BreakawayTeamOrder[] = Array.from({ length: 5 }, (_, i) => ({
    team_id: `t${i}`,
    breakaway_stance: "chase" as const,
    riders: [],
  }));
  const s = stanceSignal(orders);
  assert.ok(s >= -1 && s <= 1);
});

// ── Kontrakt: netto jagt-fordel (#2416) — retning + bounded stance-effekt ─────

function netAdvantageFor(breakawayOverrides: Partial<Record<AbilityKey, number>>, count: number, stance: number): number {
  const entrants: Record<string, Entrant> = {};
  const chaseIds = ["c0", "c1", "c2"];
  for (const id of chaseIds) entrants[id] = makeEntrant(id, { sprint: 80 });
  const breakawayIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `b${i}`;
    breakawayIds.push(id);
    entrants[id] = makeEntrant(id, breakawayOverrides);
  }
  return computeNetChaseAdvantage({
    chaseGroupRiderIds: chaseIds,
    breakawayRiderIds: breakawayIds,
    entrants,
    finaleType: "bunch_sprint",
    remainingKmFraction: 0.8,
    stance,
  });
}

test("staerkere/stoerre udbrud modstaar jagten mere (lavere netto jagt-fordel) end et svagt udbrud", () => {
  const weakBreakaway = netAdvantageFor({ endurance: 30, tempo: 30 }, 2, 0);
  const strongBreakaway = netAdvantageFor({ endurance: 90, tempo: 90 }, 6, 0);
  assert.ok(strongBreakaway < weakBreakaway, "staerkt/stort udbrud skal give LAVERE netto jagt-fordel end et svagt");
});

test("breakaway_stance='chase' giver hoejere netto jagt-fordel end 'let_go' (retning), BOUNDED effekt", () => {
  const neutral = netAdvantageFor({ endurance: 50, tempo: 50 }, 4, 0);
  const chase = netAdvantageFor({ endurance: 50, tempo: 50 }, 4, 1);
  const letGo = netAdvantageFor({ endurance: 50, tempo: 50 }, 4, -1);
  assert.ok(chase > neutral, "chase-stance skal oege jagt-fordelen");
  assert.ok(letGo < neutral, "let_go-stance skal reducere jagt-fordelen");
  // Bounded: stance-multiplikatoren er clampet til [0.7, 1.3] (tuning.ts) —
  // chase/let_go-forholdet kan derfor ikke overstige det forhold, uanset
  // hvor ekstremt resten af scenariet er.
  if (neutral !== 0) {
    const ratio = chase / letGo;
    const maxRatio = 1.3 / 0.7;
    assert.ok(Math.abs(ratio) <= maxRatio + 1e-9, `stance-effekten skal vaere bounded (ratio=${ratio})`);
  }
});

// ── Kontrakt: breakawayHook — formation kun paa segment 0 ────────────────────

test("formation forsoeges KUN paa segmentIndex 0 — senere segmenter uden eksisterende udbrud goer ingenting", () => {
  const route = routeWithSegments(6);
  const { state, ctx } = buildFieldScenario(20, 3, route);
  const result = breakawayHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state, "no-op paa segment>0 uden eksisterende udbrud skal returnere praecis samme state");
});

test("formation paa segment 0 med stort felt danner en bounded udbruds-gruppe + breakaway_formed-event", () => {
  const route = routeWithSegments(6);
  const { state, ctx } = buildFieldScenario(25, 0, route);
  const result = breakawayHook(state, ctx);
  const formed = eventsOfType(result.events, "breakaway_formed");
  assert.equal(formed.length, 1);
  const riderIds = formed[0].params.rider_ids as string[];
  assert.ok(riderIds.length >= 2 && riderIds.length <= 8, `udbrudsstoerrelse skal vaere bounded, fik ${riderIds.length}`);

  const breakawayGroup = result.state.groups.find((g) => g.kind === "breakaway");
  assert.ok(breakawayGroup, "der skal findes en breakaway-gruppe efter formation");
  assert.deepEqual([...breakawayGroup!.rider_ids].sort(), [...riderIds].sort());
});

test("try_break-flag garanterer ALDRIG medlemskab (kan udeblive selv med flaget saat)", () => {
  const route = routeWithSegments(6);
  const orders: BreakawayTeamOrder[] = [
    { team_id: "t0", breakaway_stance: "neutral", riders: [{ rider_id: "r0", try_break: true }] },
  ];
  // Mange forskellige seeds: try_break-flagede rytter skal IKKE altid vaere med.
  let joinedCount = 0;
  const seeds = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
  for (const seed of seeds) {
    const { state, ctx } = buildFieldScenario(20, 0, route, seed, orders);
    const result = breakawayHook(state, ctx);
    const breakawayGroup = result.state.groups.find((g) => g.kind === "breakaway");
    if (breakawayGroup?.rider_ids.includes("r0")) joinedCount++;
  }
  assert.ok(joinedCount < seeds.length, "try_break maa ALDRIG garantere medlemskab paa tvaers af seeds");
});

// ── Kontrakt: jagt-fremdrift, indhentning + overlevelse ───────────────────────

test("breakawayHook er deterministisk: samme (state, ctx) giver samme output", () => {
  const route = routeWithSegments(6);
  const { state, ctx } = buildFieldScenario(20, 0, route);
  const result1 = breakawayHook(state, ctx);
  const result2 = breakawayHook(state, ctx);
  assert.deepEqual(result1, result2);
});

test("staerkt sprinterfelt + chase-stance + svagt udbrud: udbruddet fanges (breakaway_caught) uden negativt gap", () => {
  const route = routeWithSegments(3);
  const chaseOrders: BreakawayTeamOrder[] = [{ team_id: "t0", breakaway_stance: "chase", riders: [] }];

  // Formation paa segment 0 (svag-udbryder-tunget felt: hoej sprint hos alle,
  // lav aggression/endurance/tempo saa udbruddet der DANNES ogsaa er svagt).
  const weakField = (id: string) => ({ sprint: 85, aggression: 30, endurance: 25, tempo: 25 });
  const { state: s0, ctx: ctx0 } = buildFieldScenario(24, 0, route, "catch-seed", chaseOrders, weakField);
  const afterFormation = breakawayHook(s0, ctx0);
  const breakawayGroup0 = afterFormation.state.groups.find((g) => g.kind === "breakaway");
  assert.ok(breakawayGroup0, "der skal dannes et udbrud i dette scenarie");

  // Koer segment 1 og 2 (jagt-fremdrift) — samme entrants/orders, hoejere segmentIndex.
  let state = afterFormation.state;
  let caughtSomewhere = false;
  for (let segIdx = 1; segIdx < route.segments.length; segIdx++) {
    // #4949: re-noegler rngFor til det nye segmentIndex (samme rngForStage-
    // stream genbrugt) — ellers ville hvert segment i loekken faa den SAMME
    // foerste lodtraekning, praecis den fejlklasse #4886 fandt i produktion.
    const ctx = rekeyHookCtxForSegment(ctx0, route.segments[segIdx], segIdx);
    const result = breakawayHook(state, ctx);
    state = result.state;
    const chaseGroup = state.groups.find((g) => g.kind === "peloton" || g.kind === "chase");
    assert.ok(chaseGroup && chaseGroup.gap_seconds >= 0, "jagt-gruppens gap maa ALDRIG blive negativt");
    if (eventsOfType(result.events, "breakaway_caught").length > 0) caughtSomewhere = true;
  }
  assert.ok(caughtSomewhere, "et markant svagere udbrud mod et staerkt chasende sprinterfelt boer fanges inden maal");
});

test("staerkt udbrud + let_go-stance: udbruddet overlever til maal (breakaway_survived)", () => {
  const route = routeWithSegments(3);
  const letGoOrders: BreakawayTeamOrder[] = [{ team_id: "t0", breakaway_stance: "let_go", riders: [] }];

  const strongField = (id: string) => ({ sprint: 20, aggression: 90, endurance: 95, tempo: 95 });
  const { state: s0, ctx: ctx0 } = buildFieldScenario(24, 0, route, "survive-seed", letGoOrders, strongField);
  const afterFormation = breakawayHook(s0, ctx0);
  const breakawayGroup0 = afterFormation.state.groups.find((g) => g.kind === "breakaway");
  assert.ok(breakawayGroup0, "der skal dannes et udbrud i dette scenarie");

  let state = afterFormation.state;
  let lastEvents: TimelineEvent[] = [];
  for (let segIdx = 1; segIdx < route.segments.length; segIdx++) {
    // #4949: re-noegler rngFor til det nye segmentIndex (samme rngForStage-
    // stream genbrugt) — ellers ville hvert segment i loekken faa den SAMME
    // foerste lodtraekning, praecis den fejlklasse #4886 fandt i produktion.
    const ctx = rekeyHookCtxForSegment(ctx0, route.segments[segIdx], segIdx);
    const result = breakawayHook(state, ctx);
    state = result.state;
    lastEvents = result.events;
  }
  assert.equal(eventsOfType(lastEvents, "breakaway_survived").length, 1);
  assert.ok(state.groups.some((g) => g.kind === "breakaway"), "udbrudsgruppen skal stadig eksistere ved maal");
});

// ── Skala-invarianter (#4707, RULES §7 raekke 14) ─────────────────────────────
// Samme formuleringsprincip som fieldIntegrity.test.ts og #4604-load-guarden:
// udsagnene er SKALA-uafhaengige, ikke forventede tal, og koeres over hele
// evne-spektret 5/11/30/60/99. Fejlen de vogter mod: to strukturelle led i
// jagt-modellen (sen-etape-uro og udbruddets stoerrelse) stod som absolutte
// konstanter mod evne-led der skalerede med populationen, saa det SAMME
// relative scenarie gav en anden jagt ved median-evne 11 end ved 60.
//
// Felterne bygges med profil-faktorer <= 1 ganget paa niveauet, saa ingen evne
// klampes ved 99: et felt paa niveau 60 er PRAECIS 60/11 gange feltet paa
// niveau 11, og en skala-invariant model skal derfor give praecis samme svar.

const CHASE_ABILITY_LEVELS = [5, 11, 30, 60, 99];

type ScaledChaseScenario = {
  entrants: Record<string, Entrant>;
  chaseIds: string[];
  breakawayIds: string[];
  fieldIds: string[];
};

/** Jagt-gruppe + udbrud med fast RELATIV sammensaetning, skaleret til `level`. */
function scaledChaseScenario(
  level: number,
  opts: { breakawayFactor: number; breakawaySize: number; chaseSize?: number },
): ScaledChaseScenario {
  const entrants: Record<string, Entrant> = {};
  const chaseIds: string[] = [];
  const breakawayIds: string[] = [];
  const chaseSize = opts.chaseSize ?? 20;
  for (let i = 0; i < chaseSize; i++) {
    const id = `c${String(i).padStart(2, "0")}`;
    chaseIds.push(id);
    const f = 0.6 + (0.4 * (i % 5)) / 4;
    const sprintF = 0.5 + (0.5 * ((i * 3) % 7)) / 6;
    const ab = abilities();
    for (const key of Object.keys(ab) as AbilityKey[]) ab[key] = level * f;
    ab.sprint = level * sprintF;
    entrants[id] = { ...makeEntrant(id), abilities: ab };
  }
  for (let i = 0; i < opts.breakawaySize; i++) {
    const id = `b${i}`;
    breakawayIds.push(id);
    const ab = abilities();
    for (const key of Object.keys(ab) as AbilityKey[]) ab[key] = level * opts.breakawayFactor;
    entrants[id] = { ...makeEntrant(id), abilities: ab };
  }
  return { entrants, chaseIds, breakawayIds, fieldIds: [...chaseIds, ...breakawayIds] };
}

function netAtLevel(
  level: number,
  opts: { breakawayFactor: number; breakawaySize: number; remainingKmFraction: number; finaleType: RouteV2["finale_type"]; stance: number },
): number {
  const s = scaledChaseScenario(level, opts);
  return computeNetChaseAdvantage({
    chaseGroupRiderIds: s.chaseIds,
    breakawayRiderIds: s.breakawayIds,
    entrants: s.entrants,
    finaleType: opts.finaleType,
    remainingKmFraction: opts.remainingKmFraction,
    stance: opts.stance,
    fieldRiderIds: s.fieldIds,
  });
}

function assertClose(actual: number, expected: number, message: string): void {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}

test("#4707 skala-invariant: samme relative jagt-scenarie giver samme netto jagt-fordel paa alle evne-niveauer", () => {
  const scenarios = [
    { breakawayFactor: 1.0, breakawaySize: 2, remainingKmFraction: 0.2, finaleType: "bunch_sprint" as const, stance: 0 },
    { breakawayFactor: 0.8, breakawaySize: 4, remainingKmFraction: 0.6, finaleType: "bunch_sprint" as const, stance: 1 },
    { breakawayFactor: 0.6, breakawaySize: 6, remainingKmFraction: 0.95, finaleType: "long_climb" as const, stance: -1 },
    { breakawayFactor: 0.9, breakawaySize: 8, remainingKmFraction: 0.5, finaleType: "descent" as const, stance: 0 },
    { breakawayFactor: 0.7, breakawaySize: 3, remainingKmFraction: 0.8, finaleType: null, stance: 0 },
  ];
  for (const scenario of scenarios) {
    const reference = netAtLevel(11, scenario);
    for (const level of CHASE_ABILITY_LEVELS) {
      assertClose(
        netAtLevel(level, scenario),
        reference,
        `evne-niveau ${level} (${scenario.finaleType ?? "null"}, ${scenario.breakawaySize} i udbruddet, ${scenario.remainingKmFraction} af etapen)`,
      );
    }
  }
});

test("#4707 skala-invariant: jagtens retninger holder paa alle evne-niveauer", () => {
  const base = { breakawayFactor: 0.8, breakawaySize: 4, remainingKmFraction: 0.5, finaleType: "bunch_sprint" as const, stance: 0 };
  for (const level of CHASE_ABILITY_LEVELS) {
    const net = netAtLevel(level, base);
    // Sen-etape-uroen: jo taettere paa maal, jo mere jagter feltet.
    assert.ok(
      netAtLevel(level, { ...base, remainingKmFraction: 0.9 }) > net,
      `evne-niveau ${level}: senere i etapen skal give HOEJERE jagt-fordel`,
    );
    // Udbruddets stoerrelse: flere ryttere ruller bedre.
    assert.ok(
      netAtLevel(level, { ...base, breakawaySize: 6 }) < net,
      `evne-niveau ${level}: et stoerre udbrud skal modstaa jagten mere`,
    );
    // Udbruddets RELATIVE styrke: et udbrud af feltets staerkeste modstaar mere
    // end et af feltets svageste — paa ALLE niveauer, ikke kun midt-skala.
    assert.ok(
      netAtLevel(level, { ...base, breakawayFactor: 1.0 }) < netAtLevel(level, { ...base, breakawayFactor: 0.6 }),
      `evne-niveau ${level}: et relativt staerkere udbrud skal give LAVERE jagt-fordel`,
    );
  }
});

test("#4707 chaseAbilityScale: halveres naar feltet fordobles, og et evne-loest felt skalerer ikke", () => {
  const at11 = scaledChaseScenario(11, { breakawayFactor: 0.8, breakawaySize: 4 });
  const at22 = scaledChaseScenario(22, { breakawayFactor: 0.8, breakawaySize: 4 });
  assertClose(chaseAbilityScale(at22.fieldIds, at22.entrants) * 2, chaseAbilityScale(at11.fieldIds, at11.entrants), "dobbelt evne => halv skala");

  const zeroEntrants: Record<string, Entrant> = {};
  for (const id of ["z0", "z1", "z2"]) {
    const ab = abilities();
    for (const key of Object.keys(ab) as AbilityKey[]) ab[key] = 0;
    zeroEntrants[id] = { ...makeEntrant(id), abilities: ab };
  }
  assert.equal(chaseAbilityScale(["z0", "z1", "z2"], zeroEntrants), 1, "et felt uden maalbar evne har intet at skalere");
});

/** Hook-niveau: pelotonen jager et udbrud der allerede er etableret med et fast forspring. */
function chaseStateAtLevel(level: number, route: RouteV2, segmentIndex: number): { state: EngineState; ctx: BreakawayHookContext } {
  const s = scaledChaseScenario(level, { breakawayFactor: 0.8, breakawaySize: 5, chaseSize: 40 });
  const riders: Record<string, RiderState> = {};
  for (const id of s.chaseIds) riders[id] = makeRiderState(id, "peloton-0");
  for (const id of s.breakawayIds) riders[id] = makeRiderState(id, "breakaway-0");
  const groups: RaceGroup[] = [
    { id: "peloton-0", kind: "peloton", rider_ids: s.chaseIds, gap_seconds: 0, cohesion: 1 },
    { id: "breakaway-0", kind: "breakaway", rider_ids: s.breakawayIds, gap_seconds: -180, cohesion: 1 },
  ];
  const state: EngineState = { km: route.segments[segmentIndex].from_km, groups, riders, virtual_gc: {} };
  const ctx = makeHookCtx({
    segment: route.segments[segmentIndex],
    segmentIndex,
    route,
    entrants: s.entrants,
    tuning: RACE_V4_TUNING,
    seed: "4707-scale",
  });
  return { state, ctx };
}

test("#4707 skala-invariant: jagten lukker praecis lige meget af forspringet paa alle evne-niveauer", () => {
  const route = routeWithSegments(6);
  for (const segmentIndex of [1, 3, 5]) {
    const outcomes = CHASE_ABILITY_LEVELS.map((level) => {
      const { state, ctx } = chaseStateAtLevel(level, route, segmentIndex);
      const result = breakawayHook(state, ctx);
      const peloton = result.state.groups.find((g) => g.id === "peloton-0")!;
      const breakaway = result.state.groups.find((g) => g.id === "breakaway-0")!;
      return {
        level,
        separation: peloton.gap_seconds - breakaway.gap_seconds,
        events: result.events.map((e) => e.type).join(","),
      };
    });
    const reference = outcomes.find((o) => o.level === 11)!;
    for (const outcome of outcomes) {
      assertClose(outcome.separation, reference.separation, `evne-niveau ${outcome.level}, segment ${segmentIndex}: forspringet efter jagten`);
      assert.equal(outcome.events, reference.events, `evne-niveau ${outcome.level}, segment ${segmentIndex}: jagtens udfald (fanget/overlevet)`);
    }
  }
});
