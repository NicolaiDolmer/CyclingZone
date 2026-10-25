// #7003 (KUN s5_profiles_v3, slukket bag stage_plan_v1): motorens opgaveskift langs ruten.
// Kontrakter, ingen balance-tal (hard rule 17): byte-identitet uden plan og under aeldre
// revisioner, skift ved rutepunkt og ved "sat", kronologi (aldrig bagud), ugyldige planer
// ignoreres, juryen ser sidste leds indsats, og tidslinjen er stadig gyldig.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "./index.ts";
import { runSegmentLoop, DEFAULT_MECHANIC_HOOKS } from "./segmentLoop.ts";
import { validateTimelineEvents } from "./timeline.ts";
import type { EngineState, Entrant, RaceGroup, StageInput, TeamOrder, TimelineEvent } from "./types.ts";
import {
  STAGE_PLAN_LEG_EVENT,
  STAGE_PLAN_ORDER_KIND,
  advanceStagePlan,
  createStagePlanRuntime,
  isRiderDropped,
  stagePlanEntrants,
  stagePlanOrderFromRow,
  stagePlanRouteFromV4,
} from "../../stagePlanEngine.ts";
import { suggestStagePlan, validateStagePlanLegs, type StagePlanLeg, type StagePlanRole } from "../../stagePlan.ts";
import { isS5ProfilesV3OrLater } from "../../raceEngineRulesRevision.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Bjerg-fixturen med hold-id'er (tre ryttere pr. hold) og en given revision. */
function mountainInput(revision: string | null, orders: TeamOrder[] = []): StageInput {
  const input = JSON.parse(readFileSync(path.join(here, "fixtures", "bjerg-selektion", "input.json"), "utf8")) as StageInput;
  input.startlist = input.startlist.map((e, i) => ({ ...e, team_id: `T${Math.floor(i / 3)}` }));
  input.orders = orders;
  if (revision) (input as { rules_revision?: unknown }).rules_revision = revision;
  return input;
}

function planOrder(teamId: string, riders: Array<{ rider_id: string; legs: StagePlanLeg[] }>): TeamOrder {
  return { team_id: teamId, kind: STAGE_PLAN_ORDER_KIND, params: { riders } };
}

function legEvents(events: readonly TimelineEvent[], riderId?: string): TimelineEvent[] {
  return events.filter((e) => e.type === STAGE_PLAN_LEG_EVENT && (!riderId || e.params.rider_id === riderId));
}

function teamOf(input: StageInput, riderId: string): string {
  return String(input.startlist.find((e) => e.rider_id === riderId)!.team_id);
}

test("#7003: uden plan er etapen byte-identisk; en tom plan-ordre aendrer intet under v3", () => {
  const base = simulateStageV4(mountainInput("s5_profiles_v3"));
  const withEmpty = simulateStageV4(mountainInput("s5_profiles_v3", [planOrder("T0", [])]));
  assert.deepEqual(withEmpty, base);
  assert.equal(legEvents(base.timeline.events).length, 0);
});

test("#7003: under s5_profiles_v2 (og aeldre) ignoreres planen helt, byte-identisk", () => {
  const input = mountainInput("s5_profiles_v2");
  const rider = input.startlist[0];
  const order = planOrder(String(rider.team_id), [{ rider_id: rider.rider_id, legs: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }] }]);
  for (const revision of ["s5_profiles_v2", "official_times_v3", null]) {
    assert.deepEqual(simulateStageV4(mountainInput(revision, [order])), simulateStageV4(mountainInput(revision)), String(revision));
  }
});

test("#7003: adapteren laver kun plan-ordren under s5_profiles_v3", () => {
  const row = { riders: [{ rider_id: "r01", effort: "save", plan: [{ task: "stay_sheltered" }] }, { rider_id: "r02", effort: "normal" }] };
  assert.deepEqual(stagePlanOrderFromRow("T0", row, "s5_profiles_v3", isS5ProfilesV3OrLater), planOrder("T0", [{ rider_id: "r01", legs: [{ task: "stay_sheltered" }] }]));
  for (const revision of ["s5_profiles_v2", "legacy", undefined]) {
    assert.equal(stagePlanOrderFromRow("T0", row, revision, isS5ProfilesV3OrLater), null, String(revision));
  }
  assert.equal(stagePlanOrderFromRow("T0", { riders: [{ rider_id: "r02", effort: "normal" }] }, "s5_profiles_v3", isS5ProfilesV3OrLater), null);
});

test("#7003: skift ved toppen af stigningen sker paa segmentet efter toppen og koster indsatsen derfra", () => {
  const input = mountainInput("s5_profiles_v3");
  const rider = input.startlist.find((e) => e.role === "captain")!;
  const crestKm = input.route.waypoints.find((w) => w.kind === "kom")!.km;
  const order = planOrder(teamOf(input, rider.rider_id), [{ rider_id: rider.rider_id, legs: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 0 } }] }]);
  const out = simulateStageV4(mountainInput("s5_profiles_v3", [order]));
  const events = legEvents(out.timeline.events, rider.rider_id);
  assert.equal(events.length, 1);
  assert.equal(events[0].params.task, "attack");
  assert.equal(events[0].params.reason, "kom");
  assert.equal(events[0].params.leg, 1);
  assert.ok(events[0].km >= crestKm, "skiftet kan aldrig ske foer toppen");
  // Indsatsen virker: rytterens belastning er en anden end uden plan.
  const withPlan = runSegmentLoop(mountainInput("s5_profiles_v3", [order]), DEFAULT_MECHANIC_HOOKS).state.riders[rider.rider_id];
  const without = runSegmentLoop(mountainInput("s5_profiles_v3"), DEFAULT_MECHANIC_HOOKS).state.riders[rider.rider_id];
  assert.notEqual(withPlan.work_norm, without.work_norm);
});

test("#7003: en ugyldig plan ignoreres (rytteren koerer paa sin almindelige ordre)", () => {
  const input = mountainInput("s5_profiles_v3");
  const rider = input.startlist.find((e) => e.role === "captain")!;
  const invalid: StagePlanLeg[][] = [
    [{ task: "stay_sheltered" }, { task: "breakaway", from: { at: "final_km" } }], // udbrud kun foerst
    [{ task: "grupetto" }], // kaptajnen koerer aldrig grupetto
    [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 9 } }], // ukendt stigning
  ];
  const base = simulateStageV4(mountainInput("s5_profiles_v3"));
  for (const legs of invalid) {
    const out = simulateStageV4(mountainInput("s5_profiles_v3", [planOrder(teamOf(input, rider.rider_id), [{ rider_id: rider.rider_id, legs }])]));
    assert.deepEqual(out, base, JSON.stringify(legs));
  }
  // Et andet holds ordre kan aldrig styre rytteren.
  const foreign = planOrder("T4", [{ rider_id: rider.rider_id, legs: [{ task: "attack" }] }]);
  assert.deepEqual(simulateStageV4(mountainInput("s5_profiles_v3", [foreign])), base);
});

test("#7003: assistentens planer for hele feltet giver kronologiske skift og en gyldig tidslinje", () => {
  const input = mountainInput("s5_profiles_v3");
  const planRoute = stagePlanRouteFromV4(input.route);
  const byTeam = new Map<string, Array<{ rider_id: string; legs: StagePlanLeg[] }>>();
  const hasSprintCaptain = (team: string) => input.startlist.some((e) => e.team_id === team && e.role === "sprint_captain");
  for (const e of input.startlist) {
    const team = String(e.team_id);
    const legs = suggestStagePlan({ role: e.role as StagePlanRole, route: planRoute, teamHasSprintCaptain: hasSprintCaptain(team) })!;
    assert.equal(validateStagePlanLegs(legs, e.role as StagePlanRole, planRoute), null);
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team)!.push({ rider_id: e.rider_id, legs });
  }
  const orders = [...byTeam].map(([team, riders]) => planOrder(team, riders));
  const run = () => simulateStageV4(mountainInput("s5_profiles_v3", orders));
  const out = run();
  assert.deepEqual(run(), out, "deterministisk");
  assert.deepEqual(validateTimelineEvents(out.timeline.events, { distanceKm: input.route.distance_km, knownRiderIds: new Set(input.startlist.map((e) => e.rider_id)) }), []);
  const all = legEvents(out.timeline.events);
  assert.ok(all.length > 0, "mindst et skift paa en bjergetape");
  for (const e of input.startlist) {
    const events = legEvents(out.timeline.events, e.rider_id);
    const legs = byTeam.get(String(e.team_id))!.find((r) => r.rider_id === e.rider_id)!.legs;
    let lastLeg = 0;
    let lastKm = 0;
    for (const ev of events) {
      const leg = ev.params.leg as number;
      assert.ok(leg > lastLeg, "kaeden gaar kun frem");
      assert.ok(ev.km >= lastKm, "skiftene kommer i rutens orden");
      assert.equal(ev.params.task, legs[leg].task);
      if (legs[leg].from?.at === "dropped") assert.ok(["dropped", "caught", "missed_break"].includes(ev.params.reason as string));
      lastLeg = leg;
      lastKm = ev.km;
    }
  }
});

// ── Enheds-kontrakter paa runtime'en ────────────────────────────────────────

function entrant(id: string, team: string, role: Entrant["role"]): Entrant {
  return { rider_id: id, abilities: {} as Entrant["abilities"], role, effort: "normal", condition: 1, team_id: team };
}

function stateWith(groups: RaceGroup[]): EngineState {
  const riders: EngineState["riders"] = {};
  for (const g of groups) for (const id of g.rider_ids) {
    riders[id] = { rider_id: id, group_id: g.id, cp: 1, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  return { km: 50, groups, riders, virtual_gc: {} };
}

const ENTRANTS: Record<string, Entrant> = {
  cap: entrant("cap", "A", "captain"),
  h1: entrant("h1", "A", "helper"),
  hun: entrant("hun", "A", "hunter"),
  x: entrant("x", "B", "captain"),
};

test("#7003: sat = bag holdlederens gruppe; foran ham eller i udbruddet er ikke sat", () => {
  const front: RaceGroup = { id: "p0", kind: "peloton", rider_ids: ["cap", "x"], gap_seconds: 0, cohesion: 1 };
  const back: RaceGroup = { id: "c1", kind: "chase", rider_ids: ["h1"], gap_seconds: 40, cohesion: 1 };
  const brk: RaceGroup = { id: "b1", kind: "breakaway", origin: "breakaway", rider_ids: ["hun"], gap_seconds: 0, cohesion: 1 };
  const shifted = { ...front, gap_seconds: 90 }; // udbruddet foerer
  const s = stateWith([brk, shifted, { ...back, gap_seconds: 120 }]);
  assert.equal(isRiderDropped("h1", s, ENTRANTS), true);
  assert.equal(isRiderDropped("hun", s, ENTRANTS), false, "udbryderen er foran, ikke sat");
  assert.equal(isRiderDropped("cap", s, ENTRANTS), false, "lederen i forreste gruppe uden for udbruddet");
  // Kaptajnen sat sammen med hjaelperen: hjaelperen er ved sin leder, ikke sat; lederen er sat.
  const s2 = stateWith([{ ...front, rider_ids: ["x"] }, { ...back, rider_ids: ["h1", "cap"] }]);
  assert.equal(isRiderDropped("h1", s2, ENTRANTS), false);
  assert.equal(isRiderDropped("cap", s2, ENTRANTS), true);
});

test("#7003: udbrudsopgaven: hentet efter at have vaeret med, eller kom ikke med", () => {
  const route = mountainInput("s5_profiles_v3").route;
  const legs: StagePlanLeg[] = [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }];
  const orders = [planOrder("A", [{ rider_id: "hun", legs }, { rider_id: "h1", legs }])];
  const rt = createStagePlanRuntime(orders, route, ENTRANTS)!;
  const seg = (i: number) => route.segments[i];
  const brk: RaceGroup = { id: "b1", kind: "breakaway", origin: "breakaway", rider_ids: ["hun"], gap_seconds: 0, cohesion: 1 };
  const pel: RaceGroup = { id: "p0", kind: "peloton", rider_ids: ["cap", "h1", "x"], gap_seconds: 60, cohesion: 1 };
  // Segment 0: ingen skift (udbruddet dannes her).
  assert.deepEqual(advanceStagePlan(rt, { state: stateWith([brk, pel]), segment: seg(0), segmentIndex: 0, entrants: ENTRANTS }), []);
  const first = advanceStagePlan(rt, { state: stateWith([brk, pel]), segment: seg(1), segmentIndex: 1, entrants: ENTRANTS });
  assert.deepEqual(first.map((e) => [e.params.rider_id, e.params.reason]), [["h1", "missed_break"]]);
  const caught = advanceStagePlan(rt, { state: stateWith([{ ...pel, rider_ids: ["cap", "h1", "x", "hun"], gap_seconds: 0 }]), segment: seg(2), segmentIndex: 2, entrants: ENTRANTS });
  assert.deepEqual(caught.map((e) => [e.params.rider_id, e.params.reason, e.params.task]), [["hun", "caught", "ride_in"]]);
  // Indsatsen foelger opgaven: kør i mål = spar.
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["hun"].effort, "save");
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["cap"], ENTRANTS["cap"], "ryttere uden plan er samme objekt");
});

test("#7003: juryen ser indsatsen i rytterens sidste led", () => {
  const input = mountainInput("s5_profiles_v3");
  const rider = input.startlist.find((e) => e.role === "helper")!;
  const order = planOrder(teamOf(input, rider.rider_id), [{ rider_id: rider.rider_id, legs: [{ task: "shelter_leader" }, { task: "grupetto", from: { at: "kom", kom_index: 0 } }] }]);
  const loop = runSegmentLoop(mountainInput("s5_profiles_v3", [order]), DEFAULT_MECHANIC_HOOKS);
  assert.equal(loop.state.stage_plan_efforts?.[rider.rider_id], "grupetto");
  assert.equal(runSegmentLoop(mountainInput("s5_profiles_v3"), DEFAULT_MECHANIC_HOOKS).state.stage_plan_efforts, undefined);
});
