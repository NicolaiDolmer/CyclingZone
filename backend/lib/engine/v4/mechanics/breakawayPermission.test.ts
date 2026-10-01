// backend/lib/engine/v4/mechanics/breakawayPermission.test.ts
// #5955 (#5984 Task 3): ejer-matricen for morgenudbrud + den omstridte dannelse
// under orders_gc_v1. Syntetiske ryttere; ingen rigtige rytterdata og ingen
// kalibrerings-maal — testene laaser strukturelle invarianter, ikke tal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canAttemptMorningBreak,
  effectiveTryBreakByRider,
  morningBreakIntent,
  resolveMorningBreakFormation,
  type FormationRider,
  type FormationRoll,
  type FormationStance,
} from "./breakawayPermission.ts";
import { breakawayHook, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import { buildGroupTeamContexts } from "./teamPlay.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { MORNING_BREAK_FORMATION_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import { normalizeRulesRevision } from "../segmentLoop.ts";
import type { AbilityKey, Entrant, EngineState, RiderRole, RiderState, RouteV2, StageInput, TeamOrder } from "../types.ts";

// ── 1. Ejer-matricen ─────────────────────────────────────────────────────────

const ROLES: RiderRole[] = ["captain", "sprint_captain", "helper", "hunter", "free_role"];
const EFFORTS = ["normal", "save", "grupetto"] as const;
const ORDERS = [true, false, undefined] as const;

function expected(role: RiderRole, effort: string, tryBreak: boolean | undefined): boolean {
  if (effort === "grupetto") return false;
  switch (role) {
    case "captain":
    case "sprint_captain":
    case "helper":
      return tryBreak === true;
    case "hunter":
      return tryBreak !== false;
    case "free_role":
      return tryBreak === true || effort === "normal";
  }
}

test("permission matrix: every role x effort x effective order", () => {
  for (const role of ROLES) {
    for (const effort of EFFORTS) {
      for (const tryBreak of ORDERS) {
        assert.equal(
          canAttemptMorningBreak({ role, effort, tryBreak }),
          expected(role, effort, tryBreak),
          `${role}/${effort}/try_break=${String(tryBreak)}`,
        );
      }
    }
  }
});

test("a break order is an ordered attempt; free role without order is only spontaneous", () => {
  assert.equal(morningBreakIntent({ role: "free_role", effort: "normal", tryBreak: undefined }), "spontaneous");
  assert.equal(morningBreakIntent({ role: "free_role", effort: "normal", tryBreak: true }), "ordered");
  assert.equal(morningBreakIntent({ role: "free_role", effort: "save", tryBreak: true }), "ordered");
  assert.equal(morningBreakIntent({ role: "hunter", effort: "save", tryBreak: undefined }), "ordered");
  assert.equal(morningBreakIntent({ role: "captain", effort: "protect", tryBreak: undefined }), "none");
  assert.equal(morningBreakIntent({ role: "free_role", effort: "protect", tryBreak: undefined }), "none");
});

test("effective order keeps absent and explicit false apart", () => {
  const orders: TeamOrder[] = [
    { team_id: "A", kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [
      { rider_id: "h1", try_break: false },
      { rider_id: "h2", try_break: true },
      { rider_id: "h3" },
    ] } },
    { team_id: "A", kind: "leadout", params: { captain_rider_id: "x", leadout_rider_ids: [] } },
  ];
  const map = effectiveTryBreakByRider(orders);
  assert.equal(map.get("h1"), false);
  assert.equal(map.get("h2"), true);
  assert.equal(map.has("h3"), false);
  assert.equal(canAttemptMorningBreak({ role: "hunter", effort: "normal", tryBreak: map.get("h1") }), false);
  assert.equal(canAttemptMorningBreak({ role: "hunter", effort: "normal", tryBreak: map.get("h3") }), true);
});

// ── 2-4. Den rene dannelse ────────────────────────────────────────────────────

function rider(id: string, team: string | null, over: Partial<FormationRider> = {}): FormationRider {
  return {
    rider_id: id, team_id: team, role: "helper", effort: "normal", tryBreak: undefined,
    strength: 0.5, spontaneousChance: 0.2, engine: 0.5, freshness: 1, ...over,
  };
}

const always = (value: number): FormationRoll => () => value;

function field(): FormationRider[] {
  // Hold A-D, hvert med kaptajn + to hjaelpere; hold A's og B's hunter forsoeger.
  const out: FormationRider[] = [];
  for (const team of ["A", "B", "C", "D"]) {
    out.push(rider(`${team}-cap`, team, { role: "captain" }));
    out.push(rider(`${team}-h1`, team));
    out.push(rider(`${team}-h2`, team));
  }
  out.push(rider("A-hunter", "A", { role: "hunter" }));
  out.push(rider("B-hunter", "B", { role: "hunter" }));
  return out;
}

test("all attempts can fail: zero escapees, nobody is filled in, every attempt is still paid once", () => {
  const result = resolveMorningBreakFormation({ riders: field(), stances: new Map(), roll: always(0.999), maxSize: 8 });
  assert.deepEqual(result.attempted, ["A-hunter", "B-hunter"]);
  assert.deepEqual(result.escaped, []);
  assert.deepEqual(result.failed, ["A-hunter", "B-hunter"]);
  assert.deepEqual([...result.attemptCost.keys()].sort(), ["A-hunter", "B-hunter"]);
  for (const paid of result.attemptCost.values()) assert.equal(paid, MORNING_BREAK_FORMATION_TUNING.attemptCostFraction);
});

test("no permission, no attempt: captains and helpers without an order stay in the field at no cost", () => {
  const riders = ["A", "B", "C"].flatMap((team) => [rider(`${team}-cap`, team, { role: "captain" }), rider(`${team}-h`, team)]);
  const result = resolveMorningBreakFormation({ riders, stances: new Map(), roll: always(0), maxSize: 8 });
  assert.deepEqual(result.attempted, []);
  assert.deepEqual(result.escaped, []);
  assert.equal(result.attemptCost.size, 0);
  assert.equal(result.reactionCost.size, 0);
});

test("save + break order attempts at the normal price; grupetto never attempts", () => {
  const riders = [
    rider("A-saver", "A", { role: "free_role", effort: "save", tryBreak: true }),
    rider("B-grupetto", "B", { role: "hunter", effort: "grupetto", tryBreak: true }),
    rider("C-x", "C"), rider("D-x", "D"),
  ];
  const result = resolveMorningBreakFormation({ riders, stances: new Map(), roll: always(0.999), maxSize: 8 });
  assert.deepEqual(result.attempted, ["A-saver"]);
  assert.equal(result.attemptCost.get("A-saver"), MORNING_BREAK_FORMATION_TUNING.attemptCostFraction);
});

test("rival teams react with their actual workers; represented teams and leaders do not work", () => {
  const stances = new Map<string, FormationStance>([["C", "chase"], ["D", "let_go"]]);
  const result = resolveMorningBreakFormation({ riders: field(), stances, roll: always(0.999), maxSize: 8 });
  // A og B er repraesenteret i forsoeget; C jager; D lader gaa.
  assert.deepEqual(result.reactingTeamIds, ["C"]);
  assert.deepEqual([...result.reactionCost.keys()].sort(), ["C-h1", "C-h2"]);
  for (const paid of result.reactionCost.values()) assert.ok(paid > 0);
});

function escapedCount(stances: Map<string, FormationStance>, roll: FormationRoll): number {
  return resolveMorningBreakFormation({ riders: field(), stances, roll, maxSize: 8 }).escaped.length;
}

test("a real chase makes the move harder than letting it go (same rolls)", () => {
  // Rul lige over let_go-sandsynligheden giver forskellen; et sweep viser at
  // jagt ALDRIG giver flere udbrydere end lad-gaa.
  for (let r = 0; r < 1; r += 0.05) {
    const letGo = escapedCount(new Map([["C", "let_go"], ["D", "let_go"]]), always(r));
    const chase = escapedCount(new Map([["C", "chase"], ["D", "chase"]]), always(r));
    assert.ok(chase <= letGo, `roll ${r.toFixed(2)}: chase ${chase} > let_go ${letGo}`);
  }
  const somewhere = [...Array(20).keys()].some((i) => {
    const r = i / 20;
    return escapedCount(new Map([["C", "chase"], ["D", "chase"]]), always(r)) < escapedCount(new Map([["C", "let_go"], ["D", "let_go"]]), always(r));
  });
  assert.ok(somewhere, "rival chase must change the outcome for some rolls");
});

test("no hidden weakening of strong riders: ability only helps the attempt", () => {
  for (let r = 0; r < 1; r += 0.02) {
    const riders = [
      rider("A-weak", "A", { role: "hunter", strength: 0.3 }),
      rider("B-strong", "B", { role: "hunter", strength: 0.9 }),
      rider("C-x", "C"), rider("D-x", "D"),
    ];
    const result = resolveMorningBreakFormation({ riders, stances: new Map([["C", "chase"]]), roll: always(r), maxSize: 8 });
    if (result.escaped.includes("A-weak")) assert.ok(result.escaped.includes("B-strong"), `roll ${r.toFixed(2)}`);
  }
});

test("an overcrowded move keeps at most maxSize successes and never adds non-attempters", () => {
  const riders: FormationRider[] = [];
  for (let i = 0; i < 12; i++) riders.push(rider(`hunter-${String(i).padStart(2, "0")}`, `T${i}`, { role: "hunter" }));
  for (let i = 0; i < 12; i++) riders.push(rider(`stay-${String(i).padStart(2, "0")}`, `T${i}`));
  const result = resolveMorningBreakFormation({ riders, stances: new Map(), roll: always(0), maxSize: 5 });
  assert.equal(result.escaped.length, 5);
  for (const id of result.escaped) assert.ok(result.attempted.includes(id));
  assert.equal(result.failed.length, 7);
});

test("#5955 a crowded morning where every team has an attacker still forms a real group, not a lone rider", () => {
  // Regression: a crowd penalty that scaled with the number of attackers made
  // every attempt fail on a busy morning, so the break collapsed to 0-1 riders.
  // Mid-range rolls on a full field of equal hunters must let several through.
  const riders: FormationRider[] = [];
  for (let i = 0; i < 22; i++) {
    const team = `T${String(i).padStart(2, "0")}`;
    riders.push(rider(`${team}-hunter`, team, { role: "hunter" }));
    for (let h = 0; h < 7; h++) riders.push(rider(`${team}-h${h}`, team));
  }
  const result = resolveMorningBreakFormation({ riders, stances: new Map(), roll: always(0.3), maxSize: 8 });
  assert.equal(result.attempted.length, 22);
  assert.ok(result.escaped.length >= 2, `escaped ${result.escaped.length}`);
  assert.ok(result.escaped.length <= 8);
});

test("a spontaneous free role attempts only when its own roll says so", () => {
  const riders = [rider("A-free", "A", { role: "free_role", spontaneousChance: 0.3 }), rider("B-x", "B"), rider("C-x", "C")];
  const yes = resolveMorningBreakFormation({ riders, stances: new Map(), roll: (s) => (s === "attempt" ? 0.1 : 0.999), maxSize: 8 });
  const no = resolveMorningBreakFormation({ riders, stances: new Map(), roll: (s) => (s === "attempt" ? 0.9 : 0.999), maxSize: 8 });
  assert.deepEqual(yes.attempted, ["A-free"]);
  assert.deepEqual(no.attempted, []);
});

// ── Hook-integration + legacy-bevis ──────────────────────────────────────────

function abilities(over: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...over };
}

function riderState(id: string): RiderState {
  return { rider_id: id, group_id: "peloton-0", cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}

const ROUTE: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 10 }, { kind: "flat", from_km: 10, to_km: 150 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

function hookSetup(roleFor: (team: string, i: number) => RiderRole) {
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const team of ["A", "B", "C", "D", "E", "F"]) {
    for (let i = 0; i < 4; i++) {
      const id = `${team}${i}`;
      entrants[id] = { rider_id: id, abilities: abilities(), role: roleFor(team, i), effort: "normal", condition: 1, team_id: team };
      riders[id] = riderState(id);
    }
  }
  const state: EngineState = {
    km: 0, groups: [{ id: "peloton-0", kind: "peloton", rider_ids: Object.keys(entrants).sort(), gap_seconds: 0, cohesion: 1 }],
    riders, virtual_gc: {},
  };
  return { entrants, state };
}

test("orders_gc_v1: a field of captains and helpers without orders forms no morning break", () => {
  const { entrants, state } = hookSetup((_, i) => (i === 0 ? "captain" : "helper"));
  const ctx = { ...makeHookCtx({ segment: ROUTE.segments[0], route: ROUTE, entrants, tuning: RACE_V4_TUNING }), rulesRevision: "orders_gc_v1" as const };
  const result = breakawayHook(state, ctx);
  assert.equal(result.events.filter((e) => e.type === "breakaway_formed").length, 0);
  assert.equal(result.events.filter((e) => e.type === "breakaway_attempt").length, 0);
  assert.equal(result.state.groups.length, 1);
  // Samme felt under legacy fylder et udbrud (den dokumenterede fejl).
  const legacy = breakawayHook(state, makeHookCtx({ segment: ROUTE.segments[0], route: ROUTE, entrants, tuning: RACE_V4_TUNING }));
  assert.equal(legacy.events.filter((e) => e.type === "breakaway_formed").length, 1);
});

test("orders_gc_v1: escapees are exactly the successful attempters, and attempters paid", () => {
  const { entrants, state } = hookSetup((_, i) => (i === 0 ? "captain" : i === 1 ? "hunter" : "helper"));
  for (let s = 0; s < 10; s++) {
    const ctx = { ...makeHookCtx({ segment: ROUTE.segments[0], route: ROUTE, entrants, tuning: RACE_V4_TUNING, seed: `5955-${s}` }), rulesRevision: "orders_gc_v1" as const };
    const result = breakawayHook(state, ctx);
    const attempt = result.events.find((e) => e.type === "breakaway_attempt");
    assert.ok(attempt, "the hunters attempt");
    const attempted = attempt.params.rider_ids as string[];
    assert.deepEqual(attempted, ["A1", "B1", "C1", "D1", "E1", "F1"]);
    const escaped = attempt.params.escaped_rider_ids as string[];
    const formed = result.events.find((e) => e.type === "breakaway_formed");
    assert.deepEqual(formed ? (formed.params.rider_ids as string[]) : [], escaped);
    for (const id of escaped) assert.ok(attempted.includes(id));
    for (const id of attempted) assert.ok((result.state.riders[id].team_cp_factor ?? 1) < 1, `${id} paid for the attempt`);
    // Ingen fog-gate-laek: ingen sandsynlighed/score i params.
    assert.deepEqual(Object.keys(attempt.params).sort(), ["escaped_rider_ids", "reacting_team_ids", "rider_ids"]);
  }
});

test("legacy: an absent revision and an explicit legacy revision are byte-identical", () => {
  const { entrants, state } = hookSetup((_, i) => (i === 0 ? "captain" : "helper"));
  const base = makeHookCtx({ segment: ROUTE.segments[0], route: ROUTE, entrants, tuning: RACE_V4_TUNING });
  assert.deepEqual(breakawayHook(state, { ...base, rulesRevision: "legacy" }), breakawayHook(state, base));
});

test("a helper away in an escape cannot support his captain in another group", () => {
  const entrants: Record<string, Entrant> = {
    cap: { rider_id: "cap", abilities: abilities(), role: "captain", effort: "normal", condition: 1, team_id: "A" },
    help: { rider_id: "help", abilities: abilities(), role: "helper", effort: "normal", condition: 1, team_id: "A" },
  };
  const riders = { cap: riderState("cap"), help: { ...riderState("help"), group_id: "breakaway-0" } };
  const peloton = buildGroupTeamContexts({ id: "peloton-0", kind: "peloton", rider_ids: ["cap"], gap_seconds: 0, cohesion: 1 }, entrants, riders, "flat");
  const escape = buildGroupTeamContexts({ id: "breakaway-0", kind: "breakaway", rider_ids: ["help"], gap_seconds: 0, cohesion: 1 }, entrants, riders, "flat");
  // Kaptajnen staar alene i feltet: ingen arbejdere der kan beskytte ham.
  assert.deepEqual(peloton.map((c) => [c.leaderId, c.workerIds]), [["cap", []]]);
  // Hjaelperen i udbruddet har ingen leder at arbejde for dér.
  assert.equal(escape.every((c) => c.leaderId === null), true);
});

// ── Hele motoren: golden-fixture-input ───────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureInput(name: string): StageInput {
  return JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
}

test("full engine: legacy revision is byte-identical to the frozen golden input without a revision", () => {
  const input = fixtureInput("flat-massespurt");
  assert.deepEqual(simulateStageV4({ ...input, rules_revision: "legacy" }), simulateStageV4(input));
});

test("full engine: orders_gc_v1 runs deterministically and keeps every rider accounted for", () => {
  const input = fixtureInput("flat-massespurt");
  const a = simulateStageV4({ ...input, rules_revision: "orders_gc_v1" });
  const b = simulateStageV4({ ...input, rules_revision: "orders_gc_v1" });
  assert.deepEqual(a, b);
  assert.equal(a.results.length, input.startlist.length);
});

test("an unknown rules revision is an error, never silently legacy or newest", () => {
  assert.equal(normalizeRulesRevision(undefined), "legacy");
  assert.equal(normalizeRulesRevision(null), "legacy");
  assert.equal(normalizeRulesRevision("orders_gc_v1"), "orders_gc_v1");
  assert.throws(() => normalizeRulesRevision("orders_gc_v2"));
  const input = fixtureInput("flat-massespurt");
  assert.throws(() => simulateStageV4({ ...input, rules_revision: "next" as unknown as "legacy" }));
});
