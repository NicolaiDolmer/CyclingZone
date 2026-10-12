// #1140 — model for "Your first race"-kortet: tidsberegning i spillerens egen
// zone, saertilfaelde (loeb i gang, saesonpause) og at assistent-/mail-linjerne
// og guld-knappen kun optraeder naar de er sande.
import test from "node:test";
import assert from "node:assert/strict";

import {
  RESULT_DELAY_MS,
  dayKeyFor,
  describeMoment,
  pickFirstRaceCardRace,
  buildFirstRaceCardModel,
} from "./firstRaceCardModel.js";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const hours = (n) => n * 3600 * 1000;
const scheduled = (id, extra = {}) => ({ id, name: `Race ${id}`, status: "scheduled", stages: 4, stages_completed: 0, pool_race: { date_text: "01.03" }, ...extra });
const live = (id, extra = {}) => ({ id, name: `Race ${id}`, status: "scheduled", stages: 4, stages_completed: 1, pool_race: { date_text: "01.02" }, ...extra });

test("dayKeyFor: i dag / i morgen / dato i spillerens zone, ikke i en fast zone", () => {
  // 23:30 UTC 12/10 er allerede 13/10 i Tokyo (UTC+9), men stadig 12/10 i UTC.
  const late = Date.parse("2026-10-12T23:30:00Z");
  const target = Date.parse("2026-10-13T08:00:00Z");
  assert.equal(dayKeyFor(target, late, "UTC"), "tomorrow");
  assert.equal(dayKeyFor(target, late, "Asia/Tokyo"), "today");
  assert.equal(dayKeyFor(Date.parse("2026-10-15T08:00:00Z"), late, "UTC"), "date");
  assert.equal(dayKeyFor(NaN, late, "UTC"), "date");
});

test("dayKeyFor: i morgen er naeste kalenderdag ogsaa over sommertid-skiftet", () => {
  // Europe/Copenhagen skifter til vintertid soendag 25/10/2026 (dagen er 25 t lang).
  const now = Date.parse("2026-10-24T20:00:00Z"); // 22:00 loerdag lokal
  const target = Date.parse("2026-10-25T22:30:00Z"); // 23:30 soendag lokal
  assert.equal(dayKeyFor(target, now, "Europe/Copenhagen"), "tomorrow");
});

test("describeMoment: klokkeslaet staar i den angivne zone", () => {
  const ms = Date.parse("2026-10-13T10:00:00Z");
  assert.equal(describeMoment(ms, NOW, { timeZone: "UTC", locale: "en" }).clock, "10:00");
  assert.equal(describeMoment(ms, NOW, { timeZone: "Asia/Tokyo", locale: "en" }).clock, "19:00");
});

test("pickFirstRaceCardRace: udtageligt foer i gang; tomt = null", () => {
  assert.equal(pickFirstRaceCardRace([]), null);
  assert.equal(pickFirstRaceCardRace(null), null);
  const picked = pickFirstRaceCardRace([live("L"), scheduled("S")], new Set(["L"]));
  assert.equal(picked.race.id, "S");
  assert.equal(picked.kind, "upcoming");
  const onlyLive = pickFirstRaceCardRace([live("L")], new Set(["L"]));
  // Et loeb i gang som holdet ikke er tilmeldt (eller ukendt tilmelding) er ikke holdets foerste loeb.
  assert.equal(pickFirstRaceCardRace([live("L")], new Set()), null);
  assert.equal(pickFirstRaceCardRace([live("L")]), null);
  assert.equal(onlyLive.race.id, "L");
  assert.equal(onlyLive.kind, "started");
});

test("upcoming: tider, etaper, resultattid og guld-knap naar udtagelse mangler", () => {
  const race = scheduled("R1");
  const startMs = NOW + hours(17);
  const m = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: { R1: startMs }, squadSelectionMissingRace: race,
    card: { assistant_picks: true, mail: true }, nowMs: NOW, timeZone: "UTC", locale: "en",
  });
  assert.equal(m.kind, "upcoming");
  assert.equal(m.stages, 4);
  assert.equal(m.isStageRace, true);
  assert.equal(m.start.clock, "03:00");
  assert.equal(m.start.dayKey, "tomorrow");
  assert.equal(m.resultAt.ms, startMs + RESULT_DELAY_MS);
  assert.equal(m.resultAt.clock, "04:00");
  assert.equal(m.showCta, true);
  assert.equal(m.showAssistant, true);
  assert.equal(m.mentionMail, true);
  assert.equal(m.ctaTo, "/races/R1#selection");
});

test("assistent- og mail-saetningerne udelades naar serveren ikke siger de er sande", () => {
  const race = scheduled("R1");
  const m = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: { R1: NOW + hours(5) }, squadSelectionMissingRace: race,
    card: { assistant_picks: false, mail: false }, nowMs: NOW, timeZone: "UTC",
  });
  assert.equal(m.showAssistant, false);
  assert.equal(m.mentionMail, false);
  const none = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: { R1: NOW + hours(5) }, squadSelectionMissingRace: race, card: {}, nowMs: NOW, timeZone: "UTC",
  });
  assert.equal(none.showAssistant, false);
  assert.equal(none.mentionMail, false);
});

test("trup allerede gemt: ingen guld-knap, ingen assistent-linje, men tider vises", () => {
  const race = scheduled("R1");
  const m = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: { R1: NOW + hours(5) }, squadSelectionMissingRace: null,
    card: { assistant_picks: true }, nowMs: NOW, timeZone: "UTC",
  });
  assert.equal(m.kind, "upcoming");
  assert.equal(m.showNow, true);
  assert.equal(m.selectionMissing, false);
  assert.equal(m.showCta, false);
  assert.equal(m.showAssistant, false);
  assert.ok(m.start);
});

test("manglende etape-tid: ingen opfundne tider", () => {
  const race = scheduled("R1");
  const m = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: {}, squadSelectionMissingRace: race, card: {}, nowMs: NOW, timeZone: "UTC",
  });
  assert.equal(m.start, null);
  assert.equal(m.resultAt, null);
  assert.equal(m.showCta, true);
});

test("saertilfaelde: loebet er allerede startet (naeste etape + tidspunkt, ingen guld-knap)", () => {
  const race = live("L1");
  const m = buildFirstRaceCardModel({
    nextRaces: [race], nextStageByRace: { L1: NOW + hours(3) }, squadSelectionMissingRace: null, enteredRaceIds: new Set(["L1"]),
    card: { assistant_picks: true, mail: true }, nowMs: NOW, timeZone: "UTC", locale: "en",
  });
  assert.equal(m.kind, "started");
  assert.equal(m.stageNumber, 2);
  assert.equal(m.showNow, false);
  assert.equal(m.showCta, false);
  assert.equal(m.showAssistant, false);
  assert.equal(m.start.clock, "13:00");
  assert.equal(m.resultAt.clock, "14:00");
});

test("saertilfaelde: saesonpause uden loeb (naeste saesonstart, ingen guld-knap)", () => {
  const m = buildFirstRaceCardModel({
    nextRaces: [], card: { next_season_start: "2026-11-02" }, nowMs: NOW, timeZone: "UTC", locale: "en",
  });
  assert.equal(m.kind, "pause");
  assert.equal(m.showCta, false);
  assert.equal(m.nextSeasonStart.dayKey, "date");
  assert.match(m.nextSeasonStart.dayLabel, /2/);
  const unknown = buildFirstRaceCardModel({ nextRaces: [], card: {}, nowMs: NOW, timeZone: "UTC" });
  assert.equal(unknown.kind, "pause");
  assert.equal(unknown.nextSeasonStart, null);
});

test("endagsloeb: isStageRace er false", () => {
  const race = scheduled("D1", { stages: 1 });
  const m = buildFirstRaceCardModel({ nextRaces: [race], nextStageByRace: { D1: NOW + hours(2) }, squadSelectionMissingRace: race, card: {}, nowMs: NOW, timeZone: "UTC" });
  assert.equal(m.isStageRace, false);
  assert.equal(m.stages, 1);
});
