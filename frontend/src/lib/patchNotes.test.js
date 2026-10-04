import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenChanges, pickLang, filterChanges, groupByDay, computeNewDays,
  effectiveRollout, filterByRollout,
} from "./patchNotes.js";

const PATCHES = [
  { version: "2.0", date: "2026-06-20", label: "Beta", changes: [
    { category: "improved", topic: "Getting started", audience: "player",
      en: { title: "Tooltips for newcomers", body: "Hover to learn" },
      da: { title: "Tooltips til nye", body: "Hold musen for at lære" } },
    { category: "fixed", audience: "internal",
      en: { title: "DB grant", body: "GRANT SELECT" } },
  ]},
  { version: "1.0", date: "2026-06-19", label: "Beta", changes: [
    { category: "new", audience: "player", da: { title: "Akademi", body: "Nyt akademi" } },
  ]},
];

test("flattenChanges folder versioner ud + tilføjer date/version/_key", () => {
  const flat = flattenChanges(PATCHES);
  assert.equal(flat.length, 3);
  assert.equal(flat[0].date, "2026-06-20");
  assert.equal(flat[0]._key, "2.0#0");
});

test("pickLang vælger aktivt sprog, falder tilbage med flag", () => {
  const c = PATCHES[1].changes[0]; // kun da
  assert.equal(pickLang(c, "da").body, "Nyt akademi");
  const fb = pickLang(c, "en");
  assert.equal(fb.body, "Nyt akademi");
  assert.equal(fb.isFallback, true);
});

test("filterChanges fjerner interne + matcher kategori og query", () => {
  const flat = flattenChanges(PATCHES);
  assert.equal(filterChanges(flat, { lang: "en", category: "all", query: "" }).length, 2);
  assert.equal(filterChanges(flat, { lang: "en", category: "new", query: "" }).length, 1);
  assert.equal(filterChanges(flat, { lang: "en", category: "all", query: "tooltips" }).length, 1);
});

test("groupByDay grupperer player-changes pr. dato, nyeste først", () => {
  const flat = filterChanges(flattenChanges(PATCHES), { lang: "en", category: "all", query: "" });
  const days = groupByDay(flat, "en");
  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-06-20");
  assert.equal(days[0].count, 1);
  assert.equal(days[0].categories.improved.length, 1);
});

test("computeNewDays markerer dage nyere end lastSeen; tom ved første besøg", () => {
  assert.deepEqual([...computeNewDays(["2026-06-20", "2026-06-19"], "2026-06-19")], ["2026-06-20"]);
  assert.equal(computeNewDays(["2026-06-20"], null).size, 0);
});

test("effectiveRollout: en beta-note med flag der er on for alle, læses som beta_to_live", () => {
  const change = { rollout: "beta", flag: "training_groups" };
  assert.equal(effectiveRollout(change, { training_groups: true }), "beta_to_live");
  assert.equal(effectiveRollout(change, { training_groups: false }), "beta");
  assert.equal(effectiveRollout(change, {}), "beta");
  assert.equal(effectiveRollout(change, null), "beta");
});

test("effectiveRollout: noter uden flag og gamle stage:beta-noter er uændrede", () => {
  assert.equal(effectiveRollout({ rollout: "live" }, { x: true }), "live");
  assert.equal(effectiveRollout({ stage: "beta" }, {}), "beta");
  assert.equal(effectiveRollout({ rollout: "beta_to_live" }, {}), "beta_to_live");
});

test("filterByRollout: all, beta og now_live", () => {
  const changes = [
    { id: 1, rollout: "beta", flag: "a" }, { id: 2, rollout: "beta", flag: "b" },
    { id: 3, rollout: "beta_to_live" }, { id: 4, rollout: "live" },
  ];
  const flags = { a: true, b: false };
  assert.deepEqual(filterByRollout(changes, "all", flags).map((c) => c.id), [1, 2, 3, 4]);
  assert.deepEqual(filterByRollout(changes, "beta", flags).map((c) => c.id), [2]);
  assert.deepEqual(filterByRollout(changes, "now_live", flags).map((c) => c.id), [1, 3]);
});
