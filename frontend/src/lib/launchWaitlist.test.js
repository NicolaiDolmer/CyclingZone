import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLaunchForm,
  buildLaunchPayload,
  mapLaunchInsertError,
  isHoneypotTripped,
  INITIAL_STATE,
} from "./launchWaitlist.js";

test("validateLaunchForm requires email", () => {
  const { ok, errors } = validateLaunchForm({ email: "", consent: true });
  assert.equal(ok, false);
  assert.ok(errors.email);
});

test("validateLaunchForm rejects a malformed email", () => {
  const { ok, errors } = validateLaunchForm({ email: "not-an-email", consent: true });
  assert.equal(ok, false);
  assert.ok(errors.email);
});

test("validateLaunchForm requires consent", () => {
  const { ok, errors } = validateLaunchForm({ email: "a@b.dk", consent: false });
  assert.equal(ok, false);
  assert.ok(errors.consent);
});

test("validateLaunchForm passes with a valid email + consent", () => {
  const { ok, errors } = validateLaunchForm({ email: "rider@cyclingzone.org", consent: true });
  assert.equal(ok, true);
  assert.deepEqual(errors, {});
});

test("buildLaunchPayload trims email, nulls empty name, injects utm + iso", () => {
  const payload = buildLaunchPayload(
    { email: "  Rider@Example.com  ", name: "   ", consent: true },
    { source: "reddit", campaign: "tdf26", medium: "social" },
    "2026-06-15T10:00:00.000Z",
  );
  assert.equal(payload.email, "Rider@Example.com");
  assert.equal(payload.name, null);
  assert.equal(payload.source, "reddit");
  assert.equal(payload.utm_campaign, "tdf26");
  assert.equal(payload.utm_medium, "social");
  assert.equal(payload.consent_given_at, "2026-06-15T10:00:00.000Z");
});

test("buildLaunchPayload keeps a name and truncates overly long input", () => {
  const payload = buildLaunchPayload({ email: "a@b.dk", name: "Marco" }, null, "x");
  assert.equal(payload.name, "Marco");
  assert.equal(payload.source, null);
  assert.equal(payload.utm_campaign, null);

  const long = "x".repeat(200);
  const p2 = buildLaunchPayload({ email: "a@b.dk", name: long }, null, "x");
  assert.equal(p2.name.length, 80);
});

test("mapLaunchInsertError treats 23505 as a soft-success duplicate", () => {
  assert.equal(mapLaunchInsertError({ code: "23505" }).kind, "duplicate");
});

test("mapLaunchInsertError classifies RLS (42501)", () => {
  assert.equal(mapLaunchInsertError({ code: "42501" }).kind, "rls");
});

test("mapLaunchInsertError falls back to unknown", () => {
  assert.equal(mapLaunchInsertError({ message: "boom" }).kind, "unknown");
});

test("isHoneypotTripped is true only for a non-empty string", () => {
  assert.equal(isHoneypotTripped(""), false);
  assert.equal(isHoneypotTripped("bot"), true);
  assert.equal(isHoneypotTripped(undefined), false);
});

test("INITIAL_STATE is frozen and empty", () => {
  assert.equal(INITIAL_STATE.email, "");
  assert.equal(INITIAL_STATE.consent, false);
  assert.throws(() => {
    INITIAL_STATE.email = "x";
  });
});
