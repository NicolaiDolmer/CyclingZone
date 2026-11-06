// #7381: "Alt ud holdt udbruddet" for ryttere med etapeplan, hele vejen fra spillerens
// ordrer (effectiveEffortByRider) og tidslinjens stage_plan_leg-events til linjen i
// loebshistorien (withNarrativeCauses). Opslaget er stagePlanTaskAt, ikke en kopi.
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveEffortByRider } from "./stageSplitTimes.ts";
import { withNarrativeCauses, withAttackWording } from "../../../backend/lib/engine/v4/mechanics/narrativeCauses6469.ts";

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
  assert.deepEqual(impacts(events, efforts), ["attack_stayed_away"]);
  // Uden skiftet koerte han udbruddet paa forsoeg (normal indsats): ingen historie.
  assert.deepEqual(impacts([formed, ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] }), finish], efforts), []);
  // Et skift der kun gaelder finalen (at_finish), er ikke opgaven i udbruddet. Skiftets
  // km ligger FOER udfaldet, saa kun at_finish-reglen holder det ude (ikke "strengt foer").
  const legParams = { rider_id: "own1", leg: 1, task: "attack", reason: "final_km" };
  const held = ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["own1"] });
  assert.deepEqual(impacts([formed, ev(130, "stage_plan_leg", { ...legParams, at_finish: true }), held, finish], efforts), []);
  // Kontrol: samme skift uden at_finish giver historien, saa linjen ovenfor maaler reglen.
  assert.deepEqual(impacts([formed, ev(130, "stage_plan_leg", legParams), held, finish], efforts), ["attack_stayed_away"]);
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

// #7707: motorens all_out_gain/all_out_cracked faar Angrib-ordene for en rytter paa opgaven Angrib.
const wordOf = (events: Ev[], efforts: ReturnType<typeof effortsFor>, extra: Record<string, unknown> = {}) =>
  withAttackWording(events, { ownRiderIds: ["own1"], effortByRider: efforts, ...extra }).find((e) => e.type === "all_out_gain")?.params.task;

test("#7707: plan-rytter paa Angrib faar Angrib-ordene; et skift paa stigningens top hoerer til det forrige led", () => {
  const efforts = effortsFor({ effort: "normal", plan: [{ task: "attack" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }] });
  const gain = ev(140, "all_out_gain", { rider_id: "own1" });
  // Skiftet til Foelg angrebene staar paa samme km som toppen: han angreb op ad stigningen.
  const atTop = ev(140, "stage_plan_leg", { rider_id: "own1", leg: 1, task: "follow_moves", reason: "kom" });
  assert.equal(wordOf([atTop, gain], efforts), "attack");
  assert.equal(wordOf([gain, atTop], efforts), "attack", "raekkefoelgen i listen er ligegyldig");
  // Kontrol: skiftet lidt FOER toppen betyder at han ikke angreb dér, saa ingen Angrib-tekst.
  assert.equal(wordOf([ev(139, "stage_plan_leg", { rider_id: "own1", leg: 1, task: "follow_moves", reason: "kom" }), gain], efforts), undefined);
  // Uden skift: foerste led (Angrib).
  assert.equal(wordOf([gain], efforts), "attack");
});

test("#7707: Alt ud bevares paa enkeltstart og for en egen rytter med indsats-ordren; andres ryttere siger Angrib", () => {
  const gain = ev(140, "all_out_gain", { rider_id: "own1" });
  const planned = effortsFor({ effort: "normal", plan: [{ task: "attack" }] });
  assert.equal(wordOf([gain], planned, { profileType: "itt" }), undefined, "enkeltstart");
  assert.equal(wordOf([ev(0, "stage_start", { profile_type: "itt" }), gain], planned), undefined, "enkeltstart fra tidslinjen");
  assert.equal(wordOf([gain], effortsFor({ effort: "all_out" })), undefined, "indsats-ordren Alt ud (aeldre etaper)");
  const other = ev(140, "all_out_gain", { rider_id: "other" });
  assert.equal(withAttackWording([other], { ownRiderIds: ["own1"], effortByRider: planned })[0].params.task, "attack", "andre holds ryttere er kun Angrib paa en etape uden indsatsvaelger");
  // Idempotent og uden at roere input: en uaendret haendelse er det samme objekt.
  const kept = ev(100, "breakaway_formed", {});
  const [again] = withAttackWording([kept], { ownRiderIds: ["own1"], effortByRider: planned });
  assert.equal(again, kept);
  assert.equal(gain.params.task, undefined);
});
