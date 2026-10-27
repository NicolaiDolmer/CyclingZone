// #7258: afgjorde et morgenudbrud klassementet? Syntetiske fixtures (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gcStageTimes, gcWinnerBreakFacts } from "./gcFromBreakaway7258.mjs";

const st = (before, after) => gcStageTimes(
  Object.entries(before).map(([rider_id, time]) => ({ rider_id, time })),
  Object.entries(after).map(([rider_id, time]) => ({ rider_id, time })),
);

test("udbruddets gevinst over loebets forspring = afgjort; vandt etapen fra udbrud", () => {
  const rows = [
    { stage: 1, breakawayRiderIds: [] },
    { stage: 2, breakawayRiderIds: ["w", "x"], breakawayWon: true, winnerId: "w" },
    { stage: 3, breakawayRiderIds: [] },
  ];
  const gcTimes = [
    st({}, { w: 100, r: 100, x: 100 }),
    st({ w: 100, r: 100, x: 100 }, { w: 200, r: 500, x: 200 }),
    st({ w: 200, r: 500, x: 200 }, { w: 400, r: 600, x: 450 }),
  ];
  const final = [{ rider_id: "w", time: 400 }, { rider_id: "x", time: 450 }, { rider_id: "r", time: 600 }];
  const f = gcWinnerBreakFacts({ rows, gcTimes, final });
  assert.equal(f.decisive, true, "R er bedste uden for udbruddet; gevinst 300 >= forspring 200");
  assert.equal(f.decisiveStage, 2);
  assert.equal(f.gainSeconds, 300);
  assert.equal(f.wonFromBreak, true);
});

test("et udbrud der blev hentet (ingen gevinst) taeller ikke som afgjort", () => {
  const rows = [{ stage: 1, breakawayRiderIds: ["w"] }, { stage: 2, breakawayRiderIds: [] }];
  const gcTimes = [st({}, { w: 100, r: 100 }), st({ w: 100, r: 100 }, { w: 200, r: 260 })];
  const final = [{ rider_id: "w", time: 200 }, { rider_id: "r", time: 260 }];
  const f = gcWinnerBreakFacts({ rows, gcTimes, final });
  assert.equal(f.decisive, false);
  assert.equal(f.wonFromBreak, false);
});

test("gevinst mindre end forspringet: ikke afgjort af udbruddet", () => {
  const rows = [{ stage: 1, breakawayRiderIds: ["w"] }, { stage: 2, breakawayRiderIds: [] }];
  const gcTimes = [st({}, { w: 100, r: 130 }), st({ w: 100, r: 130 }, { w: 200, r: 300 })];
  const final = [{ rider_id: "w", time: 200 }, { rider_id: "r", time: 300 }];
  assert.equal(gcWinnerBreakFacts({ rows, gcTimes, final }).decisive, false, "gevinst 30 < forspring 100");
});

test("endagsloeb og manglende vinder giver null", () => {
  assert.equal(gcWinnerBreakFacts({ rows: [{ stage: 1 }], gcTimes: [], final: [{ rider_id: "w", time: 1 }] }), null);
  assert.equal(gcWinnerBreakFacts({ rows: [{}, {}], gcTimes: [], final: [] }), null);
});
