import test from "node:test";
import assert from "node:assert/strict";
import { checkCalendarOverlapInvariants } from "./calendarOverlapInvariant.js";
import { TIER_OVERLAP_CAP, TIER_DENSITY, minGameDaysPerRealDay } from "./calendarTierCaps.js";
import { packLaneCalendar } from "./raceCalendarLanePacker.js";

// Rækker som de ligger i race_stage_schedule.
const row = (race_id, stage_number, game_day, scheduled_at = null) =>
  ({ race_id, stage_number, game_day, scheduled_at });

test("caps: de ejer-låste værdier er uændrede (2026-06-28)", () => {
  assert.deepEqual({ ...TIER_OVERLAP_CAP }, { 1: 3, 2: 3, 3: 2, 4: 2 });
  // #4270 (ejer-beslutning 3/9): D4 hævet 2 → 3 etaper om dagen fra sæson 4.
  // Overlap-cap'en er UÆNDRET (2), så K = ceil(3/2) = 2: D4 er ikke længere den ene
  // division hvor løbsdags-aksen og kalenderaksen falder sammen. Se CALENDAR_RULES.md §0.
  assert.deepEqual({ ...TIER_DENSITY }, { 1: 5, 2: 4, 3: 3, 4: 3 });
  assert.deepEqual([1, 2, 3, 4].map(minGameDaysPerRealDay), [2, 2, 2, 2]);
});

test("ren kalender inden for cap giver ingen brud", () => {
  const rows = [
    row("a", 1, 0), row("b", 1, 0), row("c", 1, 0),   // 3 løb på game_day 0 = præcis cap for tier 1
    row("a", 2, 1), row("b", 2, 1),
  ];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.overlapViolationCount, 0);
  assert.equal(r.stageRepeatViolationCount, 0);
  assert.equal(r.maxOverlap, 3);
  assert.equal(r.overlapCap, 3);
});

test("fjerde samtidige løb på én game_day bryder tier 1-cap'en", () => {
  const rows = [row("a", 1, 0), row("b", 1, 0), row("c", 1, 0), row("d", 1, 0)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.overlapViolationCount, 1);
  assert.equal(r.overlapViolations[0].game_day, 0);
  assert.equal(r.overlapViolations[0].races, 4);
  assert.equal(r.overlapViolations[0].cap, 3);
});

test("tier 3 har cap 2 — tre samtidige løb er et brud dér", () => {
  const rows = [row("a", 1, 4), row("b", 1, 4), row("c", 1, 4)];
  assert.equal(checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 3 }).overlapViolationCount, 1);
  assert.equal(checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 }).overlapViolationCount, 0);
});

test("to etaper af SAMME løb på samme game_day er et brud (pakker-kontrakt: 1 etape = 1 game-dag)", () => {
  const rows = [row("gt", 1, 5), row("gt", 2, 5), row("gt", 3, 5), row("gt", 4, 6)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.stageRepeatViolationCount, 1);
  assert.deepEqual(r.stageRepeatViolations[0], {
    race_id: "gt", game_day: 5, stages: 3, stage_numbers: [1, 2, 3],
  });
});

// #4270 (3/9): K udledes nu af DATA (etaper ÷ kalenderdage ÷ cap), ikke af TIER_DENSITY.
// Fixturerne skal derfor bære en realistisk tæthed — ellers måler testen ikke det den påstår.
test("fladet akse opdages: én game_day pr. kalenderdag i en division der kører 5 etaper om dagen", () => {
  // Tier 1: 5 etaper pr. kalenderdag, cap 3 → K = 2. Men kun 2 game_days på 2 kalenderdage.
  const rows = [];
  for (const [dag, dato] of [[0, "2026-08-25"], [1, "2026-08-26"]]) {
    for (const løb of ["a", "b", "c", "d", "e"]) {
      rows.push(row(løb, dag + 1, dag, `${dato}T09:00:00Z`));
    }
  }
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.gameDayCount, 2);
  assert.equal(r.realDayCount, 2);
  assert.equal(r.minGameDaysPerCalendarDay, 2);
  assert.equal(r.axisLooksCollapsed, true, "2 game_days på 2 kalenderdage ved 5 etaper/dag er en fladet akse");
});

// Den vigtigste regressionsvagt i denne fil. Da D4 gik fra 2 til 3 etaper om dagen for
// sæson 4, meldte nat-vagten sæson 3's ALLEREDE SKREVNE og korrekte D4-kalender som
// "kollapset akse" i alle 8 puljer — fordi K blev læst af konstanten i stedet for af
// kalenderen. En invariant mod prod skal måle den kalender der står der, mod den tæthed
// den er BYGGET med. Se #4161 og #4270.
test("en FROSSEN sæson måles mod sin egen tæthed, ikke mod en konstant der er flyttet", () => {
  // Sæson 3's D4-form: 2 etaper pr. kalenderdag, cap 2 → K = 1. Én game_day pr.
  // kalenderdag er dér KORREKT, også efter at TIER_DENSITY[4] er hævet til 3.
  const rows = [];
  for (const [dag, dato] of [[0, "2026-08-28"], [1, "2026-08-29"], [2, "2026-08-30"]]) {
    rows.push(row("a", dag + 1, dag, `${dato}T10:00:00Z`));
    rows.push(row("b", dag + 1, dag, `${dato}T16:00:00Z`));
  }
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 4 });
  assert.equal(r.observedDensity, 2, "målt tæthed er 2 etaper pr. kalenderdag");
  assert.equal(r.minGameDaysPerCalendarDay, 1);
  assert.equal(r.axisLooksCollapsed, false, "sæson 3's D4 er korrekt og må ikke meldes rød");
  assert.equal(r.overlapViolationCount, 0);
});

// Og sæson 4's D4-form: 3 etaper pr. kalenderdag, cap 2 → K = 2. Dér ER 1:1 et brud.
test("Div 4 ved 3 etaper om dagen: én game_day pr. kalenderdag ER et brud", () => {
  const rows = [];
  for (const [dag, dato] of [[0, "2026-09-28"], [1, "2026-09-29"]]) {
    rows.push(row("a", dag + 1, dag, `${dato}T12:00:00Z`));
    rows.push(row("b", dag + 1, dag, `${dato}T15:00:00Z`));
    rows.push(row("c", dag + 1, dag, `${dato}T18:00:00Z`));
  }
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 4 });
  assert.equal(r.observedDensity, 3);
  assert.equal(r.minGameDaysPerCalendarDay, 2);
  assert.equal(r.axisLooksCollapsed, true);
});

test("Div 4 med to løbsdage pr. kalenderdag er ren (den form density 3 kræver)", () => {
  const rows = [
    row("a", 1, 0, "2026-09-28T10:00:00Z"), row("b", 1, 0, "2026-09-28T13:00:00Z"),
    row("c", 1, 1, "2026-09-28T16:00:00Z"),
    row("a", 2, 2, "2026-09-29T10:00:00Z"), row("b", 2, 2, "2026-09-29T13:00:00Z"),
    row("c", 2, 3, "2026-09-29T16:00:00Z"),
  ];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 4 });
  assert.equal(r.gameDayCount, 4);
  assert.equal(r.realDayCount, 2);
  assert.equal(r.axisLooksCollapsed, false);
  assert.equal(r.overlapViolationCount, 0);
  assert.equal(r.maxOverlap, 2, "to samtidige løb er præcis D4's cap");
});

test("rækker uden game_day ignoreres (gammelt CET-ordinal-nøglerum, raceBinding.js)", () => {
  const rows = [row("a", 1, null), row("b", 1, undefined), row("c", 1, 0)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.maxOverlap, 1);
  assert.equal(r.overlapViolationCount, 0);
});

// Den vigtige: pakkerens EGET output skal bestå invarianten. Hvis pakkeren og vagten
// nogensinde driver fra hinanden, fejler denne test — ikke prod.
test("pakkerens eget Div 1-output består invarianten (cap 3, 1 etape pr. løb pr. game-dag)", () => {
  const stageRaces = [
    { id: "gt-1", stages: 21, race_class: "TourFrance" },
    { id: "gt-2", stages: 21, race_class: "GiroVuelta" },
    { id: "gt-3", stages: 21, race_class: "GiroVuelta" },
    { id: "wt-1", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-2", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-3", stages: 7, race_class: "OtherWorldTourA" },
    { id: "wt-4", stages: 6, race_class: "OtherWorldTourA" },
  ];
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments" })),
    ...Array.from({ length: 43 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA" })),
  ];
  const packed = packLaneCalendar({
    stageRaces, oneDayRaces,
    density: TIER_DENSITY[1], days: 28, overlapCap: TIER_OVERLAP_CAP[1],
  });
  const scheduleRows = packed.placements.flatMap((p) =>
    p.stagesPlaced.map((st) => ({ race_id: p.id, stage_number: st.stage_number, game_day: st.game_day })));

  const r = checkCalendarOverlapInvariants({ scheduleRows, tier: 1 });
  assert.equal(r.overlapViolationCount, 0, `pakkeren brød cap'en: ${JSON.stringify(r.overlapViolations.slice(0, 3))}`);
  assert.equal(r.stageRepeatViolationCount, 0, `pakkeren lagde 2 etaper af samme løb på én game-dag: ${JSON.stringify(r.stageRepeatViolations.slice(0, 3))}`);
  assert.ok(r.gameDayCount > 28, `pakkeren skal bruge FLERE game_days (${r.gameDayCount}) end kalenderdage (28) — ellers er aksen fladet`);
});

// ── #4236/#4465: den eksklusive monument-loebsdag er OPHAEVET ─────────────────────
//
// #4075 (laast 21/8) gav monumentet sin egen loebsdag. Ejeren ophaevede reglen 26/8
// (#4236) da #4217's spaend-baserede binding havde fjernet gevinsten. Taellingen blev
// tilbage i tre doegn og gjorde nat-gaten roed paa noget der er tilladt. Denne test
// laaser tilbagerulningen fast: et monument der deler loebsdag er IKKE et brud, og
// vagten maa ikke faa en monument-akse tilbage uden en ny ejer-beslutning.

test("monument der deler in-game-dag er IKKE et brud laengere (#4236/#4465)", () => {
  const r = checkCalendarOverlapInvariants({
    scheduleRows: [row("mon", 1, 5), row("gt", 12, 5), row("gt", 13, 6)],
    tier: 1,
  });
  assert.equal(r.overlapViolationCount, 0, "2 loeb < cap 3 — ingen cap-brud");
  assert.equal(r.stageRepeatViolationCount, 0);
  assert.equal(
    r.monumentSharedDayViolationCount, undefined,
    "monument-taellingen er fjernet — kommer den tilbage, er en ophaevet regel genindfoert"
  );
  assert.equal(r.monumentSharedDayViolations, undefined);
});

test("monument-loebsdage taeller stadig med i cap'en som ethvert andet loeb (#4236)", () => {
  // Cap 3 i D1: fire loeb paa samme loebsdag er et brud, uanset at det ene er et monument.
  const r = checkCalendarOverlapInvariants({
    scheduleRows: [row("mon", 1, 5), row("a", 1, 5), row("b", 1, 5), row("c", 1, 5)],
    tier: 1,
  });
  assert.equal(r.overlapViolationCount, 1);
  assert.equal(r.overlapViolations[0].races, 4);
});
