// #7381: "Alt ud holdt udbruddet" for ryttere med etapeplan, hele vejen fra spillerens
// ordrer (effectiveEffortByRider) og tidslinjens stage_plan_leg-events til linjen i
// loebshistorien (withNarrativeCauses). Opslaget er stagePlanTaskAt, ikke en kopi.
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveEffortByRider } from "./stageSplitTimes.ts";
import { withNarrativeCauses } from "../../../backend/lib/engine/v4/mechanics/narrativeCauses6469.ts";

type Ev = { km: number; type: string; params: Record<string, unknown> };
const ev = (km: number, type: string, params: Record<string, unknown> = {}): Ev => ({ km, type, params });
const formed = ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["own1", "x"] });
const finish = ev(150, "finish", { top: [{ rider_id: "own1", rank: 1, gap: 0 }, { rider_id: "w", rank: 2, gap: 0 }, { rider_id: "q", rank: 3, gap: 40 }] });

function effortsFor(rider: Record<string, unknown>) {
  return effectiveEffortByRider(null, { orders: [{ stage_number: 1, riders: [{ rider_id: "own1", ...rider }] }] }, 1, { v4: true });
}
const impacts = (events: Ev[], efforts: ReturnType<typeof effortsFor>) =>
  withNarrativeCauses(events, { ownRiderIds: ["own1"], effortByRider: efforts })
    .filter((e) => e?.type === "order_impact")
    .map((e) => e?.params?.kind);

test("#7381: plan-rytter paa angreb i det udbrud der holdt: historien vises", () => {
  const efforts = effortsFor({ effort: "normal", plan: [{ task: "breakaway" }, { task: "attack", from: { at: "final_km" } }] });
  assert.equal(efforts.get("own1"), undefined, "plan-rytteren staar ikke i indsats-mappen (#7333)");
  const events = [formed, ev(130, "stage_plan_leg", { rider_id: "own1", leg: 1, task: "attack", reason: "final_km" }), ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] }), finish];
  assert.deepEqual(impacts(events, efforts), ["all_out_stayed_away"]);
  // Uden skiftet koerte han udbruddet paa forsoeg (normal indsats): ingen historie.
  assert.deepEqual(impacts([formed, ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] }), finish], efforts), []);
  // Et skift der kun gaelder finalen (at_finish), er ikke opgaven i udbruddet. Skiftets
  // km ligger FOER udfaldet, saa kun at_finish-reglen holder det ude (ikke "strengt foer").
  const legParams = { rider_id: "own1", leg: 1, task: "attack", reason: "final_km" };
  const held = ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] });
  assert.deepEqual(impacts([formed, ev(130, "stage_plan_leg", { ...legParams, at_finish: true }), held, finish], efforts), []);
  // Kontrol: samme skift uden at_finish giver historien, saa linjen ovenfor maaler reglen.
  assert.deepEqual(impacts([formed, ev(130, "stage_plan_leg", legParams), held, finish], efforts), ["all_out_stayed_away"]);
});

test("#7381: plan-rytter der skiftede til angreb efter at udbruddet blev hentet: ingen historie", () => {
  const efforts = effortsFor({ effort: "protect", plan: [{ task: "follow_moves" }, { task: "attack", from: { at: "final_km" } }] });
  const events = [formed, ev(80, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["own1", "x"] }), ev(130, "stage_plan_leg", { rider_id: "own1", leg: 1, task: "attack", reason: "final_km" }), finish];
  assert.deepEqual(impacts(events, efforts), []);
});

test("#7381: rytter uden plan med 'Alt ud': som foer", () => {
  const efforts = effortsFor({ effort: "all_out" });
  assert.equal(efforts.plans.size, 0);
  assert.deepEqual(impacts([formed, ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] }), finish], efforts), ["all_out_stayed_away"]);
});
