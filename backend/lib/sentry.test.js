import test from "node:test";
import assert from "node:assert/strict";

import { monitorCron, captureCheckIn, toSentryError } from "./sentry.js";

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

// ── toSentryError (#2389 A3): normalisér non-Errors før capture ─────────────────

test("toSentryError — ægte Error passerer uændret igennem", () => {
  const original = new Error("boom");
  assert.equal(toSentryError(original), original);
});

test("toSentryError — Supabase plain-object bliver Error med besked + code, uden stack", () => {
  const err = toSentryError({ message: "duplicate key value", code: "23505", details: "Key (id)=..." });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "duplicate key value");
  assert.equal(err.code, "23505");
  assert.equal(err.details, "Key (id)=...");
  assert.equal(err.stack, "", "stack strippes så Sentry grupperer på besked, ikke wrap-site");
});

test("toSentryError — string og objekt uden message får brugbar titel", () => {
  assert.equal(toSentryError("noget gik galt").message, "noget gik galt");
  assert.equal(toSentryError({ status: 500 }).message, '{"status":500}');
  assert.equal(toSentryError(null).message, "Unknown error (non-Error captured)");
});

test("toSentryError — Cloudflare HTML-fejlside normaliseres til én læsbar linje", () => {
  const html = "<!DOCTYPE html><html><title>supabase.co | 522: Connection timed out</title></html>";
  assert.equal(toSentryError({ message: html }).message, "Supabase unavailable (522 Connection timed out)");
});
