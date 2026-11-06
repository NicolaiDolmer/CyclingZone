// #7730: jagten afgoeres af de hold der jager. Syntetiske scenarier, ingen kalibrerede balancevaerdier.
import test from "node:test";
import assert from "node:assert/strict";
import { breakawayHook } from "./breakaway.ts";
import { TEAM_CHASE_7730_TUNING, judgeFloorChase7730, teamChase7730On } from "./chaseGroup.ts";
import { TEAM_REACTION_TUNING } from "./teamChaseReaction.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { BREAKAWAY_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { s5V3RealisticLeadCeilingSeconds } from "./breakawayV3_6804.ts";
import type { EngineState, Entrant, RaceGroup, RiderState, RouteV2, TimelineEvent } from "../types.ts";

const LATE = 100;
const ON_TIME = 10;
const t = TEAM_CHASE_7730_TUNING;

/** `team:rider` -> hold; alle ryttere er lige staerke som udbruddet med mindre andet er sat. */
function judge(work: Record<string, number>, opts: { factor?: Record<string, number>; engine?: Record<string, number>; wanted?: boolean } = {}) {
  const riders = Object.fromEntries(Object.keys(work).map((id) => [id, { status: "racing", team_cp_factor: opts.factor?.[id] ?? 1 }]));
  return judgeFloorChase7730({
    work: new Map(Object.entries(work)),
    teamOf: (id) => id.split(":")[0],
    engineOf: (id) => opts.engine?.[id] ?? 50,
    riders,
    breakEngine: 50,
    onTimeSeconds: ON_TIME,
    lateSeconds: LATE,
    wanted: opts.wanted ?? true,
  });
}

/** Nok hold med nok ryttere til at jagten er i tide. */
function strongChase(): Record<string, number> {
  const work: Record<string, number> = {};
  const teams = Math.ceil(t.onTimePull / t.teamPullCap) + 1;
  for (let team = 0; team < teams; team++) for (let r = 0; r < Math.ceil(t.teamPullCap); r++) work[`T${team}:${r}`] = 1;
  return work;
}

test("#7730 dommen: nok friske hold er i tide, og maalet er til-tiden", () => {
  const v = judge(strongChase());
  assert.equal(v.targetSeconds, ON_TIME);
  assert.equal(v.short, false);
  assert.equal(v.reason, null);
});

test("#7730 dommen: holdene ville jage, men ingen ryttere arbejder = for sent, og aarsagen er ingen jagere", () => {
  const v = judge({});
  assert.equal(v.targetSeconds, LATE);
  assert.deepEqual([v.short, v.reason, v.teamIds], [true, "no_chasers", []]);
  assert.equal(judge({ "A:1": 0 }).reason, "no_chasers", "en rytter uden indsats arbejder ikke");
});

test("#7730 dommen: ingen arbejder og intet hold ville jage = ikke det samme som ingen ryttere", () => {
  const v = judge({}, { wanted: false });
  assert.equal(v.targetSeconds, LATE);
  assert.deepEqual([v.short, v.reason, v.teamIds], [true, "nobody_wanted", []]);
  assert.equal(judge(strongChase(), { wanted: false }).short, false, "viljen flytter aldrig maalet, naar nogen arbejder");
});

test("#7730 dommen: maalet ligger altid mellem til-tiden og for-sent", () => {
  for (const riders of [1, 2, 3, 4, 6, 10]) {
    const work = Object.fromEntries(Array.from({ length: riders }, (_, i) => [`T${i}:0`, 0.5]));
    const v = judge(work);
    assert.ok(v.targetSeconds >= ON_TIME && v.targetSeconds <= LATE, `${riders} ryttere`);
  }
});

test("#7730 dommen: flere hold slaar ét hold med mange ryttere", () => {
  const oneTeam = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`A:${i}`, 1]));
  const twoTeams = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${i % 2 ? "A" : "B"}:${i}`, 1]));
  assert.ok(judge(twoTeams).targetSeconds < judge(oneTeam).targetSeconds);
});

test("#7730 dommen: traette ryttere henter senere, og traethed er aarsagen", () => {
  const work = strongChase();
  const tired = Object.fromEntries(Object.keys(work).map((id) => [id, TEAM_REACTION_TUNING.minWorkerFreshness - 0.001]));
  const v = judge(work, { factor: tired });
  assert.equal(v.targetSeconds, LATE, "for traette ryttere traekker ikke");
  assert.deepEqual([v.short, v.reason], [true, "tired"]);
  const worn = Object.fromEntries(Object.keys(work).map((id) => [id, TEAM_REACTION_TUNING.minWorkerFreshness + 0.001]));
  assert.ok(judge(work, { factor: worn }).targetSeconds >= judge(work).targetSeconds);
});

test("#7730 dommen: svagere ben end udbruddet henter senere, og det er aarsagen", () => {
  const work = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`T${i}:0`, 1]));
  const even = judge(work);
  const weak = judge(work, { engine: Object.fromEntries(Object.keys(work).map((id) => [id, 25])) });
  assert.ok(weak.targetSeconds > even.targetSeconds);
  assert.equal(weak.reason, "outgunned");
});

test("#7730 dommen: for faa ryttere er aarsagen, naar hverken friske ben eller staerkere ben havde redet den", () => {
  const v = judge({ "A:1": 0.5 });
  assert.deepEqual([v.short, v.reason, v.teamIds], [true, "too_few", ["A"]]);
});

test("#7730 dommen: ét helt udkoert hold er traethed, ikke for faa ryttere", () => {
  const work = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`A:${i}`, 1]));
  const spent = Object.fromEntries(Object.keys(work).map((id) => [id, TEAM_REACTION_TUNING.minWorkerFreshness - 0.001]));
  const v = judge(work, { factor: spent });
  assert.equal(v.targetSeconds, LATE);
  assert.deepEqual([v.short, v.reason, v.teamIds], [true, "tired", ["A"]]);
  assert.equal(judge(work).reason, "too_few", "samme hold friskt mangler kun flere hold");
});

test("#7730 dommen: aarsagen flytter aldrig maalet", () => {
  const work = { "A:1": 1, "A:2": 1 };
  const spent = { "A:1": TEAM_REACTION_TUNING.minWorkerFreshness - 0.001, "A:2": 1 };
  const v = judge(work, { factor: spent });
  assert.equal(v.targetSeconds, judge({ "A:2": 1 }).targetSeconds, "den udkoerte rytter taeller ikke, uanset hvad aarsagen hedder");
});

test("#7730 dommen: en rytter der ikke koerer mere, taeller ikke", () => {
  const riders = { "A:1": { status: "dnf" }, "A:2": { status: "racing" } };
  const v = judgeFloorChase7730({ work: new Map([["A:1", 1], ["A:2", 1]]), teamOf: (id) => id.split(":")[0], engineOf: () => 50, riders, breakEngine: 50, onTimeSeconds: ON_TIME, lateSeconds: LATE, wanted: true });
  const alone = judge({ "A:2": 1 });
  assert.equal(v.targetSeconds, alone.targetSeconds);
});

test("#7730 dommen: raekkefoelgen i arbejdslisten flytter intet", () => {
  const entries = Object.entries(strongChase());
  const args = { wanted: true, teamOf: (id: string) => id.split(":")[0], engineOf: () => 50, riders: Object.fromEntries(entries.map(([id]) => [id, { status: "racing", team_cp_factor: 0.97 }])), breakEngine: 50, onTimeSeconds: ON_TIME, lateSeconds: LATE };
  assert.deepEqual(judgeFloorChase7730({ ...args, work: new Map(entries) }), judgeFloorChase7730({ ...args, work: new Map([...entries].reverse()) }));
});

test("#7730 kontakten: kun eksplicit og kun fra s5_profiles_v3", () => {
  assert.equal(teamChase7730On({ rules_revision: "s5_profiles_v3", team_chase_7730: true }), true);
  assert.equal(teamChase7730On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(teamChase7730On({ rules_revision: "s5_profiles_v3", team_chase_7730: null }), false);
  for (const rules_revision of ["legacy", "orders_gc_v3", "s5_profiles_v2"] as const) assert.equal(teamChase7730On({ rules_revision, team_chase_7730: true }), false, rules_revision);
});

// ── Gennem jagten: det sidste segment af en flad etape ─────────

function fixture({ factor = 1, stage = "seed-a" }: { factor?: number; stage?: string } = {}) {
  const ceiling = s5V3RealisticLeadCeilingSeconds("flat", true);
  const groups: RaceGroup[] = [
    { id: "escape", kind: "breakaway", origin: "breakaway", rider_ids: ["e1", "e2"], gap_seconds: 0, cohesion: 1 },
    { id: "field", kind: "peloton", rider_ids: ["spr", "h1", "h2", "h3", "h4", "s2", "g1", "g2", "g3", "g4", "other"], gap_seconds: ceiling, cohesion: 1 },
  ];
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const g of groups) for (const id of g.rider_ids) {
    const isBreak = g.id === "escape";
    const team = id === "spr" || id.startsWith("h") ? "team-a" : id === "s2" || id.startsWith("g") ? "team-b" : g.id;
    entrants[id] = { rider_id: id, team_id: team, role: id === "spr" || id === "s2" ? "sprint_captain" : "helper", effort: "normal", condition: 1,
      abilities: { sprint: id === "spr" || id === "s2" ? 90 : isBreak ? 5 : 10, flat: isBreak ? 80 : 50, tempo: isBreak ? 80 : 50, endurance: isBreak ? 80 : 50, climbing: 20, time_trial: 20 } } as Entrant;
    riders[id] = { rider_id: id, group_id: g.id, cp: .5, wprimeMax: .4, wprime: .4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0, ...(isBreak ? {} : { team_cp_factor: factor }) };
  }
  const route: RouteV2 = { distance_km: 200, profile_type: "flat", finale_type: "bunch_sprint", segments: [{ kind: "flat", from_km: 0, to_km: 5 }, { kind: "flat", from_km: 170, to_km: 200 }], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] };
  const state: EngineState = { km: 170, groups, riders, virtual_gc: {} };
  const ctx: Parameters<typeof breakawayHook>[1] = { ...makeHookCtx({ segment: route.segments[1], segmentIndex: 1, route, entrants, tuning: RACE_V4_TUNING, seed: stage }), rulesRevision: "orders_gc_v1", ordersGcV3: true, s5ProfilesV1: true, s5ProfilesV2: true, s5ProfilesV3: true,
    gcContext: { status: "first_stage", stage_number: 1 } as const, sharedGroupTime: { entryGroups: groups, timeModelGeneration: 3 as const } };
  return { state, ctx };
}

const separationAfter = (result: { state: EngineState }): number => {
  const field = result.state.groups.find((g) => g.id === "field");
  const escape = result.state.groups.find((g) => g.id === "escape");
  return field && escape ? field.gap_seconds - escape.gap_seconds : 0;
};
const shortEvents = (events: readonly TimelineEvent[]) => events.filter((e) => e.type === "breakaway_chase_short");

test("#7730 jagten: to friske hold henter til tiden, samme etape med traette hold kommer for sent, og filmen faar aarsagen", () => {
  const fresh = fixture();
  const on = breakawayHook(fresh.state, { ...fresh.ctx, teamChase7730: true });
  const worn = fixture({ factor: TEAM_REACTION_TUNING.minWorkerFreshness - 0.001 });
  const late = breakawayHook(worn.state, { ...worn.ctx, teamChase7730: true });
  assert.ok(separationAfter(late) > separationAfter(on), "de traette hold lukker mindre");
  assert.ok(separationAfter(late) <= BREAKAWAY_EXTRA_TUNING.chaseFloorLateTargetGapSeconds + 1e-9, "for-sent er stadig loftet");
  assert.equal(shortEvents(on.events).length, 0);
  const [event] = shortEvents(late.events);
  assert.equal(event?.params.group_id, "escape");
  assert.equal(event?.params.reason, "tired");
  assert.deepEqual(event?.params.team_ids, ["team-a", "team-b"]);
  assert.equal(Object.values(event?.params ?? {}).some((v) => typeof v === "number"), false, "aldrig tal i haendelsen");
});

test("#7730 jagten: lodtraekningen spoerges aldrig, og samme jagt giver samme udfald paa alle seeds", () => {
  const seen = new Set<number>();
  for (const stage of ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e", "seed-f", "seed-g", "seed-h"]) {
    const { state, ctx } = fixture({ stage });
    const rngForStage: typeof ctx.rngForStage = (mechanic, riderId) => {
      assert.notEqual(mechanic, "breakaway_chase_floor");
      return ctx.rngForStage(mechanic, riderId);
    };
    seen.add(separationAfter(breakawayHook(state, { ...ctx, teamChase7730: true, rngForStage })));
  }
  assert.equal(seen.size, 1);
});

test("#7730 jagten: uden kontakten er det stadig lodtraekningen, og ingen ny haendelse", () => {
  const { state, ctx } = fixture({ factor: TEAM_REACTION_TUNING.minWorkerFreshness - 0.001 });
  let asked = 0;
  const rngForStage: typeof ctx.rngForStage = (mechanic, riderId) => {
    if (mechanic === "breakaway_chase_floor") asked += 1;
    return ctx.rngForStage(mechanic, riderId);
  };
  const off = breakawayHook(state, { ...ctx, rngForStage });
  assert.ok(asked > 0);
  assert.equal(shortEvents(off.events).length, 0);
});
