import { test } from "node:test";
import assert from "node:assert/strict";
import { dateToOrdinal, monthTicks, formatOrdinalShort, statusMeta, riderShortName, nextPlannableSeason, effectivePlannerFilter } from "./plannerShared.js";

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

// #2883: sæson-nudge — planneren viste ingen proaktiv besked om at S2 kunne
// planlægges, selvom sæson-vælgeren (#2518) allerede understøttede det.
test("nextPlannableSeason: finder nærmeste senere sæson end den viste", () => {
  const seasons = [
    { id: "s1", number: 1, status: "active" },
    { id: "s2", number: 2, status: "upcoming" },
  ];
  assert.deepEqual(nextPlannableSeason(seasons, 1), { id: "s2", number: 2, status: "upcoming" });
});

test("nextPlannableSeason: ingen kandidat når den viste sæson allerede er den seneste", () => {
  const seasons = [
    { id: "s1", number: 1, status: "active" },
    { id: "s2", number: 2, status: "upcoming" },
  ];
  assert.equal(nextPlannableSeason(seasons, 2), null);
});

test("nextPlannableSeason: vælger den NÆRMESTE senere sæson, ikke den seneste, når flere findes", () => {
  const seasons = [
    { id: "s1", number: 1, status: "active" },
    { id: "s2", number: 2, status: "upcoming" },
    { id: "s3", number: 3, status: "upcoming" },
  ];
  assert.deepEqual(nextPlannableSeason(seasons, 1), { id: "s2", number: 2, status: "upcoming" });
});

test("nextPlannableSeason: null/tom liste eller ukendt viewingNumber → ingen nudge", () => {
  assert.equal(nextPlannableSeason(null, 1), null);
  assert.equal(nextPlannableSeason([], 1), null);
  assert.equal(nextPlannableSeason([{ id: "s2", number: 2 }], null), null);
});

// ── #3018 · ingen "mine løb" før divisionen er afgjort ────────────────────────
// thelamba 26/7: planlæggeren viste D3's kalender for S2 til et hold på vej op i
// D2. Boardet markerer nu intet som isMine i den situation, så default-filteret
// "mine" ville tegne et TOMT bræt. effectivePlannerFilter tvinger hele
// kalenderen frem i stedet, så manageren stadig kan orientere sig.

test("effectivePlannerFilter: divisionPending tvinger 'all' uanset valgt filter", () => {
  assert.equal(effectivePlannerFilter("mine", true), "all");
  assert.equal(effectivePlannerFilter("all", true), "all");
});

test("effectivePlannerFilter: uden divisionPending er managerens valg urørt", () => {
  assert.equal(effectivePlannerFilter("mine", false), "mine");
  assert.equal(effectivePlannerFilter("all", false), "all");
});
