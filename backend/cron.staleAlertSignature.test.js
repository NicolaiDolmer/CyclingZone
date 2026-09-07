import test from "node:test";
import assert from "node:assert/strict";

import { buildStaleAlertSignature } from "./cron.js";

/**
 * Regressionstest for #4974 (CodeRabbit-fund på #4828) — staleSignature skal
 * ændre sig når et hold skifter fra ét stalled blocking_race til et andet,
 * selvom `reason` forbliver "blocking_race_stalled". Før fix: signaturen var
 * kun `teamId:reason`, så skiftet var usynligt for shouldAlertOnChange.
 */

test("buildStaleAlertSignature ændrer sig når raceIds skifter men reason er uændret", () => {
  const before = [
    { teamId: "team-1", reason: "blocking_race_stalled", blockKind: "blocking_race", raceIds: ["race-a"] },
  ];
  const after = [
    { teamId: "team-1", reason: "blocking_race_stalled", blockKind: "blocking_race", raceIds: ["race-b"] },
  ];

  const sigBefore = buildStaleAlertSignature(before);
  const sigAfter = buildStaleAlertSignature(after);

  assert.notEqual(sigBefore, sigAfter, "skift af raceIds med samme reason skal give en ny signatur");
});

test("buildStaleAlertSignature er uafhængig af raceIds' rækkefølge", () => {
  const orderA = [
    { teamId: "team-1", reason: "blocking_race_stalled", blockKind: "blocking_race", raceIds: ["race-a", "race-b"] },
  ];
  const orderB = [
    { teamId: "team-1", reason: "blocking_race_stalled", blockKind: "blocking_race", raceIds: ["race-b", "race-a"] },
  ];

  assert.equal(
    buildStaleAlertSignature(orderA),
    buildStaleAlertSignature(orderB),
    "rækkefølgen af raceIds må ikke i sig selv se ud som en ændring"
  );
});

test("buildStaleAlertSignature håndterer manglende blockKind/raceIds (ikke-blocking_race-årsager)", () => {
  const withoutBlockInfo = [{ teamId: "team-2", reason: "error_exceeds_backstop" }];

  assert.doesNotThrow(() => buildStaleAlertSignature(withoutBlockInfo));
  assert.equal(buildStaleAlertSignature(withoutBlockInfo), buildStaleAlertSignature(withoutBlockInfo));
});

test("buildStaleAlertSignature er uændret når intet har ændret sig", () => {
  const list = [
    { teamId: "team-1", reason: "blocking_race_stalled", blockKind: "blocking_race", raceIds: ["race-a"] },
    { teamId: "team-3", reason: "error_exceeds_backstop", message: "boom" },
  ];

  assert.equal(buildStaleAlertSignature(list), buildStaleAlertSignature(list));
});
