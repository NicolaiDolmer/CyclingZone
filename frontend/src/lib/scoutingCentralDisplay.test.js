import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, missionCriteriaLabel } from "./scoutingCentralDisplay.js";

test("daysUntil: hele dage frem, aldrig negativ", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  assert.equal(daysUntil("2026-07-13", now), 3);
  assert.equal(daysUntil("2026-07-10", now), 0);
  assert.equal(daysUntil("2026-07-01", now), 0); // fortid — sweep endnu ikke kørt
  assert.equal(daysUntil(null, now), 0);
  assert.equal(daysUntil("not-a-date", now), 0);
});

test("missionCriteriaLabel: u23 har intet value", () => {
  assert.equal(missionCriteriaLabel({ scope: "u23" }, { translateScope: (s) => s.toUpperCase() }), "U23");
});

test("missionCriteriaLabel: country/nm kombinerer scope + landenavn", () => {
  const label = missionCriteriaLabel(
    { scope: "country", value: "dk" },
    { translateScope: (s) => (s === "country" ? "Country" : s), translateCountry: (c) => c.toUpperCase() },
  );
  assert.equal(label, "Country · DK");
});

test("missionCriteriaLabel: ukendt/tom criteria giver tom streng", () => {
  assert.equal(missionCriteriaLabel(null), "");
  assert.equal(missionCriteriaLabel({}), "");
});
