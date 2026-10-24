import test from "node:test";
import assert from "node:assert/strict";
import {
  shortDayMonth, buildRiderInjuredNotification, buildTeamDidNotStartNotification,
  racesMissedByInjury, notifyRaceInjuries, notifyTeamsDidNotStart, RACE_AVAILABILITY_NOTIFICATION_TYPE,
  buildTrainingInjuryNotification, newTrainingInjuries, notifyTrainingInjuries,
} from "./raceAvailabilityNotifications.js";
import { NOTIFICATION_TYPES } from "./notificationTypes.js";
import { notStartedTeams } from "./raceRunner.js";

// Fast tidspunkt: testene maa aldrig laese uret (clock-drift-invarianten, AGENTS.md).
const NOW = new Date("2026-10-16T12:00:00Z");

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

test("buildRiderInjuredNotification #7042: haardt styrt koert faerdigt siger det, med og uden kommende loeb", () => {
  const n = buildRiderInjuredNotification({ riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-24", finishedStage: true });
  assert.equal(n.message, "A B crashed in R but finished the stage. He is injured until 24/10.");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.messageFinished");
  const m = buildRiderInjuredNotification({
    riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-24", finishedStage: true,
    missedRaces: [{ id: "x", name: "X" }],
  });
  assert.equal(m.message, "A B crashed in R but finished the stage. He is injured until 24/10 and will not ride X.");
  assert.equal(m.metadata.messageCode, "notif.riderInjured.messageFinishedMissed");
  assert.deepEqual(m.metadata.messageParams, { rider: "A B", race: "R", until: "24/10", missed: "X" });
});

test("riderInjured #7042: alle fire beskednoegler findes i hvert bundlet sprog med samme pladsholdere", async () => {
  const { readFileSync } = await import("node:fs");
  const bundle = JSON.parse(readFileSync(new URL("./locales/backendMessages.generated.json", import.meta.url), "utf8"));
  for (const [lang, msgs] of Object.entries(bundle)) {
    for (const key of ["message", "messageMissed", "messageFinished", "messageFinishedMissed"]) {
      const text = msgs[`notif.riderInjured.${key}`];
      assert.ok(text, `${lang}: notif.riderInjured.${key} mangler`);
      for (const p of ["{rider}", "{race}", "{until}"]) assert.ok(text.includes(p), `${lang} ${key} mangler ${p}`);
      assert.equal(text.includes("{missed}"), key.endsWith("Missed"), `${lang} ${key}: {missed}`);
    }
  }
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
      const q = {
        select: () => q, in: () => q, eq: () => q, neq: () => q, order: () => q,
        range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        then: (r) => r({ data: rows, error: null }),
      };
      return q;
    },
  };
}

test("notifyRaceInjuries: én besked pr. skadet rytter til holdets ejer, med de loeb han misser", async () => {
  const sent = [];
  const supabase = fakeDb({
    riders: [{ id: "adrien", firstname: "Adrien", lastname: "Charpentier", team_id: "lorraine" }],
    // Svaret efter races!inner-filteret: kun løb der ikke er startet (Westkust er væk).
    race_entries: [
      { race_id: "leman", rider_id: "adrien", team_id: "lorraine",
        races: { id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled" } },
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
    now: NOW, notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].teamId, "lorraine");
  assert.match(sent[0].message, /He will not ride Tour du Léman\.$/);
});

test("notifyRaceInjuries: ingen skaderaekker -> ingen opslag, ingen beskeder", async () => {
  const supabase = { from: () => { throw new Error("should not query"); } };
  assert.deepEqual(await notifyRaceInjuries({ supabase, race: { id: "r" }, injuryRows: [], now: NOW }), { sent: 0 });
});

test("notifyTeamsDidNotStart: én besked pr. hold (dubletter samlet)", async () => {
  const sent = [];
  const out = await notifyTeamsDidNotStart({
    supabase: {}, race: { id: "danube", name: "Tour du Danube" }, teamIds: ["csc", "csc", "talent"],
    now: NOW, notify: async (args) => { sent.push(args.teamId); return { delivered: true }; },
  });
  assert.equal(out.sent, 2);
  assert.deepEqual(sent, ["csc", "talent"]);
});

test("notifyRaceInjuries: et loeb holdet har meldt fra, naevnes ikke (review #6742)", async () => {
  const sent = [];
  const supabase = fakeDb({
    riders: [{ id: "adrien", firstname: "Adrien", lastname: "Charpentier", team_id: "lorraine" }],
    race_entries: [
      { race_id: "leman", rider_id: "adrien", team_id: "lorraine",
        races: { id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled" } },
    ],
    race_withdrawals: [{ race_id: "leman", team_id: "lorraine" }],
    race_stage_schedule: [{ race_id: "leman", scheduled_at: "2026-10-16T17:00:00Z" }],
  });
  await notifyRaceInjuries({
    supabase, race: { id: "westkust", name: "Westkust Klassieker" },
    injuryRows: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    now: NOW, notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(sent[0].message, "Adrien Charpentier crashed in Westkust Klassieker and is injured until 19/10.");
  assert.equal(sent[0].relatedId, "westkust");
});

// ── #6740 review: hold der mistede alle entries foer gulvet faar ogsaa besked ──
test("notStartedTeams: gulvets hold + hold uden entries tilbage, aldrig afmeldte", () => {
  assert.deepEqual(notStartedTeams({
    droppedTeamIds: ["floor"],
    selectedTeamIds: new Set(["floor", "all-ghosts", "started", "withdrawn"]),
    keptTeamIds: new Set(["started"]),
    withdrawnTeamIds: new Set(["withdrawn"]),
  }), ["all-ghosts", "floor"]);
  assert.deepEqual(notStartedTeams({}), []);
});

test("notifyTeamsDidNotStart: én fejlende modtager stopper ikke de oevrige (review #6742)", async () => {
  const sent = [];
  const out = await notifyTeamsDidNotStart({
    supabase: {}, race: { id: "danube", name: "Tour du Danube" }, teamIds: ["broken", "csc", "talent"], now: NOW,
    notify: async (args) => {
      if (args.teamId === "broken") throw new Error("owner lookup failed");
      sent.push(args.teamId);
      return { delivered: true };
    },
  });
  assert.equal(out.sent, 2);
  assert.deepEqual(sent, ["csc", "talent"]);
});

// ── #7086: træningsskader ────────────────────────────────────────────────────

test("buildTrainingInjuryNotification #7086: årsag træning, intet løb, link til rytteren", () => {
  const n = buildTrainingInjuryNotification({ riderId: "rider-a", riderName: "Rytter A", injuredUntil: "2026-10-19" });
  assert.equal(n.type, "selection_warning");
  assert.equal(n.title, "Rider injured");
  assert.equal(n.message, "Rytter A was injured in training and is out until 19/10.");
  assert.equal(n.relatedId, "rider-a", "dedup er pr. rytter");
  assert.equal(n.metadata.riderId, "rider-a", "frontend deep-linker til rytterprofilen");
  assert.equal(n.metadata.raceId, undefined, "ingen løbs-link");
  assert.equal(n.metadata.titleCode, "notif.riderInjured.title");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.messageTraining");
  assert.deepEqual(n.metadata.messageParams, { rider: "Rytter A", until: "19/10" });
});

test("riderInjured.messageTraining #7086: findes i hvert bundlet sprog med {rider} + {until} og uden {race}", async () => {
  const { readFileSync } = await import("node:fs");
  const bundle = JSON.parse(readFileSync(new URL("./locales/backendMessages.generated.json", import.meta.url), "utf8"));
  for (const [lang, msgs] of Object.entries(bundle)) {
    const text = msgs["notif.riderInjured.messageTraining"];
    assert.ok(text, `${lang}: notif.riderInjured.messageTraining mangler`);
    for (const p of ["{rider}", "{until}"]) assert.ok(text.includes(p), `${lang} mangler ${p}`);
    for (const p of ["{race}", "{missed}"]) assert.ok(!text.includes(p), `${lang} maa ikke have ${p}`);
  }
  assert.equal(bundle.da["notif.riderInjured.messageTraining"], "{rider} blev skadet i træningen og er ude til {until}.");
});

test("newTrainingInjuries #7086: kun skader rullet i dette tick, dato fra condition-raekken, ingen overståede", () => {
  const out = newTrainingInjuries({
    today: "2026-10-16",
    reportRiders: [
      { rider_id: "new", name: "Ny Skade", injury_days: 3 },
      { rider_id: "ongoing", name: "Allerede Skadet", injured: true, injury_days: 0 },
      { rider_id: "healthy", name: "Rask", injury_days: 0 },
      { rider_id: "stale", name: "Gammel Dato", injury_days: 1 },
      { rider_id: "nocond", name: "Ingen Raekke", injury_days: 2 },
    ],
    conditionUpserts: [
      { rider_id: "new", injured_until: "2026-10-21" },
      { rider_id: "ongoing", injured_until: "2026-10-18" },
      { rider_id: "healthy", injured_until: null },
      { rider_id: "stale", injured_until: "2026-10-12" },
    ],
  });
  assert.deepEqual(out, [{ riderId: "new", riderName: "Ny Skade", injuredUntil: "2026-10-21" }]);
});

test("notifyTrainingInjuries #7086: én besked pr. ny skade til holdets ejer", async () => {
  const calls = [];
  const out = await notifyTrainingInjuries({
    supabase: {}, teamId: "team-a", now: NOW,
    reportRiders: [{ rider_id: "r1", name: "A B", injury_days: 2 }, { rider_id: "r2", name: "C D", injury_days: 0 }],
    conditionUpserts: [{ rider_id: "r1", injured_until: "2026-10-18" }, { rider_id: "r2", injured_until: null }],
    notify: async (args) => { calls.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].teamId, "team-a");
  assert.equal(calls[0].message, "A B was injured in training and is out until 18/10.");
  assert.equal(calls[0].relatedId, "r1");
});

test("notifyTrainingInjuries #7086: ingen nye skader -> intet kald", async () => {
  let called = false;
  const out = await notifyTrainingInjuries({
    supabase: {}, teamId: "team-a", now: NOW, reportRiders: [{ rider_id: "r1", injury_days: 0 }], conditionUpserts: [],
    notify: async () => { called = true; return { delivered: true }; },
  });
  assert.equal(out.sent, 0);
  assert.equal(called, false);
});

test("notifyTrainingInjuries #7086: kaster aldrig, og én fejl stopper ikke de øvrige", async () => {
  const sent = [];
  const out = await notifyTrainingInjuries({
    supabase: {}, teamId: "team-a", now: NOW,
    reportRiders: [{ rider_id: "bad", name: "X", injury_days: 1 }, { rider_id: "ok", name: "Y", injury_days: 1 }],
    conditionUpserts: [{ rider_id: "bad", injured_until: "2026-10-18" }, { rider_id: "ok", injured_until: "2026-10-18" }],
    notify: async (args) => { if (args.relatedId === "bad") throw new Error("insert failed"); sent.push(args.relatedId); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.deepEqual(sent, ["ok"]);
  const broken = await notifyTrainingInjuries({ supabase: {}, teamId: "team-a", now: NOW, reportRiders: null, conditionUpserts: { not: "an array" } });
  assert.equal(broken.sent, 0, "selv ugyldigt input kaster ikke");
});

// Lille notifications-mock til den ægte notifyTeamOwner/notifyUser-dedup.
function dedupSupabase({ userId = "user-a" } = {}) {
  const rows = [];
  const query = (table, filters = []) => ({
    select: () => query(table, filters),
    eq: (c, v) => query(table, [...filters, (r) => r[c] === v]),
    is: (c, v) => query(table, [...filters, (r) => (r[c] ?? null) === v]),
    gte: (c, v) => query(table, [...filters, (r) => r[c] >= v]),
    order: () => query(table, filters),
    limit: (n) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, n), error: null }),
    single: () => Promise.resolve({ data: { user_id: userId }, error: null }),
    insert: (row) => { rows.push({ ...row, created_at: NOW.toISOString() }); return Promise.resolve({ error: null }); },
  });
  return { rows, from: (table) => query(table) };
}

test("notifyTrainingInjuries #7086: samme skade sendt to gange giver én besked (dedup i notifyUser)", async () => {
  const supabase = dedupSupabase();
  const args = {
    supabase, teamId: "team-dedup", now: NOW,
    reportRiders: [{ rider_id: "r1", name: "A B", injury_days: 2 }],
    conditionUpserts: [{ rider_id: "r1", injured_until: "2026-10-18" }],
  };
  assert.equal((await notifyTrainingInjuries(args)).sent, 1);
  assert.equal((await notifyTrainingInjuries(args)).sent, 0, "genkørsel samme dag sender ikke igen");
  assert.equal(supabase.rows.length, 1);
  assert.equal(supabase.rows[0].type, "selection_warning");
  assert.equal(supabase.rows[0].related_id, "r1");
});
