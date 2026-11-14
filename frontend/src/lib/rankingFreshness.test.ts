// #7664: "Opdateret kl." maa aldrig vaere forkert eller love for meget.
import test from "node:test";
import assert from "node:assert/strict";
import { updatedAtFromFreshness, formatUpdatedAtTime, startFreshnessProbe } from "./rankingFreshness.ts";

test("#7664 freshness: only a valid time from the new tables gives a line", () => {
  assert.equal(updatedAtFromFreshness({ source: "shadow", current_as_of: "2026-11-13T13:07:00.000Z" }), "2026-11-13T13:07:00.000Z");
  for (const body of [null, undefined, {}, { source: "legacy", current_as_of: null }, { current_as_of: "not a time" }, { current_as_of: 1 }]) {
    assert.equal(updatedAtFromFreshness(body), null, JSON.stringify(body));
  }
});

test("#7664 freshness: the clock is the game's time zone (Europe/Copenhagen), not the browser's", () => {
  // 13:07 UTC is 14:07 in Copenhagen in November (CET), 15:07 in July (CEST).
  assert.equal(formatUpdatedAtTime("2026-11-13T13:07:00.000Z", "en-GB"), "14:07");
  assert.equal(formatUpdatedAtTime("2026-07-13T13:07:00.000Z", "en-GB"), "15:07");
  assert.equal(formatUpdatedAtTime("2026-11-13T13:07:00.000Z", "da"), "14.07");
  assert.equal(formatUpdatedAtTime("nonsense", "da"), "");
});

test("#7664 freshness: the probe gives a time only once its answer has arrived, and never on failure", async () => {
  let answer!: (body: unknown) => void;
  const probe = startFreshnessProbe(() => new Promise((resolve) => { answer = resolve; }));
  await Promise.resolve();
  assert.equal(probe.settled(), null, "no answer yet: no line (the numbers may be older)");
  answer({ current_as_of: "2026-11-13T13:07:00.000Z" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probe.settled(), "2026-11-13T13:07:00.000Z");

  const failing = startFreshnessProbe(async () => { throw new Error("offline"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failing.settled(), null);
  const throwing = startFreshnessProbe(() => { throw new Error("sync"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(throwing.settled(), null);
});
