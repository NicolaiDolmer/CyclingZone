import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitTimes, buildOwnTimeLoss, effortByRiderForStage, effectiveEffortByRider, formatSplitGap, hasGroupGaps,
} from "./stageSplitTimes.ts";

// Formen er kopieret fra en ægte v4-etape (kuperet, 165 km): udbrud, en stor
// selektion paa foerste stigning, et styrt med solo-gruppe, og en anden
// selektion hvor en del af de afhaengte kommer tilbage.
const EVENTS = [
  { km: 0, type: "stage_start", params: { field_count: 10, profile_type: "hilly", distance_km: 165 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2"] } },
  { km: 33.5, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 283 } },
  { km: 43.41, type: "incident", params: { kind: "crash", outcome: "time_loss", rider_id: "own3", severity: "light", injury_days: null, helper_assist: false, time_loss_seconds: 14.19 } },
  { km: 50.25, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 387.64 } },
  { km: 50.25, type: "gap_update", params: { group_id: "solo-m10-2-0", gap_seconds: 401.83 } },
  { km: 72, type: "peloton_splits", params: { cause: "mixed", group_id: "gruppetto-4001", source_group_id: "peloton-0", rider_ids: ["own1", "p1", "p2"], gap_seconds: 46.98 } },
  { km: 72, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 407.75 } },
  { km: 72, type: "gap_update", params: { group_id: "solo-m10-2-0", gap_seconds: 410.09 } },
  { km: 72, type: "gap_update", params: { group_id: "gruppetto-4001", gap_seconds: 454.73 } },
  { km: 72, type: "kom_passage", params: { name: "Mont Saint-Roch", category: "3", top: [] } },
  { km: 77.8, type: "group_merged", params: { group_id: "solo-m10-2-0", into_group_id: "peloton-0", rider_ids: ["own3"] } },
  { km: 102, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "chase-7002", source_group_id: "gruppetto-4001", rider_ids: ["own1", "p1"], gap_seconds: 49 } },
  { km: 102, type: "peloton_splits", params: { cause: "wprime_depleted", group_id: "solo-7003", source_group_id: "peloton-0", rider_ids: ["own2"], gap_seconds: 30 } },
  { km: 102, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 361.22 } },
  { km: 102, type: "gap_update", params: { group_id: "solo-7003", gap_seconds: 391 } },
  { km: 102, type: "gap_update", params: { group_id: "gruppetto-4001", gap_seconds: 684.18 } },
  { km: 102, type: "gap_update", params: { group_id: "chase-7002", gap_seconds: 733.82 } },
  { km: 102, type: "kom_passage", params: { name: "Col de la Colombière", category: "2", top: [] } },
  { km: 107, type: "intermediate_sprint", params: { name: "Intermediate Sprint", top: [] } },
  { km: 109.1, type: "group_merged", params: { group_id: "chase-7002", into_group_id: "gruppetto-4001", rider_ids: ["own1", "p1"] } },
  { km: 165, type: "finish", params: { win_type: "solo_win" } },
];

const OWN = ["own1", "own2", "own3", "own4"];

test("hasGroupGaps: v4 ja, v3 (gap_update uden group_id) nej", () => {
  assert.equal(hasGroupGaps(EVENTS), true);
  assert.equal(hasGroupGaps([{ km: 10, type: "gap_update", params: { gap_seconds: 60 } }]), false);
  assert.equal(hasGroupGaps(null), false);
});

test("buildSplitTimes: v3-tidslinje giver ingen mellemtider", () => {
  const v3 = [
    { km: 0, type: "stage_start", params: { field_count: 100 } },
    { km: 40, type: "gap_update", params: { gap_seconds: 120 } },
    { km: 40, type: "kom_passage", params: { name: "Col", category: "2", top: [] } },
  ];
  assert.deepEqual(buildSplitTimes(v3), []);
});

test("buildSplitTimes: gab, antal og egne ryttere ved hver stigning og mellemsprint", () => {
  const points = buildSplitTimes(EVENTS, { ownRiderIds: OWN });
  assert.deepEqual(points.map((p) => [p.km, p.kind, p.name]), [
    [72, "kom", "Mont Saint-Roch"],
    [102, "kom", "Col de la Colombière"],
    [107, "sprint", "Intermediate Sprint"],
  ]);

  const [first] = points;
  assert.equal(first.category, "3");
  assert.deepEqual(first.groups.map((g) => [g.groupId, g.kind, g.riderCount, g.gapSeconds]), [
    ["breakaway-0", "breakaway", 2, 0],
    ["peloton-0", "peloton", 4, 408],
    ["solo-m10-2-0", "solo", 1, 410],
    ["gruppetto-4001", "group", 3, 455],
  ]);
  // own2 og own4 er implicit i feltet; own3 sidder alene efter styrtet.
  assert.deepEqual(first.groups[1].ownRiderIds.sort(), ["own2", "own4"]);
  assert.equal(first.groups[2].soloRiderId, "own3");
  assert.deepEqual(first.groups[3].ownRiderIds, ["own1"]);

  // Mellemsprinten ved km 107 bruger de seneste tal motoren havde (km 102).
  const sprint = points[2];
  assert.deepEqual(sprint.groups.map((g) => g.groupId), points[1].groups.map((g) => g.groupId));
});

test("buildSplitTimes: 'feltet' er den største gruppe, ikke motorens startgruppe", () => {
  const events = [
    { km: 0, type: "stage_start", params: { field_count: 20, distance_km: 100 } },
    { km: 40, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "chase-1", source_group_id: "peloton-0", rider_ids: Array.from({ length: 15 }, (_, i) => `r${i}`), gap_seconds: 60 } },
    { km: 40, type: "gap_update", params: { group_id: "chase-1", gap_seconds: 60 } },
    { km: 40, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 0 } },
    { km: 40, type: "kom_passage", params: { name: "Col", category: "2", top: [] } },
  ];
  const [point] = buildSplitTimes(events, { ownRiderIds: [] });
  const kinds = Object.fromEntries(point.groups.map((g) => [g.groupId, g.kind]));
  assert.equal(kinds["chase-1"], "peloton");
  assert.equal(kinds["peloton-0"], "group");
});

test("buildSplitTimes: viser de forreste grupper + grupper med egne ryttere", () => {
  const [, colombiere] = buildSplitTimes(EVENTS, { ownRiderIds: ["own1"], maxGroups: 2 });
  assert.deepEqual(colombiere.groups.map((g) => g.groupId), ["breakaway-0", "peloton-0", "chase-7002"]);
  assert.equal(colombiere.hiddenCount, 2);
});

test("buildOwnTimeLoss: foerste fald der staar ved magt + uheld, med dokumenteret grund", () => {
  const efforts = new Map([["own2", "save"]]);
  const loss = buildOwnTimeLoss(EVENTS, { ownRiderIds: OWN, effortByRider: efforts });
  assert.deepEqual(loss.map((l) => [l.type, l.km, l.riderId]), [
    ["event", 43.41, "own3"],
    ["drop", 72, "own1"],
    ["drop", 102, "own2"],
  ]);
  const own1 = loss[1];
  assert.equal(own1.type === "drop" && own1.from, "peloton");
  assert.equal(own1.type === "drop" && own1.reason, "mixed");
  assert.equal(own1.type === "drop" && own1.climbName, "Mont Saint-Roch");
  assert.equal(own1.type === "drop" && own1.order, null);
  const own2 = loss[2];
  assert.equal(own2.type === "drop" && own2.reason, "wprime_depleted");
  assert.equal(own2.type === "drop" && own2.order, "save");
  assert.equal(own2.type === "drop" && own2.climbName, "Col de la Colombière");
});

test("buildOwnTimeLoss: et fald hvor rytteren kom tilbage til sin gruppe tæller ikke", () => {
  // own1 faldt fra gruppetto-4001 ved km 102 men var tilbage ved km 109.1:
  // kun faldet fra feltet ved km 72 staar tilbage.
  const loss = buildOwnTimeLoss(EVENTS, { ownRiderIds: ["own1"] });
  assert.deepEqual(loss.map((l) => l.km), [72]);
});

test("buildOwnTimeLoss: egne ryttere der faldt af samme sted af samme grund bliver én linje", () => {
  const events = [
    { km: 0, type: "stage_start", params: { field_count: 6 } },
    { km: 50, type: "peloton_splits", params: { group_id: "chase-1", source_group_id: "peloton-0", rider_ids: ["a", "x", "b"], cause: "climb_deficit" } },
    { km: 50, type: "gap_update", params: { group_id: "chase-1", gap_seconds: 40 } },
    { km: 50, type: "kom_passage", params: { name: "Col", category: "1", top: [] } },
  ];
  const loss = buildOwnTimeLoss(events, { ownRiderIds: ["a", "b"], effortByRider: new Map([["b", "save"]]) });
  // b havde en anden ordre end a, saa de staar paa hver sin linje.
  assert.deepEqual(loss.map((l) => l.type === "drop" && l.riderIds), [["a"], ["b"]]);
  const same = buildOwnTimeLoss(events, { ownRiderIds: ["a", "b"] });
  assert.deepEqual(same.map((l) => l.type === "drop" && l.riderIds), [["a", "b"]]);
});

test("buildOwnTimeLoss: ukendt aarsag opfindes ikke", () => {
  const events = [
    { km: 0, type: "stage_start", params: { field_count: 3 } },
    { km: 40, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "peloton-0", rider_ids: ["x"] } },
    { km: 40, type: "gap_update", params: { group_id: "solo-1", gap_seconds: 20 } },
  ];
  const [entry] = buildOwnTimeLoss(events, { ownRiderIds: ["x"] });
  assert.equal(entry.type === "drop" && entry.reason, "unknown");
  assert.equal(entry.type === "drop" && entry.climbName, null);
});

test("buildOwnTimeLoss: brosten bærer sektorens navn", () => {
  const events = [
    { km: 0, type: "stage_start", params: { field_count: 3 } },
    { km: 80, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "peloton-0", rider_ids: ["x"], cause: "cobbles_sector", sector_name: "Arenberg" } },
    { km: 80, type: "gap_update", params: { group_id: "solo-1", gap_seconds: 20 } },
  ];
  const [entry] = buildOwnTimeLoss(events, { ownRiderIds: ["x"] });
  assert.equal(entry.type === "drop" && entry.reason, "cobbles_sector");
  assert.equal(entry.type === "drop" && entry.sectorName, "Arenberg");
});

test("buildOwnTimeLoss: ingen egne ryttere eller v3 → tom", () => {
  assert.deepEqual(buildOwnTimeLoss(EVENTS, { ownRiderIds: [] }), []);
  assert.deepEqual(buildOwnTimeLoss([{ km: 1, type: "gap_update", params: { gap_seconds: 5 } }], { ownRiderIds: ["x"] }), []);
});

test("effortByRiderForStage: kun overrides for etapen", () => {
  const roles = { overrides: [
    { stage_number: 2, rider_id: "a", effort: "save" },
    { stage_number: 3, rider_id: "a", effort: "grupetto" },
    { stage_number: 2, rider_id: "b", effort: "normal" },
  ] };
  assert.deepEqual([...effortByRiderForStage(roles, 2)], [["a", "save"], ["b", "normal"]]);
  assert.equal(effortByRiderForStage(null, 2).size, 0);
  assert.equal(effortByRiderForStage(false, 2).size, 0);
});

test("effectiveEffortByRider: v4-ordren vinder over stage-roles, v3 bruger kun stage-roles", () => {
  const roles = { overrides: [{ stage_number: 2, rider_id: "a", effort: "normal" }, { stage_number: 2, rider_id: "b", effort: "save" }] };
  const orders = { orders: [
    { stage_number: 2, riders: [{ rider_id: "a", effort: "save" }, { rider_id: "c", effort: "bogus" }] },
    { stage_number: 3, riders: [{ rider_id: "b", effort: "grupetto" }] },
  ] };
  assert.deepEqual([...effectiveEffortByRider(roles, orders, 2, { v4: true })], [["a", "save"], ["b", "save"]]);
  assert.deepEqual([...effectiveEffortByRider(roles, orders, 2, { v4: false })], [["a", "normal"], ["b", "save"]]);
  assert.equal(effectiveEffortByRider(null, null, 2, { v4: true }).size, 0);
});

test("formatSplitGap", () => {
  assert.equal(formatSplitGap(0), null);
  assert.equal(formatSplitGap(65), "+1:05");
  assert.equal(formatSplitGap(454.73), "+7:35");
  assert.equal(formatSplitGap(3723), "+1:02:03");
});
