import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_CALENDAR_FLAG_KEY, isAutoCalendarEnabled } from "./autoCalendarFlag.js";

test("AUTO_CALENDAR_FLAG_KEY = app_config-nøglen", () => {
  assert.equal(AUTO_CALENDAR_FLAG_KEY, "auto_calendar_enabled");
});

test("isAutoCalendarEnabled: fail-safe false ved fejl/fravær", async () => {
  assert.equal(await isAutoCalendarEnabled(null), false);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await isAutoCalendarEnabled(errClient), false);
  const absentClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  assert.equal(await isAutoCalendarEnabled(absentClient), false, "fraværende row → off (forever-kalender kører ikke uden eksplicit opt-in)");
});

test("isAutoCalendarEnabled: on → true", async () => {
  const onClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: true }, error: null }) }) }) }) };
  assert.equal(await isAutoCalendarEnabled(onClient), true);
  const onStrClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "on" }, error: null }) }) }) }) };
  assert.equal(await isAutoCalendarEnabled(onStrClient), true);
});

test("isAutoCalendarEnabled: beta-stage kun for beta-testere", async () => {
  const betaClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await isAutoCalendarEnabled(betaClient, { isBetaTester: true }), true);
  assert.equal(await isAutoCalendarEnabled(betaClient, { isBetaTester: false }), false);
  assert.equal(await isAutoCalendarEnabled(betaClient), false);
});
