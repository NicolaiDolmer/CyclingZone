// Tests for Z1 Season-visningens rene geometri (#1146).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayIndex,
  isoOfDayIndex,
  seasonRange,
  spanToRect,
  dateToPct,
  buildWeekTicks,
  packLanes,
  bandsCoveringDay,
  nextFocusDayIso,
  seasonDayOrdinal,
  padVisualSpan,
} from "./seasonTimeline.js";

test("dayIndex/isoOfDayIndex er inverse og TZ-frie", () => {
  assert.equal(isoOfDayIndex(dayIndex("2026-08-25")), "2026-08-25");
  assert.equal(dayIndex("2026-08-26") - dayIndex("2026-08-25"), 1);
  // Måneds-/årsskifte
  assert.equal(dayIndex("2026-09-01") - dayIndex("2026-08-31"), 1);
  assert.equal(dayIndex("2027-01-01") - dayIndex("2026-12-31"), 1);
  assert.equal(dayIndex("ikke-en-dato"), null);
});

test("seasonRange finder min/max over bændene", () => {
  const r = seasonRange([
    { startDate: "2026-09-01", endDate: "2026-09-18" },
    { startDate: "2026-08-25", endDate: "2026-08-25" },
    { startDate: "2026-09-05", endDate: "2026-09-21" },
  ]);
  assert.deepEqual(r, { startIso: "2026-08-25", endIso: "2026-09-21" });
  assert.equal(seasonRange([]), null);
});

test("spanToRect: inklusive dage, klipning og udenfor-linealen", () => {
  // 28-dages lineal 25/8-21/9; endagsløb dag 1 = 1/28 bredde fra venstre kant
  const rail = ["2026-08-25", "2026-09-21"];
  const oneDay = spanToRect("2026-08-25", "2026-08-25", ...rail);
  assert.equal(oneDay.leftPct, 0);
  assert.ok(Math.abs(oneDay.widthPct - 100 / 28) < 1e-9);
  // GT over 18 dage
  const gt = spanToRect("2026-08-25", "2026-09-11", ...rail);
  assert.ok(Math.abs(gt.widthPct - (18 / 28) * 100) < 1e-9);
  // Klippes til linealen
  const clipped = spanToRect("2026-08-20", "2026-08-26", ...rail);
  assert.equal(clipped.leftPct, 0);
  assert.ok(Math.abs(clipped.widthPct - (2 / 28) * 100) < 1e-9);
  // Helt udenfor
  assert.equal(spanToRect("2026-07-01", "2026-07-05", ...rail), null);
});

test("dateToPct: midtpunkt af dagen, null udenfor", () => {
  const rail = ["2026-08-25", "2026-09-21"];
  assert.ok(Math.abs(dateToPct("2026-08-25", ...rail) - (0.5 / 28) * 100) < 1e-9);
  assert.equal(dateToPct("2026-09-22", ...rail), null);
  assert.equal(dateToPct("2026-08-24", ...rail), null);
});

test("buildWeekTicks: start, ugetakter, slut — og kollisions-drop nær slutningen", () => {
  const ticks = buildWeekTicks("2026-08-25", "2026-09-21");
  // 25/8 (start), 1/9, 8/9, 15/9, 21/9 (slut) — præcis mockuppens fem
  assert.deepEqual(
    ticks.map((t) => t.iso),
    ["2026-08-25", "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-21"],
  );
  assert.equal(ticks[0].edge, "start");
  assert.equal(ticks.at(-1).edge, "end");
  assert.ok(ticks.slice(1, -1).every((t) => t.edge === null));
  // Stigende positioner
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].pct > ticks[i - 1].pct);
  // En-dags lineal: kun start-ticken
  assert.equal(buildWeekTicks("2026-08-25", "2026-08-25").length, 1);
});

test("packLanes: GT'er (længst) i bane 0, overlappende endagsløb pakkes nedenunder", () => {
  const bands = packLanes([
    { id: "gt1", startDate: "2026-08-25", endDate: "2026-09-11" },
    { id: "one1", startDate: "2026-08-27", endDate: "2026-08-27" },
    { id: "one2", startDate: "2026-08-27", endDate: "2026-08-27" },
    { id: "gt2", startDate: "2026-09-12", endDate: "2026-09-21" },
    { id: "solo", startDate: "2026-09-13", endDate: "2026-09-13" },
  ]);
  const lane = Object.fromEntries(bands.map((b) => [b.id, b.lane]));
  assert.equal(lane.gt1, 0);
  // gt2 overlapper ikke gt1 → deler bane 0
  assert.equal(lane.gt2, 0);
  // De to samtidige endagsløb må ikke dele bane
  assert.notEqual(lane.one1, lane.one2);
  assert.ok(lane.one1 > 0 && lane.one2 > 0);
  // solo overlapper gt2 (bane 0) → skubbes ned, men kan dele bane med et endagsløb
  assert.ok(lane.solo > 0);
  assert.ok(bands.laneCount >= 3);
});

test("packLanes: ugyldige datoer filtreres, tom liste er ok", () => {
  const bands = packLanes([{ id: "x", startDate: "nope", endDate: "2026-09-01" }]);
  assert.equal(bands.length, 0);
  assert.equal(bands.laneCount, 0);
  assert.equal(packLanes([]).laneCount, 0);
});

test("bandsCoveringDay: inklusivt spænd, GT dækker også hviledage", () => {
  const bands = [
    { id: "gt", startDate: "2026-08-25", endDate: "2026-09-11" },
    { id: "one", startDate: "2026-09-09", endDate: "2026-09-09" },
  ];
  assert.deepEqual(bandsCoveringDay(bands, "2026-09-09").map((b) => b.id), ["gt", "one"]);
  assert.deepEqual(bandsCoveringDay(bands, "2026-09-12").map((b) => b.id), []);
  assert.deepEqual(bandsCoveringDay(bands, "ugyldig"), []);
});

test("nextFocusDayIso: første kommende dag med et åbent løb vinder", () => {
  const bands = [
    { startDate: "2026-08-25", endDate: "2026-08-25", hasSelection: true },
    { startDate: "2026-08-26", endDate: "2026-08-26", hasSelection: true },
    { startDate: "2026-08-27", endDate: "2026-08-27", hasSelection: false },
  ];
  assert.equal(nextFocusDayIso(bands, "2026-08-25"), "2026-08-27");
  // Alt udtaget → første kommende dag med løb
  const all = bands.map((b) => ({ ...b, hasSelection: true }));
  assert.equal(nextFocusDayIso(all, "2026-08-26"), "2026-08-26");
  // En IGANGVÆRENDE GT uden udtagelse tæller fra i dag, ikke fra sin startdato
  const gt = [{ startDate: "2026-08-25", endDate: "2026-09-11", hasSelection: false }];
  assert.equal(nextFocusDayIso(gt, "2026-09-01"), "2026-09-01");
  // I dag ligger efter alle løb → null
  assert.equal(nextFocusDayIso(bands, "2026-10-01"), null);
});

test("padVisualSpan: endagsløb udvides mod højre, flerdages røres ikke", () => {
  const padded = padVisualSpan([
    { id: "one", startDate: "2026-08-27", endDate: "2026-08-27" },
    { id: "gt", startDate: "2026-08-25", endDate: "2026-09-11" },
  ], 2);
  assert.equal(padded.find((b) => b.id === "one").endDate, "2026-08-28");
  assert.equal(padded.find((b) => b.id === "one").startDate, "2026-08-27");
  assert.equal(padded.find((b) => b.id === "gt").endDate, "2026-09-11");
});

test("seasonDayOrdinal: 1-baseret dansk kalenderdag-akse", () => {
  assert.equal(seasonDayOrdinal("2026-08-25", "2026-08-25"), 1);
  assert.equal(seasonDayOrdinal("2026-09-09", "2026-08-27"), 14);
  assert.equal(seasonDayOrdinal("nope", "2026-08-25"), null);
});
