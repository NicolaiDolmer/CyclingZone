import test from "node:test";
import assert from "node:assert/strict";
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
import { formatCopenhagenDateTime } from "./copenhagenTime.js";
import { nextValueUpdateAt, nextAcademyIntakeAt, buildNextScheduledUpdates } from "./nextScheduledUpdates.js";

const hh = String(SUNDAY_VALUE_FROM_HOUR).padStart(2, "0");
const fmt = (d) => formatCopenhagenDateTime(d);

test("onsdag: begge peger paa kommende soendag", () => {
  const now = new Date("2026-10-21T10:00:00Z"); // onsdag
  assert.equal(fmt(nextValueUpdateAt(now)), `2026-10-25 ${hh}:00`);
  assert.equal(fmt(nextAcademyIntakeAt(now)), "2026-10-25 00:00");
});

test("soendag foer vaerdi-timen: vaerdi i dag, intake naeste uge", () => {
  const now = new Date("2026-11-01T08:00:00Z"); // soendag 09:00 dansk
  assert.equal(fmt(nextValueUpdateAt(now)), `2026-11-01 ${hh}:00`);
  assert.equal(fmt(nextAcademyIntakeAt(now)), "2026-11-08 00:00");
});

test("soendag efter vaerdi-timen: begge naeste uge", () => {
  const now = new Date("2026-11-01T22:00:00Z");
  assert.equal(fmt(nextValueUpdateAt(now)), `2026-11-08 ${hh}:00`);
});

test("natten til soendag dansk tid (stadig loerdag i UTC): intake naeste uge", () => {
  const now = new Date("2026-10-24T22:30:00Z"); // 22:30Z = soendag 00:30 dansk
  assert.equal(fmt(nextAcademyIntakeAt(now)), "2026-11-01 00:00");
});

test("intake udelades naar akademi-intaget ikke er planlagt", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  assert.equal(buildNextScheduledUpdates({ now }).academy_intake_at, null);
  assert.ok(buildNextScheduledUpdates({ now, academyIntakeScheduled: true }).academy_intake_at);
});
