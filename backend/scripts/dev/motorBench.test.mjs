// #6451: motor-testbaenkens argumenter og nedkoerselsmarkering gennem motorens egen rute-adapter.
import test from "node:test";
import assert from "node:assert/strict";
import { descentFinishFor, parseArgs } from "./motorBench.mjs";
import { routeFromStageProfileRow } from "../../lib/engine/v4/adapters/routeAdapter.ts";
import { finishDescentIndexFor, SHARED_TIME_MODEL_V3_TUNING } from "../../lib/engine/v4/mechanics/timeModel.ts";

const engine = { routeFromStageProfileRow, finishDescentIndexFor, tuning: SHARED_TIME_MODEL_V3_TUNING };

test("parseArgs: --previous og --verdict-out", () => {
  const o = parseArgs(["--seeds=3", "--previous=a/bench.json", "--verdict-out=a/verdict.json"]);
  assert.equal(o.seeds, 3);
  assert.equal(o.previous, "a/bench.json");
  assert.equal(o.verdictOut, "a/verdict.json");
  const d = parseArgs([]);
  assert.equal(d.previous, null);
  assert.equal(d.verdictOut, null);
});

test("descentFinishFor: etapeprofil med nedkoersel mod maal i et endagsloeb markeres, etapeloeb ikke", () => {
  const row = {
    stage_number: 1, profile_type: "hilly", finale_type: "descent", distance_km: 190,
    segments: [
      { kind: "flat", from_km: 0, to_km: 150 },
      { kind: "climb", from_km: 150, to_km: 170, gradient_pct: 6 },
      { kind: "descent", from_km: 170, to_km: 190, technicality: 2 },
    ],
  };
  assert.equal(descentFinishFor(engine, row, true), true);
  assert.equal(descentFinishFor(engine, row, false), false);
  assert.equal(descentFinishFor(null, row, true), false, "uden motor-detektion: aldrig markeret");
  const flat = { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", distance_km: 180, segments: [{ kind: "flat", from_km: 0, to_km: 180 }] };
  assert.equal(descentFinishFor(engine, flat, true), false);
});
