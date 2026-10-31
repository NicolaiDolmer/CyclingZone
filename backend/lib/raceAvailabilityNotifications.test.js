import test from "node:test";
import assert from "node:assert/strict";
import {
  shortDayMonth, buildRiderInjuredNotification, buildTeamDidNotStartNotification,
  racesStartingInInjury, notifyRaceInjuries, notifyTeamsDidNotStart, RACE_AVAILABILITY_NOTIFICATION_TYPE,
  buildTrainingInjuryNotification, newTrainingInjuries, notifyTrainingInjuries,
  fitAgainDate, MISSED_RACES_LISTED, loadPoolRacesStartingBy,
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

test("#7412 fitAgainDate: foerste raske dag er dagen efter injured_until (ogsaa over maaneds-/aarsskifte)", () => {
  assert.equal(fitAgainDate("2026-11-02"), "2026-11-03");
  assert.equal(fitAgainDate("2026-10-31"), "2026-11-01");
  assert.equal(fitAgainDate("2026-12-31"), "2027-01-01");
  assert.equal(fitAgainDate(null), null);
  assert.equal(fitAgainDate("2/11"), null);
});

test("buildRiderInjuredNotification: Friis' sag (styrt i Westkust, misser Leman), #7412 fit again", () => {
  const n = buildRiderInjuredNotification({
    riderName: "Adrien Charpentier", raceName: "Westkust Klassieker", raceId: "westkust",
    injuredUntil: "2026-10-19", missedRaces: [{ id: "leman", name: "Tour du Léman" }],
  });
  assert.equal(n.type, "selection_warning");
  assert.equal(n.title, "Rider injured");
  assert.equal(n.message, "Adrien Charpentier crashed in Westkust Klassieker and is fit again on 20/10. He will miss Tour du Léman.");
  assert.equal(n.relatedId, "leman", "linket peger paa det loeb manageren skal handle paa");
  assert.equal(n.metadata.raceId, "leman");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.crashMissed");
  assert.deepEqual(n.metadata.messageParams, { rider: "Adrien Charpentier", race: "Westkust Klassieker", fitAgain: "20/10", missed: "Tour du Léman", more: 0 });
});

test("buildRiderInjuredNotification: uden kommende loeb linker den til styrt-loebet", () => {
  const n = buildRiderInjuredNotification({ riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-19" });
  assert.equal(n.message, "A B crashed in R and is fit again on 20/10.");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.crash");
  assert.equal(n.relatedId, "r1");
});

test("buildRiderInjuredNotification #7042: haardt styrt koert faerdigt siger det, med og uden kommende loeb", () => {
  const n = buildRiderInjuredNotification({ riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-24", finishedStage: true });
  assert.equal(n.message, "A B crashed in R but finished the stage. He is fit again on 25/10.");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.crashFinished");
  const m = buildRiderInjuredNotification({
    riderName: "A B", raceName: "R", raceId: "r1", injuredUntil: "2026-10-24", finishedStage: true,
    missedRaces: [{ id: "x", name: "X" }],
  });
  assert.equal(m.message, "A B crashed in R but finished the stage. He is fit again on 25/10. He will miss X.");
  assert.equal(m.metadata.messageCode, "notif.riderInjured.crashFinishedMissed");
  assert.deepEqual(m.metadata.messageParams, { rider: "A B", race: "R", fitAgain: "25/10", missed: "X", more: 0 });
});

test("#7412 buildRiderInjuredNotification: mange loeb -> de foerste fem + antal resten", () => {
  const missedRaces = ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ id: name.toLowerCase(), name }));
  const n = buildRiderInjuredNotification({ riderName: "X Y", raceName: "R", raceId: "r", injuredUntil: "2026-11-02", missedRaces });
  assert.equal(MISSED_RACES_LISTED, 5);
  assert.equal(n.message, "X Y crashed in R and is fit again on 3/11. He will miss A, B, C, D, E and 2 more races.");
  assert.equal(n.metadata.messageParams.missed, "A, B, C, D, E");
  assert.equal(n.metadata.messageParams.more, 2);
  const one = buildRiderInjuredNotification({ riderName: "X Y", raceName: "R", raceId: "r", injuredUntil: "2026-11-02", missedRaces: missedRaces.slice(0, 6) });
  assert.match(one.message, /and 1 more race\.$/);
});

test("#7412 riderInjured: de seks nye noegler findes i hvert bundlet sprog med de rigtige pladsholdere", async () => {
  const { readFileSync } = await import("node:fs");
  const bundle = JSON.parse(readFileSync(new URL("./locales/backendMessages.generated.json", import.meta.url), "utf8"));
  for (const [lang, msgs] of Object.entries(bundle)) {
    for (const key of ["crash", "crashMissed", "crashFinished", "crashFinishedMissed", "training", "trainingMissed"]) {
      const text = msgs[`notif.riderInjured.${key}`];
      assert.ok(text, `${lang}: notif.riderInjured.${key} mangler`);
      assert.ok(text.includes("{rider}") && text.includes("{fitAgain}"), `${lang} ${key}: {rider}/{fitAgain}`);
      assert.ok(!text.includes("{until}"), `${lang} ${key}: "until" er erstattet af foerste raske dag`);
      assert.equal(text.includes("{race}"), key.startsWith("crash"), `${lang} ${key}: {race}`);
      const missed = key.endsWith("Missed");
      assert.equal(text.includes("{missed}"), missed, `${lang} ${key}: {missed}`);
      assert.equal(text.includes("{more, plural,"), missed, `${lang} ${key}: {more}`);
      assert.ok(!/[–—]/.test(text), `${lang} ${key}: ingen tankestreg`);
    }
  }
  assert.equal(bundle.da["notif.riderInjured.crash"], "{rider} styrtede i {race} og er rask igen {fitAgain}.");
});

// Gamle beskeder i indbakken bruger stadig de gamle noegler; de skal kunne renderes.
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

// #7412: ALLE loeb i rytterens pulje der starter i skadeperioden, ikke kun tilmeldte.
const POOL_RACES = [
  { id: "crash", name: "Westkust", squad: "senior", poolId: 3, start: "2026-10-16" },
  { id: "leman", name: "Tour du Léman", squad: "senior", poolId: 3, start: "2026-10-16" },
  { id: "notentered", name: "Grand Prix Ikke Tilmeldt", squad: "senior", poolId: 3, start: "2026-10-18" },
  { id: "lastday", name: "Sidste Skadedag", squad: "senior", poolId: 3, start: "2026-10-19" },
  { id: "fit", name: "Rask Igen", squad: "senior", poolId: 3, start: "2026-10-20" },
  { id: "yesterday", name: "I Gaar", squad: "senior", poolId: 3, start: "2026-10-15" },
  { id: "otherpool", name: "Anden Division", squad: "senior", poolId: 4, start: "2026-10-17" },
  { id: "u23", name: "U23 Loeb", squad: "u23", poolId: 3, start: "2026-10-17" },
];

test("#7412 racesStartingInInjury: alle puljens loeb fra i dag til sidste skadedag, uanset tilmelding", () => {
  assert.deepEqual(
    racesStartingInInjury({ races: POOL_RACES, squad: "senior", poolId: 3, injuredUntil: "2026-10-19", today: "2026-10-16", crashRaceId: "crash" }),
    [
      { id: "leman", name: "Tour du Léman" },
      { id: "notentered", name: "Grand Prix Ikke Tilmeldt" },
      { id: "lastday", name: "Sidste Skadedag" },
    ],
  );
});

test("#7412 racesStartingInInjury: trup, afmelding og manglende pulje", () => {
  assert.deepEqual(
    racesStartingInInjury({ races: POOL_RACES, squad: "u23", poolId: 3, injuredUntil: "2026-10-19", today: "2026-10-16" }).map((r) => r.id),
    ["u23"],
  );
  assert.deepEqual(
    racesStartingInInjury({ races: POOL_RACES, squad: null, poolId: 3, injuredUntil: "2026-10-19", today: "2026-10-16", crashRaceId: "crash", withdrawnRaceIds: new Set(["leman"]) }).map((r) => r.id),
    ["notentered", "lastday"],
    "en manglende trup er senior; et loeb holdet har meldt fra, naevnes ikke (review #6742)",
  );
  assert.deepEqual(racesStartingInInjury({ races: POOL_RACES, squad: "senior", poolId: null, injuredUntil: "2026-10-19", today: "2026-10-16" }), []);
});

function fakeDb(tables, calls = []) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const q = {};
      for (const m of ["select", "in", "eq", "neq", "order", "gte", "lt"]) {
        q[m] = (...args) => { calls.push([table, m, ...args]); return q; };
      }
      q.range = (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      q.then = (r) => r({ data: rows, error: null });
      return q;
    },
  };
}

const sched = (raceId, scheduledAt, extra = {}) => ({
  race_id: raceId, stage_number: 1, scheduled_at: scheduledAt,
  races: { id: raceId, name: extra.name ?? raceId, squad: extra.squad ?? "senior", league_division_id: extra.pool ?? 3, stages_completed: 0, status: "scheduled" },
});

test("#7412 loadPoolRacesStartingBy: foerste etapes DANSKE dato pr. loeb, filtreret paa pulje og ikke-startet", async () => {
  const calls = [];
  const supabase = fakeDb({
    race_stage_schedule: [
      sched("a", "2026-10-17T09:00:00Z", { name: "A" }),
      sched("a", "2026-10-16T22:30:00Z", { name: "A" }),
      sched("b", "2026-10-18T12:00:00Z", { name: "B", squad: "u23" }),
    ],
  }, calls);
  const races = await loadPoolRacesStartingBy({ supabase, poolIds: [3, 3, null], untilDate: "2026-10-19", now: NOW });
  assert.deepEqual(races, [
    { id: "a", name: "A", squad: "senior", poolId: 3, start: "2026-10-17" },
    { id: "b", name: "B", squad: "u23", poolId: 3, start: "2026-10-18" },
  ]);
  const filters = calls.filter(([t]) => t === "race_stage_schedule").map(([, m, ...a]) => [m, ...a]);
  assert.deepEqual(filters.find(([m, c]) => m === "in" && c === "races.league_division_id"), ["in", "races.league_division_id", [3]]);
  assert.ok(filters.some(([m, c, v]) => m === "eq" && c === "races.stages_completed" && v === 0));
  assert.ok(filters.some(([m, c, v]) => m === "neq" && c === "races.status" && v === "completed"));
  assert.ok(filters.some(([m, c, v]) => m === "lt" && c === "scheduled_at" && v === "2026-10-20T00:00:00Z"));
  assert.deepEqual(await loadPoolRacesStartingBy({ supabase, poolIds: [null], untilDate: "2026-10-19", now: NOW }), []);
});

const FRIIS_DB = () => ({
  riders: [{ id: "adrien", firstname: "Adrien", lastname: "Charpentier", team_id: "lorraine", squad: "senior" }],
  teams: [{ id: "lorraine", league_division_id: 3, u23_league_division_id: 7, junior_league_division_id: 8 }],
  race_stage_schedule: [
    sched("leman", "2026-10-16T17:00:00Z", { name: "Tour du Léman" }),
    sched("leman", "2026-10-17T09:00:00Z", { name: "Tour du Léman" }),
    sched("ardennes", "2026-10-18T09:00:00Z", { name: "Ardennes Classic" }),
  ],
});

test("notifyRaceInjuries #7412: én besked pr. skadet rytter, med ALLE loeb i skadeperioden og foerste raske dag", async () => {
  const sent = [];
  const out = await notifyRaceInjuries({
    supabase: fakeDb(FRIIS_DB()), race: { id: "westkust", name: "Westkust Klassieker" },
    injuryRows: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    now: NOW, notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].teamId, "lorraine");
  assert.equal(sent[0].message, "Adrien Charpentier crashed in Westkust Klassieker and is fit again on 20/10. He will miss Tour du Léman, Ardennes Classic.");
  assert.equal(sent[0].relatedId, "leman");
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
  const db = { ...FRIIS_DB(), race_withdrawals: [{ race_id: "leman", team_id: "lorraine" }] };
  db.race_stage_schedule = db.race_stage_schedule.filter((r) => r.race_id === "leman");
  await notifyRaceInjuries({
    supabase: fakeDb(db), race: { id: "westkust", name: "Westkust Klassieker" },
    injuryRows: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    now: NOW, notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(sent[0].message, "Adrien Charpentier crashed in Westkust Klassieker and is fit again on 20/10.");
  assert.equal(sent[0].relatedId, "westkust");
});

test("#7412 notifyRaceInjuries: et fejlet loebsopslag koster listen, aldrig beskeden", async () => {
  const sent = [];
  const db = fakeDb(FRIIS_DB());
  const supabase = { from: (t) => { if (t === "teams") throw new Error("teams down"); return db.from(t); } };
  const out = await notifyRaceInjuries({
    supabase, race: { id: "westkust", name: "Westkust Klassieker" },
    injuryRows: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    now: NOW, notify: async (args) => { sent.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].message, "Adrien Charpentier crashed in Westkust Klassieker and is fit again on 20/10.");
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
  assert.equal(n.message, "Rytter A was injured in training and is fit again on 20/10.");
  assert.equal(n.relatedId, "rider-a", "dedup er pr. rytter");
  assert.equal(n.metadata.riderId, "rider-a", "frontend deep-linker til rytterprofilen");
  assert.equal(n.metadata.raceId, undefined, "ingen løbs-link");
  assert.equal(n.metadata.titleCode, "notif.riderInjured.title");
  assert.equal(n.metadata.messageCode, "notif.riderInjured.training");
  assert.deepEqual(n.metadata.messageParams, { rider: "Rytter A", fitAgain: "20/10", missed: "", more: 0 });
  const m = buildTrainingInjuryNotification({ riderId: "rider-a", riderName: "Rytter A", injuredUntil: "2026-10-19", missedRaces: [{ id: "x", name: "X" }] });
  assert.equal(m.message, "Rytter A was injured in training and is fit again on 20/10. He will miss X.");
  assert.equal(m.metadata.messageCode, "notif.riderInjured.trainingMissed");
  assert.equal(m.metadata.riderId, "rider-a", "linket gaar stadig til rytteren");
});

test("#7412 notifyTrainingInjuries: naevner alle loeb i rytterens pulje i skadeperioden", async () => {
  const calls = [];
  const db = FRIIS_DB();
  db.riders = [{ id: "adrien", squad: "senior" }];
  const out = await notifyTrainingInjuries({
    supabase: fakeDb(db), teamId: "lorraine", now: NOW,
    reportRiders: [{ rider_id: "adrien", name: "Adrien Charpentier", injury_days: 3 }],
    conditionUpserts: [{ rider_id: "adrien", injured_until: "2026-10-19" }],
    notify: async (args) => { calls.push(args); return { delivered: true }; },
  });
  assert.equal(out.sent, 1);
  assert.equal(calls[0].message, "Adrien Charpentier was injured in training and is fit again on 20/10. He will miss Tour du Léman, Ardennes Classic.");
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
  assert.equal(calls[0].message, "A B was injured in training and is fit again on 19/10.");
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
