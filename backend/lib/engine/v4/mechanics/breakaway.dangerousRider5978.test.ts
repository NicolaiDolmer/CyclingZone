// backend/lib/engine/v4/mechanics/breakaway.dangerousRider5978.test.ts
// #5978 (KUN orders_gc_v3): farlig rytter i udbrud. Ejer-design 5/10, hoej
// risiko, hoej gevinst:
//   1. et forsoeg fra en farlig rytter moeder haardere modreaktion og koster
//      kraefter (dannelsen),
//   2. snoren: saa laenge han sidder i udbruddet, holdes forspringet under hans
//      afstand minus en margin; reaktionen stopper ikke som "contained"; falder
//      han fra, slippes udbruddet; snoren holder kun med hjaelpere med kraefter,
//   3. farlig = tid + evne + resterende etaper; "kun hold med top-10-rytter"
//      erstattes af hvem der har noget at forsvare,
//   4. endagsloeb: samme snor maalt paa evne,
//   5. egne ryttere taeller aldrig (#6187).
// Plus review-punkterne fra #6213 (1, 2 og 4). Syntetiske ryttere; testene
// laaser strukturen og retningen, ikke kalibrerede tal.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessGcThreat,
  formationDangerTeams,
  GC_THREAT_V3_TUNING,
  oneDayProtectedRider,
  type GcThreat,
} from "./gcThreat.ts";
import {
  advanceTeamReaction,
  IDLE_TEAM_REACTION,
  letGoBrakingTeams,
  planTeamReaction,
} from "./teamChaseReaction.ts";
import { resolveMorningBreakFormation, DANGEROUS_ATTEMPT_TUNING, type FormationRider } from "./breakawayPermission.ts";
import { breakawayHook, mergeChasePlans, ownRidersOnWheel, ownRidersOnWheelRaw, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import { runSegmentLoop } from "../segmentLoop.ts";
import { LIVE_MECHANIC_HOOKS } from "../index.ts";
import { splitGroup } from "../groups.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey, Entrant, EngineState, GcContext, RaceGroup, RiderState, RouteV2, SegmentHookContext, StageInput, TeamOrder,
  TeamReactionState, TimelineEvent,
} from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const ROUTE: RouteV2 = {
  distance_km: 160, profile_type: "mountain", finale_type: "long_climb",
  segments: [
    ...Array.from({ length: 10 }, (_, i) => ({ kind: "flat" as const, from_km: i * 10, to_km: (i + 1) * 10 })),
    { kind: "climb" as const, from_km: 100, to_km: 130, category: "1" as const, avg_gradient: 7, top_elevation_m: 1800 },
    { kind: "flat" as const, from_km: 130, to_km: 160 },
  ],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
};
const TEAMS = ["A", "B", "C", "D", "E", "F"];

function entrants(levels: Record<string, number> = {}): Record<string, Entrant> {
  const out: Record<string, Entrant> = {};
  for (const team of TEAMS) {
    for (let i = 0; i < 6; i++) {
      const id = `${team}${i}`;
      out[id] = { rider_id: id, abilities: abilities(levels[id] ?? (i === 0 ? 70 : 50)), role: i === 0 ? "captain" : "helper", effort: "normal", condition: 1, team_id: team };
    }
  }
  return out;
}

/** A0 foerer, B0 nr. 2, ...; C1 er nr. 15 (+5:00), D1 er nr. 25 (langt nede). */
function gc(extra: Partial<Record<string, number>> = {}, stagesRemaining?: number): GcContext {
  const rows: Array<[string, number]> = [["A0", 0], ["B0", 20], ["C0", 40], ["D0", 60], ["E0", 80], ["F0", 100]];
  for (const [id, gap] of Object.entries(extra)) rows.push([id, gap as number]);
  rows.sort((a, b) => a[1] - b[1]);
  return {
    status: "standings", stage_number: 6, leader_id: "A0",
    standings: rows.map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds })),
    ...(stagesRemaining !== undefined ? { stages_remaining: stagesRemaining } : {}),
  };
}

function groups(breakIds: string[], all: Record<string, Entrant>, lead: number): RaceGroup[] {
  return [
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: [...breakIds].sort(), gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(all).filter((id) => !breakIds.includes(id)).sort(), gap_seconds: lead, cohesion: 1 },
  ];
}

// ── 3. Hvem er farlig, og hvem har noget at forsvare ─────────────────────────

test("#5978 v3: a team far down the top 10 but close in time has something to defend; v2 does not", () => {
  const all = entrants();
  // Hold A's bedste mand staar nr. 12, 2:30 efter, med mange etaper tilbage.
  const ctx = gc({ X1: 10, X2: 11, X3: 12, X4: 13, X5: 14, X6: 15, A1: 150, C1: 160 }, 8);
  const standings = ctx.status === "standings" ? ctx.standings.filter((s) => s.rider_id !== "A0") : [];
  const ctxNoA0: GcContext = { ...(ctx as Extract<GcContext, { status: "standings" }>), leader_id: "B0", standings: standings.map((s, i) => ({ ...s, rank: i + 1 })) };
  const base = { gcContext: ctxNoA0, groups: groups(["C1"], all, 120), entrants: all, route: ROUTE, protectedRiderId: "A1", km: 20 };
  assert.equal(assessGcThreat(base).reason, "no_gc_interest", "v2: outside the top 10 = nothing to defend");
  const v3 = assessGcThreat({ ...base, dangerModel: { stagesRemaining: 8 } });
  assert.notEqual(v3.reason, "no_gc_interest");
  assert.notEqual(v3.severity, "none", "C1 (+10 s behind A1) 2 min up the road is a real threat");
});

test("#5978 v3: ability over the remaining stages makes a rider dangerous that today's gap alone does not", () => {
  const all = entrants({ C1: 80 });
  const ctx = gc({ C1: 300 }, 10);
  const base = { gcContext: ctx, groups: groups(["C1"], all, 120), entrants: all, route: ROUTE, protectedRiderId: "B0", km: 120 };
  const v2 = assessGcThreat(base);
  const v3 = assessGcThreat({ ...base, dangerModel: { stagesRemaining: 10 } });
  assert.equal(v2.severity, "none");
  assert.ok(v3.severity !== "none" || v3.leash_hold === true, "a stronger climber with ten stages left is dangerous");
  // Uden resterende etaper (sidste etape) er han lige saa harmloes som i v2.
  assert.equal(assessGcThreat({ ...base, dangerModel: { stagesRemaining: 0 } }).severity, v2.severity);
});

// ── 2. Snoren ────────────────────────────────────────────────────────────────

test("#5978 v3: the leash holds while the dangerous rider is up there and the margin is not reached", () => {
  const all = entrants({ C1: 70 });
  const ctx = gc({ C1: 200 });
  const at = (lead: number) => assessGcThreat({ gcContext: ctx, groups: groups(["C1", "D3"], all, lead), entrants: all, route: ROUTE, protectedRiderId: "B0", km: 155, dangerModel: {} });
  // Afstand B0 -> C1 = 180 s. Margin er naaet foerst naar forspringet er under afstand minus margin.
  const leash = GC_THREAT_V3_TUNING.leashMarginSeconds;
  assert.equal(at(180 - leash + 20).leash_hold, true);
  assert.deepEqual(at(180 - leash + 20).leash_rider_ids, ["C1"]);
  assert.equal(at(180 - leash - 20).leash_hold, false);
  // Bremsen holder forspringet under snorens laengde.
  assert.equal(at(200).tolerated_lead_seconds, 180 - leash);
  // Falder han fra (ikke laengere i udbruddet), slippes udbruddet.
  const dropped = assessGcThreat({ gcContext: ctx, groups: groups(["D3"], all, 150), entrants: all, route: ROUTE, protectedRiderId: "B0", km: 155, dangerModel: {} });
  assert.equal(dropped.leash_hold ?? false, false);
  assert.equal(dropped.severity, "none");
});

test("#5978 v3: a reacting team never stops as 'contained' while the leash holds; only when helpers run out", () => {
  const threat = { severity: "none" as const, reason: "harmless" as const, protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: [], tied: false, leash_hold: true, leash_rider_ids: ["C1"] };
  const reacting: TeamReactionState = { ...IDLE_TEAM_REACTION, status: "reacting", mode: "neutral" };
  const held = planTeamReaction({ prior: reacting, threat, stance: "neutral", availableWorkers: ["B2"], leash: true });
  assert.ok(held.intensity > 0);
  assert.equal(held.reason, "leash");
  const kept = advanceTeamReaction({ prior: reacting, threat, stance: "neutral", availableWorkers: ["B2"], performedWork: 0.001, teamId: "B", km: 50, leash: true });
  assert.equal(kept.next.status, "reacting");
  assert.equal(kept.events.length, 0, "no stop event");
  // v2 (uden snor): samme situation stopper som "contained".
  const v2 = advanceTeamReaction({ prior: reacting, threat: { ...threat, leash_hold: undefined }, stance: "neutral", availableWorkers: ["B2"], performedWork: 0, teamId: "B", km: 50 });
  assert.equal(v2.events[0].params.reason, "contained");
  // Ingen hjaelpere med kraefter: snoren knaekker, og grunden siges aerligt.
  const tired = advanceTeamReaction({ prior: reacting, threat, stance: "neutral", availableWorkers: [], performedWork: 0, teamId: "B", km: 60, leash: true });
  assert.equal(tired.next.status, "idle");
  assert.equal(tired.events[0].params.reason, "no_workers");
  // Snoren starter ikke en reaktion af sig selv (kun et hold der allerede reagerer holder den).
  assert.equal(planTeamReaction({ prior: undefined, threat, stance: "neutral", availableWorkers: ["B2"], leash: true }).intensity, 0);
});

test("#5978 v3: a team holding the leash brakes the let-go phase, also at a moderate threat", () => {
  const threat = { severity: "moderate" as const, reason: "rival_close" as const, protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: ["C1"], tied: false, tolerated_lead_seconds: 100, leash_hold: true };
  const decision = { teamId: "B", threat, stance: "neutral" as const, plan: { intensity: 0.5 } };
  assert.equal(letGoBrakingTeams([decision], "peloton-0").size, 0, "v2: only a serious threat brakes");
  assert.equal(letGoBrakingTeams([decision], "peloton-0", true).get("B"), 100);
});

// ── 4. Endagsloeb ────────────────────────────────────────────────────────────

test("#5978 v3: one-day race: a rider who can win today ahead of a captain who can win is a threat; v2 ignores it", () => {
  const all = entrants({ C1: 72 });
  const demand = RACE_V4_TUNING.finale.demandVectorByFinaleType.long_climb!;
  const g = groups(["C1", "D3"], all, 200);
  const protectedId = oneDayProtectedRider({ teamId: "B", groups: g, entrants: all, routeDemand: demand });
  assert.equal(protectedId, "B0");
  const base = { gcContext: { status: "one_day" } as GcContext, groups: g, entrants: all, route: ROUTE, protectedRiderId: protectedId, km: 50 };
  assert.equal(assessGcThreat(base).reason, "one_day", "v2: no reaction in a one-day race");
  const v3 = assessGcThreat({ ...base, dangerModel: { routeDemand: demand } });
  assert.equal(v3.severity, "serious");
  assert.equal(v3.reason, "winner_ahead");
  assert.equal(v3.one_day, true);
  assert.deepEqual(v3.threat_rider_ids, ["C1"]);
  // Ingen kaptajn der kan vinde: holdet har intet at forsvare.
  const weak = entrants({ C1: 72, B0: 40 });
  assert.equal(oneDayProtectedRider({ teamId: "B", groups: g, entrants: weak, routeDemand: demand }), null);
  // En hjaelper der ikke kan vinde, er ingen trussel.
  const harmless = assessGcThreat({ ...base, groups: groups(["D3", "E4"], all, 200), dangerModel: { routeDemand: demand } });
  assert.equal(harmless.severity, "none");
  // Lad gaa i et endagsloeb giver ingen undtagelse (beskytter kun klassementet, ejer 30/9).
  assert.equal(planTeamReaction({ prior: undefined, threat: v3, stance: "let_go", availableWorkers: ["B2"], leash: true }).reason, "let_go_one_day");
  assert.ok(planTeamReaction({ prior: undefined, threat: v3, stance: "neutral", availableWorkers: ["B2"], leash: true }).intensity > 0);
});

test("#5978 v3: own riders are never the threat (one-day and stage race)", () => {
  const all = entrants({ B1: 72 });
  const demand = RACE_V4_TUNING.finale.demandVectorByFinaleType.long_climb!;
  const g = groups(["B1"], all, 300);
  const oneDay = assessGcThreat({ gcContext: { status: "one_day" }, groups: g, entrants: all, route: ROUTE, protectedRiderId: "B0", km: 50, ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: { routeDemand: demand } });
  assert.equal(oneDay.severity, "none");
  assert.equal(oneDay.reason, "own_rider_ahead");
  const stage = assessGcThreat({ gcContext: gc({ B1: 30 }), groups: g, entrants: all, route: ROUTE, protectedRiderId: "B0", km: 50, ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: {} });
  assert.equal(stage.severity, "none");
  assert.equal(stage.leash_hold ?? false, false);
  assert.deepEqual(formationDangerTeams({ gcContext: gc({ B1: 30 }), riderId: "B1", teamIds: ["B"], groups: [g[1]].map((x) => ({ ...x, rider_ids: [...x.rider_ids, "B1"].sort() })), entrants: all, route: ROUTE, km: 0, dangerModel: {} }), []);
});

// ── 1. Dannelsen ─────────────────────────────────────────────────────────────

function formationRiders(): FormationRider[] {
  const out: FormationRider[] = [];
  for (const team of TEAMS) {
    for (let i = 0; i < 6; i++) {
      const id = `${team}${i}`;
      out.push({ rider_id: id, team_id: team, role: i === 0 ? "captain" : "helper", effort: "normal", tryBreak: id === "C1" || id === "D3" ? true : undefined, strength: 0.6, spontaneousChance: 0, engine: 0.5, freshness: 1 });
    }
  }
  return out;
}

test("#5978 v3: an attempt by a dangerous rider meets the defending teams' full reaction and costs him more", () => {
  const stances = new Map(TEAMS.map((t) => [t, "neutral" as const]));
  // Succes-rullet ligger midt i omraadet, saa forskellen i sandsynlighed afgoer udfaldet.
  const rolls = (r: number) => (stream: "attempt" | "success") => (stream === "attempt" ? 0 : r);
  const base = { riders: formationRiders(), stances, maxSize: 8 };
  const v2 = resolveMorningBreakFormation({ ...base, roll: rolls(0.5) });
  const v3 = resolveMorningBreakFormation({ ...base, roll: rolls(0.5), dangerTeams: (id) => (id === "C1" ? ["A", "B", "E", "F"] : []) });
  assert.ok(v2.escaped.includes("C1"), "v2: C1 gets away like anyone");
  assert.equal(v3.escaped.includes("C1"), false, "v3: the defending teams close him down");
  assert.ok(v3.escaped.includes("D3"), "a harmless attacker is not affected");
  assert.equal(v3.attemptCost.get("C1"), (v2.attemptCost.get("C1") ?? 0) * DANGEROUS_ATTEMPT_TUNING.attemptCostFactor);
  assert.equal(v3.attemptCost.get("D3"), v2.attemptCost.get("D3"));
  // Den haardere modreaktion koster de forsvarende holds arbejdere mere.
  const sum = (m: Map<string, number>, team: string) => [...m].filter(([id]) => id.startsWith(team)).reduce((s, [, v]) => s + v, 0);
  assert.ok(sum(v3.reactionCost, "A") > sum(v2.reactionCost, "A"));
  // Et hold der lader gaa, reagerer heller ikke paa en farlig rytter.
  const letGo = resolveMorningBreakFormation({ ...base, stances: new Map(TEAMS.map((t) => [t, "let_go" as const])), roll: rolls(0.5), dangerTeams: () => ["A", "B"] });
  const letGoV2 = resolveMorningBreakFormation({ ...base, stances: new Map(TEAMS.map((t) => [t, "let_go" as const])), roll: rolls(0.5) });
  assert.deepEqual(letGo.escaped, letGoV2.escaped);
  // Udeladt dangerTeams = bit-identisk dannelse.
  assert.deepEqual(resolveMorningBreakFormation({ ...base, roll: rolls(0.5) }), v2);
});

test("#5978 v3: formation danger: a GC rider close in time is dangerous to the teams ahead of him, a rider far down is not", () => {
  const all = entrants({ C1: 70 });
  const ctx = gc({ C1: 60, D5: 3000 });
  const peloton: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(all).sort(), gap_seconds: 0, cohesion: 1 };
  const close = formationDangerTeams({ gcContext: ctx, riderId: "C1", teamIds: TEAMS, groups: [peloton], entrants: all, route: ROUTE, km: 0, dangerModel: { stagesRemaining: 5 } });
  assert.ok(close.includes("A") && close.includes("B"), `teams ahead of him defend (${close})`);
  assert.equal(close.includes("C"), false, "never his own team");
  assert.deepEqual(formationDangerTeams({ gcContext: ctx, riderId: "D5", teamIds: TEAMS, groups: [peloton], entrants: all, route: ROUTE, km: 0, dangerModel: { stagesRemaining: 5 } }), []);
});

// ── Review af #6213 ─────────────────────────────────────────────────────────

test("#5978 (review 1): two breaks behind one chase group: each rider's work is merged (max), order-independent", () => {
  const a = { signal: 0.2, chaserWork: new Map([["B2", 1], ["C2", 0.5]]) };
  const b = { signal: 0.4, chaserWork: new Map([["C2", 1], ["D2", 0.25]]) };
  const ab = mergeChasePlans(a, b);
  const ba = mergeChasePlans(b, a);
  assert.deepEqual([...ab.chaserWork], [["B2", 1], ["C2", 1], ["D2", 0.25]]);
  assert.deepEqual([...ab.chaserWork], [...ba.chaserWork]);
});

function hookState(all: Record<string, Entrant>, breakIds: string[]): EngineState {
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(all)) {
    riders[id] = { rider_id: id, group_id: breakIds.includes(id) ? "breakaway-0" : "peloton-0", cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  return { km: 20, groups: groups(breakIds, all, 30), riders, virtual_gc: {} };
}

test("#5978 (review 2): the hook uses the wheel-sitters segmentLoop computed at segment start (ctx), not a fresh set", () => {
  const all = entrants({ C1: 70 });
  const ctxGc = gc({ B1: 30, C1: 25 });
  const state = hookState(all, ["B1", "C1"]);
  const orders: TeamOrder[] = TEAMS.map((t) => ({ team_id: t, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [] } }));
  const base = makeHookCtx({ segment: ROUTE.segments[3], segmentIndex: 3, route: ROUTE, entrants: all, tuning: RACE_V4_TUNING, orders });
  const ctx: SegmentHookContext = { ...base, rulesRevision: "orders_gc_v1", gcContext: ctxGc, ordersGcV3: true };
  const lines = (events: TimelineEvent[]) => events.filter((e) => e.type === "own_riders_ahead" && e.params.reason === "on_wheel");
  // Med segmentLoop's saet fra segmentets start: hooket bruger det, ogsaa naar det er tomt.
  const none = breakawayHook(state, { ...ctx, ownRidersOnWheel: [] });
  assert.deepEqual(lines(none.events), []);
  const given = breakawayHook(state, { ...ctx, ownRidersOnWheel: [{ team_id: "D", group_id: "breakaway-0", rider_ids: ["D9"], protected_rider_id: "D0" }] });
  assert.deepEqual(lines(given.events).map((e) => e.params.rider_ids), [["D9"]]);
});

// ── Review af #5978, punkt 1: paa hjul bruger reaktionens DangerModel ────────

test("#5978 (review 1 of #5978): on the wheel uses the reaction's danger model: a team with something to defend outside the top 10", () => {
  const all = entrants();
  // Hold A's bedste mand (A1) staar nr. 12, 2:30 efter; C1 (+10 s bag ham) er i udbruddet med A's egen A3.
  const ctx = gc({ X1: 10, X2: 11, X3: 12, X4: 13, X5: 14, X6: 15, A1: 150, C1: 160 }, 8);
  const standings = ctx.status === "standings" ? ctx.standings.filter((s) => s.rider_id !== "A0") : [];
  const ctxNoA0: GcContext = { ...(ctx as Extract<GcContext, { status: "standings" }>), leader_id: "B0", standings: standings.map((s, i) => ({ ...s, rank: i + 1 })) };
  const state = hookState(all, ["A3", "C1"]);
  const base = { groups: state.groups, riders: state.riders, entrants: all, gcContext: ctxNoA0, route: ROUTE, km: 20 };
  // Reaktionen (v3) reagerer for hold A ...
  const threat = assessGcThreat({ gcContext: ctxNoA0, groups: state.groups, entrants: all, route: ROUTE, protectedRiderId: "A1", km: 20, ownTeamId: "A", dangerModel: { stagesRemaining: 8 } });
  assert.notEqual(threat.severity, "none");
  // ... saa A3 sidder paa hjul under v3. Uden DangerModel (#6187-vurderingen) har A intet at forsvare.
  assert.deepEqual(ownRidersOnWheel(base), []);
  const expected = [{ team_id: "A", group_id: "breakaway-0", rider_ids: ["A3"], protected_rider_id: "A1" }];
  assert.deepEqual(ownRidersOnWheel({ ...base, dangerModel: { stagesRemaining: 8 } }), expected);
  // segmentLoop's kobling bygger samme model fra klassement-konteksten (etaper tilbage).
  assert.deepEqual(ownRidersOnWheelRaw({ ...base, tuning: RACE_V4_TUNING }), expected);
  // Uden klassement (raa kontekst "missing") sidder ingen paa hjul (overtaget fra den fjernede ownRiderWheelSitterIds-test).
  assert.deepEqual(ownRidersOnWheelRaw({ ...base, gcContext: { status: "missing" }, tuning: RACE_V4_TUNING }), []);
});

test("#5978 (review 1 of #5978): on the wheel in a one-day race: the captain who can win is protected", () => {
  const all = entrants({ C1: 72 });
  const state = hookState(all, ["B1", "C1"]);
  // Forspring 200 s: C1 kan vinde i dag og truer B0 (kaptajn der kan vinde); B1 er B's egen.
  const g = groups(["B1", "C1"], all, 200);
  const base = { groups: g, riders: state.riders, entrants: all, gcContext: { status: "one_day" } as GcContext, route: ROUTE, km: 20 };
  assert.deepEqual(ownRidersOnWheel(base), [], "#6187 assessment: nothing in a one-day race");
  const expected = [{ team_id: "B", group_id: "breakaway-0", rider_ids: ["B1"], protected_rider_id: "B0" }];
  const demand = RACE_V4_TUNING.finale.demandVectorByFinaleType.long_climb!;
  assert.deepEqual(ownRidersOnWheel({ ...base, dangerModel: { routeDemand: demand } }), expected);
  assert.deepEqual(ownRidersOnWheelRaw({ ...base, tuning: RACE_V4_TUNING }), expected);
});

// ── Review af #6213, punkt 4: paa hjul ende-til-ende ─────────────────────────

/** Fast udbrud paa foerste segment, ellers intet M5-arbejde: kun hjul-reglen adskiller v2 og v3. */
function fixedBreakHook(breakIds: string[]) {
  return (state: EngineState, ctx: SegmentHookContext) => {
    if (ctx.segmentIndex !== 0 || state.groups.some((g) => g.kind === "breakaway")) return { state, events: [] };
    const source = [...state.groups].sort((a, b) => b.rider_ids.length - a.rider_ids.length)[0];
    return { state: { ...state, groups: splitGroup(state.groups, source.id, breakIds, { id: "breakaway-0", kind: "breakaway", gapSecondsDelta: -60, origin: "breakaway" }) }, events: [] };
  };
}

test("#5978 (review 4): end to end, the rider on the wheel spends less energy than when he has to pull", () => {
  const all = entrants({ B1: 75, C1: 70, D3: 60 });
  const breakIds = ["B1", "C1", "D3"];
  const input = (rules: "orders_gc_v2" | "orders_gc_v3"): StageInput => ({
    route: ROUTE, startlist: Object.values(all), orders: [], seed: "5978-wheel", tuning: RACE_V4_TUNING,
    rules_revision: rules, gc_context: gc({ B1: 50, C1: 30 }),
  });
  const hooks = { ...LIVE_MECHANIC_HOOKS, breakaway: fixedBreakHook(breakIds) };
  const v2 = runSegmentLoop(input("orders_gc_v2"), hooks);
  const v3 = runSegmentLoop(input("orders_gc_v3"), hooks);
  // B1 (holdets egen) sidder paa hjul bag C1 (truer B0); han er den staerkeste og ville ellers foere.
  assert.ok(v3.state.riders.B1.work_norm < v2.state.riders.B1.work_norm, `B1 works less on the wheel (${v3.state.riders.B1.work_norm} < ${v2.state.riders.B1.work_norm})`);
  // Nogen anden i udbruddet koerer forrest i hans sted.
  const others = (r: typeof v2) => r.state.riders.C1.work_norm + r.state.riders.D3.work_norm;
  assert.ok(others(v3) >= others(v2));
});

// ── Review af #5978, punkt 6: kanttilfaelde efter kontrakten (ejer 5/10) ─────

test("#5978 v3 (review 6a): two dangerous riders in one break: the leash holds while either sits there, measured on the closer one", () => {
  const all = entrants({ C1: 70, D1: 70 });
  // Afstand B0 -> C1 = 180 s, B0 -> D1 = 240 s.
  const ctx = gc({ C1: 200, D1: 260 });
  const at = (breakIds: string[]) => assessGcThreat({ gcContext: ctx, groups: groups(breakIds, all, 200), entrants: all, route: ROUTE, protectedRiderId: "B0", km: 155, dangerModel: {} });
  const leash = GC_THREAT_V3_TUNING.leashMarginSeconds;
  const both = at(["C1", "D1", "D3"]);
  assert.equal(both.leash_hold, true);
  assert.deepEqual(both.leash_rider_ids, ["C1", "D1"]);
  assert.equal(both.tolerated_lead_seconds, 180 - leash, "the closer dangerous rider sets the leash length");
  // C1 falder fra: snoren holder stadig paa D1, nu med hans (laengere) afstand.
  const onlyD1 = at(["D1", "D3"]);
  assert.equal(onlyD1.leash_hold, true);
  assert.deepEqual(onlyD1.leash_rider_ids, ["D1"]);
  assert.equal(onlyD1.tolerated_lead_seconds, 240 - leash);
  // Begge vaek: udbruddet slippes.
  const released = at(["D3"]);
  assert.equal(released.leash_hold ?? false, false);
  assert.equal(released.severity, "none");
});

test("#5978 v3 (review 6b): the GC leader in the break is dangerous to every team with something to defend; his own team rides its own race", () => {
  const all = entrants();
  const ctx = gc({}, 5);
  const g = groups(["A0", "D3"], all, 60);
  const model = { stagesRemaining: 5 };
  const forB = assessGcThreat({ gcContext: ctx, groups: g, entrants: all, route: ROUTE, protectedRiderId: "B0", km: 50, ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: model });
  assert.equal(forB.severity, "serious");
  assert.deepEqual(forB.threat_rider_ids, ["A0"]);
  assert.equal(forB.leash_hold, true);
  assert.deepEqual(forB.leash_rider_ids, ["A0"]);
  assert.equal(forB.tolerated_lead_seconds, 0, "he already leads the GC: no free lead");
  // Hans eget hold jager ikke: klassementsrytteren sidder selv i udbruddet.
  const forA = assessGcThreat({ gcContext: ctx, groups: g, entrants: all, route: ROUTE, protectedRiderId: "A0", km: 50, ownTeamId: "A", skipOwnRiderGroups: true, dangerModel: model });
  assert.equal(forA.severity, "none");
  assert.equal(forA.reason, "protected_ahead");
  assert.equal(forA.leash_hold ?? false, false);
  // Dannelsen: hans forsoeg er farligt for alle andre hold, aldrig for hans eget.
  const peloton: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(all).sort(), gap_seconds: 0, cohesion: 1 };
  assert.deepEqual(formationDangerTeams({ gcContext: ctx, riderId: "A0", teamIds: TEAMS, groups: [peloton], entrants: all, route: ROUTE, km: 0, dangerModel: model }), ["B", "C", "D", "E", "F"]);
});

const PAUSED: GcThreat = { severity: "none", reason: "protected_in_other_group", protected_rider_id: "B0", chase_group_id: "group-b", threat_rider_ids: [], tied: false };

test("#5978 v3 (review 6c): the pause: the GC rider in another group stops nothing and books nothing; back in the chase group the reaction carries on", () => {
  const reacting: TeamReactionState = { ...IDLE_TEAM_REACTION, status: "reacting", mode: "neutral", neutral_work: 0.01 };
  assert.equal(planTeamReaction({ prior: reacting, threat: PAUSED, stance: "neutral", availableWorkers: ["B2"], leash: true }).intensity, 0);
  const pause = advanceTeamReaction({ prior: reacting, threat: PAUSED, stance: "neutral", availableWorkers: ["B2"], performedWork: 0, teamId: "B", km: 80, leash: true });
  assert.equal(pause.next, reacting, "unchanged: no stop, no booked work");
  assert.deepEqual(pause.events, []);
  assert.deepEqual(pause.workers, []);
  // Tilbage i jagtgruppen, den farlige rytter er der stadig: ingen ny "started".
  const back: GcThreat = { severity: "serious", reason: "rival_ahead", protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: ["C1"], tied: false, tolerated_lead_seconds: 0, leash_hold: true, leash_rider_ids: ["C1"] };
  const resumed = advanceTeamReaction({ prior: pause.next, threat: back, stance: "neutral", availableWorkers: ["B2"], performedWork: 0.002, teamId: "B", km: 90, leash: true });
  assert.equal(resumed.next.status, "reacting");
  assert.deepEqual(resumed.events, []);
  assert.equal(resumed.next.neutral_work, reacting.neutral_work + 0.002);
  // orders_gc_v2 (ingen snor): samme situation stopper straks som "contained" (uaendret).
  const v2 = advanceTeamReaction({ prior: reacting, threat: PAUSED, stance: "neutral", availableWorkers: ["B2"], performedWork: 0, teamId: "B", km: 80 });
  assert.equal(v2.events[0].params.reason, "contained");
  assert.deepEqual(advanceTeamReaction({ prior: reacting, threat: PAUSED, stance: "neutral", availableWorkers: ["B2"], performedWork: 0, teamId: "B", km: 80, lastSegment: true }), v2, "lastSegment without the leash changes nothing");
});

test("#5978 v3 (review 7): a pause that lasts the stage is closed on the last segment: 'started' always gets a 'stopped'", () => {
  const reacting: TeamReactionState = { ...IDLE_TEAM_REACTION, status: "reacting", mode: "neutral", neutral_work: 0.01 };
  const end = advanceTeamReaction({ prior: reacting, threat: PAUSED, stance: "neutral", availableWorkers: [], performedWork: 0, teamId: "B", km: 160, leash: true, lastSegment: true });
  assert.equal(end.next.status, "idle");
  assert.equal(end.next.neutral_work, reacting.neutral_work, "stopping never resets the booked work");
  assert.equal(end.events.length, 1);
  assert.equal(end.events[0].type, "gc_reaction");
  assert.equal(end.events[0].params.status, "stopped");
  assert.equal(end.events[0].params.reason, "protected_in_other_group", "an existing reason, never 'contained'");
  assert.equal(end.events[0].params.mode, "neutral");

  // Gennem hooket: B0 sidder bag feltet i sin egen gruppe, C1 (farlig for B) i udbruddet.
  const all = entrants({ C1: 70 });
  const st = hookState(all, ["C1"]);
  const state: EngineState = {
    ...st,
    groups: [
      st.groups[0],
      { ...st.groups[1], rider_ids: st.groups[1].rider_ids.filter((id) => id !== "B0") },
      { id: "group-b", kind: "gruppetto", rider_ids: ["B0"], gap_seconds: 200, cohesion: 1 },
    ],
    riders: { ...st.riders, B0: { ...st.riders.B0, group_id: "group-b" } },
    team_reactions: { B: reacting },
  };
  const orders: TeamOrder[] = TEAMS.map((t) => ({ team_id: t, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [] } }));
  const hookAt = (index: number, v3: boolean) => {
    const base = makeHookCtx({ segment: ROUTE.segments[index], segmentIndex: index, route: ROUTE, entrants: all, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = { ...base, rulesRevision: "orders_gc_v1", gcContext: gc({ C1: 200 }), ...(v3 ? { ordersGcV3: true as const } : {}) };
    return breakawayHook(state, ctx);
  };
  const forB = (events: TimelineEvent[]) => events.filter((e) => e.type === "gc_reaction" && e.params.team_id === "B");
  // Midt i etapen: pause, intet event, reaktionen staar.
  const mid = hookAt(5, true);
  assert.deepEqual(forB(mid.events), []);
  assert.equal(mid.state.team_reactions?.B?.status, "reacting");
  // Sidste segment: afsluttet med en eksisterende grund.
  const last = hookAt(ROUTE.segments.length - 1, true);
  assert.deepEqual(forB(last.events).map((e) => [e.params.status, e.params.reason]), [["stopped", "protected_in_other_group"]]);
  assert.equal(last.state.team_reactions?.B?.status, "idle");
  // Under orders_gc_v2 (uden v3) stopper den straks som "contained", ogsaa midt i etapen (uaendret).
  assert.deepEqual(forB(hookAt(5, false).events).map((e) => [e.params.status, e.params.reason]), [["stopped", "contained"]]);
});

test("#5978 v3 (review 6d): let_go in a stage race: the preventive exception holds the leash until its budget is spent, never 'contained', never started by the leash alone", () => {
  const serious: GcThreat = { severity: "serious", reason: "rival_ahead", protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: ["C1"], tied: false, tolerated_lead_seconds: 0, leash_hold: true, leash_rider_ids: ["C1"] };
  const leashOnly: GcThreat = { severity: "none", reason: "harmless", protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: [], tied: false, tolerated_lead_seconds: 30, leash_hold: true, leash_rider_ids: ["C1"] };
  const base = { stance: "let_go" as const, availableWorkers: ["B2", "B3"], teamId: "B", leash: true };
  // Snoren alene starter ikke lad-gaa-undtagelsen.
  assert.equal(planTeamReaction({ prior: undefined, threat: leashOnly, ...base }).intensity, 0);
  // En alvorlig trussel starter den forebyggende undtagelse (som foer).
  const start = advanceTeamReaction({ prior: undefined, threat: serious, performedWork: 0.001, km: 30, ...base });
  assert.equal(start.next.status, "reacting");
  assert.equal(start.next.mode, "preventive");
  assert.deepEqual(start.events.map((e) => e.params.status), ["started"]);
  // Truslen er ikke laengere alvorlig, men han sidder der, og margin er ikke naaet: snoren holder.
  const held = planTeamReaction({ prior: start.next, threat: leashOnly, ...base });
  assert.ok(held.intensity > 0);
  assert.equal(held.mode, "preventive");
  assert.equal(held.reason, "leash");
  const kept = advanceTeamReaction({ prior: start.next, threat: leashOnly, performedWork: 0.001, km: 40, ...base });
  assert.equal(kept.next.status, "reacting");
  assert.deepEqual(kept.events, []);
  // Budgettet brugt: stopper aerligt som "budget_exhausted", aldrig "contained".
  const spent = advanceTeamReaction({ prior: kept.next, threat: leashOnly, performedWork: 1, km: 50, ...base });
  assert.equal(spent.next.status, "exhausted");
  assert.deepEqual(spent.events.map((e) => [e.params.status, e.params.reason]), [["exhausted", "budget_exhausted"]]);
  // Og en lad-gaa-reaktion bremser lad-gaa-fasen, mens snoren holder.
  assert.equal(letGoBrakingTeams([{ teamId: "B", threat: leashOnly, stance: "let_go", plan: held }], "peloton-0", true).get("B"), 30);
});

// Kontrakten (ejer 5/10, acceptkriterie 1 + RULES punkt 3): reaktionen stopper
// ikke, saa laenge den farlige rytter sidder der og margin ikke er naaet; kun
// naar hjaelperne eller budgettet er brugt. Ogsaa naar truslen for et lad-gaa-hold
// falder fra alvorlig til moderat (review af #5978, kontrakt-gab fra punkt 6d).
const LET_GO_SERIOUS: GcThreat = { severity: "serious", reason: "rival_ahead", protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: ["C1"], tied: false, tolerated_lead_seconds: 0, leash_hold: true, leash_rider_ids: ["C1"] };
const LET_GO_MODERATE: GcThreat = { severity: "moderate", reason: "rival_close", protected_rider_id: "B0", chase_group_id: "peloton-0", threat_rider_ids: ["C1"], tied: false, tolerated_lead_seconds: 30, leash_hold: true, leash_rider_ids: ["C1"] };

test("#5978 v3 (review 6d, contract gap): let_go in a stage race: a moderate threat while the leash holds keeps the preventive reaction going until helpers or budget run out", () => {
  const base = { stance: "let_go" as const, availableWorkers: ["B2", "B3"], teamId: "B", leash: true };
  const start = advanceTeamReaction({ prior: undefined, threat: LET_GO_SERIOUS, performedWork: 0.001, km: 30, ...base });
  assert.equal(start.next.status, "reacting");
  const plan = planTeamReaction({ prior: start.next, threat: LET_GO_MODERATE, ...base });
  assert.ok(plan.intensity > 0, "the leash still holds: the reaction keeps working");
  assert.equal(plan.mode, "preventive");
  assert.equal(plan.reason, "leash");
  const next = advanceTeamReaction({ prior: start.next, threat: LET_GO_MODERATE, performedWork: 0.001, km: 40, ...base });
  assert.equal(next.next.status, "reacting", "the leash still holds: the reaction must not stop");
  assert.deepEqual(next.events, []);
  assert.equal(next.next.preventive_work, start.next.preventive_work + 0.001, "the work is booked on the same budget");
  // Og det hold bremser lad-gaa-fasen ved den moderate trussel, mens snoren holder.
  assert.equal(letGoBrakingTeams([{ teamId: "B", threat: LET_GO_MODERATE, stance: "let_go", plan }], "peloton-0", true).get("B"), 30);
  // Budgettet brugt: stopper aerligt som "budget_exhausted".
  const spent = advanceTeamReaction({ prior: next.next, threat: LET_GO_MODERATE, performedWork: 1, km: 50, ...base });
  assert.equal(spent.next.status, "exhausted");
  assert.deepEqual(spent.events.map((e) => [e.params.status, e.params.reason]), [["exhausted", "budget_exhausted"]]);
  // Ingen hjaelpere med kraefter: stopper aerligt som "no_workers", aldrig "let_go_not_serious".
  const tired = advanceTeamReaction({ prior: next.next, threat: LET_GO_MODERATE, performedWork: 0, km: 50, ...base, availableWorkers: [] });
  assert.equal(tired.next.status, "idle");
  assert.deepEqual(tired.events.map((e) => [e.params.status, e.params.reason]), [["stopped", "no_workers"]]);
  // Snoren starter stadig ikke lad-gaa-undtagelsen ved en moderat trussel.
  assert.equal(planTeamReaction({ prior: undefined, threat: LET_GO_MODERATE, ...base }).reason, "let_go_not_serious");
});

test("#5978 v3 (review 6d, opposite direction): without the leash a let_go team still stops at a moderate threat, as before", () => {
  const base = { stance: "let_go" as const, availableWorkers: ["B2", "B3"], teamId: "B" };
  // orders_gc_v1/v2 (ingen snor): uaendret, stopper som "let_go_not_serious".
  const start = advanceTeamReaction({ prior: undefined, threat: LET_GO_SERIOUS, performedWork: 0.001, km: 30, ...base });
  const v2 = advanceTeamReaction({ prior: start.next, threat: LET_GO_MODERATE, performedWork: 0, km: 40, ...base });
  assert.equal(v2.next.status, "idle");
  assert.deepEqual(v2.events.map((e) => [e.params.status, e.params.reason]), [["stopped", "let_go_not_serious"]]);
  // orders_gc_v3, men snoren holder ikke (margin naaet eller han er vaek): ogsaa uaendret.
  const loose: GcThreat = { ...LET_GO_MODERATE, leash_hold: false, leash_rider_ids: undefined };
  const v3Start = advanceTeamReaction({ prior: undefined, threat: LET_GO_SERIOUS, performedWork: 0.001, km: 30, ...base, leash: true });
  const v3 = advanceTeamReaction({ prior: v3Start.next, threat: loose, performedWork: 0, km: 40, ...base, leash: true });
  assert.equal(v3.next.status, "idle");
  assert.deepEqual(v3.events.map((e) => [e.params.status, e.params.reason]), [["stopped", "let_go_not_serious"]]);
});

// Review af #5978 (variant set i koden): snoren er den ENESTE trussel (ingen
// alvorlig/moderat rytter, men en farlig rytter sidder der under margin), og
// holdets klassementsrytter sidder i en anden gruppe end jagtgruppen. Uden
// rettelsen gav vurderingen ikke "protected_in_other_group": snoren holdt
// reaktionen som "reacting" med hjaelperne i hans gruppe, som ingen jagt bruger
// (intet arbejde), og etapens sidste segment afsluttede den ikke.

/** C1 (farlig for B) i udbruddet; B0 + B2 i en gruppe bag feltet, `lead` s efter udbruddet. */
function otherGroupState(all: Record<string, Entrant>, lead: number, prior: TeamReactionState): EngineState {
  const st = hookState(all, ["C1"]);
  return {
    ...st,
    groups: [
      st.groups[0],
      { ...st.groups[1], rider_ids: st.groups[1].rider_ids.filter((id) => id !== "B0" && id !== "B2") },
      { id: "group-b", kind: "gruppetto", rider_ids: ["B0", "B2"], gap_seconds: lead, cohesion: 1 },
    ],
    riders: { ...st.riders, B0: { ...st.riders.B0, group_id: "group-b" }, B2: { ...st.riders.B2, group_id: "group-b" } },
    team_reactions: { B: prior },
  };
}

test("#5978 v3 (review, leash-only variant): the GC rider in another group pauses a reaction held only by the leash, like any other threat", () => {
  const all = entrants({ C1: 70 });
  const ctx = gc({ C1: 200 }); // B0 -> C1 = 180 s
  // Sidste segment (130-160 km): forspring 75 s giver en fremskrevet margin mellem
  // det moderate vindue og snorens margin: ingen alvorlig/moderat trussel, men snoren holder.
  const state = otherGroupState(all, 75, { ...IDLE_TEAM_REACTION, status: "reacting", mode: "neutral", neutral_work: 0.01 });
  const assess = (chasing?: ReadonlySet<string>) => assessGcThreat({
    gcContext: ctx, groups: [state.groups[0], state.groups[2]], entrants: all, route: ROUTE, protectedRiderId: "B0", km: 130,
    ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: {}, ...(chasing ? { chasingGroupIds: chasing } : {}),
  });
  const leashOnly = assess();
  assert.equal(leashOnly.severity, "none", "precondition: no serious or moderate rider");
  assert.equal(leashOnly.leash_hold, true, "precondition: the leash holds");
  // Hans gruppe jager ikke: samme dom som ved en alvorlig/moderat trussel.
  const paused = assess(new Set(["peloton-0"]));
  assert.equal(paused.reason, "protected_in_other_group");
  assert.equal(paused.leash_hold ?? false, false);
  // Hans gruppe jager: snoren holder som foer.
  assert.equal(assess(new Set(["group-b"])).leash_hold, true);
  // Uden DangerModel (orders_gc_v1/v2) aendres intet: ingen snor, ingen pause.
  const v2 = assessGcThreat({ gcContext: ctx, groups: [state.groups[0], state.groups[2]], entrants: all, route: ROUTE, protectedRiderId: "B0", km: 130, chasingGroupIds: new Set(["peloton-0"]) });
  assert.notEqual(v2.reason, "protected_in_other_group");
  assert.equal(v2.leash_hold, undefined);
  // Endagsloeb: samme dom (snoren alene, kaptajnen i en anden gruppe).
  const demand = RACE_V4_TUNING.finale.demandVectorByFinaleType.long_climb!;
  const oneDayAll = entrants({ C1: 72 });
  const oneDayGroups = [state.groups[0], { ...state.groups[2], gap_seconds: GC_THREAT_V3_TUNING.oneDayAllowanceSeconds - GC_THREAT_V3_TUNING.leashMarginSeconds + 10 }];
  const oneDay = (chasing?: ReadonlySet<string>) => assessGcThreat({
    gcContext: { status: "one_day" }, groups: oneDayGroups, entrants: oneDayAll, route: ROUTE, protectedRiderId: "B0", km: 130,
    ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: { routeDemand: demand }, ...(chasing ? { chasingGroupIds: chasing } : {}),
  });
  assert.equal(oneDay().severity, "none", "precondition (one-day): no serious or moderate rider");
  assert.equal(oneDay().leash_hold, true, "precondition (one-day): the leash holds");
  assert.equal(oneDay(new Set(["peloton-0"])).reason, "protected_in_other_group");
  assert.equal(oneDay(new Set(["group-b"])).leash_hold, true);

  // Gennem hooket paa etapens sidste segment: afsluttet med den eksisterende grund.
  const orders: TeamOrder[] = TEAMS.map((t) => ({ team_id: t, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [] } }));
  const hookAt = (s: EngineState, index: number) => {
    const base = makeHookCtx({ segment: ROUTE.segments[index], segmentIndex: index, route: ROUTE, entrants: all, tuning: RACE_V4_TUNING, orders });
    return breakawayHook(s, { ...base, rulesRevision: "orders_gc_v1", gcContext: ctx, ordersGcV3: true });
  };
  const forB = (events: TimelineEvent[]) => events.filter((e) => e.type === "gc_reaction" && e.params.team_id === "B");
  const last = hookAt(state, ROUTE.segments.length - 1);
  assert.deepEqual(forB(last.events).map((e) => [e.params.status, e.params.reason]), [["stopped", "protected_in_other_group"]]);
  assert.equal(last.state.team_reactions?.B?.status, "idle");
  assert.equal(last.state.team_reactions?.B?.neutral_work, 0.01, "nothing booked");

  // Midt i etapen (50-60 km, mere terraen tilbage): pause uden event og uden arbejde.
  // C1 laengere nede (B0 -> C1 = 240 s) og forspring 60 s: igen kun snoren.
  const midCtx = gc({ C1: 260 });
  const mid = otherGroupState(all, 60, { ...IDLE_TEAM_REACTION, status: "reacting", mode: "neutral", neutral_work: 0.01 });
  const midThreat = assessGcThreat({ gcContext: midCtx, groups: [mid.groups[0], mid.groups[2]], entrants: all, route: ROUTE, protectedRiderId: "B0", km: 50, ownTeamId: "B", skipOwnRiderGroups: true, dangerModel: {} });
  assert.equal(midThreat.severity, "none", "precondition (mid): no serious or moderate rider");
  assert.equal(midThreat.leash_hold, true, "precondition (mid): the leash holds");
  const base = makeHookCtx({ segment: ROUTE.segments[5], segmentIndex: 5, route: ROUTE, entrants: all, tuning: RACE_V4_TUNING, orders });
  const midOut = breakawayHook(mid, { ...base, rulesRevision: "orders_gc_v1", gcContext: midCtx, ordersGcV3: true });
  assert.deepEqual(forB(midOut.events), []);
  assert.equal(midOut.state.team_reactions?.B?.status, "reacting");
  assert.equal(midOut.state.team_reactions?.B?.neutral_work, 0.01, "a pause books nothing");
});
