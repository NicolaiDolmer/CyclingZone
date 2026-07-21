import { test } from "node:test";
import assert from "node:assert/strict";
import { dateToOrdinal, monthTicks, formatOrdinalShort, statusMeta, riderShortName, racesForList, myPeakCountByRace } from "./plannerShared.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

test("dateToOrdinal: gyldig dato → heltal, ugyldig → null", () => {
  const a = dateToOrdinal("2026-07-13");
  const b = dateToOrdinal("2026-07-14");
  assert.equal(typeof a, "number");
  assert.equal(b - a, 1, "en dags forskel = ordinal +1");
  assert.equal(dateToOrdinal(null), null);
  assert.equal(dateToOrdinal("nonsense"), null);
});

test("monthTicks: ét tick pr. måned inden for intervallet med lokaliseret label", () => {
  const ticks = monthTicks(dateToOrdinal("2026-03-15"), dateToOrdinal("2026-06-10"), MONTHS);
  const labels = ticks.map((t) => t.label);
  // Apr, May, Jun ligger i intervallet (Mar 1 er før start).
  assert.deepEqual(labels, ["Apr", "May", "Jun"]);
});

test("monthTicks: tomt ved ugyldigt interval", () => {
  assert.deepEqual(monthTicks(null, null, MONTHS), []);
  assert.deepEqual(monthTicks(100, 100, MONTHS), []);
});

test("formatOrdinalShort: '12 Jun'-form", () => {
  assert.equal(formatOrdinalShort(dateToOrdinal("2026-06-12"), MONTHS), "12 Jun");
  assert.equal(formatOrdinalShort(null, MONTHS), "");
});

test("statusMeta: redundant glyf pr. status (ikke kun farve)", () => {
  assert.equal(statusMeta("on_track").glyph, "✓");
  assert.equal(statusMeta("at_risk").glyph, "↓");
  assert.equal(statusMeta("pending").glyph, "•");
  assert.equal(statusMeta("unknown").key, "pending");
});

test("riderShortName: initial + efternavn", () => {
  assert.equal(riderShortName({ firstname: "Lars", lastname: "Vermeulen" }), "L. Vermeulen");
  assert.equal(riderShortName({ lastname: "Novak" }), "Novak");
});

const RACES = [
  { id: "b", name: "Hill GP", date: "2026-05-10", isMine: true },
  { id: "a", name: "Coastal", date: "2026-04-20", isMine: true },
  { id: "c", name: "Nationals", date: "2026-06-25", isMine: false },
  { id: "d", name: "No date", date: null, isMine: true },
];

test("racesForList: filter 'mine' → kun egne løb, dato-sorteret, med isPast", () => {
  const now = dateToOrdinal("2026-05-01");
  const out = racesForList(RACES, "mine", now);
  assert.deepEqual(out.map((r) => r.id), ["a", "b"], "kun mine, sorteret på dato; nationals (ikke min) + no-date udeladt");
  assert.equal(out[0].isPast, true, "Coastal (20 apr) er før nu (1 maj)");
  assert.equal(out[1].isPast, false, "Hill GP (10 maj) er efter nu");
});

test("racesForList: filter 'all' → inkluderer rivalers løb; nowOrd=null → intet er past", () => {
  const out = racesForList(RACES, "all", null);
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"], "alle med gyldig dato, sorteret");
  assert.equal(out.every((r) => r.isPast === false), true, "uden 'nu' er intet markeret kørt");
});

test("racesForList: tom/ugyldig input → tom liste", () => {
  assert.deepEqual(racesForList(null, "mine", 0), []);
  assert.deepEqual(racesForList([], "all", 0), []);
});

test("myPeakCountByRace: tæller egne rytteres peaks pr. løb (ægte + forslag)", () => {
  const riders = [
    { peaks: [{ targetRaceId: "a" }, { targetRaceId: "b" }] },
    { peaks: [{ targetRaceId: "a", isSuggestion: true }] },
    { peaks: [{ targetRaceId: null }] },
    { peaks: [] },
  ];
  const m = myPeakCountByRace(riders);
  assert.equal(m.get("a"), 2, "to ryttere topper mod a");
  assert.equal(m.get("b"), 1);
  assert.equal(m.has(null), false, "peaks uden mål-løb tælles ikke");
  assert.deepEqual(myPeakCountByRace(null), new Map());
});
