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
} from "./gcThreat.ts";
import {
  advanceTeamReaction,
  IDLE_TEAM_REACTION,
  letGoBrakingTeams,
  planTeamReaction,
} from "./teamChaseReaction.ts";
import { resolveMorningBreakFormation, DANGEROUS_ATTEMPT_TUNING, type FormationRider } from "./breakawayPermission.ts";
import { breakawayHook, mergeChasePlans, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
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
