import test from "node:test";
import assert from "node:assert/strict";

import { trackedTick, getCronInFlight, awaitCronsIdle } from "./cron.js";

test("trackedTick — incrementerer in-flight under tick og decrementerer efter", async () => {
  let observedInFlight = 0;
  const wrapped = trackedTick("test-label", async () => {
    observedInFlight = getCronInFlight();
  });
  assert.equal(getCronInFlight(), 0);
  await wrapped();
  assert.equal(observedInFlight, 1, "in-flight skal være 1 under tick");
  assert.equal(getCronInFlight(), 0, "in-flight skal være 0 efter tick");
});

test("trackedTick — kaster fejl swallowes (cron må aldrig vælte processen)", async () => {
  const wrapped = trackedTick("throwing-tick", async () => {
    throw new Error("simuleret cron-fejl");
  }, { captureException: () => {} });
  await wrapped();
  assert.equal(getCronInFlight(), 0, "in-flight skal være 0 selv ved fejl");
});

test("trackedTick — sender Sentry-event med cron-label-tag ved fejl", async () => {
  const captured = [];
  const wrapped = trackedTick("season-auto-transition", async () => {
    throw new Error("DB connection lost");
  }, { captureException: (err, ctx) => { captured.push({ err, ctx }); } });
  await wrapped();
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /DB connection lost/);
  assert.deepEqual(captured[0].ctx.tags, { cron: "season-auto-transition" });
});

test("awaitCronsIdle — returnerer true når ingen ticks er in-flight", async () => {
  const idle = await awaitCronsIdle(100);
  assert.equal(idle, true);
});

test("awaitCronsIdle — venter til in-flight når 0", async () => {
  let resolveTick;
  const tickPromise = new Promise((resolve) => { resolveTick = resolve; });
  const wrapped = trackedTick("long-tick", async () => { await tickPromise; });

  const tickRunning = wrapped();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(getCronInFlight(), 1);

  const idlePromise = awaitCronsIdle(5_000);
  resolveTick();
  await tickRunning;
  const idle = await idlePromise;

  assert.equal(idle, true);
  assert.equal(getCronInFlight(), 0);
});

test("awaitCronsIdle — returnerer false ved timeout hvis tick stadig kører", async () => {
  let resolveTick;
  const tickPromise = new Promise((resolve) => { resolveTick = resolve; });
  const wrapped = trackedTick("stuck-tick", async () => { await tickPromise; });

  const tickRunning = wrapped();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const idle = await awaitCronsIdle(150);
  assert.equal(idle, false, "skal time ud når tick stadig kører");

  resolveTick();
  await tickRunning;
});
