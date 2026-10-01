// backend/lib/engine/v4/mechanics/teamChaseReaction.test.ts
// #5978 (#5984 Task 4): holdenes faktiske GC-reaktion og det kumulative
// reaktionsbudget, baade som rene funktioner og koblet ind i M5's jagt under
// orders_gc_v1. Syntetiske ryttere; testene laaser strukturelle invarianter
// (hvem reagerer, at budgettet deles og aldrig nulstilles, aerlige events),
// ikke kalibrerede tal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  advanceTeamReaction,
  availableReactionWorkers,
  capPreventiveIntensity,
  IDLE_TEAM_REACTION,
  LET_GO_BRAKE_TUNING,
  brakedLetGoGrowth,
  letGoBrake,
  letGoBrakingTeams,
  planTeamReaction,
  TEAM_REACTION_TUNING,
} from "./teamChaseReaction.ts";
import type { GcThreat } from "./gcThreat.ts";
import { breakawayHook, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import { generateAiTeamOrder } from "../ai/aiTactics.ts";
import { toEngineTeamOrder } from "../orders/teamOrdersAdapter.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import type {
  AbilityKey, Entrant, EngineState, GcContext, RiderState, RouteV2, SegmentHookContext, StageInput, TeamOrder,
  TeamReactionState, TimelineEvent,
} from "../types.ts";

// ── Rene funktioner ──────────────────────────────────────────────────────────

const SERIOUS: GcThreat = { severity: "serious", reason: "leader_at_risk", protected_rider_id: "cap", chase_group_id: "peloton-0", threat_rider_ids: ["rival"], tied: false };
const MODERATE: GcThreat = { ...SERIOUS, severity: "moderate", reason: "rival_close" };
const NONE: GcThreat = { ...SERIOUS, severity: "none", reason: "harmless", threat_rider_ids: [] };

test("plan: explicit chase is never driven or capped by the reaction", () => {
  const plan = planTeamReaction({ prior: undefined, threat: SERIOUS, stance: "chase", availableWorkers: ["h1"] });
  assert.equal(plan.intensity, 0);
  assert.equal(plan.reason, "explicit_chase");
});

test("plan: neutral reacts to its own GC interest, harder for a serious threat", () => {
  const moderate = planTeamReaction({ prior: undefined, threat: MODERATE, stance: "neutral", availableWorkers: ["h1"] });
  const serious = planTeamReaction({ prior: undefined, threat: SERIOUS, stance: "neutral", availableWorkers: ["h1"] });
  const none = planTeamReaction({ prior: undefined, threat: NONE, stance: "neutral", availableWorkers: ["h1"] });
  assert.equal(moderate.mode, "neutral");
  assert.ok(serious.intensity > moderate.intensity && moderate.intensity > 0);
  assert.equal(none.intensity, 0, "no threat: the ordinary neutral default (no chase)");
});

test("plan: let go reacts only to a serious threat, only with budget and workers", () => {
  assert.equal(planTeamReaction({ prior: undefined, threat: MODERATE, stance: "let_go", availableWorkers: ["h1"] }).intensity, 0);
  const serious = planTeamReaction({ prior: undefined, threat: SERIOUS, stance: "let_go", availableWorkers: ["h1"] });
  assert.equal(serious.mode, "preventive");
  assert.ok(serious.intensity > 0);
  const spent: TeamReactionState = { ...IDLE_TEAM_REACTION, preventive_work: TEAM_REACTION_TUNING.preventiveBudget };
  assert.equal(planTeamReaction({ prior: spent, threat: SERIOUS, stance: "let_go", availableWorkers: ["h1"] }).reason, "budget_exhausted");
  assert.equal(planTeamReaction({ prior: undefined, threat: SERIOUS, stance: "let_go", availableWorkers: [] }).reason, "no_workers");
});

test("capPreventiveIntensity keeps the segment's worst-case cost inside the remaining budget", () => {
  const plan = planTeamReaction({ prior: { ...IDLE_TEAM_REACTION, preventive_work: TEAM_REACTION_TUNING.preventiveBudget * 0.9 }, threat: SERIOUS, stance: "let_go", availableWorkers: ["h1"] });
  const bound = TEAM_REACTION_TUNING.preventiveBudget; // fuld intensitet ville koste et helt budget
  const capped = capPreventiveIntensity(plan, bound);
  assert.ok(capped * bound <= plan.budgetRemaining + 1e-12);
  assert.ok(capped < plan.intensity);
});

test("advance: work is cumulative across start, stop and restart, never reset", () => {
  const km = 50;
  let state: TeamReactionState | undefined;
  const events: TimelineEvent[] = [];
  const step = (threat: GcThreat, work: number) => {
    const r = advanceTeamReaction({ prior: state, threat, stance: "let_go", availableWorkers: ["h1", "h2"], performedWork: work, teamId: "A", km });
    state = r.next;
    events.push(...r.events);
    return r;
  };
  const w = TEAM_REACTION_TUNING.preventiveBudget / 5;
  step(SERIOUS, w);
  step(SERIOUS, w);
  step(NONE, 0); // inddaemmet: stop, men arbejdet bevares
  assert.equal(state?.status, "idle");
  assert.ok(Math.abs((state?.preventive_work ?? 0) - 2 * w) < 1e-12);
  step(SERIOUS, w); // ny trussel: samme budget
  assert.ok(Math.abs((state?.preventive_work ?? 0) - 3 * w) < 1e-12);
  step(SERIOUS, w);
  step(SERIOUS, w); // nu er budgettet brugt
  assert.equal(state?.status, "exhausted");
  const after = step(SERIOUS, 0);
  assert.deepEqual(after.workers, [], "exhausted never reacts again this stage");
  assert.deepEqual(events.map((e) => e.params.status), ["started", "stopped", "started", "exhausted"]);
  assert.equal(events[1].params.reason, "contained");
  // Fog-gate: ingen tal i params.
  for (const e of events) for (const v of Object.values(e.params)) assert.notEqual(typeof v, "number");
});

test("advance: a real threat without available helpers is reported once, honestly", () => {
  const a = advanceTeamReaction({ prior: undefined, threat: SERIOUS, stance: "neutral", availableWorkers: [], performedWork: 0, teamId: "A", km: 10 });
  assert.deepEqual(a.events.map((e) => [e.params.status, e.params.reason]), [["unavailable", "no_workers"]]);
  const b = advanceTeamReaction({ prior: a.next, threat: SERIOUS, stance: "neutral", availableWorkers: [], performedWork: 0, teamId: "A", km: 20 });
  assert.deepEqual(b.events, []);
  assert.equal(b.next.status, "idle");
});

test("availableReactionWorkers: only the team's non-leaders in the group, with team effort, not exhausted", () => {
  const entrants: Record<string, Entrant> = {
    cap: entrant("cap", "A", "captain"),
    h1: entrant("h1", "A", "helper"),
    h2: { ...entrant("h2", "A", "helper"), effort: "all_out" },
    h3: entrant("h3", "A", "helper"),
    other: entrant("other", "B", "helper"),
  };
  const riders: Record<string, RiderState> = Object.fromEntries(Object.keys(entrants).map((id) => [id, riderState(id)]));
  riders.h3 = { ...riders.h3, team_cp_factor: TEAM_PLAY_EXTRA_TUNING.minCpFactor };
  assert.deepEqual(
    availableReactionWorkers({ teamId: "A", groupRiderIds: ["cap", "h1", "h2", "h3", "other"], entrants, riders }),
    ["h1"],
  );
  // En hjaelper i en anden gruppe (fx i udbruddet) taeller ikke.
  assert.deepEqual(availableReactionWorkers({ teamId: "A", groupRiderIds: ["cap", "other"], entrants, riders }), []);
});

// ── Koblet ind i M5's jagt (orders_gc_v1) ────────────────────────────────────

function abilities(level = 50): Record<AbilityKey, number> {
  const keys: AbilityKey[] = [
    "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
    "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
  ];
  return Object.fromEntries(keys.map((k) => [k, level])) as Record<AbilityKey, number>;
}
function entrant(id: string, team: string, role: Entrant["role"], level = 50): Entrant {
  return { rider_id: id, abilities: abilities(level), role, effort: "normal", condition: 1, team_id: team };
}
function riderState(id: string, group = "peloton-0"): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}

const ROUTE: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: Array.from({ length: 10 }, (_, i) => ({ kind: "flat" as const, from_km: i * 15, to_km: (i + 1) * 15 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

const TEAMS = ["A", "B", "C", "D", "E", "F"];

function field() {
  const entrants: Record<string, Entrant> = {};
  for (const team of TEAMS) {
    for (let i = 0; i < 5; i++) {
      const id = `${team}${i}`;
      entrants[id] = entrant(id, team, i === 0 ? "captain" : "helper", i === 0 ? 70 : 50);
    }
  }
  return entrants;
}

/** B0 (holdet B's kaptajn, 30 s efter foereren A0) sidder i et udbrud med C1. */
function scenario(breakawayIds = ["B0", "C1"], separation = 240) {
  const entrants = field();
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(entrants)) riders[id] = riderState(id, breakawayIds.includes(id) ? "breakaway-0" : "peloton-0");
  const peloton = Object.keys(entrants).filter((id) => !breakawayIds.includes(id)).sort();
  const state: EngineState = {
    km: 45,
    groups: [
      { id: "breakaway-0", kind: "breakaway", rider_ids: [...breakawayIds].sort(), gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: peloton, gap_seconds: separation, cohesion: 1 },
    ],
    riders, virtual_gc: {},
  };
  return { entrants, state };
}

const GC: GcContext = {
  status: "standings", stage_number: 6, leader_id: "A0",
  standings: [
    ["A0", 0], ["B0", 30], ["D0", 50], ["E0", 70], ["F0", 90], ["C0", 110],
    ...TEAMS.flatMap((t) => [1, 2, 3, 4].map((i) => [`${t}${i}`, 3600 + i] as [string, number])),
  ].map(([rider_id, gap_seconds], i) => ({ rider_id: rider_id as string, rank: i + 1, gap_seconds: gap_seconds as number })),
};

function teamOrder(team: string, stance: "chase" | "neutral" | "let_go"): TeamOrder {
  return { team_id: team, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: stance, riders: [] } };
}

function run(opts: {
  stanceA: "chase" | "neutral" | "let_go";
  gcContext?: GcContext | null;
  revision?: "legacy" | "orders_gc_v1";
  segments?: number;
  breakawayIds?: string[];
  separation?: number;
  ordersA?: TeamOrder;
  othersStance?: "chase" | "neutral" | "let_go";
  mutate?: (s: EngineState) => EngineState;
}) {
  const { entrants, state: initial } = scenario(opts.breakawayIds, opts.separation);
  let state = opts.mutate ? opts.mutate(initial) : initial;
  const orders = [opts.ordersA ?? teamOrder("A", opts.stanceA), ...TEAMS.slice(1).map((t) => teamOrder(t, opts.othersStance ?? "neutral"))];
  const events: TimelineEvent[] = [];
  const first = 3;
  for (let i = first; i < first + (opts.segments ?? 6); i++) {
    const base = makeHookCtx({ segment: ROUTE.segments[i], segmentIndex: i, route: ROUTE, entrants, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = {
      ...base,
      rulesRevision: opts.revision ?? "orders_gc_v1",
      ...(opts.gcContext !== undefined ? { gcContext: opts.gcContext } : {}),
    };
    const r = breakawayHook(state, ctx);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events, entrants };
}

function separation(state: EngineState): number {
  const b = state.groups.find((g) => g.id === "breakaway-0");
  const p = state.groups.find((g) => g.id === "peloton-0");
  return b && p ? p.gap_seconds - b.gap_seconds : 0;
}
function teamFactorLoss(state: EngineState, team: string): number {
  return [1, 2, 3, 4].reduce((s, i) => s + (1 - (state.riders[`${team}${i}`].team_cp_factor ?? 1)), 0);
}
const reactionEvents = (events: TimelineEvent[], team = "A") => events.filter((e) => e.type === "gc_reaction" && e.params.team_id === team);

test("hook: the leader's neutral team reacts to a serious rival up the road, works, and closes more", () => {
  const reacting = run({ stanceA: "neutral", gcContext: GC, separation: 900, segments: 3 });
  const blind = run({ stanceA: "neutral", gcContext: { status: "missing" }, separation: 900, segments: 3 });
  const started = reactionEvents(reacting.events).find((e) => e.params.status === "started");
  assert.ok(started, "team A starts a GC reaction");
  assert.equal(started.params.mode, "neutral");
  assert.equal(started.params.protected_rider_id, "A0");
  assert.deepEqual(started.params.rider_ids, ["B0"]);
  assert.ok(teamFactorLoss(reacting.state, "A") > 0, "the reacting helpers pay for the work");
  assert.equal(teamFactorLoss(blind.state, "A"), 0, "no context: no imaginary protection, no work");
  assert.ok(separation(reacting.state) < separation(blind.state), "the reaction closes the gap faster");
  assert.equal(reacting.state.team_reactions?.A?.mode, "neutral");
  assert.equal(reactionEvents(blind.events).length, 0);
});

test("hook: a harmless rider far down GC does not trigger a reaction", () => {
  const r = run({ stanceA: "neutral", gcContext: GC, breakawayIds: ["C1", "D2"] });
  assert.equal(reactionEvents(r.events).length, 0);
  assert.equal(teamFactorLoss(r.state, "A"), 0);
});

test("hook: let go gives a limited preventive reaction whose cumulative work never exceeds the stage budget", () => {
  const r = run({ stanceA: "let_go", gcContext: GC, segments: 7, separation: 2400, othersStance: "let_go" });
  const statuses = reactionEvents(r.events).map((e) => e.params.status);
  assert.equal(statuses[0], "started");
  assert.equal(r.events.find((e) => e.params.status === "started")?.params.mode, "preventive");
  const spent = r.state.team_reactions?.A?.preventive_work ?? 0;
  assert.ok(spent > 0);
  assert.ok(spent <= TEAM_REACTION_TUNING.preventiveBudget + 1e-9, "never above the budget");
  assert.ok(Math.abs(teamFactorLoss(r.state, "A") - spent) < 1e-9, "booked work equals what the helpers actually paid, once");
  assert.ok(statuses.includes("exhausted"), "a long threat exhausts the budget");
  assert.equal(r.state.team_reactions?.A?.status, "exhausted");
  // Efter udmattelse reagerer holdet ikke igen paa etapen.
  const idx = statuses.indexOf("exhausted");
  assert.equal(statuses.slice(idx + 1).includes("started"), false);
});

test("hook: explicit chase is not capped by the preventive budget and books no preventive work", () => {
  const r = run({ stanceA: "chase", gcContext: GC, segments: 7, separation: 900 });
  assert.equal(reactionEvents(r.events).length, 0);
  assert.equal(r.state.team_reactions?.A, undefined);
  assert.ok(teamFactorLoss(r.state, "A") > TEAM_REACTION_TUNING.preventiveBudget, "explicit chase can work beyond the exception's budget");
});

test("hook: no or fatigued helpers means an honest 'no_workers' and no reaction", () => {
  const tired = run({
    stanceA: "neutral",
    gcContext: GC,
    mutate: (s) => ({
      ...s,
      riders: Object.fromEntries(Object.entries(s.riders).map(([id, r]) => [id, id.startsWith("A") && id !== "A0" ? { ...r, team_cp_factor: TEAM_PLAY_EXTRA_TUNING.minCpFactor } : r])),
    }),
  });
  const events = reactionEvents(tired.events);
  assert.deepEqual(events.map((e) => [e.params.status, e.params.reason]), [["unavailable", "no_workers"]]);
  assert.notEqual(tired.state.team_reactions?.A?.status, "reacting");
});

test("hook: a protected rider in another group cannot be protected by helpers in the chasing group", () => {
  const r = run({
    stanceA: "neutral",
    gcContext: GC,
    mutate: (s) => ({
      ...s,
      groups: [
        ...s.groups.map((g) => (g.id === "peloton-0" ? { ...g, rider_ids: g.rider_ids.filter((id) => id !== "A0") } : g)),
        { id: "chase-9", kind: "chase" as const, rider_ids: ["A0"], gap_seconds: 600, cohesion: 1 },
      ],
    }),
  });
  assert.equal(reactionEvents(r.events).length, 0);
  assert.equal(teamFactorLoss(r.state, "A"), 0);
});

test("hook: the reaction stops honestly when the threat is caught", () => {
  const r = run({ stanceA: "neutral", gcContext: GC, segments: 2, separation: 900 });
  assert.equal(r.state.team_reactions?.A?.status, "reacting");
  const workBefore = r.state.team_reactions?.A?.neutral_work ?? 0;
  // segmentLoop's merge efter indhentningen: udbruddet er opslugt af feltet.
  const merged: EngineState = {
    ...r.state,
    groups: [{ id: "peloton-0", kind: "peloton", rider_ids: r.state.groups.flatMap((g) => g.rider_ids).sort(), gap_seconds: 0, cohesion: 1 }],
  };
  const orders = TEAMS.map((t) => teamOrder(t, "neutral"));
  const ctx: SegmentHookContext = {
    ...makeHookCtx({ segment: ROUTE.segments[6], segmentIndex: 6, route: ROUTE, entrants: r.entrants, tuning: RACE_V4_TUNING, orders }),
    rulesRevision: "orders_gc_v1",
    gcContext: GC,
  };
  const after = breakawayHook(merged, ctx);
  assert.deepEqual(reactionEvents(after.events).map((e) => [e.params.status, e.params.reason]), [["stopped", "contained"]]);
  assert.equal(after.state.team_reactions?.A?.status, "idle");
  assert.equal(after.state.team_reactions?.A?.neutral_work, workBefore, "stopping never resets the booked work");
});

test("hook: legacy never reads gc_context and books no reactions", () => {
  const withCtx = run({ stanceA: "neutral", gcContext: GC, revision: "legacy" });
  const without = run({ stanceA: "neutral", revision: "legacy" });
  assert.deepEqual(withCtx.state, without.state);
  assert.deepEqual(withCtx.events, without.events);
  assert.equal(withCtx.state.team_reactions, undefined);
});

test("human and AI orders use the same reaction: an AI order equals the same human order", () => {
  const { entrants } = scenario();
  const roster = [0, 1, 2, 3, 4].map((i) => ({ rider_id: `A${i}`, role: entrants[`A${i}`].role, abilities: entrants[`A${i}`].abilities }));
  const ai = generateAiTeamOrder({ team_id: "A", route: { profile_type: ROUTE.profile_type, finale_type: ROUTE.finale_type }, roster, race: { is_stage_race: true, later_stages: [] } });
  const aiEngineOrder = toEngineTeamOrder(ai.order);
  const human: TeamOrder = { team_id: "A", kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: ai.order.breakaway_stance, riders: [] } };
  const viaAi = run({ stanceA: ai.order.breakaway_stance, gcContext: GC, ordersA: aiEngineOrder });
  const viaHuman = run({ stanceA: ai.order.breakaway_stance, gcContext: GC, ordersA: human });
  assert.deepEqual(reactionEvents(viaAi.events), reactionEvents(viaHuman.events));
  assert.deepEqual(viaAi.state.team_reactions, viaHuman.state.team_reactions);
});

// ── Hele motoren ─────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureInput(name: string): StageInput {
  return JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
}

test("full engine: legacy ignores gc_context completely (byte-identical)", () => {
  const input = fixtureInput("flat-massespurt");
  const gc: GcContext = { status: "standings", stage_number: 4, leader_id: input.startlist[0].rider_id, standings: input.startlist.map((e, i) => ({ rider_id: e.rider_id, rank: i + 1, gap_seconds: i * 5 })) };
  assert.deepEqual(simulateStageV4({ ...input, gc_context: gc }), simulateStageV4(input));
});

test("full engine: orders_gc_v1 reports its GC context explicitly and stays deterministic", () => {
  const input = fixtureInput("flat-massespurt");
  for (const [gc, status] of [
    [undefined, "missing"],
    [{ status: "one_day" }, "one_day"],
    [{ status: "first_stage", stage_number: 1 }, "first_stage"],
    [{ status: "standings", stage_number: 3, leader_id: input.startlist[0].rider_id, standings: input.startlist.map((e, i) => ({ rider_id: e.rider_id, rank: i + 1, gap_seconds: i * 5 })) }, "standings"],
  ] as Array<[GcContext | undefined, string]>) {
    const run1 = simulateStageV4({ ...input, rules_revision: "orders_gc_v1", ...(gc ? { gc_context: gc } : {}) });
    const run2 = simulateStageV4({ ...input, rules_revision: "orders_gc_v1", ...(gc ? { gc_context: gc } : {}) });
    assert.deepEqual(run1, run2);
    const ctxEvents = run1.timeline.events.filter((e) => e.type === "gc_context");
    assert.equal(ctxEvents.length, 1);
    assert.equal(ctxEvents[0].params.status, status);
    assert.equal(run1.results.length, input.startlist.length);
  }
});

// ── #5955 (ejer-valg B 1/10): GC-bremsen i lad-gaa-fasen ─────────────────────

test("brake: only a serious threat brakes (reacting team or explicit chase), only in its own chase group", () => {
  const decisions = [
    { teamId: "A", threat: SERIOUS, stance: "neutral" as const, plan: { intensity: 1 } },
    { teamId: "B", threat: MODERATE, stance: "chase" as const, plan: { intensity: 0 } },
    { teamId: "C", threat: NONE, stance: "chase" as const, plan: { intensity: 0 } },
    { teamId: "D", threat: SERIOUS, stance: "let_go" as const, plan: { intensity: 0 } },
    { teamId: "E", threat: { ...SERIOUS, chase_group_id: "chase-9" }, stance: "chase" as const, plan: { intensity: 0 } },
    { teamId: "F", threat: SERIOUS, stance: "chase" as const, plan: { intensity: 0 } },
    { teamId: "G", threat: MODERATE, stance: "neutral" as const, plan: { intensity: 0.5 } },
  ];
  assert.deepEqual([...letGoBrakingTeams(decisions, "peloton-0").keys()].sort(), ["A", "F"]);
  assert.deepEqual([...letGoBrakingTeams(decisions, "chase-9").keys()], ["E"]);
});

test("brake: bounded below the full let-go, weaker when tired, only braking teams pay", () => {
  const entrants: Record<string, Entrant> = {
    a1: entrant("a1", "A", "helper"), a2: entrant("a2", "A", "helper"), a3: entrant("a3", "A", "helper"),
    a4: entrant("a4", "A", "helper"), a5: entrant("a5", "A", "helper"), b1: entrant("b1", "B", "helper"),
  };
  const fresh: Record<string, RiderState> = Object.fromEntries(Object.keys(entrants).map((id) => [id, riderState(id)]));
  const chaserWork = new Map(Object.keys(entrants).map((id) => [id, 1]));
  const none = letGoBrake({ chaserWork, braking: new Map(), entrants, riders: fresh });
  assert.equal(none.fraction, 0);
  assert.equal(none.work.size, 0);
  const full = letGoBrake({ chaserWork, braking: new Map([["A", 0]]), entrants, riders: fresh });
  assert.ok(full.fraction > 0 && full.fraction <= LET_GO_BRAKE_TUNING.maxBrake + 1e-12);
  assert.ok(LET_GO_BRAKE_TUNING.maxBrake < 1, "the field never stops the let-go completely");
  assert.deepEqual([...full.work.keys()].sort(), ["a1", "a2", "a3", "a4", "a5"], "team B is not braking and pays nothing");
  const tired = Object.fromEntries(Object.entries(fresh).map(([id, r]) => [id, { ...r, team_cp_factor: 0.3 }]));
  const weak = letGoBrake({ chaserWork: new Map([["a1", 1]]), braking: new Map([["A", 0]]), entrants, riders: tired });
  const strong = letGoBrake({ chaserWork: new Map([["a1", 1]]), braking: new Map([["A", 0]]), entrants, riders: fresh });
  assert.ok(weak.fraction < strong.fraction);
  // Flere bremsende hold: det mindste tolererede forspring gaelder.
  const two = letGoBrake({ chaserWork, braking: new Map([["A", 90], ["B", 40]]), entrants, riders: fresh });
  assert.equal(two.toleratedSeconds, 40);
});

test("brakedLetGoGrowth: free up to the tolerated lead, dampened above it, only braked km are paid", () => {
  const free = brakedLetGoGrowth({ separationSeconds: 30, growthSeconds: 60, fraction: 0.5, toleratedSeconds: 200 });
  assert.deepEqual(free, { growthSeconds: 60, brakedShare: 0 }, "well below the tolerated lead nobody brakes");
  const above = brakedLetGoGrowth({ separationSeconds: 100, growthSeconds: 60, fraction: 0.5, toleratedSeconds: 50 });
  assert.equal(above.growthSeconds, 30);
  assert.equal(above.brakedShare, 1);
  const across = brakedLetGoGrowth({ separationSeconds: 30, growthSeconds: 60, fraction: 0.5, toleratedSeconds: 60 });
  assert.equal(across.growthSeconds, 30 + 30 * 0.5);
  assert.equal(across.brakedShare, 0.5);
  assert.deepEqual(brakedLetGoGrowth({ separationSeconds: 30, growthSeconds: 60, fraction: 0, toleratedSeconds: 0 }), { growthSeconds: 60, brakedShare: 0 });
  // Ved lad-gaa-loftet vokser hullet alligevel ikke: intet bremses, intet betales.
  assert.equal(brakedLetGoGrowth({ separationSeconds: 300, growthSeconds: 60, fraction: 0.5, toleratedSeconds: 0, ceilingSeconds: 300 }).brakedShare, 0);
  const nearCeiling = brakedLetGoGrowth({ separationSeconds: 280, growthSeconds: 60, fraction: 0.5, toleratedSeconds: 0, ceilingSeconds: 300 });
  assert.equal(nearCeiling.growthSeconds, 10);
  assert.ok(Math.abs(nearCeiling.brakedShare - 20 / 60) < 1e-12, "only the km that could still grow are paid");
});

const BRAKE_TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const BRAKE_ROUTE: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: Array.from({ length: 30 }, (_, i) => ({ kind: "flat" as const, from_km: i * 5, to_km: (i + 1) * 5 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};
const BRAKE_GC: GcContext = {
  status: "standings", stage_number: 6, leader_id: "A0",
  standings: [
    ...BRAKE_TEAMS.map((t, i) => [`${t}0`, i * 20] as [string, number]),
    ...BRAKE_TEAMS.flatMap((t) => [1, 2, 3, 4].map((i) => [`${t}${i}`, 3600 + i] as [string, number])),
  ].map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds })),
};

/** Dagens udbrud lige dannet (lad-gaa-fasen), feltet stort nok til at lade det gaa. */
function runLetGo(opts: {
  stanceA: "chase" | "neutral" | "let_go";
  breakawayIds: string[];
  gcContext?: GcContext;
  revision?: "legacy" | "orders_gc_v1";
}) {
  const entrants: Record<string, Entrant> = {};
  for (const team of BRAKE_TEAMS) {
    for (let i = 0; i < 5; i++) entrants[`${team}${i}`] = entrant(`${team}${i}`, team, i === 0 ? "captain" : "helper", i === 0 ? 70 : 50);
  }
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(entrants)) riders[id] = riderState(id, opts.breakawayIds.includes(id) ? "breakaway-0" : "peloton-0");
  let state: EngineState = {
    km: 5,
    groups: [
      { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: [...opts.breakawayIds].sort(), gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(entrants).filter((id) => !opts.breakawayIds.includes(id)).sort(), gap_seconds: 25, cohesion: 1 },
    ],
    riders, virtual_gc: {},
  };
  const orders = [teamOrder("A", opts.stanceA), ...BRAKE_TEAMS.slice(1).map((t) => teamOrder(t, "neutral"))];
  const events: TimelineEvent[] = [];
  for (let i = 1; i <= 3; i++) {
    const base = makeHookCtx({ segment: BRAKE_ROUTE.segments[i], segmentIndex: i, route: BRAKE_ROUTE, entrants, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = { ...base, rulesRevision: opts.revision ?? "orders_gc_v1", ...(opts.gcContext ? { gcContext: opts.gcContext } : {}) };
    const r = breakawayHook(state, ctx);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

test("hook: a threatened GC team brakes the let-go phase, holds the gap down and pays for it", () => {
  const braked = runLetGo({ stanceA: "neutral", breakawayIds: ["B0", "C3"], gcContext: BRAKE_GC });
  const free = runLetGo({ stanceA: "neutral", breakawayIds: ["B0", "C3"], gcContext: { status: "missing" } });
  assert.ok(separation(free.state) > 25, "without a reaction the let-go phase grows the gap");
  assert.ok(separation(braked.state) < separation(free.state), "the brake holds the gap down");
  assert.ok(separation(braked.state) > 25, "the brake dampens growth, it never closes during the let-go phase");
  assert.ok(teamFactorLoss(braked.state, "A") > 0, "braking is work, paid by the reacting helpers");
  assert.equal(teamFactorLoss(free.state, "A"), 0);
});

test("hook: explicit chase brakes only at a real GC threat", () => {
  const threatened = runLetGo({ stanceA: "chase", breakawayIds: ["B0", "C3"], gcContext: BRAKE_GC });
  const harmless = runLetGo({ stanceA: "chase", breakawayIds: ["C3", "D2"], gcContext: BRAKE_GC });
  const harmlessNoCtx = runLetGo({ stanceA: "chase", breakawayIds: ["C3", "D2"], gcContext: { status: "missing" } });
  assert.ok(separation(threatened.state) < separation(harmless.state));
  assert.equal(separation(harmless.state), separation(harmlessNoCtx.state), "no threat: the let-go phase is untouched");
  assert.equal(teamFactorLoss(harmless.state, "A"), 0, "no threat: no brake work in the let-go phase");
});

test("hook: the preventive let-go brake stays inside the per-team stage budget", () => {
  const r = runLetGo({ stanceA: "let_go", breakawayIds: ["B0", "C3"], gcContext: BRAKE_GC });
  const spent = r.state.team_reactions?.A?.preventive_work ?? 0;
  assert.ok(spent > 0, "the preventive exception brakes");
  assert.ok(spent <= TEAM_REACTION_TUNING.preventiveBudget + 1e-9);
  assert.ok(Math.abs(teamFactorLoss(r.state, "A") - spent) < 1e-9, "brake work is booked once, as paid");
});

test("hook: legacy never brakes the let-go phase (byte-identical with or without GC context)", () => {
  const withCtx = runLetGo({ stanceA: "chase", breakawayIds: ["B0", "C3"], gcContext: BRAKE_GC, revision: "legacy" });
  const without = runLetGo({ stanceA: "chase", breakawayIds: ["B0", "C3"], revision: "legacy" });
  assert.deepEqual(withCtx.state, without.state);
  assert.deepEqual(withCtx.events, without.events);
  assert.equal(teamFactorLoss(withCtx.state, "A"), 0, "legacy: nobody works in the let-go phase");
});
