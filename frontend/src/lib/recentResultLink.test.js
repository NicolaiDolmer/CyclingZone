// #3373 — binder deep-link-reglen til den PAYLOAD GET /api/dashboard/recent-results
// faktisk sender (backend/routes/api.js: race_id, name, race_type, stages,
// winner{result_type, stage_number, ...}), så reglen ikke kan drive fra kontrakten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recentResultStage } from "./recentResultLink.js";

test("etapevinder på et etapeløb → dyb-link til dén etape", () => {
  assert.equal(
    recentResultStage({
      race_id: "r1", race_type: "stage_race", stages: 4,
      winner: { result_type: "stage", stage_number: 4 },
    }),
    4,
  );
});

test("gc-vinder på et etapeløb → samlet-fanen (ingen ?stage)", () => {
  assert.equal(
    recentResultStage({
      race_id: "r1", race_type: "stage_race", stages: 4,
      winner: { result_type: "gc", stage_number: null },
    }),
    undefined,
  );
});

test("endagsløb → samlet-fanen, også når vinderrækken er en etaperække", () => {
  // Endagsløb gemmer vinderen som gc-række (#1188), men gamle/afvigende importer
  // kan bære result_type="stage". Løbssiden har ingen etape-faner for et
  // endagsløb, så ?stage ville være støj.
  assert.equal(
    recentResultStage({ race_id: "r2", race_type: "single", winner: { result_type: "gc" } }),
    undefined,
  );
  assert.equal(
    recentResultStage({ race_id: "r2", race_type: "single", winner: { result_type: "stage", stage_number: 1 } }),
    undefined,
  );
});

test("manglende/ugyldigt etapenummer → ingen ?stage frem for et forkert et", () => {
  for (const stage_number of [null, undefined, 0, -1, 1.5, "abc"]) {
    assert.equal(
      recentResultStage({ race_id: "r3", race_type: "stage_race", winner: { result_type: "stage", stage_number } }),
      undefined,
      `stage_number=${String(stage_number)}`,
    );
  }
});

test("tom/ufuldstændig payload kaster ikke", () => {
  assert.equal(recentResultStage(undefined), undefined);
  assert.equal(recentResultStage(null), undefined);
  assert.equal(recentResultStage({}), undefined);
  assert.equal(recentResultStage({ race_type: "stage_race" }), undefined);
});
