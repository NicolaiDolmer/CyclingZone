// backend/lib/engine/v4/winType.test.ts
// #5577 (spec M2): sejrstypens klassifikation.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { FINALE_EXTRA_TUNING } from "./tuning.ts";
import { isBunchSizedChaseGroup } from "./finale.ts";
import {
  WIN_TYPE_KEYS,
  classifyRoadWinType,
  isWinType,
  winTypeFromFinaleEvents,
  type RoadWinTypeInput,
} from "./winType.ts";

const BUNCH = {
  bunchMinFieldFraction: FINALE_EXTRA_TUNING.bunchCatchMinFieldFraction,
  bunchMinRiders: FINALE_EXTRA_TUNING.bunchCatchMinRiders,
};

function input(overrides: Partial<RoadWinTypeInput>): RoadWinTypeInput {
  return { poolSize: 1, fieldSize: 150, massFinish: true, escapeOnlyPool: false, ...BUNCH, ...overrides };
}

test("WIN_TYPE_KEYS er praecis de noegler loebsfilmen og fortaellingen har copy til", () => {
  // frontend/src/lib/stageTimelineFilm.js WIN_TYPE_KEY + raceNarrative.js's vindermomenter.
  assert.deepEqual([...WIN_TYPE_KEYS].sort(), ["close_win", "itt_win", "solo_win", "sprint_win", "ttt_win"]);
  assert.equal(isWinType("group_finish"), false, "den gamle pladsholder er ingen sejrstype");
  assert.equal(isWinType(undefined), false);
});

test("classifyRoadWinType: én mand i puljen er altid en solosejr", () => {
  assert.equal(classifyRoadWinType(input({ poolSize: 1 })), "solo_win");
  assert.equal(classifyRoadWinType(input({ poolSize: 1, massFinish: false })), "solo_win");
  assert.equal(classifyRoadWinType(input({ poolSize: 1, escapeOnlyPool: true })), "solo_win", "udbrud der holder hjem med én");
});

test("classifyRoadWinType: feltet samlet paa en massefinale er en massespurt", () => {
  assert.equal(classifyRoadWinType(input({ poolSize: 150 })), "sprint_win");
});

test("classifyRoadWinType: en reduceret gruppe paa en massefinale er en taet finish", () => {
  assert.equal(classifyRoadWinType(input({ poolSize: 4 })), "close_win");
});

test("classifyRoadWinType: et udbrud der kommer samlet hjem er aldrig en massespurt", () => {
  assert.equal(classifyRoadWinType(input({ poolSize: 150, escapeOnlyPool: true })), "close_win");
});

test("classifyRoadWinType: en selektiv finale er aldrig en massespurt, uanset puljens stoerrelse", () => {
  assert.equal(classifyRoadWinType(input({ poolSize: 150, massFinish: false })), "close_win");
});

test("classifyRoadWinType: massespurt-graensen er motorens egen definition af feltet", () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 200 }), fc.integer({ min: 1, max: 200 }), (poolSize, fieldSize) => {
      const bunch = isBunchSizedChaseGroup(poolSize, fieldSize, BUNCH.bunchMinFieldFraction, BUNCH.bunchMinRiders);
      const winType = classifyRoadWinType(input({ poolSize, fieldSize }));
      assert.equal(winType, bunch ? "sprint_win" : "close_win");
    }),
  );
});

test("classifyRoadWinType: resultatet er altid en kendt noegle", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 200 }),
      fc.integer({ min: 0, max: 200 }),
      fc.boolean(),
      fc.boolean(),
      (poolSize, fieldSize, massFinish, escapeOnlyPool) => {
        assert.ok(isWinType(classifyRoadWinType(input({ poolSize, fieldSize, massFinish, escapeOnlyPool }))));
      },
    ),
  );
});

test("winTypeFromFinaleEvents: laeser finalens afgoerelse, ignorerer events uden sejrstype", () => {
  const events = [
    { km: 10, type: "breakaway_formed", params: { group_id: "b" } },
    { km: 150, type: "finale_attack", params: { kind: "placement_gap", group_id: "w", gap_seconds: 3 } },
    { km: 150, type: "finale_attack", params: { kind: "stage_decided", rider_id: "r1", win_type: "solo_win" } },
  ];
  assert.equal(winTypeFromFinaleEvents(events), "solo_win");
  assert.equal(winTypeFromFinaleEvents(events.slice(0, 2)), null);
  assert.equal(winTypeFromFinaleEvents([{ km: 1, type: "x", params: { win_type: "group_finish" } }]), null);
});
