import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2288 D — "Næste træk" udvides med 3 nye items (squad selection / training /
// board plan), prioriteret ØVERST (mest presserende: deadline-følsom
// holdudtagelse → dagligt trænings-vindue → langsigtet bestyrelsesplan uden
// deadline). Source-scan-mønster (samme som Onboarding.noEmoji.test.js) —
// ingen jsdom-harness i dette repo for komponent-render-tests.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NextActionsCard.jsx"), "utf8");

test("NextActionsCard accepterer de 3 nye #2288 D-props", () => {
  assert.match(source, /squadSelectionMissingRace\s*=\s*null/);
  assert.match(source, /notTrainedToday\s*=\s*false/);
  assert.match(source, /boardPlanMissing\s*=\s*false/);
});

test("NextActionsCard: squadSelection-item linker til #selection-anchoret (#2288 F)", () => {
  assert.match(source, /`\/races\/\$\{squadSelectionMissingRace\.id\}#selection`/);
});

test("NextActionsCard: de 3 nye items pushes FØR de eksisterende transfer/swap/loan/auction-items (mest presserende øverst)", () => {
  const squadIdx = source.indexOf('key: "squadSelection"');
  const trainingIdx = source.indexOf('key: "training"');
  const boardIdx = source.indexOf('key: "boardPlan"');
  const transfersIdx = source.indexOf('key: "transfers"');
  assert.ok(squadIdx !== -1 && trainingIdx !== -1 && boardIdx !== -1 && transfersIdx !== -1);
  assert.ok(squadIdx < trainingIdx, "squadSelection skal komme før training");
  assert.ok(trainingIdx < boardIdx, "training skal komme før boardPlan");
  assert.ok(boardIdx < transfersIdx, "de 3 nye items skal komme før de eksisterende transfer-items");
});
