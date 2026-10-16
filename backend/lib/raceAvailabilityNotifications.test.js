import test from "node:test";
import assert from "node:assert/strict";
import {
  shortDayMonth, buildRiderInjuredNotification, buildTeamDidNotStartNotification,
  racesMissedByInjury, notifyRaceInjuries, notifyTeamsDidNotStart, RACE_AVAILABILITY_NOTIFICATION_TYPE,
} from "./raceAvailabilityNotifications.js";
import { NOTIFICATION_TYPES } from "./notificationTypes.js";

test("typen findes allerede i notifications_type_check (ingen migration)", () => {
  assert.ok(NOTIFICATION_TYPES.includes(RACE_AVAILABILITY_NOTIFICATION_TYPE));
});

test("shortDayMonth: ISO-dato -> dag/maaned, ugyldigt -> null", () => {
  assert.equal(shortDayMonth("2026-10-19"), "19/10");
  assert.equal(shortDayMonth("2026-01-05"), "5/1");
  assert.equal(shortDayMonth(null), null);
  assert.equal(shortDayMonth("19/10"), null);
});

test("buildRiderInjuredNotification: Friis' sag (styrt i Westkust, misser Leman)", () => {
  const n = buildRiderInjuredNotification({
    riderName: "Adrien Charpentier", raceName: "Westkust Klassieker", raceId: "westkust",
    injuredUntil: "2026-10-19", missedRaces: [{ id: "leman", name: "Tour du Léman" }],
  });
  assert.equal(n.type, "selection_warning");
  assert.equal(n.title, "Rider injured");
  assert.equal(n.message, "Adrien Charpentier crashed in Westkust Klassieker and is injured until 19/10. He will not ride Tour du Léman.");
  assert.equal(n.relatedId, "leman", "linket peger paa det loeb manageren skal handle paa");
  assert.equal(n.metadata.raceId, "leman");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.messageMissed");
  assert.deepEqual(n.metadata.messageParams, { rider: "Adrien Charpentier", race: "Westkust Klassieker", until: "19/10", missed: "Tour du Léman" });
});

test("buildRiderInjuredNotification: uden kommende loeb linker den til styrt-loebet", () => {
  const n = buildRiderInjuredNotification({ riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-19" });
  assert.equal(n.message, "A B crashed in R and is injured until 19/10.");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.message");
  assert.equal(n.relatedId, "r1");
});

test("buildTeamDidNotStartNotification: tekst + noegler", () => {
  const n = buildTeamDidNotStartNotification({ raceId: "leman", raceName: "Tour du Léman" });
  assert.equal(n.type, "selection_warning");
  assert.equal(n.title, "Your team did not start");
  assert.equal(n.message, "Your team did not start Tour du Léman: fewer than 6 fit riders at the start.");
  assert.deepEqual(n.metadata, {
    raceId: "leman", titleCode: "notif.teamDidNotStart.title", titleParams: {},
    messageCode: "notif.teamDidNotStart.message", messageParams: { race: "Tour du Léman", min: 6 },
  });
});

test("racesMissedByInjury: kun kommende, ikke-startede loeb der starter inden skaden er overstaaet", () => {
  const races = [
    { id: "crash", name: "Westkust", stages_completed: 1, status: "completed" },
    { id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled" },
    { id: "later", name: "Late Race", stages_completed: 0, status: "scheduled" },
    { id: "running", name: "Hexagone", stages_completed: 15, status: "scheduled" },
  ];
  const firstStageDateByRace = new Map([["crash", "2026-10-16"], ["leman", "2026-10-16"], ["later", "2026-10-20"], ["running", "2026-10-01"]]);
  const entries = ["crash", "leman", "later", "running", "leman"].map((race_id) => ({ race_id }));
  assert.deepEqual(
    racesMissedByInjury({ entries, races, firstStageDateByRace, injuredUntil: "2026-10-19", crashRaceId: "crash" }),
    [{ id: "leman", name: "Tour du Léman" }],
  );
});

function fakeDb(tables) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const q = { select: () => q, in: () => q, eq: () => q, then: (r) => r({ data: rows, error: null }) };
      return q;
    },
  };
}

test("notifyRaceInjuries: én besked pr. skadet rytter til holdets ejer, med de loeb han misser", async () => {
  const sent = [];
  const supabase = fakeDb({
    riders: [{ id: "adrien", firstname: "Adrien", lastname: "Charpentier", team_id: "lorraine" }],
    race_entries: [
      { race_id: "westkust", rider_id: "adrien", team_id: "lorraine" },
      { race_id: "leman", rider_id: "adrien", team_id: "lorraine" },
    ],
    races: [
      { id: "westkust", name: "Westkust Klassieker", stages_completed: 1, status: "completed" },
      { id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled" },
    ],
    race_stage_schedule: [
      { race_id: "westkust", scheduled_at: "2026-10-16T09:00:00Z" },
      { race_id: "leman", scheduled_at: "2026-10-16T17:00:00Z" },
      { race_id: "leman", scheduled_at: "2026-10-17T09:00:00Z" },
    ],
  });
  const out = await notifyRaceInjuries({
    supabase, race: { id: "westkust", name: "Westkust Klassieker" },
    injuryRows: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].teamId, "lorraine");
  assert.match(sent[0].message, /He will not ride Tour du Léman\.$/);
});

test("notifyRaceInjuries: ingen skaderaekker -> ingen opslag, ingen beskeder", async () => {
  const supabase = { from: () => { throw new Error("should not query"); } };
  assert.deepEqual(await notifyRaceInjuries({ supabase, race: { id: "r" }, injuryRows: [] }), { sent: 0 });
});

test("notifyTeamsDidNotStart: én besked pr. hold (dubletter samlet)", async () => {
  const sent = [];
  const out = await notifyTeamsDidNotStart({
    supabase: {}, race: { id: "danube", name: "Tour du Danube" }, teamIds: ["csc", "csc", "talent"],
    notify: async (args) => { sent.push(args.teamId); return { delivered: true }; },
  });
  assert.equal(out.sent, 2);
  assert.deepEqual(sent, ["csc", "talent"]);
});
