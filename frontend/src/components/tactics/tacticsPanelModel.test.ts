// #8297 · det fælles taktikpanels rene regler.
import test from "node:test";
import assert from "node:assert/strict";
import { effortSegments, saveBadge } from "./tacticsPanelModel.ts";

test("indsatsen står let til venstre og hård til højre, uanset rækkefølgen ind", () => {
  assert.deepEqual(effortSegments(["all_out", "normal", "save", "protect", "grupetto"]), ["grupetto", "save", "normal", "protect", "all_out"]);
  // Enkeltstart: kun etapens trin, samme retning.
  assert.deepEqual(effortSegments(["all_out", "save", "normal"]), ["save", "normal", "all_out"]);
});

test("indsatsen viser kun de trin der kommer ind; et ukendt trin står bagest", () => {
  assert.deepEqual(effortSegments(["normal", "future_step", "save"]), ["save", "normal", "future_step"]);
  assert.deepEqual(effortSegments([]), []);
  assert.deepEqual(effortSegments(null), []);
  assert.deepEqual(effortSegments(["normal", "normal"]), ["normal"]);
});

test("bundens mærke: kun et lykket gem er gemt", () => {
  assert.equal(saveBadge({ status: "saved", dirty: false }), "saved");
  assert.equal(saveBadge({ status: "idle", dirty: true }), "unsaved");
  assert.equal(saveBadge({ status: "idle", dirty: false }), "untouched");
  assert.equal(saveBadge({ status: "saving", dirty: true }), "saving");
  for (const status of ["error", "partial", "conflict"] as const) assert.equal(saveBadge({ status, dirty: true }), "problem", status);
});
