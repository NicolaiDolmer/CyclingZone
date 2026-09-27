// #4629 — preview-mockens katalog er en KOPI (preview kan ikke importere
// backend-kode). Denne test holder kopien aerlig: retter nogen kataloget her
// uden at rette preview'et (eller omvendt), fejler den.
import test from "node:test";
import assert from "node:assert/strict";

import { trainingProgramCatalog } from "./trainingPrograms.js";
import { PREVIEW_TRAINING_PROGRAMS } from "../../frontend/src/preview/trainingProgramsMock.js";

test("preview-katalogets kopi er identisk med backend-kataloget", () => {
  assert.deepEqual(PREVIEW_TRAINING_PROGRAMS, trainingProgramCatalog());
});
