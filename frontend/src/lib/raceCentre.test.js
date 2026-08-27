// frontend/src/lib/raceCentre.test.js — #3858 (Race Centre)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LIVE_PLAYBACK_WINDOW_MS,
  copenhagenDayKey,
  copenhagenDayStart,
  copenhagenDayRange,
  isRaceDayToday,
  stageCardState,
  playbackKm,
  latestFilmEvent,
  buildRaceCentreCards,
  stagePodium,
  ownBestResult,
} from "./raceCentre.js";

// Sommertid i Danmark = UTC+2. 2026-08-17 21:30 UTC er derfor allerede
// 2026-08-17 23:30 København (samme dag), mens 22:30 UTC er 18/8 kl. 00:30.
const AUG17_2130Z = Date.parse("2026-08-17T21:30:00Z");
const AUG17_2230Z = Date.parse("2026-08-17T22:30:00Z");

test("copenhagenDayKey: krydser dagsgrænsen i København, ikke i UTC", () => {
  assert.equal(copenhagenDayKey(AUG17_2130Z), "2026-08-17");
  assert.equal(copenhagenDayKey(AUG17_2230Z), "2026-08-18");
  assert.equal(copenhagenDayKey(NaN), null);
});

test("copenhagenDayKey: en zone runtime'en ikke kender giver null, ikke et kast (#4293)", () => {
  // Intl.DateTimeFormat kaster RangeError på en ukendt zone (stripped ICU).
  // Dagsnøglen slås op midt i data-hentninger (useTrainingHistory), hvor et
  // kast ville rive resten af hentningen med sig og tømme hele historikken.
  assert.doesNotThrow(() => copenhagenDayKey(AUG17_2130Z, "Mars/Olympus_Mons"));
  assert.equal(copenhagenDayKey(AUG17_2130Z, "Mars/Olympus_Mons"), null);
  // Null-grenen findes allerede hos begge interne kaldere.
  assert.equal(copenhagenDayStart(AUG17_2130Z, "Mars/Olympus_Mons"), null);
  assert.equal(isRaceDayToday(AUG17_2130Z, AUG17_2130Z, "Mars/Olympus_Mons"), false);
});

test("isRaceDayToday: samme København-dag", () => {
  assert.equal(isRaceDayToday(AUG17_2130Z, Date.parse("2026-08-17T06:00:00Z")), true);
  assert.equal(isRaceDayToday(AUG17_2230Z, Date.parse("2026-08-17T06:00:00Z")), false);
});

test("copenhagenDayStart: sommertid (UTC+2) og vintertid (UTC+1)", () => {
  // 17/8 = CEST (UTC+2) → midnat lokalt er 16/8 22:00 UTC.
  assert.equal(copenhagenDayStart(AUG17_2130Z), Date.parse("2026-08-16T22:00:00Z"));
  // 10/1 = CET (UTC+1) → midnat lokalt er 9/1 23:00 UTC.
  assert.equal(
    copenhagenDayStart(Date.parse("2026-01-10T12:00:00Z")),
    Date.parse("2026-01-09T23:00:00Z"),
  );
  assert.equal(copenhagenDayStart(NaN), null);
});

test("copenhagenDayRange: dækker hele døgnet med padding, også over DST-skiftet", () => {
  const range = copenhagenDayRange(AUG17_2130Z, undefined, 0);
  assert.equal(range.startMs, Date.parse("2026-08-16T22:00:00Z"));
  assert.equal(range.endMs, Date.parse("2026-08-17T22:00:00Z"));
  // Efterårs-skiftet 25/10 2026: døgnet er 25 timer langt.
  const dst = copenhagenDayRange(Date.parse("2026-10-25T09:00:00Z"), undefined, 0);
  assert.equal((dst.endMs - dst.startMs) / 3_600_000, 25);
  assert.equal(copenhagenDayRange(NaN), null);
});

test("stageCardState: før slot = upcoming", () => {
  const scheduledMs = Date.parse("2026-08-17T17:00:00Z");
  assert.equal(
    stageCardState({ scheduledMs, nowMs: scheduledMs - 60_000, stageCompleted: false }),
    "upcoming",
  );
});

test("stageCardState: slot passeret uden resultater = live (aldrig 'finished')", () => {
  const scheduledMs = Date.parse("2026-08-17T17:00:00Z");
  // Langt uden for afspilningsvinduet, men motoren har ikke skrevet etapen færdig:
  // den må ikke præsenteres som afsluttet.
  assert.equal(
    stageCardState({ scheduledMs, nowMs: scheduledMs + 5 * LIVE_PLAYBACK_WINDOW_MS, stageCompleted: false }),
    "live",
  );
});

test("stageCardState: kørt etape er live i vinduet, færdig efter", () => {
  const scheduledMs = Date.parse("2026-08-17T17:00:00Z");
  assert.equal(
    stageCardState({ scheduledMs, nowMs: scheduledMs + LIVE_PLAYBACK_WINDOW_MS - 1, stageCompleted: true }),
    "live",
  );
  assert.equal(
    stageCardState({ scheduledMs, nowMs: scheduledMs + LIVE_PLAYBACK_WINDOW_MS, stageCompleted: true }),
    "finished",
  );
});

test("stageCardState: ugyldige tider → null", () => {
  assert.equal(stageCardState({ scheduledMs: NaN, nowMs: 1, stageCompleted: true }), null);
});

test("playbackKm: deterministisk lineær afspilning, klemt til [0, distance]", () => {
  const scheduledMs = 1_000_000;
  const windowMs = 1000;
  const distanceKm = 200;
  assert.equal(playbackKm({ scheduledMs, nowMs: scheduledMs, distanceKm, windowMs }), 0);
  assert.equal(playbackKm({ scheduledMs, nowMs: scheduledMs + 500, distanceKm, windowMs }), 100);
  assert.equal(playbackKm({ scheduledMs, nowMs: scheduledMs + 9999, distanceKm, windowMs }), 200);
  // Før slot klemmes til 0 (ingen negativ km).
  assert.equal(playbackKm({ scheduledMs, nowMs: scheduledMs - 500, distanceKm, windowMs }), 0);
  assert.equal(playbackKm({ scheduledMs, nowMs: scheduledMs, distanceKm: 0, windowMs }), 0);
});

test("latestFilmEvent: sidste passerede event, gap_update udelukkes", () => {
  const events = [
    { km: 0, type: "stage_start" },
    { km: 12, type: "breakaway_formed" },
    { km: 40, type: "gap_update", params: { gap_seconds: 200 } },
    { km: 120, type: "kom_passage" },
    { km: 180, type: "finish" },
  ];
  assert.equal(latestFilmEvent(events, 0)?.type, "stage_start");
  assert.equal(latestFilmEvent(events, 50)?.type, "breakaway_formed");
  assert.equal(latestFilmEvent(events, 150)?.type, "kom_passage");
  assert.equal(latestFilmEvent(events, 999)?.type, "finish");
  assert.equal(latestFilmEvent([], 10), null);
  assert.equal(latestFilmEvent(null, 10), null);
});

test("buildRaceCentreCards: filtrerer til i dag, sorterer live → upcoming → finished", () => {
  const nowMs = Date.parse("2026-08-17T17:10:00Z");
  const slots = [
    { raceId: "later", stageNumber: 3, scheduledMs: Date.parse("2026-08-17T19:00:00Z"), stagesCompleted: 2 },
    { raceId: "done", stageNumber: 1, scheduledMs: Date.parse("2026-08-17T12:00:00Z"), stagesCompleted: 1 },
    { raceId: "live", stageNumber: 2, scheduledMs: Date.parse("2026-08-17T17:00:00Z"), stagesCompleted: 2 },
    { raceId: "tomorrow", stageNumber: 1, scheduledMs: Date.parse("2026-08-18T12:00:00Z"), stagesCompleted: 0 },
  ];
  const cards = buildRaceCentreCards(slots, { nowMs });
  assert.deepEqual(cards.map((c) => c.raceId), ["live", "later", "done"]);
  assert.deepEqual(cards.map((c) => c.state), ["live", "upcoming", "finished"]);
  // muterer ikke input
  assert.equal(slots[0].state, undefined);
});

test("buildRaceCentreCards: todayOnly=false beholder alle slots", () => {
  const nowMs = Date.parse("2026-08-17T17:10:00Z");
  const slots = [{ raceId: "tomorrow", stageNumber: 1, scheduledMs: Date.parse("2026-08-18T12:00:00Z"), stagesCompleted: 0 }];
  assert.equal(buildRaceCentreCards(slots, { nowMs, todayOnly: false }).length, 1);
  assert.equal(buildRaceCentreCards(slots, { nowMs }).length, 0);
  assert.deepEqual(buildRaceCentreCards(null, { nowMs }), []);
});

test("buildRaceCentreCards: to færdige etaper sorteres nyeste først", () => {
  const nowMs = Date.parse("2026-08-17T20:00:00Z");
  const slots = [
    { raceId: "early", stageNumber: 1, scheduledMs: Date.parse("2026-08-17T10:00:00Z"), stagesCompleted: 1 },
    { raceId: "late", stageNumber: 1, scheduledMs: Date.parse("2026-08-17T14:00:00Z"), stagesCompleted: 1 },
  ];
  assert.deepEqual(buildRaceCentreCards(slots, { nowMs }).map((c) => c.raceId), ["late", "early"]);
});

test("stagePodium: top-3 sorteret på rank med egne ryttere markeret", () => {
  const results = [
    { rank: 3, rider_id: "c", team_id: "t2" },
    { rank: 1, rider_id: "a", team_id: "mine" },
    { rank: 2, rider_id: "b", team_id: "t3" },
    { rank: 9, rider_id: "d", team_id: "mine" },
    { rank: null, rider_id: "dnf", team_id: "t4" },
  ];
  const podium = stagePodium(results, { ownTeamId: "mine" });
  assert.deepEqual(podium.map((r) => r.rider_id), ["a", "b", "c"]);
  assert.deepEqual(podium.map((r) => r.isOwn), [true, false, false]);
  assert.deepEqual(stagePodium(null, { ownTeamId: "mine" }), []);
});

test("ownBestResult: bedste egne placering, null uden deltagelse", () => {
  const results = [
    { rank: 9, rider_id: "d", team_id: "mine" },
    { rank: 4, rider_id: "e", team_id: "mine" },
    { rank: 1, rider_id: "a", team_id: "other" },
  ];
  assert.equal(ownBestResult(results, "mine").rider_id, "e");
  assert.equal(ownBestResult(results, "nobody"), null);
  assert.equal(ownBestResult(results, null), null);
});
