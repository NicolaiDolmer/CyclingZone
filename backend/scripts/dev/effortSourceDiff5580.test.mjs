// #5580: read-only rapporten over de to effort-kilder. Kun syntetiske id'er.
import { test } from "node:test";
import assert from "node:assert/strict";

import { diffEffortSources, parseArgs } from "./effortSourceDiff5580.mjs";

test("#5580 diffEffortSources: taeller enighed, uenighed og raekker kun i den ene kilde", () => {
  const result = diffEffortSources({
    stageRoleRows: [
      { race_id: "race-a", stage_number: 1, rider_id: "r1", effort: "save" },
      { race_id: "race-a", stage_number: 1, rider_id: "r2", effort: "normal" },
      { race_id: "race-a", stage_number: 2, rider_id: "r1", effort: "protect" },
      { race_id: "race-a", stage_number: 1, rider_id: "r5", effort: null },
    ],
    teamOrderRows: [
      { race_id: "race-a", stage_number: 1, riders: [{ rider_id: "r1", effort: "all_out" }, { rider_id: "r2", effort: "normal" }, { rider_id: "r3", effort: "save" }, { rider_id: "r4", effort: "bogus" }] },
    ],
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.written, 0);
  assert.equal(result.bothSources, 2);
  assert.equal(result.disagree, 1);
  assert.equal(result.onlyStageRoles, 2, "etape 2 + r5 har ingen ordre-effort");
  assert.equal(result.onlyOrders, 1, "r3; r4's ukendte effort taeller ikke");
  assert.deepEqual(result.transitions, { "save->all_out": 1 });
  assert.deepEqual(result.disagreements, [
    { race_id: "race-a", stage_number: 1, rider_id: "r1", stage_roles: "save", order: "all_out" },
  ]);
});

test("#5580 diffEffortSources: tomme kilder giver nul overalt", () => {
  const result = diffEffortSources({});
  assert.equal(result.bothSources, 0);
  assert.equal(result.disagree, 0);
  assert.deepEqual(result.transitions, {});
});

test("#5580 parseArgs: kun --out; alt andet afvises (scriptet er read-only)", () => {
  assert.deepEqual(parseArgs(["--out=x.json"]), { out: "x.json" });
  assert.throws(() => parseArgs(["--apply"]), /read-only/);
});
