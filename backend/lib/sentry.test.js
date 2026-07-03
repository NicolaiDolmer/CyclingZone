import test from "node:test";
import assert from "node:assert/strict";

import { monitorCron, captureCheckIn } from "./sentry.js";

// I test-env er Sentry disabled (ingen SENTRY_DSN) → monitorCron skal være en ren
// passthrough: kør fn, returnér dens resultat, re-throw dens fejl, uden overhead.

test("monitorCron (Sentry disabled) — kører fn og returnerer resultat", async () => {
  let ran = false;
  const wrapped = monitorCron("test-monitor", async () => {
    ran = true;
    return 42;
  }, { schedule: { type: "interval", value: 5, unit: "minute" } });
  const result = await wrapped();
  assert.equal(ran, true);
  assert.equal(result, 42);
});

test("monitorCron (Sentry disabled) — videresender argumenter", async () => {
  const wrapped = monitorCron("test-monitor", async (a, b) => a + b);
  assert.equal(await wrapped(2, 3), 5);
});

test("monitorCron (Sentry disabled) — re-thrower fn's fejl", async () => {
  const wrapped = monitorCron("test-monitor", async () => {
    throw new Error("boom");
  });
  await assert.rejects(() => wrapped(), /boom/);
});

test("captureCheckIn (Sentry disabled) — no-op, returnerer undefined", () => {
  assert.equal(captureCheckIn({ monitorSlug: "x", status: "ok" }), undefined);
});
