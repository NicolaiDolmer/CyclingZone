// backend/lib/raceParticipationHistory.s5v2_6748.test.ts
// #6748 punkt 6 (KUN s5_profiles_v2, `separate_formation` paa et nyt udbrud):
// historikken holder den AKTIVE formation adskilt fra den samlede deltagelse.
// Det hentede udbruds ryttere der samler sig i en jagtgruppe og henter det nye
// udbrud, har hentet det; det er ingen sammenlaegning inde i udbruddet. Uden
// maerket (s5_profiles_v1 og aeldre) er projektionen uaendret.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveParticipationHistory, settleBreakawayOutcome, type ParticipationEvent } from "./raceParticipationHistory.ts";

const START = ["a1", "a2", "b1", "b2", "p1", "p2", "p3"];

/** A hentes tidligt, B gaar, A's ryttere kommer fri af feltet og henter B. */
function chaseOfOldEscapees(separate: boolean, viaMerge: boolean): ParticipationEvent[] {
  const catchB: ParticipationEvent[] = viaMerge
    ? [{ km: 120, type: "group_merged", params: { group_id: "chase-9000", into_group_id: "breakaway-1500", rider_ids: ["a1", "a2"] } }]
    : [
      { km: 120, type: "breakaway_caught", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"], chase_group_id: "chase-9000", chase_group_kind: "chase" } },
      { km: 120, type: "group_merged", params: { group_id: "breakaway-1500", into_group_id: "chase-9000", rider_ids: ["b1", "b2"] } },
    ];
  return [
    { km: 0, type: "stage_start", params: {} },
    { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a1", "a2"], drops_reported: true } },
    { km: 18, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a1", "a2"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
    { km: 18, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["a1", "a2"] } },
    { km: 23, type: "breakaway_formed", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"], reformation: true, ...(separate ? { separate_formation: true } : {}) } },
    { km: 80, type: "peloton_splits", params: { source_group_id: "peloton-0", group_id: "chase-9000", rider_ids: ["a1", "a2"] } },
    ...catchB,
    { km: 150, type: "finish", params: {} },
  ];
}

for (const viaMerge of [false, true]) {
  const how = viaMerge ? "sammenlaegning" : "indhentning";
  test(`#6748 punkt 6 (${how}): uden maerket tolkes jagten af gamle udbrydere som en sammenlaegning (v1, uaendret)`, () => {
    const h = deriveParticipationHistory(chaseOfOldEscapees(false, viaMerge), START);
    assert.notEqual(h.riders.get("b1")?.caught, true, "v1's projektion kalder det ikke en indhentning");
    if (!viaMerge) assert.equal(h.regroupCatches.size, 1, "v1 laeser indhentningen som en sammenlaegning");
  });

  test(`#6748 punkt 6 (${how}): med maerket er det nye udbrud hentet af de gamle udbrydere`, () => {
    const h = deriveParticipationHistory(chaseOfOldEscapees(true, viaMerge), START);
    for (const id of ["b1", "b2"]) {
      assert.equal(h.riders.get(id)?.caught, true, `${id} er hentet`);
      assert.equal(h.riders.get(id)?.dropped, false, `${id} er ikke sat af`);
      assert.equal(settleBreakawayOutcome(h.riders.get(id), true), "caught");
    }
    assert.equal(h.regroupCatches.size, 0, "ingen falsk sammenlaegning i filmen");
    assert.equal(h.riders.get("a1")?.caught, true, "det hentede udbrud beholder sit udfald");
    assert.deepEqual([...h.morningRiderIds].sort(), ["a1", "a2", "b1", "b2"], "deltagelsen er stadig begge udbrud");
  });
}

test("#6748 punkt 6: med maerket er et afsat stykke af det NYE udbrud der lukker hullet stadig en sammenlaegning", () => {
  const events: ParticipationEvent[] = [
    { km: 0, type: "stage_start", params: {} },
    { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a1"], drops_reported: true } },
    { km: 18, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a1"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
    { km: 18, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["a1"] } },
    { km: 23, type: "breakaway_formed", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"], reformation: true, separate_formation: true } },
    { km: 60, type: "breakaway_dropped", params: { group_id: "chase-3000", from_group_id: "breakaway-1500", rider_ids: ["b2"] } },
    { km: 70, type: "breakaway_caught", params: { group_id: "breakaway-1500", rider_ids: ["b1"], chase_group_id: "chase-3000", chase_group_kind: "chase" } },
    { km: 70, type: "group_merged", params: { group_id: "chase-3000", into_group_id: "breakaway-1500", rider_ids: ["b2"] } },
    { km: 150, type: "breakaway_survived", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"] } },
    { km: 150, type: "finish", params: {} },
  ];
  const h = deriveParticipationHistory(events, ["a1", "b1", "b2", "p1"]);
  assert.equal(h.regroupCatches.size, 1, "b2 kom tilbage til sit eget udbrud");
  assert.equal(h.riders.get("b1")?.survived, true);
  assert.equal(h.riders.get("b2")?.survived, true);
});
