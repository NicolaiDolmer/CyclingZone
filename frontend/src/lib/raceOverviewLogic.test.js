// #4613 — Overblik-fanens rene logik. Ingen React, ingen I/O.

import test from "node:test";
import assert from "node:assert/strict";
import {
  stageHasIntention,
  openStageDecisions,
  beforeFlagChecklist,
  standingsWithMine,
} from "./raceOverviewLogic.js";

const OVERRIDES = [
  { stage_number: 1, rider_id: "a", effort: "all_out" },
  // 'normal' ER rollens standard — den tæller ikke som et valg.
  { stage_number: 2, rider_id: "b", effort: "normal" },
];

test("stageHasIntention: kun en afvigelse fra rollens standard tæller", () => {
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 1 }), true);
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 2 }), false);
  assert.equal(stageHasIntention({ overrides: OVERRIDES, stageNumber: 3 }), false);
  assert.equal(stageHasIntention({ overrides: undefined, stageNumber: 1 }), false);
});

test("openStageDecisions: kun etaper der stadig kan sættes", () => {
  assert.deepEqual(
    openStageDecisions({ overrides: OVERRIDES, stageCount: 4, stagesCompleted: 2 }),
    [{ stageNumber: 3, hasIntention: false }, { stageNumber: 4, hasIntention: false }],
  );
  assert.deepEqual(
    openStageDecisions({ overrides: OVERRIDES, stageCount: 2, stagesCompleted: 2 }),
    [],
    "alt kørt → intet tilbage at beslutte",
  );
  assert.deepEqual(
    openStageDecisions({ overrides: OVERRIDES, stageCount: 1, stagesCompleted: 0 })[0],
    { stageNumber: 1, hasIntention: true },
  );
});

test("beforeFlagChecklist: udtagelse, roller, etape 1 og resten af etaperne", () => {
  const riders = [
    { rider_id: "a", race_role: "captain" },
    { rider_id: "b", race_role: "sprint_captain" },
    { rider_id: "c", race_role: "helper" },
  ];
  const list = beforeFlagChecklist({ riders, overrides: OVERRIDES, stageCount: 5 });
  assert.deepEqual(list.map((i) => i.key), ["teamPicked", "rolesSet", "firstStage", "laterStages"]);
  assert.equal(list[0].done, true);
  assert.equal(list[0].params.count, 3);
  assert.equal(list[1].done, true, "kaptajn sat");
  assert.deepEqual(list[1].params.roles, ["captain", "sprint_captain"]);
  assert.equal(list[2].done, true, "etape 1 har en intention");
  assert.deepEqual(list[3].params, { from: 2, to: 5 });
});

test("beforeFlagChecklist: uden kaptajn er rollerne ikke sat, og et endagsløb har ingen 'resten af etaperne'", () => {
  const list = beforeFlagChecklist({
    riders: [{ rider_id: "c", race_role: "helper" }],
    overrides: [],
    stageCount: 1,
  });
  assert.deepEqual(list.map((i) => i.key), ["teamPicked", "rolesSet", "firstStage"]);
  assert.equal(list[1].done, false);
  assert.equal(list[2].done, false);
});

test("beforeFlagChecklist: ingen udtagelse endnu → intet er gjort", () => {
  const list = beforeFlagChecklist({ riders: [], overrides: [], stageCount: 3 });
  assert.equal(list[0].done, false);
  assert.equal(list[0].params.count, 0);
});

const ROWS = [
  { id: "r1", rank: 1, rider_id: "x1", team_id: "t-other" },
  { id: "r2", rank: 2, rider_id: "x2", team_id: "t-mine" },
  { id: "r3", rank: 3, rider_id: "x3", team_id: "t-other" },
  { id: "r4", rank: 24, rider_id: "x4", team_id: "t-mine" },
];

test("standingsWithMine: top N + dine egne, uden dubletter", () => {
  const out = standingsWithMine({ rows: ROWS, myTeamId: "t-mine", top: 3 });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r2", "r3", "r4"],
    "r2 er allerede i toppen og må ikke gentages, r4 hentes ind nedefra");
});

test("standingsWithMine: uden eget hold er det bare toppen", () => {
  assert.deepEqual(
    standingsWithMine({ rows: ROWS, myTeamId: null, top: 2 }).map((r) => r.id),
    ["r1", "r2"],
  );
});

test("standingsWithMine: sorterer på rank, uanset rækkefølgen ind", () => {
  const shuffled = [ROWS[3], ROWS[1], ROWS[0], ROWS[2]];
  assert.deepEqual(
    standingsWithMine({ rows: shuffled, myTeamId: null, top: 4 }).map((r) => r.rank),
    [1, 2, 3, 24],
  );
});
