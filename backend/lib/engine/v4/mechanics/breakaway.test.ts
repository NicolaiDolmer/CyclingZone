// backend/lib/engine/v4/mechanics/breakaway.test.ts
// Kontrakt-tests for M5 (udbrud v2, #4030/#3855, #2416's jagt-interesse-model).
// Laaser HENSIGTEN (retning + bounded stoerrelse/effekt), ikke implementerings-
// detaljer — samme testfilosofi som descent.test.ts/climbSelection.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyChaseCost,
  breakawayHook,
  chaseAbilityScale,
  computeJoinScore,
  computeNetChaseAdvantage,
  joinProbability,
  selectBreakawayRiders,
  teamChasePlan,
  type BreakawayHookContext,
  type BreakawayStance,
  type BreakawayTeamOrder,
  TEAM_TACTICS_ORDER_KIND,
} from "./breakaway.ts";
import { makeHookCtx, rekeyHookCtxForSegment } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import type { AbilityKey, EffortLevel, Entrant, EngineState, RaceGroup, RiderRole, RiderState, RouteV2, TimelineEvent } from "../types.ts";

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
  /** #5570: >0 fordeler rytterne paa hold `t0..t{n-1}` (Entrant.team_id). 0 = ingen hold. */
  teamCount = 0,
): { state: EngineState; ctx: BreakawayHookContext } {
  const entrantsById: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const riderIds: string[] = [];
  for (let i = 0; i < riderCount; i++) {
    const id = `r${i}`;
    riderIds.push(id);
    entrantsById[id] = makeEntrant(id, riderOverrides ? riderOverrides(id) : { sprint: 70 });
    if (teamCount > 0) entrantsById[id] = { ...entrantsById[id], team_id: `t${i % teamCount}` };
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

// ── Kontrakt: holdspecifik jagt (#5570) ───────────────────────────────────────
// Foer: stanceSignal tog gennemsnittet over ALLE hold med en ordre, og hvert
// hold paa startlisten faar en (default neutral) — én spillers "jag" flyttede
// signalet med 1/N, og jagten var gratis. Nu virker et holds valg GENNEM
// holdets egne ryttere i jagt-gruppen, og jagten koster hold-CP.

type ChaseRider = {
  id: string;
  team: string | null;
  role?: RiderRole;
  effort?: EffortLevel;
  teamCpFactor?: number;
  status?: RiderState["status"];
  engine?: number; // endurance = tempo = engine
};

function chaseFixture(riders: ChaseRider[]): {
  entrants: Record<string, Entrant>;
  riderStates: Record<string, RiderState>;
  ids: string[];
} {
  const entrants: Record<string, Entrant> = {};
  const riderStates: Record<string, RiderState> = {};
  for (const r of riders) {
    const engine = r.engine ?? 50;
    entrants[r.id] = {
      ...makeEntrant(r.id, { endurance: engine, tempo: engine }),
      role: r.role ?? "free_role",
      effort: r.effort ?? "normal",
      team_id: r.team,
    };
    riderStates[r.id] = {
      ...makeRiderState(r.id, "peloton-0"),
      status: r.status ?? "racing",
      ...(r.teamCpFactor !== undefined ? { team_cp_factor: r.teamCpFactor } : {}),
    };
  }
  return { entrants, riderStates, ids: riders.map((r) => r.id) };
}

/** `perTeam` ryttere pr. hold for hvert hold i `teams`. */
function teamRiders(teams: string[], perTeam: number, extra: Partial<ChaseRider> = {}): ChaseRider[] {
  return teams.flatMap((team) => Array.from({ length: perTeam }, (_, i) => ({ id: `${team}-${i}`, team, ...extra })));
}

function orderFor(team_id: string, breakaway_stance: BreakawayStance): BreakawayTeamOrder {
  return { team_id, breakaway_stance, riders: [] };
}

function planFor(riders: ChaseRider[], orders: BreakawayTeamOrder[]) {
  const f = chaseFixture(riders);
  return teamChasePlan({ orders, chaseGroupRiderIds: f.ids, entrants: f.entrants, riders: f.riderStates });
}

test("#5570 teamChasePlan: ingen ordrer => signal 0 og ingen jaegere", () => {
  const plan = planFor(teamRiders(["A", "B"], 4), []);
  assert.equal(plan.signal, 0);
  assert.equal(plan.chaserWork.size, 0);
});

test("#5570 teamChasePlan: en startliste uden team_id har ingen hold at jage med (golden fixtures uaendret)", () => {
  const riders: ChaseRider[] = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, team: null }));
  const plan = planFor(riders, [orderFor("A", "chase"), orderFor("B", "let_go")]);
  assert.equal(plan.signal, 0);
  assert.equal(plan.chaserWork.size, 0);
});

test("#5570 teamChasePlan: ét holds jagt udvandes IKKE af hvor mange neutrale hold der staar paa startlisten", () => {
  const signals = [1, 5, 19].map((neutralTeams) => {
    const neutral = Array.from({ length: neutralTeams }, (_, i) => `N${String(i).padStart(2, "0")}`);
    const riders = [...teamRiders(["A"], 4), ...teamRiders(neutral, 4)];
    const orders = [orderFor("A", "chase"), ...neutral.map((t) => orderFor(t, "neutral"))];
    return planFor(riders, orders).signal;
  });
  assert.ok(signals[0] > 0, "et jagende hold skal give et positivt signal");
  for (const s of signals) assertClose(s, signals[0], "signalet maa ikke afhaenge af antallet af neutrale hold (1/N-fejlen)");
});

test("#5570 teamChasePlan: jager flere hold, bliver signalet staerkere — men altid bounded [-1, 1]", () => {
  const teams = ["A", "B", "C", "D", "E", "F"];
  const riders = teamRiders(teams, 4);
  let previous = 0;
  for (let k = 1; k <= teams.length; k++) {
    const orders = teams.map((t, i) => orderFor(t, i < k ? "chase" : "neutral"));
    const s = planFor(riders, orders).signal;
    assert.ok(s >= previous, `${k} jagende hold (${s}) maa ikke give svagere jagt end ${k - 1} (${previous})`);
    assert.ok(s >= -1 && s <= 1, `signalet skal vaere bounded, fik ${s}`);
    previous = s;
  }
  const one = planFor(riders, teams.map((t, i) => orderFor(t, i < 1 ? "chase" : "neutral"))).signal;
  const two = planFor(riders, teams.map((t, i) => orderFor(t, i < 2 ? "chase" : "neutral"))).signal;
  assert.ok(two > one, "to hold i jagt skal jage haardere end ét");
  assert.ok(one < 1, "ét hold alene maa aldrig naa det fulde signal (ét valg vaelter aldrig et loeb)");
});

test("#5570 teamChasePlan: et hold kan kun jage med ryttere det HAR i jagt-gruppen", () => {
  const riders = teamRiders(["B"], 4);
  // Hold A har ingen ryttere i jagt-gruppen (alle i udbruddet eller sat af).
  const plan = planFor(riders, [orderFor("A", "chase"), orderFor("B", "neutral")]);
  assert.equal(plan.signal, 0);
  assert.equal(plan.chaserWork.size, 0);

  const withDropped = teamRiders(["A"], 4, { status: "dnf" });
  assert.equal(planFor(withDropped, [orderFor("A", "chase")]).signal, 0, "udgaaede ryttere jager ikke");
});

test("#5570 teamChasePlan: lederne trækker ikke jagten, og all_out arbejder ikke for holdet", () => {
  const leaders: ChaseRider[] = [
    { id: "A-cap", team: "A", role: "captain" },
    { id: "A-spr", team: "A", role: "sprint_captain" },
  ];
  const leadersOnly = planFor(leaders, [orderFor("A", "chase")]);
  assert.equal(leadersOnly.signal, 0, "et hold med kun sine ledere i gruppen kan ikke jage");
  assert.equal(leadersOnly.chaserWork.size, 0, "og lederne betaler ingen jagt-pris");

  const allOut = planFor(teamRiders(["A"], 4, { effort: "all_out" }), [orderFor("A", "chase")]);
  assert.equal(allOut.signal, 0, "all_out koerer for sig selv (M16's effort-akse): intet jagt-bidrag");
  assert.equal(allOut.chaserWork.size, 0, "og derfor heller ingen pris");

  const helpers = planFor([...leaders, ...teamRiders(["A"], 4, { role: "helper" })], [orderFor("A", "chase")]);
  assert.ok(helpers.signal > 0);
  assert.ok(!helpers.chaserWork.has("A-cap") && !helpers.chaserWork.has("A-spr"), "lederne er aldrig jaegere");
});

test("#5570 teamChasePlan: et hold der allerede har brugt kraefter, jager svagere", () => {
  const fresh = planFor(teamRiders(["A"], 3), [orderFor("A", "chase")]).signal;
  const tired = planFor(teamRiders(["A"], 3, { teamCpFactor: 0.7 }), [orderFor("A", "chase")]).signal;
  assert.ok(fresh > 0 && tired > 0);
  assert.ok(tired < fresh, `et traet hold (${tired}) skal jage svagere end et friskt (${fresh})`);
});

test("#5570 teamChasePlan: lader ALLE hold det gaa, er signalet -1; ét hold alene flytter kun sin egen andel", () => {
  const teams = ["A", "B", "C", "D"];
  const riders = teamRiders(teams, 4);
  assertClose(planFor(riders, teams.map((t) => orderFor(t, "let_go"))).signal, -1, "alle lader gaa");
  const oneLetGo = planFor(riders, teams.map((t, i) => orderFor(t, i === 0 ? "let_go" : "neutral"))).signal;
  assert.ok(oneLetGo < 0 && oneLetGo > -1, `ét hold der lader gaa skal daempe, ikke stoppe jagten (fik ${oneLetGo})`);
  const twoLetGo = planFor(riders, teams.map((t, i) => orderFor(t, i < 2 ? "let_go" : "neutral"))).signal;
  assert.ok(twoLetGo < oneLetGo, "jo flere der lader gaa, jo svagere jagt");
});

test("#5570 teamChasePlan er skala-invariant (#4707): samme relative hold giver samme signal paa alle evne-niveauer", () => {
  const signalAt = (level: number) => {
    const riders: ChaseRider[] = [
      ...teamRiders(["A"], 3).map((r, i) => ({ ...r, engine: level * (0.7 + 0.1 * i) })),
      ...teamRiders(["B", "C"], 4).map((r, i) => ({ ...r, engine: level * (0.6 + 0.05 * i) })),
    ];
    return planFor(riders, [orderFor("A", "chase"), orderFor("B", "neutral"), orderFor("C", "let_go")]).signal;
  };
  const reference = signalAt(11);
  for (const level of [5, 11, 30, 60, 99]) assertClose(signalAt(level), reference, `evne-niveau ${level}`);
});

test("#5570 applyChaseCost: jagten koster jaegerne hold-CP — aldrig andre, aldrig negativt, aldrig under M16's gulv", () => {
  const f = chaseFixture([...teamRiders(["A"], 4), ...teamRiders(["B"], 4)]);
  const plan = teamChasePlan({
    orders: [orderFor("A", "chase"), orderFor("B", "neutral")],
    chaseGroupRiderIds: f.ids,
    entrants: f.entrants,
    riders: f.riderStates,
  });
  const after = applyChaseCost(f.riderStates, plan.chaserWork, 0.5);
  assert.ok(after, "et jagende hold skal betale");
  for (const id of f.ids) {
    const factor = after![id].team_cp_factor;
    if (id.startsWith("A-")) assert.ok(factor !== undefined && factor < 1, `${id} jagede og skal have betalt`);
    else assert.equal(factor, undefined, `${id} jagede ikke og maa ikke betale`);
  }
  assert.equal(f.riderStates["A-0"].team_cp_factor, undefined, "input-state maa aldrig muteres");

  // Gulvet: selv en hel dags jagt oven paa M16-arbejde bringer ingen under minCpFactor.
  const worn = chaseFixture(teamRiders(["A"], 2, { teamCpFactor: TEAM_PLAY_EXTRA_TUNING.minCpFactor + 0.01 }));
  const floored = applyChaseCost(worn.riderStates, new Map([["A-0", 1], ["A-1", 1]]), 1)!;
  for (const id of ["A-0", "A-1"]) {
    assert.ok(floored[id].team_cp_factor! >= TEAM_PLAY_EXTRA_TUNING.minCpFactor, `${id} under gulvet`);
  }

  assert.equal(applyChaseCost(f.riderStates, plan.chaserWork, 0), null, "et segment uden laengde koster intet");
  assert.equal(applyChaseCost(f.riderStates, new Map(), 0.5), null, "ingen jaegere, ingen pris");
});

test("#5570 applyChaseCost: et hold der jager alene betaler mere pr. rytter end naar flere hold deler arbejdet", () => {
  const riders = teamRiders(["A", "B", "C"], 4);
  const costFor = (chasing: string[]) => {
    const f = chaseFixture(riders);
    const plan = teamChasePlan({
      orders: ["A", "B", "C"].map((t) => orderFor(t, chasing.includes(t) ? "chase" : "neutral")),
      chaseGroupRiderIds: f.ids,
      entrants: f.entrants,
      riders: f.riderStates,
    });
    return 1 - applyChaseCost(f.riderStates, plan.chaserWork, 0.5)!["A-0"].team_cp_factor!;
  };
  const alone = costFor(["A"]);
  const shared = costFor(["A", "B", "C"]);
  assert.ok(alone > 0 && shared > 0);
  assert.ok(shared < alone, `delt jagt (${shared}) skal koste hver rytter mindre end at jage alene (${alone})`);
});

test("#5570 applyChaseCost: prisen er uafhaengig af hvor fint etapen er skaaret op, og bevarer CP-ordenen", () => {
  const work = new Map([["A-0", 1], ["A-1", 1]]);
  const once = applyChaseCost(chaseFixture(teamRiders(["A"], 2)).riderStates, work, 0.4)!;
  let split: Record<string, RiderState> = chaseFixture(teamRiders(["A"], 2)).riderStates;
  for (let i = 0; i < 4; i++) split = applyChaseCost(split, work, 0.1)!;
  assertClose(split["A-0"].team_cp_factor!, once["A-0"].team_cp_factor!, "4 x 0,1 skal koste det samme som 1 x 0,4");
  assertClose(once["A-0"].team_cp_factor!, once["A-1"].team_cp_factor!, "samme effort => samme andel af egen CP (monotoni)");
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
  // #5570: stancen virker gennem holdenes egne ryttere — alle fire hold jager.
  const chaseOrders: BreakawayTeamOrder[] = ["t0", "t1", "t2", "t3"].map((t) => ({ team_id: t, breakaway_stance: "chase", riders: [] }));

  // Formation paa segment 0 (svag-udbryder-tunget felt: hoej sprint hos alle,
  // lav aggression/endurance/tempo saa udbruddet der DANNES ogsaa er svagt).
  const weakField = (id: string) => ({ sprint: 85, aggression: 30, endurance: 25, tempo: 25 });
  const { state: s0, ctx: ctx0 } = buildFieldScenario(24, 0, route, "catch-seed", chaseOrders, weakField, 4);
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
  // #5570: alle fire hold lader det gaa.
  const letGoOrders: BreakawayTeamOrder[] = ["t0", "t1", "t2", "t3"].map((t) => ({ team_id: t, breakaway_stance: "let_go", riders: [] }));

  const strongField = (id: string) => ({ sprint: 20, aggression: 90, endurance: 95, tempo: 95 });
  const { state: s0, ctx: ctx0 } = buildFieldScenario(24, 0, route, "survive-seed", letGoOrders, strongField, 4);
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

// ── #5570 realisme-kontrol (ejer 23/9: "foelg realismen") ─────────────────────
// Issuets tre udsagn, maalt paa hook-niveau over et sweep af udbrud (relativ
// styrke x forspring), saa de er udsagn om RETNING paa tvaers af scenarier og
// ikke om et enkelt haandplukket tal:
//   1. Et hold der jager alene, taber kraefter og kan stadig fejle.
//   2. Jager flere hold, bliver udbruddet hentet oftere.
//   3. Lader alle holdene det gaa, vinder udbruddet oftere.

const REALISM_TEAMS = ["tA", "tB", "tC", "tD", "tE", "tF", "tG", "tH"];
const REALISM_BREAKAWAY_FACTORS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
// Taet i det omraade hvor jagten er afgoerende (stancen er en BOUNDED
// multiplikator paa jagten, saa den flytter kun udfaldet naer vippepunktet),
// plus et par forspring ingen jagt henter.
const REALISM_GAPS = Array.from({ length: 16 }, (_, i) => 40 + 20 * i).concat([600, 900]);

type TeamChaseOutcome = {
  caughtAtSegment: number | null;
  survived: boolean;
  finalSeparation: number;
  riders: Record<string, RiderState>;
  teamOf: Record<string, string>;
};

/**
 * Et etableret udbrud (4 ryttere, fast forspring) mod en jagt-gruppe paa 32
 * ryttere fordelt paa otte hold. `stances[i]` er hold i's valg. Koerer
 * hooket segment for segment, som segmentLoop goer det, og stopper ved
 * indhentning (segmentLoop smelter grupperne sammen lige efter hooket).
 */
function teamChaseRace(stances: BreakawayStance[], breakawayFactor: number, gapSeconds: number): TeamChaseOutcome {
  const route = routeWithSegments(6);
  const s = scaledChaseScenario(11, { breakawayFactor, breakawaySize: 4, chaseSize: 32 });
  const teamOf: Record<string, string> = {};
  const entrants: Record<string, Entrant> = {};
  s.chaseIds.forEach((id, i) => {
    teamOf[id] = REALISM_TEAMS[i % REALISM_TEAMS.length];
    entrants[id] = { ...s.entrants[id], team_id: teamOf[id] };
  });
  for (const id of s.breakawayIds) entrants[id] = { ...s.entrants[id], team_id: "tX" };

  let riders: Record<string, RiderState> = {};
  for (const id of s.chaseIds) riders[id] = makeRiderState(id, "peloton-0");
  for (const id of s.breakawayIds) riders[id] = makeRiderState(id, "breakaway-0");
  let state: EngineState = {
    km: route.segments[1].from_km,
    groups: [
      { id: "peloton-0", kind: "peloton", rider_ids: s.chaseIds, gap_seconds: 0, cohesion: 1 },
      { id: "breakaway-0", kind: "breakaway", rider_ids: s.breakawayIds, gap_seconds: -gapSeconds, cohesion: 1 },
    ],
    riders,
    virtual_gc: {},
  };
  const orders = REALISM_TEAMS.map((team_id, i) => ({
    team_id,
    kind: TEAM_TACTICS_ORDER_KIND,
    params: { breakaway_stance: stances[i] ?? "neutral", riders: [] },
  }));

  let caughtAtSegment: number | null = null;
  let survived = false;
  for (let segIdx = 1; segIdx < route.segments.length; segIdx++) {
    const ctx = makeHookCtx({
      segment: route.segments[segIdx],
      segmentIndex: segIdx,
      route,
      entrants,
      tuning: RACE_V4_TUNING,
      seed: "5570-realism",
      orders,
    });
    const result = breakawayHook(state, ctx);
    state = result.state;
    if (eventsOfType(result.events, "breakaway_caught").length > 0) {
      caughtAtSegment = segIdx;
      break;
    }
    if (eventsOfType(result.events, "breakaway_survived").length > 0) survived = true;
  }
  const peloton = state.groups.find((g) => g.id === "peloton-0")!;
  const breakaway = state.groups.find((g) => g.id === "breakaway-0")!;
  riders = state.riders;
  return { caughtAtSegment, survived, finalSeparation: peloton.gap_seconds - breakaway.gap_seconds, riders, teamOf };
}

function stancesWith(chasing: number, rest: BreakawayStance = "neutral"): BreakawayStance[] {
  return REALISM_TEAMS.map((_, i) => (i < chasing ? "chase" : rest));
}

function sweep(stances: BreakawayStance[]): TeamChaseOutcome[] {
  return REALISM_BREAKAWAY_FACTORS.flatMap((f) => REALISM_GAPS.map((gap) => teamChaseRace(stances, f, gap)));
}

test("#5570 realisme 1: et hold der jager alene, taber kraefter — og kan stadig fejle", () => {
  const outcomes = sweep(stancesWith(1));
  let failedChases = 0;
  for (const o of outcomes) {
    for (const [riderId, team] of Object.entries(o.teamOf)) {
      const factor = o.riders[riderId].team_cp_factor;
      if (team === "tA") assert.ok(factor !== undefined && factor < 1, `${riderId} jagede og skal have betalt`);
      else assert.equal(factor, undefined, `${riderId} (hold ${team}) jagede ikke og maa ikke betale`);
    }
    if (o.survived) failedChases++;
  }
  assert.ok(failedChases > 0, "et hold der jager alene skal kunne fejle: udbruddet overlever i mindst ét scenarie");
  assert.ok(failedChases < outcomes.length, "men jagten skal ogsaa kunne lykkes");
});

test("#5570 realisme 2: jager flere hold, bliver udbruddet hentet oftere (og aldrig sjaeldnere)", () => {
  const counts = [0, 1, 2, 4].map((k) => {
    const outcomes = sweep(stancesWith(k));
    return { k, caught: outcomes.filter((o) => o.caughtAtSegment !== null).length, outcomes };
  });
  for (let i = 1; i < counts.length; i++) {
    assert.ok(
      counts[i].caught >= counts[i - 1].caught,
      `${counts[i].k} jagende hold (${counts[i].caught} hentet) maa ikke hente sjaeldnere end ${counts[i - 1].k} (${counts[i - 1].caught})`,
    );
    // Og scenarie for scenarie: flere jaegere lukker aldrig MINDRE af hullet.
    counts[i].outcomes.forEach((o, j) => {
      const prev = counts[i - 1].outcomes[j];
      const earlierOrSame = o.caughtAtSegment !== null && (prev.caughtAtSegment === null || o.caughtAtSegment <= prev.caughtAtSegment);
      assert.ok(
        earlierOrSame || o.finalSeparation <= prev.finalSeparation + 1e-9,
        `scenarie ${j}: ${counts[i].k} jagende hold lukkede mindre end ${counts[i - 1].k}`,
      );
    });
  }
  assert.ok(counts[3].caught > counts[0].caught, "fire hold i jagt skal hente flere udbrud end ingen");
  assert.ok(counts[2].caught > counts[1].caught || counts[3].caught > counts[1].caught, "flere hold skal hente flere end ét hold alene");
});

test("#5570 realisme 3: lader alle holdene det gaa, vinder udbruddet oftere", () => {
  const neutral = sweep(stancesWith(0, "neutral")).filter((o) => o.survived).length;
  const letGo = sweep(stancesWith(0, "let_go")).filter((o) => o.survived).length;
  assert.ok(letGo > neutral, `alle lader gaa (${letGo} overlever) skal give flere overlevende udbrud end alle neutrale (${neutral})`);
  // Og at lade gaa er gratis: ingen betaler for at sidde paa hjul.
  for (const o of sweep(stancesWith(0, "let_go"))) {
    for (const r of Object.values(o.riders)) assert.equal(r.team_cp_factor, undefined, `${r.rider_id} lod gaa og maa ikke betale`);
  }
});
