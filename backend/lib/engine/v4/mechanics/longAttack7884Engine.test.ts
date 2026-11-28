// #8828 trin 3: "Angrib paa" tilsluttet motoren bag kontakten long_attack_7884 (StageInput.long_attack_7884,
// kun et loeb stemplet ved foerste etape). Dommer-scenarierne W1-W9 er skrevet foer tilslutningen;
// den frosne golden er skrevet af MERGE-BASENS kode (__fixtures__/longAttack7884Golden.json, #7587).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LONG_ATTACK_7884_CAUGHT_EVENT,
  STAGE_PLAN_LEG_EVENT,
  advanceStagePlan,
  createStagePlanRuntime,
  stagePlanCurrentTasks,
  stagePlanEntrants,
  stagePlanLoadEfforts,
  stagePlanLongAttackStart7884,
  stagePlanLongAttackers7884,
  stagePlanOrderFromRow,
} from "../../../stagePlanEngine.ts";
import { attackPlaces7884 } from "../../../tacticAttackTrigger7884.js";
import { legacyOrderFromPlan, type StagePlanLeg } from "../../../stagePlan.ts";
import { enginePlaces7884 } from "./longAttack7884.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { frozenStages } from "../testUtils/oldRevisionDigests6199.ts";
import { contexts8828, golden8828Digests, humanRows8828, runStage8828 } from "../testUtils/longAttack7884Golden.ts";
import { frozenField } from "../testUtils/oldRevisionDigests6199.ts";
import type { EngineState, Entrant, RaceGroup, RouteV2, Segment } from "../types.ts";

// ── Frossen golden fra merge-basen ──────────────────────────────────────────

test("W0: slukket OG taendt uden nogen Angrib paa-ordre er bit-identiske med merge-basen (alle profiler, etapeloeb og endagsloeb, AI-hold)", () => {
  const frozen = JSON.parse(readFileSync(new URL("../../../__fixtures__/longAttack7884Golden.json", import.meta.url), "utf8"));
  assert.match(frozen.sourceCommit, /^[0-9a-f]{40}$/);
  const off = golden8828Digests(false);
  assert.deepEqual(Object.keys(off).sort(), Object.keys(frozen.off).sort(), "samme scenarier");
  assert.deepEqual(off, frozen.off);
  assert.deepEqual(golden8828Digests(true), frozen.onNoPlaces);
});

// ── En lille rute til runtime'ens regler ────────────────────────────────────

const SEGMENTS: Segment[] = [
  { kind: "flat", from_km: 0, to_km: 50 },
  { kind: "climb", from_km: 50, to_km: 60, category: "1", avg_gradient: 7, top_elevation_m: 1500 },
  { kind: "descent", from_km: 60, to_km: 70, technicality: 2 },
  { kind: "flat", from_km: 70, to_km: 100 },
];
const ROUTE: RouteV2 = {
  distance_km: 100, profile_type: "mountain", finale_type: null, segments: SEGMENTS, weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [{ kind: "kom", index: 0, name: "Col", km: 60, category: "1" }, { kind: "finish", index: 0, name: "Finish", km: 100 }],
};
const entrant = (id: string, role: Entrant["role"]): Entrant => ({ rider_id: id, team_id: "team-a", role, effort: "normal", condition: 1, abilities: {} as Entrant["abilities"] });
const ENTRANTS: Record<string, Entrant> = { a: entrant("a", "captain"), h: entrant("h", "helper"), x: { ...entrant("x", "captain"), team_id: "team-b" } };
const ATTACK: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: 0 } as never }, { task: "ride_for_result", from: { at: "final_km" } }];
const WITHOUT: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
const ROW = { riders: [{ rider_id: "a", ...legacyOrderFromPlan(WITHOUT), plan: ATTACK, plan_no_long_attack: WITHOUT, long_attack_route_7884: "fp" }] };
const group = (id: string, rider_ids: string[], gap_seconds: number, kind: RaceGroup["kind"] = "peloton"): RaceGroup => ({ id, kind, rider_ids, gap_seconds, cohesion: 1 });
const state = (groups: RaceGroup[]): EngineState => ({
  km: 0, groups, virtual_gc: {},
  riders: Object.fromEntries(["a", "h", "x"].map((id) => [id, { status: "racing" } as EngineState["riders"][string]])),
});

test("W1: motorens steder har samme noegler og fod som API'ets paa de samme raa felter", () => {
  for (const row of frozenStages()) {
    const api = attackPlaces7884(row);
    const engine = enginePlaces7884(routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]), 10);
    assert.deepEqual(engine.map((p) => p.key), api.map((p) => p.key), `${row.profile_type}#${row.stage_number}`);
    engine.forEach((p, i) => assert.ok(Math.abs(p.foot_km - api[i].foot_km) < 0.051, `${p.key}: ${p.foot_km} mod ${api[i].foot_km}`));
  }
});

test("W2: ordre-adapteren baerer planen med stederne ved siden af; uden kontakten koerer runtime'en planen uden dem", () => {
  const order = stagePlanOrderFromRow("team-a", ROW, "s5_profiles_v3", () => true)!;
  const rider = (order.params as { riders: Array<Record<string, unknown>> }).riders[0];
  assert.deepEqual(rider["legs"], WITHOUT);
  assert.deepEqual(rider["long_attack_legs"], ATTACK);
  const off = createStagePlanRuntime([order], ROUTE, ENTRANTS)!;
  assert.equal(off.longAttack7884, undefined, "slukket: ingen ny tilstand paa runtime'en");
  assert.equal(off.legs.get("a")!.length, 2);
  // En raekke uden steder er praecis som foer (intet nyt felt).
  const plain = stagePlanOrderFromRow("team-a", { riders: [{ rider_id: "a", plan: WITHOUT }] }, "s5_profiles_v3", () => true)!;
  assert.equal("long_attack_legs" in (plain.params as { riders: Array<Record<string, unknown>> }).riders[0], false);
});

test("W3: et ukendt sted eller en ugyldig plan med steder koerer planen uden stederne, ogsaa med kontakten", () => {
  const bad = { riders: [{ ...ROW.riders[0], plan: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: 9 } }] }] };
  const order = stagePlanOrderFromRow("team-a", bad, "s5_profiles_v3", () => true)!;
  const rt = createStagePlanRuntime([order], ROUTE, ENTRANTS, { longAttack7884: true })!;
  assert.equal(rt.longAttack7884, undefined);
  assert.equal(rt.legs.get("a")!.length, 2);
  // Taendt uden nogen plan med steder: runtime'en er som slukket.
  const none = createStagePlanRuntime([stagePlanOrderFromRow("team-a", { riders: [{ rider_id: "a", plan: WITHOUT }] }, "s5_profiles_v3", () => true)!], ROUTE, ENTRANTS, { longAttack7884: true })!;
  assert.equal(none.longAttack7884, undefined);
});

test("W4: afsaet ved foden fra hans egen gruppe (samme hul), angreb til toppen, ingen gevinst fra Alt ud", () => {
  const order = stagePlanOrderFromRow("team-a", ROW, "s5_profiles_v3", () => true)!;
  const rt = createStagePlanRuntime([order], ROUTE, ENTRANTS, { longAttack7884: true })!;
  assert.ok(rt.longAttack7884);
  // Segment 1 (flad): intet skift.
  assert.deepEqual(advanceStagePlan(rt, { state: state([group("pel", ["a", "h", "x"], 0)]), segment: SEGMENTS[0], segmentIndex: 0, entrants: ENTRANTS }), []);
  // Segment 2 (stigningen): skift ved foden, aarsag long_attack.
  const events = advanceStagePlan(rt, { state: state([group("pel", ["a", "h", "x"], 12)]), segment: SEGMENTS[1], segmentIndex: 1, entrants: ENTRANTS });
  assert.deepEqual(events, [{ km: 50, type: STAGE_PLAN_LEG_EVENT, params: { rider_id: "a", leg: 1, task: "attack", reason: "long_attack" } }]);
  const groups = stagePlanLongAttackStart7884(rt, [group("pel", ["a", "h", "x"], 12)], 1);
  const solo = groups.find((g) => g.rider_ids.includes("a"))!;
  assert.deepEqual(solo.rider_ids, ["a"]);
  assert.equal(solo.gap_seconds, 12, "samme hul som gruppen, intet forspring");
  assert.deepEqual(stagePlanLongAttackers7884(rt), ["a"]);
  // Indsatsen er ikke "Alt ud" (farten betales af reserven); opgaven er stadig Angrib.
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["a"].effort, "normal");
  assert.equal(stagePlanCurrentTasks(rt)["a"], "attack");
  // Traetheden bagefter kender leddets pris (mindst som Alt ud).
  assert.equal(stagePlanLoadEfforts(rt)["a"], "all_out");
  // Han er stadig alene foran ved toppen: angrebet holder til toppen og slutter dér (naeste led ved sidste km).
  const atTop = advanceStagePlan(rt, { state: state([group(solo.id, ["a"], 0, "solo"), group("pel", ["h", "x"], 20)]), segment: SEGMENTS[2], segmentIndex: 2, entrants: ENTRANTS });
  assert.deepEqual(atTop, []);
  assert.deepEqual(stagePlanLongAttackers7884(rt), [], "over toppen er angrebet koert: intet tillaeg mere");
  assert.equal(stagePlanCurrentTasks(rt)["a"], "follow_moves", "resten af leddet til planens naeste punkt");
  assert.equal(stagePlanLongAttackStart7884(rt, [group(solo.id, ["a"], 0, "solo"), group("pel", ["h", "x"], 20)], 2).length, 2, "intet nyt afsaet");
});

test("W5: hentet = ét forsoeg; resten af leddet koeres som Foelg med, og senere led gaelder", () => {
  const order = stagePlanOrderFromRow("team-a", ROW, "s5_profiles_v3", () => true)!;
  const rt = createStagePlanRuntime([order], ROUTE, ENTRANTS, { longAttack7884: true })!;
  advanceStagePlan(rt, { state: state([group("pel", ["a", "h", "x"], 0)]), segment: SEGMENTS[0], segmentIndex: 0, entrants: ENTRANTS });
  advanceStagePlan(rt, { state: state([group("pel", ["a", "h", "x"], 0)]), segment: SEGMENTS[1], segmentIndex: 1, entrants: ENTRANTS });
  stagePlanLongAttackStart7884(rt, [group("pel", ["a", "h", "x"], 0)], 1);
  // Ved toppen er han samlet op af feltet han kom fra.
  const events = advanceStagePlan(rt, { state: state([group("pel", ["a", "h", "x"], 0)]), segment: SEGMENTS[2], segmentIndex: 2, entrants: ENTRANTS });
  assert.deepEqual(events, [{ km: 60, type: LONG_ATTACK_7884_CAUGHT_EVENT, params: { rider_id: "a", leg: 1, task: "follow_moves" } }]);
  assert.deepEqual(stagePlanLongAttackers7884(rt), []);
  assert.equal(stagePlanCurrentTasks(rt)["a"], "follow_moves");
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["a"].effort, "protect");
  // Intet nyt forsoeg paa samme led.
  stagePlanLongAttackStart7884(rt, [group("pel", ["a", "h", "x"], 0)], 2);
  assert.deepEqual(stagePlanLongAttackers7884(rt), []);
});

test("W6: topankomst og finalen: angrebet holder til maal", () => {
  const segs: Segment[] = [{ kind: "flat", from_km: 0, to_km: 80 }, { kind: "climb", from_km: 80, to_km: 100, category: "HC", avg_gradient: 8, top_elevation_m: 2000 }];
  const route: RouteV2 = { ...ROUTE, segments: segs, waypoints: [{ kind: "kom", index: 0, name: "Top", km: 100, category: "HC", summit_finish: true }, { kind: "finish", index: 0, name: "Finish", km: 100 }] };
  const places = enginePlaces7884(route, 10);
  assert.deepEqual(places.map((p) => [p.key, p.foot_km, p.until_km]), [["climb:0", 80, 100], ["finale", 90, 100]]);
});

test("W7: et hold styrer aldrig et andet holds rytter, ogsaa med stederne", () => {
  const order = stagePlanOrderFromRow("team-b", { riders: [{ ...ROW.riders[0], rider_id: "a" }] }, "s5_profiles_v3", () => true)!;
  assert.equal(createStagePlanRuntime([order], ROUTE, ENTRANTS, { longAttack7884: true }), null);
});

// ── Hele motoren ───────────────────────────────────────────────────────────

const MOUNTAIN = frozenStages().find((r) => r.profile_type === "mountain" && r.stage_number === 12)!;
const ON_PLAN: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: 2 } as never }, { task: "ride_for_result", from: { at: "final_km" } }];
const OFF_PLAN: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];

function rowsWithAttack(): Map<string, Record<string, unknown>[]> {
  const rows = humanRows8828({});
  const t0 = frozenField().find((r) => r.rider_id === "t0r0")!;
  rows.set(String(t0.team_id), [{ rider_id: "t0r0", ...legacyOrderFromPlan(OFF_PLAN), plan: ON_PLAN, plan_no_long_attack: OFF_PLAN, long_attack_route_7884: "fp" }]);
  return rows;
}

test("W8: slukket koerer en gemt plan med steder som planen uden dem (samme loeb som uden stederne)", () => {
  const ctx = contexts8828(frozenField().map((r) => r.rider_id).sort())[0];
  const withPlaces = runStage8828(MOUNTAIN, "w8", ctx, rowsWithAttack(), false);
  const plain = new Map([["team-0", [{ rider_id: "t0r0", ...legacyOrderFromPlan(OFF_PLAN), plan: OFF_PLAN }]]]);
  assert.deepEqual(withPlaces, runStage8828(MOUNTAIN, "w8", ctx, plain, false));
});

test("W9: taendt saetter han af ved foden af den valgte stigning; deterministisk; loebet flytter sig", () => {
  const ctx = contexts8828(frozenField().map((r) => r.rider_id).sort())[0];
  const on = runStage8828(MOUNTAIN, "w9", ctx, rowsWithAttack(), true);
  const off = runStage8828(MOUNTAIN, "w9", ctx, rowsWithAttack(), false);
  const launch = on.timeline.events.find((e) => e.type === STAGE_PLAN_LEG_EVENT && e.params["rider_id"] === "t0r0" && e.params["reason"] === "long_attack");
  assert.ok(launch, "afsaettet staar i tidslinjen");
  const foot = attackPlaces7884(MOUNTAIN).find((p) => p.key === "climb:2")!.foot_km;
  assert.ok(Math.abs(launch!.km - foot) < 0.06, `ved foden (${launch!.km} mod ${foot})`);
  assert.notDeepEqual(on, off);
  assert.deepEqual(on, runStage8828(MOUNTAIN, "w9", ctx, rowsWithAttack(), true), "samme input, samme loeb");
});
