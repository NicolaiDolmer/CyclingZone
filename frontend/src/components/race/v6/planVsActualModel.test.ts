// #7865 · Løbssiden v6 trin 2a: planen mod det der skete (opdigtede preview-data, ingen spillerdata).
import test from "node:test";
import assert from "node:assert/strict";
import { legsFromRaw, planVsActual, type PlanVsActualInput } from "./planVsActualModel.ts";

const names: Record<string, string> = { a: "Rider A", b: "Rider B", c: "Rider C", d: "Rider D", x: "Rival X" };

function input(over: Partial<PlanVsActualInput> = {}): PlanVsActualInput {
  return {
    orders: {
      riders: [{ rider_id: "a", race_role: "helper" }, { rider_id: "b", race_role: "captain" }, { rider_id: "c", race_role: "free_role" }, { rider_id: "d", race_role: "helper" }],
      orders: [{
        stage_number: 2,
        riders: [
          { rider_id: "a", plan: [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }] },
          { rider_id: "b", plan: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }] },
          { rider_id: "c", effort: "normal" },
          { rider_id: "d", plan: [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "final_km" } }, { task: "ride_in", from: { at: "dropped" } }] },
        ],
      }],
    },
    stageRoles: null,
    stageNumber: 2,
    riderIds: ["a", "b", "c", "d"],
    nameOf: (id) => names[id] ?? null,
    timelineVersion: 2,
    climbs: [{ crest_km: 150, length_km: 8, name: "Col Test" }],
    events: [
      { km: 0, type: "stage_start", params: { distance_km: 150, field_count: 40 } },
      { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["a", "x"] } },
      { km: 120, type: "stage_plan_leg", params: { rider_id: "a", leg: 1, task: "ride_for_result", reason: "caught" } },
      { km: 140, type: "stage_plan_leg", params: { rider_id: "b", leg: 1, task: "attack", reason: "final_km" } },
      { km: 140, type: "stage_plan_leg", params: { rider_id: "d", leg: 1, task: "tempo", reason: "final_km" } },
      { km: 150, type: "all_out_gain", params: { rider_id: "b", task: "attack" } },
      { km: 150, type: "all_out_cracked", params: { rider_id: "x" } },
      { km: 150, type: "finish", params: { top: [{ rank: 1, rider_id: "b" }, { rank: 6, rider_id: "a" }] } },
    ],
    rankOf: (id) => ({ a: 6, b: 1 } as Record<string, number>)[id] ?? null,
    ...over,
  };
}

const byId = (rows: ReturnType<typeof planVsActual>) => new Map(rows.map((r) => [r.riderId, r]));

test("kaptajnen staar foerst; kun de egne ryttere, der koerte etapen", () => {
  const rows = planVsActual(input({ riderIds: ["a", "b"] }));
  assert.deepEqual(rows.map((r) => r.riderId), ["b", "a"]);
  assert.ok(!rows.some((r) => r.riderId === "x"), "en rival kommer aldrig med");
});

test("udbruddet der blev hentet: set i udbruddet, og trinnet slutter hvor han blev hentet", () => {
  const a = byId(planVsActual(input())).get("a")!;
  assert.equal(a.planned, true);
  assert.equal(a.steps[0].task, "breakaway");
  assert.equal(a.steps[0].mark, "seen");
  assert.deepEqual(a.steps[0].lines.map((l) => l.key), ["stagePlan.recap.outcome.inBreak"]);
  assert.deepEqual(a.steps[0].end, { reason: "caught", km: 120, komIndex: null });
  // Andet trin: placeringen er en kendsgerning, ingen dom.
  assert.equal(a.steps[1].mark, "fact");
  assert.deepEqual(a.steps[1].lines[0], { key: "stagePlan.recap.outcome.rank", params: { rank: 6 } });
  assert.deepEqual(a.steps[1].from, { at: "dropped" });
  assert.equal(a.steps[1].previousTask, "breakaway");
});

test("angreb paa en topankomst staar som to linjer i rigtig raekkefoelge, aldrig som interval (valg 14)", () => {
  const b = byId(planVsActual(input())).get("b")!;
  const attack = b.steps[1];
  assert.equal(attack.task, "attack");
  assert.deepEqual(attack.lines.map((l) => l.key), [
    "racePageV6.tacticsAfter.line.attackFootNamed",
    "racePageV6.tacticsAfter.line.attackHeld",
  ]);
  assert.deepEqual(attack.lines[0].params, { climb: "Col Test" });
  assert.equal(attack.lines[0].km, 142, "foden: toppen minus stigningens laengde");
  assert.equal(attack.lines[1].km, 150);
  assert.ok((attack.lines[0].km as number) < (attack.lines[1].km as number));
  assert.equal(attack.mark, "seen");
  for (const line of attack.lines) assert.ok(!("km_span" in line), "ingen interval");
});

test("et angreb der knaekker er gult, ikke en samlet dom over dagen", () => {
  const events = input().events.map((e) => (e.type === "all_out_gain" ? { ...e, type: "all_out_cracked" } : e));
  const b = byId(planVsActual(input({ events }))).get("b")!;
  assert.equal(b.steps[1].mark, "differs");
  assert.equal(b.steps[1].lines.at(-1)?.key, "racePageV6.tacticsAfter.line.attackCracked");
  assert.ok(!("verdict" in b), "ingen samlet dom");
});

test("et trin uden haendelse i optegnelsen er 'ikke set', aldrig 'mislykket'", () => {
  const d = byId(planVsActual(input())).get("d")!;
  // Ingen gruppe-gab i optegnelsen: filmen kan ikke sige noget om at sidde i ly eller koere tempo.
  assert.equal(d.steps[0].mark, "not_seen");
  assert.equal(d.steps[1].mark, "not_seen");
  assert.deepEqual(d.steps[0].lines, []);
  // Tredje trin blev aldrig naaet: det er en kendsgerning, ikke en fiasko.
  assert.equal(d.steps[2].mark, "not_reached");
  for (const step of d.steps) assert.notEqual(step.mark, "differs");
});

test("uden gemt plan: ingen opdigtet plan, kun hvad optegnelsen viser for dagen", () => {
  const c = byId(planVsActual(input())).get("c")!;
  assert.equal(c.planned, false);
  assert.deepEqual(c.steps, []);
  assert.deepEqual(c.dayLines, []);
});

test("udbrudsforsoeg uden plan: optegnelsen navngiver ham, saa linjen staar", () => {
  const events = [...input().events, { km: 8, type: "breakaway_attempt", params: { rider_ids: ["c"] } }];
  const c = byId(planVsActual(input({ events }))).get("c")!;
  assert.deepEqual(c.dayLines.map((l) => l.key), ["stagePlan.recap.outcome.failed"]);
});

test("ukendte ordrer eller ingen ryttere giver intet", () => {
  assert.deepEqual(planVsActual(input({ orders: null })), []);
  assert.deepEqual(planVsActual(input({ orders: { riders: [], orders: [] }, riderIds: [] })), []);
});

test("uden etapens resultat bruges holdets udtagelse fra ordre-svaret", () => {
  const rows = planVsActual(input({ riderIds: [] }));
  assert.deepEqual(rows.map((r) => r.riderId).sort(), ["a", "b", "c", "d"]);
});

// PR #8173-review: samme krydstjek som Taktik-fanens opsummering (kontakten stage_plan_dropped_front_7635).
// Giro-moenstret fra StagePlanModel.test.ts: et nedkoerselsangreb faa sekunder foran, "a" i feltet hele dagen.
const DESCENT_INPUT = (crossCheck?: boolean) => input({
  orders: {
    riders: [{ rider_id: "a", race_role: "captain" }],
    orders: [{ stage_number: 2, riders: [{ rider_id: "a", plan: [
      { task: "follow_moves" },
      { task: "attack", from: { at: "kom", kom_index: 1 } },
      { task: "ride_for_result", from: { at: "dropped" } },
    ] }] }],
  },
  riderIds: ["a"],
  climbs: null,
  events: [
    { type: "stage_start", km: 0, params: { field_count: 8 } },
    { type: "finale_attack", km: 60, params: { direction: "descent", rider_ids: ["x", "y", "z"], group_id: "breakaway-2000", gained_seconds: 6 } },
    { type: "gap_update", km: 60, params: { group_id: "peloton-0", gap_seconds: 6 } },
    { type: "stage_plan_leg", km: 60, params: { rider_id: "a", leg: 2, task: "ride_for_result", reason: "dropped" } },
    { type: "group_merged", km: 64, params: { group_id: "breakaway-2000", into_group_id: "peloton-0", rider_ids: ["x", "y", "z"] } },
  ],
  rankOf: () => null,
  ...(crossCheck === undefined ? {} : { crossCheck }),
});

test("krydstjekket taendt: filmen har ham i feltet, saa intet 'sat' og intet skjult skift-punkt", () => {
  const a = planVsActual(DESCENT_INPUT(true))[0];
  assert.deepEqual(a.steps.map((s) => s.end?.reason ?? null), [null, null, "finish"]);
  assert.equal(a.steps[1].mark, "not_reached");
  assert.equal(a.steps[2].from, null, "skiftet 'sat af' filmen ikke viser staar ikke som udloeser");
});

test("krydstjekket slukket: som Taktik-fanen i dag (ogsaa naar filmen modsiger det)", () => {
  for (const off of [undefined, false]) {
    const a = planVsActual(DESCENT_INPUT(off))[0];
    assert.deepEqual(a.steps.map((s) => s.end?.reason ?? null), ["dropped", null, "finish"]);
    assert.deepEqual(a.steps[2].from, { at: "dropped" });
  }
});

test("en kaede med en ukendt opgave er ingen plan", () => {
  assert.equal(legsFromRaw([{ task: "breakaway" }, { task: "teleport" }]), null);
  assert.equal(legsFromRaw([]), null);
  assert.equal(legsFromRaw(null), null);
  assert.deepEqual(legsFromRaw([{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }]), [
    { task: "stay_sheltered" },
    { task: "attack", from: { at: "final_km" } },
  ]);
});
