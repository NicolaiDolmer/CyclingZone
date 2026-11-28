// #8828 · "Angrib på" på taktikfanen: planen med et sted bygges i rutens orden, og uden sted er alt som før.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attackPlaceKey7884, orderWithoutAttack7884, planWithAttack7884, planWithoutAttack7884, stagePlaces7884, valleyWord7884, withAttackRoute7884,
  type AttackPlace7884,
} from "./longAttack7884Model.ts";
import { tacticsOrderPayload7864 } from "../../lib/tacticsOrderPayload7864.ts";
import type { StagePlanLeg, StagePlanRoute } from "../race/StagePlanModel.ts";

const ROUTE: StagePlanRoute = {
  distance_km: 175, profile_type: "high_mountain",
  climbs: [{ index: 0, km: 66, name: "A", category: "2" }, { index: 1, km: 128, name: "B", category: "1" }],
} as StagePlanRoute;
const place = (key: string, kind: "climb" | "finale", foot: number, trigger: AttackPlace7884["trigger"]): AttackPlace7884 => ({
  key, kind, trigger, label: kind === "finale" ? { key: "finale", from_km: foot } : { key: "climb", name: key, summit_finish: false },
  facts: { foot_km: foot, climbs_after: 0, summit_finish: false },
});
const B = place("climb:1", "climb", 119, { at: "climb_start", kom_index: 1 });
const C = place("climb:2", "climb", 160, { at: "climb_start", kom_index: 2 });
const FIN = place("finale", "finale", 165, { at: "finale" });
const BASE: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 1 } }, { task: "ride_for_result", from: { at: "final_km" } }];

test("stedet sættes ind ved foden i rutens orden; planen uden sted er samme array", () => {
  assert.deepEqual(planWithAttack7884(BASE, B, ROUTE), [{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: 1 } }, ...BASE.slice(1)]);
  assert.deepEqual(planWithAttack7884(BASE, C, ROUTE), [...BASE.slice(0, 2), { task: "attack", from: { at: "climb_start", kom_index: 2 } }, BASE[2]]);
  assert.equal(planWithoutAttack7884(BASE), BASE);
  assert.deepEqual(planWithAttack7884(planWithAttack7884(BASE, B, ROUTE) as StagePlanLeg[], null, ROUTE), BASE);
});

test("finalen tager pladsen for de sidste km (samme punkt), og et sted efter sat-leddet lægges før det", () => {
  assert.deepEqual(planWithAttack7884(BASE, FIN, ROUTE), [...BASE.slice(0, 2), { task: "attack", from: { at: "finale" } }]);
  const dropped: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }];
  assert.deepEqual(planWithAttack7884(dropped, B, ROUTE), [{ task: "shelter_leader" }, { task: "attack", from: { at: "climb_start", kom_index: 1 } }, { task: "ride_in", from: { at: "dropped" } }]);
});

test("et sted der ikke passer i kronologien kan ikke vælges", () => {
  const early = place("climb:0", "climb", 0, { at: "climb_start", kom_index: 0 });
  assert.equal(planWithAttack7884(BASE, early, ROUTE), null, "en fod ved km 0 er ikke et punkt");
});

test("nøglen, fingeraftrykket og ordren uden steder", () => {
  const legs = planWithAttack7884(BASE, B, ROUTE)!;
  assert.equal(attackPlaceKey7884(legs), "climb:1");
  assert.equal(attackPlaceKey7884(BASE), null);
  assert.deepEqual(withAttackRoute7884({ rider_id: "r", plan: legs }, "fp"), { rider_id: "r", plan: legs, long_attack_route_7884: "fp" });
  assert.deepEqual(withAttackRoute7884({ rider_id: "r", plan: BASE, long_attack_route_7884: "fp" }, "fp"), { rider_id: "r", plan: BASE });
  const order = { breakaway_stance: "neutral", riders: [{ rider_id: "r", plan: legs, long_attack_route_7884: "fp" }, { rider_id: "s", plan: BASE }] };
  const stripped = orderWithoutAttack7884(order);
  assert.deepEqual(stripped.riders, [{ rider_id: "r", plan: BASE }, { rider_id: "s", plan: BASE }]);
  const plain = { riders: [{ rider_id: "s", plan: BASE }] };
  assert.equal(orderWithoutAttack7884(plain), plain);
});

test("gem sender fingeraftrykket kun med en plan med et sted", () => {
  const legs = planWithAttack7884(BASE, B, ROUTE)!;
  const rider = (plan: unknown, fp?: string) => ({ rider_id: "r", effort: "normal", try_break: false, leadout: false, plan, ...(fp ? { long_attack_route_7884: fp } : {}) });
  const payload = tacticsOrderPayload7864({ breakaway_stance: "neutral", riders: [rider(legs, "fp"), { ...rider(BASE, "fp"), rider_id: "s" }] } as never, true);
  assert.equal((payload.riders[0] as Record<string, unknown>)["long_attack_route_7884"], "fp");
  assert.equal("long_attack_route_7884" in payload.riders[1], false);
});

test("stederne for én etape fra serverens svar; dalen i ord", () => {
  assert.equal(stagePlaces7884(false, 1), null);
  assert.equal(stagePlaces7884({ 2: { fingerprint: "x", places: [B] } }, 1), null);
  assert.deepEqual(stagePlaces7884({ 2: { fingerprint: "x", places: [B] } }, 2), { fingerprint: "x", places: [B] });
  assert.equal(valleyWord7884({ foot_km: 1, climbs_after: 0, summit_finish: false, valley_after_km: 53 }), "longValley");
  assert.equal(valleyWord7884({ foot_km: 1, climbs_after: 0, summit_finish: false, valley_after_km: 32 }), "valley");
  assert.equal(valleyWord7884({ foot_km: 1, climbs_after: 0, summit_finish: false, valley_after_km: 5 }), null);
  assert.equal(valleyWord7884({ foot_km: 1, climbs_after: 0, summit_finish: true, valley_after_km: 50 }), null);
});
