// #6350: a split is measured between the riders who rode together at the entry,
// the incident names the solo group it formed, and nothing moves but the place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annotateExactPlaces, type ExactPlaceContext } from "./exactPlace.ts";
import { GOLDEN_REVISIONS, placesGoldenDigests } from "./testUtils/placesGolden6350.ts";
import type { TimelineEvent } from "./types.ts";

// Two lines at the entry: a break two minutes ahead, and the field. The field
// catches the break inside the segment and then loses its tail on the climb.
function ctx(over: Partial<ExactPlaceContext> = {}): ExactPlaceContext {
  return {
    fromKm: 100,
    toKm: 110,
    entryTime: new Map([["break1", 880], ["lead", 1000], ["mid", 1000], ["tail", 1000]]),
    exitTime: new Map([["break1", 2000], ["lead", 2000], ["mid", 2000], ["tail", 2100]]),
    entryGroups: new Map([["breakaway-0", ["break1"]], ["peloton-0", ["lead", "mid", "tail"]]]),
    exitGroups: new Map([["peloton-0", ["break1", "lead", "mid"]], ["gruppetto-1", ["tail"]]]),
    visibleGapSeconds: 2,
    ...over,
  };
}

const split = (riderIds: string[], groupId = "gruppetto-1"): TimelineEvent => ({
  km: 110, type: "peloton_splits", params: { group_id: groupId, source_group_id: "peloton-0", rider_ids: riderIds },
});

test("#6350: riders the source swallowed inside the segment do not move the split to the checkpoint", () => {
  const [event] = annotateExactPlaces([split(["tail"])], ctx());
  assert.equal(event.params.exact_km, 100.2);
  assert.equal(event.params.exact_time, 1022);
  assert.equal(event.km, 110, "the ordering key stays");
});

test("#6350: a dropped group that also holds a rider caught from ahead is placed by those who rode in the source", () => {
  const events = annotateExactPlaces([split(["tail", "break1"])], ctx({
    exitTime: new Map([["break1", 2100], ["lead", 2000], ["mid", 2000], ["tail", 2100]]),
    exitGroups: new Map([["peloton-0", ["lead", "mid"]], ["gruppetto-1", ["tail", "break1"]]]),
  }));
  assert.equal(events[0].params.exact_km, 100.2);
  assert.equal(events[0].params.exact_time, 1022);
});

test("#6350: a source that is gone at the exit is still the line the split left", () => {
  const events = annotateExactPlaces([split(["tail"])], ctx({
    exitGroups: new Map([["finale-winner-0", ["lead", "mid", "break1"]], ["gruppetto-1", ["tail"]]]),
  }));
  assert.equal(events[0].params.exact_km, 100.2);
});

test("#6350: lines that really were apart at the entry keep the checkpoint", () => {
  const events = annotateExactPlaces([split(["tail"])], ctx({
    entryTime: new Map([["lead", 1000], ["mid", 1000], ["tail", 1050]]),
  }));
  assert.equal(events[0].params.exact_km, 110);
});

test("#6350: an incident names the solo group it formed; an abandon and a protected rider do not", () => {
  const incident = (riderId: string, outcome: string): TimelineEvent => ({ km: 104, type: "incident", params: { rider_id: riderId, kind: "crash", outcome, time_loss_seconds: 40 } });
  const events = annotateExactPlaces([incident("tail", "time_loss"), incident("mid", "abandoned"), incident("lead", "protected_three_km_rule")], ctx({
    exitGroups: new Map([["peloton-0", ["lead"]], ["solo-m10-3-0", ["tail"]], ["solo-m10-3-1", ["mid"]]]),
  }));
  assert.deepEqual(events.map((e) => e.params.group_id), ["solo-m10-3-0", undefined, undefined]);
});

test("#6350: against the frozen merge-base, every time, rank, group and timeline event stands; only places moved", () => {
  const baseline = JSON.parse(readFileSync(new URL("./test-data/placesGolden6350.json", import.meta.url), "utf8")) as ReturnType<typeof placesGoldenDigests>;
  assert.deepEqual(Object.keys(baseline), [...GOLDEN_REVISIONS]);
  assert.deepEqual(placesGoldenDigests(), baseline);
});
