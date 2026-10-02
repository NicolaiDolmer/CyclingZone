// backend/lib/engine/v4/mechanics/rollingBreakaway.test.ts
// #6073: under orders_gc_v2 paa rullende profil faar dagens udbrud et mindre
// ekstra lad-gaa-loft end under orders_gc_v1. Legacy og orders_gc_v1 er
// uaendrede, og ingen anden profil roeres. Syntetiske ryttere; testene laaser
// strukturen, ikke kalibrerede tal (de ligger privat i balance-internals/6073/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { breakawayHook, letGoBalanceFor, letGoMaxGapSeconds, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import { ROLLING_BREAKAWAY_V2_TUNING, rollingBreakawayV2For, rollingLetGoBalance } from "./rollingBreakaway.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { runSegmentLoop } from "../segmentLoop.ts";
import { LIVE_MECHANIC_HOOKS } from "../index.ts";
import type {
  AbilityKey, Entrant, EngineState, MechanicHooks, ProfileType, RiderState, RouteV2, SegmentHookContext, StageInput, TeamOrder,
} from "../types.ts";

// ── flaget ─────────────────────────────────────────────────────────────────

test("#6073: the rolling balance applies only under orders_gc_v2 on a rolling profile", () => {
  assert.equal(rollingBreakawayV2For("orders_gc_v2", "rolling"), true);
  for (const rev of ["legacy", "orders_gc_v1"] as const) assert.equal(rollingBreakawayV2For(rev, "rolling"), false, rev);
  for (const prof of ["flat", "hilly", "mountain", "high_mountain", "cobbles", "gravel", "classic", "itt"] as ProfileType[]) {
    assert.equal(rollingBreakawayV2For("orders_gc_v2", prof), false, prof);
  }
});

// ── faktorerne ─────────────────────────────────────────────────────────────

test("#6073: without the flag the balance is returned untouched (same object)", () => {
  const balance = letGoBalanceFor("orders_gc_v1", "rolling");
  assert.strictEqual(rollingLetGoBalance(undefined, balance, balance.maxGapFactor), balance);
  assert.strictEqual(rollingLetGoBalance(false, balance, balance.maxGapFactor), balance);
});

test("#6073: the full orders_gc_v1 ceiling maps to the v2 ceiling; growth rate is unchanged", () => {
  const v1 = letGoBalanceFor("orders_gc_v1", "rolling");
  const v2 = rollingLetGoBalance(true, v1, v1.maxGapFactor);
  assert.ok(Math.abs(v2.maxGapFactor - ROLLING_BREAKAWAY_V2_TUNING.maxGapFactor) < 1e-9);
  assert.ok(v2.maxGapFactor < v1.maxGapFactor, "less extra room than orders_gc_v1");
  assert.ok(v2.maxGapFactor > 1, "still more room than legacy");
  assert.equal(v2.rateFactor, v1.rateFactor);
});

test("#6073: the #6074 crowd damping is kept proportionally and never drops below legacy", () => {
  const raw = letGoBalanceFor("orders_gc_v1", "rolling").maxGapFactor;
  let previous = Infinity;
  for (const share of [0, 0.8, 0.9, 1]) {
    const v1 = letGoBalanceFor("orders_gc_v1", "rolling", share);
    const v2 = rollingLetGoBalance(true, v1, raw);
    assert.ok(v2.maxGapFactor >= 1, `share ${share}: never below legacy`);
    assert.ok(v2.maxGapFactor <= v1.maxGapFactor, `share ${share}: never above orders_gc_v1`);
    assert.ok(v2.maxGapFactor <= previous + 1e-12, `share ${share}: monotone in the let-go share`);
    previous = v2.maxGapFactor;
  }
});

test("#6073: legacy factors (1/1) pass through unchanged", () => {
  const legacy = letGoBalanceFor("legacy", "rolling");
  const out = rollingLetGoBalance(true, legacy, letGoBalanceFor("orders_gc_v1", "rolling").maxGapFactor);
  assert.deepEqual(out, { maxGapFactor: 1, rateFactor: 1 });
  assert.strictEqual(rollingLetGoBalance(true, legacy, 1), legacy, "no v1 extra, nothing to rescale");
});

// ── M5-ankeret: et harmloest udbrud paa rullende terraen ────────────────────

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const ROUTE: RouteV2 = {
  distance_km: 200, profile_type: "rolling", finale_type: "reduced_sprint",
  segments: Array.from({ length: 40 }, (_, i) => ({ kind: "rolling" as const, from_km: i * 5, to_km: (i + 1) * 5 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

function riderState(id: string, group: string): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}
const order = (team: string): TeamOrder => ({ team_id: team, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [] } });

/** Dagens udbrud lige dannet; holdene er neutrale. Stoerste separation undervejs. */
function maxSeparation(revision: "legacy" | "orders_gc_v1", rollingBreakawayV2: boolean) {
  const breakawayIds = ["C3", "D2"];
  const entrants: Record<string, Entrant> = {};
  for (const team of TEAMS) {
    for (let i = 0; i < 5; i++) {
      const id = `${team}${i}`;
      entrants[id] = { rider_id: id, abilities: abilities(i === 0 ? 70 : 50), role: i === 0 ? "captain" : "helper", effort: "normal", condition: 1, team_id: team };
    }
  }
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(entrants)) riders[id] = riderState(id, breakawayIds.includes(id) ? "breakaway-0" : "peloton-0");
  let state: EngineState = {
    km: 5,
    groups: [
      { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: [...breakawayIds].sort(), gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(entrants).filter((id) => !breakawayIds.includes(id)).sort(), gap_seconds: 25, cohesion: 1 },
    ],
    riders, virtual_gc: {},
  };
  const orders = TEAMS.map(order);
  let max = 0;
  for (let i = 1; i < ROUTE.segments.length - 1; i++) {
    const base = makeHookCtx({ segment: ROUTE.segments[i], segmentIndex: i, route: ROUTE, entrants, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = { ...base, rulesRevision: revision, ...(rollingBreakawayV2 ? { rollingBreakawayV2: true as const } : {}) };
    state = breakawayHook(state, ctx).state;
    const b = state.groups.find((g) => g.id === "breakaway-0");
    const p = state.groups.find((g) => g.id === "peloton-0");
    if (b && p) max = Math.max(max, p.gap_seconds - b.gap_seconds);
  }
  const fieldIds = Object.keys(entrants);
  const baseCeiling = letGoMaxGapSeconds({ breakawayRiderIds: breakawayIds, fieldRiderIds: fieldIds, entrants, profileType: "rolling", finaleType: "reduced_sprint" });
  return { max, baseCeiling };
}

test("#6073 anchor: a harmless rolling break is held under the v2 ceiling, below what orders_gc_v1 gives it", () => {
  const v1 = maxSeparation("orders_gc_v1", false);
  const v2 = maxSeparation("orders_gc_v1", true);
  const v2Ceiling = v2.baseCeiling * ROLLING_BREAKAWAY_V2_TUNING.maxGapFactor;
  assert.ok(v2.max < v1.max, `the v2 break is held shorter (${v2.max} < ${v1.max})`);
  assert.ok(v2.max <= v2Ceiling + 1e-6, `the v2 gap stays under its ceiling (${v2.max} <= ${v2Ceiling})`);
  assert.ok(v1.max > v2Ceiling, "orders_gc_v1 gives the break more than the v2 ceiling");
  assert.ok(v2.max > v2.baseCeiling, "v2 still gives more room than legacy");
});

test("#6073 anchor: legacy ignores the flag", () => {
  assert.deepEqual(maxSeparation("legacy", true), maxSeparation("legacy", false));
});

// ── laasen: segmentLoop saetter kun flaget under orders_gc_v2 paa rullende ───

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureInput(name: string): StageInput {
  return JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
}
function flagsSeen(input: StageInput): Array<{ flag: unknown; rev: unknown }> {
  const seen: Array<{ flag: unknown; rev: unknown }> = [];
  const spy: MechanicHooks = {
    ...LIVE_MECHANIC_HOOKS,
    breakaway: (s, c) => {
      seen.push({ flag: c.rollingBreakawayV2, rev: c.rulesRevision });
      return LIVE_MECHANIC_HOOKS.breakaway(s, c);
    },
  };
  runSegmentLoop(input, spy);
  return seen;
}

test("#6073 lock: only orders_gc_v2 on a rolling profile sets the flag; the hooks still see orders_gc_v1", () => {
  const flat = fixtureInput("flat-massespurt");
  const rolling: StageInput = { ...flat, route: { ...flat.route, profile_type: "rolling" } };
  for (const rules_revision of [undefined, "legacy", "orders_gc_v1"] as const) {
    const seen = flagsSeen({ ...rolling, ...(rules_revision ? { rules_revision } : {}) });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((x) => x.flag === undefined), `${rules_revision}: no flag`);
  }
  const v2Flat = flagsSeen({ ...flat, rules_revision: "orders_gc_v2" });
  assert.ok(v2Flat.every((x) => x.flag === undefined), "orders_gc_v2 on flat: no flag");
  const v2 = flagsSeen({ ...rolling, rules_revision: "orders_gc_v2" });
  assert.ok(v2.length > 0 && v2.every((x) => x.flag === true && x.rev === "orders_gc_v1"));
});
