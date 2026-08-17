import test from "node:test";
import assert from "node:assert/strict";
import {
  kmToX, xToKm, buildFilmTimeline, eventsPlayedUpTo, describeEvent, climbMarkerHeight,
} from "./stageTimelineFilm.js";
import { MOUNTAIN_TIMELINE, BREAKAWAY_WIN_TIMELINE, riderNameByIdFixture } from "./stageTimelineFixtures.js";

// ── scrubber-tidsmapning (km ⇄ pixel) ──────────────────────────────────────

test("kmToX: 0 km → 0px, distanceKm → fuld plot-bredde", () => {
  assert.equal(kmToX(0, 168, 900), 0);
  assert.equal(kmToX(168, 168, 900), 900);
  assert.equal(kmToX(84, 168, 900), 450);
});

test("kmToX: clamper km uden for [0, distanceKm]", () => {
  assert.equal(kmToX(-10, 168, 900), 0);
  assert.equal(kmToX(200, 168, 900), 900);
});

test("kmToX: distanceKm=0 degraderer til 0 i stedet for NaN/Infinity", () => {
  assert.equal(kmToX(10, 0, 900), 0);
});

test("xToKm er den nøjagtige inverse af kmToX over hele intervallet", () => {
  const distanceKm = 174;
  const width = 900;
  for (const km of [0, 12.5, 60, 87, 173.9, 174]) {
    const x = kmToX(km, distanceKm, width);
    assert.ok(Math.abs(xToKm(x, distanceKm, width) - km) < 1e-9);
  }
});

test("xToKm clamper x uden for [0, plotWidth]", () => {
  assert.equal(xToKm(-50, 168, 900), 0);
  assert.equal(xToKm(2000, 168, 900), 168);
});

// ── buildFilmTimeline ────────────────────────────────────────────────────

test("buildFilmTimeline udelukker gap_update fra feedEvents men bevarer dem i gapCurve", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.ok(built.feedEvents.every((e) => e.type !== "gap_update"));
  assert.ok(built.gapCurve.length > 0);
  assert.ok(built.gapCurve.every((p) => typeof p.km === "number" && typeof p.gapSeconds === "number"));
});

test("buildFilmTimeline finder catchKm fra breakaway_caught-eventet", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.equal(built.catchKm, 146);
});

test("buildFilmTimeline: catchKm er null når udbruddet overlever (ingen catch-event)", () => {
  const built = buildFilmTimeline(BREAKAWAY_WIN_TIMELINE);
  assert.equal(built.catchKm, null);
});

test("buildFilmTimeline: gap-kurvens slutpunkt matcher konsistensregel 2 (caught → 0 ved catchKm)", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const lastBeforeOrAtCatch = built.gapCurve.filter((p) => p.km <= built.catchKm).pop();
  assert.equal(lastBeforeOrAtCatch.gapSeconds, 0);
});

test("buildFilmTimeline udleder climbMarkers med km + kategori for scrubberens trekanter", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  assert.equal(built.climbMarkers.length, 2);
  assert.deepEqual(built.climbMarkers.map((c) => c.category), ["1", "HC"]);
});

test("climbMarkerHeight: HC højere end kat. 4, ukendt kategori degraderer til default", () => {
  assert.ok(climbMarkerHeight("HC") > climbMarkerHeight("4"));
  assert.equal(climbMarkerHeight(undefined), climbMarkerHeight("4"));
});

// ── eventsPlayedUpTo ─────────────────────────────────────────────────────

test("eventsPlayedUpTo: km 0 giver kun stage_start, nyeste øverst", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const played = eventsPlayedUpTo(built.feedEvents, 0);
  assert.equal(played.length, 1);
  assert.equal(played[0].type, "stage_start");
});

test("eventsPlayedUpTo: ved målstregen er ALLE feed-events afspillet, seneste først", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  const played = eventsPlayedUpTo(built.feedEvents, built.distanceKm);
  assert.equal(played.length, built.feedEvents.length);
  assert.equal(played[0].type, "finish");
  for (let i = 1; i < played.length; i++) assert.ok(played[i].km <= played[i - 1].km);
});

test("eventsPlayedUpTo er monoton: flere afspillede events ved højere scrub-km, aldrig færre", () => {
  const built = buildFilmTimeline(MOUNTAIN_TIMELINE);
  let prevCount = 0;
  for (const km of [0, 20, 60, 100, 150, built.distanceKm]) {
    const count = eventsPlayedUpTo(built.feedEvents, km).length;
    assert.ok(count >= prevCount);
    prevCount = count;
  }
});

// ── describeEvent (broadcast-tekst-nøgler) ──────────────────────────────

test("describeEvent: ukendt event-type returnerer null (feedet springer linjen over)", () => {
  assert.equal(describeEvent({ type: "weather_shift", params: {} }), null);
  assert.equal(describeEvent(null), null);
});

test("describeEvent: finish bruger vind-type-specifik nøgle når kendt", () => {
  const finishEvent = MOUNTAIN_TIMELINE.events.find((e) => e.type === "finish");
  const d = describeEvent(finishEvent, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.key, "finish_solo_win");
  assert.equal(d.params.rider, "Ada Pedersen");
});

test("describeEvent: gc_change slår begge rytternavne op fra riderNameById", () => {
  const gcEvent = BREAKAWAY_WIN_TIMELINE.events.find((e) => e.type === "gc_change");
  const d = describeEvent(gcEvent, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.key, "gc_change");
  assert.equal(d.params.rider, "Sofie Lund");
  assert.equal(d.params.previousLeader, "Ada Pedersen");
});

test("describeEvent: manglende rytter-opslag degraderer til det rå id, ikke et kast", () => {
  const d = describeEvent({ type: "finale_attack", params: { rider_id: "ghost-rider" } }, { riderNameById: new Map() });
  assert.equal(d.params.rider, "ghost-rider");
});

test("describeEvent: breakaway_formed samler flere rytternavne kommasepareret", () => {
  const event = MOUNTAIN_TIMELINE.events.find((e) => e.type === "breakaway_formed");
  const d = describeEvent(event, { riderNameById: riderNameByIdFixture() });
  assert.equal(d.params.riders, "Mikkel Hansen, Sofie Lund");
  assert.equal(d.params.count, 2);
});
