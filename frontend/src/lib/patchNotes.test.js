import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenChanges, pickLang, filterChanges, groupByDay, computeNewDays,
  effectiveRollout, filterByRollout,
  weekStartOf, addDaysIso, isoWeekNumber, tagOf, dedupeWeek, pickHero, groupByArea, isNewSince, latestSeenKey,
  isThinWeek, filterV2Items, matchesQuery, normalizeQuery, weekSummary, countTags, PATCH_NOTES_V2_FLAG, isPatchNotesV2Stage,
} from "./patchNotes.js";
import { PATCHES as REAL_PATCHES } from "../data/patchNotes.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";

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

test("effectiveRollout: gammelt stage-felt giver Beta-mærke (#5422), rollout vinder over stage", () => {
  assert.equal(effectiveRollout({ stage: "beta" }, null), "beta");
  assert.equal(effectiveRollout({ stage: "beta", flag: "x" }, { x: true }), "beta_to_live");
  assert.equal(effectiveRollout({ rollout: "switched_on", stage: "beta" }, null), "switched_on");
  assert.equal(effectiveRollout({}, null), "live");
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

test("filterByRollout: all og beta", () => {
  const changes = [
    { id: 1, rollout: "beta", flag: "a" }, { id: 2, rollout: "beta", flag: "b" },
    { id: 3, rollout: "beta_to_live" }, { id: 4, rollout: "live" },
  ];
  const flags = { a: true, b: false };
  assert.deepEqual(filterByRollout(changes, "all", flags).map((c) => c.id), [1, 2, 3, 4]);
  assert.deepEqual(filterByRollout(changes, "beta", flags).map((c) => c.id), [2]);
});

// #6154: GET /api/feature-flags svarer kun paa PLAYER_VISIBLE_FLAG_KEYS. En note med et
// `flag` uden for listen kan aldrig skifte maerke til "Now live for all".
// Kendt hul: training_daily_receipt staar ikke i STAGE_FLAGS (kun i trainingScoreFlag.js),
// og endpointet kraever stadie-flag. Fjernes naar noeglen er lagt i kataloget.
const KNOWN_GAPS = new Set(["training_daily_receipt"]);

test("hver note med flag i patchNotes.js har en noegle i PLAYER_VISIBLE_FLAG_KEYS", () => {
  const missing = [];
  for (const p of REAL_PATCHES) {
    (p.changes || []).forEach((c, i) => {
      if (c.flag && !KNOWN_GAPS.has(c.flag) && !PLAYER_VISIBLE_FLAG_KEYS.includes(c.flag)) missing.push(`${p.version}#${i}:${c.flag}`);
    });
  }
  assert.deepEqual(
    missing, [],
    "flag mangler i PLAYER_VISIBLE_FLAG_KEYS (backend/lib/stageFlagCatalog.js), saa maerket skifter aldrig: " + missing.join(", "),
  );
});

// ── #8049: den nye side ──────────────────────────────────────────────────────
const it8049 = (k, extra = {}) => ({ k, v: k.split("#")[0], d: "2026-11-16", s: "2026-11-16T00:01", a: "training", c: "improved", ti: k, b: "", ...extra });

test("#8049: uger starter mandag, ISO-ugenummer og dage lægges til i UTC", () => {
  assert.equal(weekStartOf("2026-11-16"), "2026-11-16"); // mandag
  assert.equal(weekStartOf("2026-11-22"), "2026-11-16"); // søndag
  assert.equal(weekStartOf("2026-11-15"), "2026-11-09");
  assert.equal(addDaysIso("2026-11-30", 1), "2026-12-01");
  assert.equal(isoWeekNumber("2026-11-16"), 47);
  assert.equal(isoWeekNumber("2026-01-01"), 1);
});

test("#8049: mærket: udrulning vinder over kategori, beta følger sin kontakt", () => {
  assert.equal(tagOf({ c: "fixed" }), "fixed");
  assert.equal(tagOf({ c: "new", r: "beta" }), "beta");
  assert.equal(tagOf({ c: "new", r: "switched_on" }), "on");
  assert.equal(tagOf({ c: "improved", r: "beta_to_live" }), "on");
  assert.equal(tagOf({ c: "new", r: "beta", f: "k" }, { k: true }), "on");
  assert.equal(tagOf({ c: "new", r: "event" }), "new");
});

test("#8049: beta og tændt samme uge: kun den seneste vises (valg 6)", () => {
  const beta = it8049("7.1#0", { r: "beta", f: "talent" });
  const on = it8049("7.2#0", { r: "beta_to_live", f: "talent" });
  const other = it8049("7.2#1", { r: "beta", f: "andet" });
  assert.deepEqual(dedupeWeek([on, beta, other]).map((x) => x.k), ["7.2#0", "7.2#1"]);
  const replaced = it8049("7.3#0", { rp: "7.2#1" });
  assert.deepEqual(dedupeWeek([replaced, other]).map((x) => x.k), ["7.3#0"]);
  assert.deepEqual(dedupeWeek([beta]).map((x) => x.k), ["7.1#0"]);
});

test("#8049: ugens nyhed: highlight > Tændt for alle > Nyt > Beta, aldrig en fejlrettelse (valg 3)", () => {
  const fix = it8049("7.9#0", { c: "fixed", s: "2026-11-16T00:09" });
  const neu = it8049("7.5#0", { c: "new", s: "2026-11-16T00:05" });
  const on = it8049("7.4#0", { r: "switched_on", s: "2026-11-16T00:04" });
  const beta = it8049("7.6#0", { r: "beta", s: "2026-11-16T00:06" });
  assert.equal(pickHero([fix, neu, on, beta]).k, "7.4#0");
  assert.equal(pickHero([fix, neu, beta]).k, "7.5#0");
  assert.equal(pickHero([fix, beta]).k, "7.6#0");
  assert.equal(pickHero([fix]), null);
  assert.equal(pickHero([fix, on, it8049("7.1#0", { hl: true })]).k, "7.1#0");
});

test("#8049: områder i fast rækkefølge, Andet sidst", () => {
  const items = [it8049("1#0", { a: "help" }), it8049("2#0", { a: "other" }), it8049("3#0", { a: "tactics" }), it8049("4#0", { a: "ukendt" })];
  assert.deepEqual(groupByArea(items).map(([a, l]) => [a, l.length]), [["tactics", 1], ["help", 1], ["other", 2]]);
});

test("#8049: nyt siden sidst: dato-markør = hele dagen set; seenKey fanger samme dag", () => {
  const item = it8049("7.453#0", { d: "2026-11-16", s: "2026-11-16T00:03" });
  assert.equal(isNewSince(item, null), false); // første besøg: ingen prikker
  assert.equal(isNewSince(item, "2026-11-16"), false);
  assert.equal(isNewSince(item, "2026-11-15"), true);
  assert.equal(isNewSince(item, "2026-11-16T00:02"), true);
  assert.equal(isNewSince(item, "2026-11-16T00:03"), false);
  assert.equal(latestSeenKey([item, it8049("x#0", { s: "2026-11-16T00:01" })]), "2026-11-16T00:03");
});

test("#8049: mandagsreglen åbner sidste uge under 10 ændringer (valg 2)", () => {
  assert.equal(isThinWeek(0), true);
  assert.equal(isThinWeek(9), true);
  assert.equal(isThinWeek(10), false);
});

test("#8049: filtre, søgning, resumé og antal pr. mærke", () => {
  const a = it8049("1#0", { a: "market", r: "beta", ti: "Auto-pris", b: "Byd" });
  const b = it8049("2#0", { a: "training", c: "fixed", ti: "Træning", s: "2026-11-16T00:02" });
  assert.deepEqual(filterV2Items([a, b], { area: "market" }).map((x) => x.k), ["1#0"]);
  assert.deepEqual(filterV2Items([a, b], { betaOnly: true }).map((x) => x.k), ["1#0"]);
  assert.deepEqual(filterV2Items([a, b], { onlyNew: true, marker: "2026-11-16T00:01" }).map((x) => x.k), ["2#0"]);
  assert.equal(matchesQuery(a, normalizeQuery("  AUTO ")), true);
  assert.equal(matchesQuery(a, "byd"), true);
  assert.equal(matchesQuery(b, "auto"), false);
  const sum = weekSummary([a, b]);
  assert.deepEqual(sum.top.map((x) => x.k), ["1#0"]);
  assert.deepEqual(sum.areas, [["training", 1], ["market", 1]]);
  assert.deepEqual(countTags([a, b]), [["beta", 1], ["fixed", 1]]);
});

test("#8049: kontakten: kun beta og on giver den nye side", () => {
  assert.equal(PATCH_NOTES_V2_FLAG, "patch_notes_v2_8049");
  assert.equal(isPatchNotesV2Stage("off"), false);
  assert.equal(isPatchNotesV2Stage(undefined), false);
  assert.equal(isPatchNotesV2Stage("beta"), true);
  assert.equal(isPatchNotesV2Stage("on"), true);
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(PATCH_NOTES_V2_FLAG), "kontakten skal kunne læses af spillersiden");
});
