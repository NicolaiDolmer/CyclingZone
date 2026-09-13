// #4983 — frist- og eskaleringslogikken for den synlige trup-påmindelse.
// Kontrakten: samme "mangler trup"-definition og samme frist som #2180's
// indbakke-varsel, plus ét nyt trin (rød under late fill-horisonten).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reminderToneForHours,
  reminderToneForRace,
  isBelowStartFloor,
  isSelectionReminderMigrationPending,
  aggregateReminderTone,
  buildSelectionDeadlineReminder,
  SELECTION_REMINDER_TONES,
  SELECTION_REMINDER_WINDOW_HOURS,
  SELECTION_REMINDER_FLOOR,
} from "./selectionDeadlineReminder.js";
import { SELECTION_WARNING_HOURS } from "./selectionWarningSweep.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const URGENT_HOURS = 24;

function hoursFromNow(h) {
  return new Date(NOW.getTime() + h * 3600 * 1000).toISOString();
}

// Class2 → SELECTION_SIZE {min:6, max:6}; TourFrance → {min:8, max:8}.
function race(id, { name = id, raceClass = "Class2", pool = null, stagesCompleted = 0, status = "scheduled" } = {}) {
  return { id, name, race_class: raceClass, league_division_id: pool, stages_completed: stagesCompleted, status };
}

function schedule(entries) {
  const map = new Map();
  for (const [raceId, hours] of entries) {
    map.set(raceId, hours.map((h) => ({ scheduled_at: hoursFromNow(h) })));
  }
  return map;
}

test("gul-vinduet ER #2180's varslings-vindue — ingen ny frist opfundet", () => {
  assert.equal(SELECTION_REMINDER_WINDOW_HOURS, SELECTION_WARNING_HOURS);
  assert.equal(SELECTION_REMINDER_WINDOW_HOURS, 36);
});

test("rød-gulvet ER #4295's deltagelses-gulv — ingen ny grænse opfundet", () => {
  assert.equal(SELECTION_REMINDER_FLOOR, MIN_RACE_ENTRIES);
  assert.equal(SELECTION_REMINDER_FLOOR, 6);
});

test("isBelowStartFloor: tom og under gulvet er 'stiller ikke op', gulvet selv er ikke", () => {
  assert.equal(isBelowStartFloor(0), true);
  assert.equal(isBelowStartFloor(5), true);
  assert.equal(isBelowStartFloor(6), false);
  assert.equal(isBelowStartFloor(7), false);
  // Ubrugeligt tal → behandl som under gulvet; en påmindelse må hellere haste
  // for meget end at tie om et hold der ikke stiller op.
  assert.equal(isBelowStartFloor(Number.NaN), true);
});

test("reminderToneForRace (ejer 10/9): kun trupper UNDER gulvet kan blive røde", () => {
  const inUrgentWindow = { hoursUntilDeadline: 6, urgentHours: URGENT_HOURS };
  // 6/8 er over gulvet: holdet stiller op, bare ikke i fuld styrke → aldrig rød.
  assert.equal(
    reminderToneForRace({ ...inUrgentWindow, entryCount: 6 }),
    SELECTION_REMINDER_TONES.WARNING,
  );
  // 5/8 og 0/8 er under gulvet → rød inde i horisonten.
  assert.equal(
    reminderToneForRace({ ...inUrgentWindow, entryCount: 5 }),
    SELECTION_REMINDER_TONES.URGENT,
  );
  assert.equal(
    reminderToneForRace({ ...inUrgentWindow, entryCount: 0 }),
    SELECTION_REMINDER_TONES.URGENT,
  );
  // Under gulvet, men UDEN for horisonten → stadig gul.
  assert.equal(
    reminderToneForRace({ hoursUntilDeadline: 30, urgentHours: URGENT_HOURS, entryCount: 0 }),
    SELECTION_REMINDER_TONES.WARNING,
  );
});

test("reminderToneForHours: over horisonten er gul, på og under er rød", () => {
  assert.equal(reminderToneForHours(30, URGENT_HOURS), SELECTION_REMINDER_TONES.WARNING);
  assert.equal(reminderToneForHours(24.01, URGENT_HOURS), SELECTION_REMINDER_TONES.WARNING);
  assert.equal(reminderToneForHours(24, URGENT_HOURS), SELECTION_REMINDER_TONES.URGENT);
  assert.equal(reminderToneForHours(1.5, URGENT_HOURS), SELECTION_REMINDER_TONES.URGENT);
});

test("reminderToneForHours: passeret frist eller ubrugeligt tal nedtones aldrig", () => {
  assert.equal(reminderToneForHours(-2, URGENT_HOURS), SELECTION_REMINDER_TONES.URGENT);
  assert.equal(reminderToneForHours(Number.NaN, URGENT_HOURS), SELECTION_REMINDER_TONES.URGENT);
});

test("aggregateReminderTone: ét rødt løb gør hele markeringen rød", () => {
  assert.equal(aggregateReminderTone([]), SELECTION_REMINDER_TONES.NONE);
  assert.equal(
    aggregateReminderTone([{ tone: "warning" }, { tone: "warning" }]),
    SELECTION_REMINDER_TONES.WARNING,
  );
  assert.equal(
    aggregateReminderTone([{ tone: "warning" }, { tone: "urgent" }]),
    SELECTION_REMINDER_TONES.URGENT,
  );
});

test("tom trup inden for vinduet giver gul; samme løb under horisonten giver rød", () => {
  const races = [race("r1", { name: "Tour de Preview" })];
  const scheduleByRace = schedule([["r1", [30, 54]]]);
  const warning = buildSelectionDeadlineReminder({
    races, scheduleByRace, entryCountByRace: new Map(), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(warning.tone, SELECTION_REMINDER_TONES.WARNING);
  assert.equal(warning.count, 1);
  assert.equal(warning.races[0].entry_count, 0);
  assert.equal(warning.races[0].target_size, 6);
  assert.equal(warning.races[0].deadline_at, hoursFromNow(30));

  const urgent = buildSelectionDeadlineReminder({
    races, scheduleByRace: schedule([["r1", [10]]]), entryCountByRace: new Map(),
    team: { league_division_id: 1 }, now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(urgent.tone, SELECTION_REMINDER_TONES.URGENT);
  assert.equal(urgent.races[0].hours_until, 10);
});

test("løb uden for vinduet (mere end 36 t væk) giver ingen påmindelse", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1")], scheduleByRace: schedule([["r1", [40]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 }, now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.tone, SELECTION_REMINDER_TONES.NONE);
  assert.equal(out.count, 0);
});

test("#4038-kontrakten: en FULD trup mangler ikke, heller ikke når assistenten fyldte den", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1")], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map([["r1", 6]]), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 0);
});

test("delvis trup tæller stadig som manglende (5 af 6)", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1")], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map([["r1", 5]]), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 1);
  assert.equal(out.races[0].entry_count, 5);
});

test("Grand Tour-truppen måles mod klassens 8, ikke mod gulvet på 6", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1", { raceClass: "TourFrance" })], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map([["r1", 6]]), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 1);
  assert.equal(out.races[0].target_size, 8);
  assert.equal(out.races[0].min_size, 6, "gulvet står i svaret ved siden af klassens max");
});

// --- Ejer-beslutning 10/9: rød = under gulvet, ikke bare "ikke fuld" ----------
// Målt i prod ville den gamle regel farve ~108 managere røde for trupper der
// starter helt fint. De fire tilfælde nedenfor ER beslutningen.

function grandTour({ entries, hours }) {
  return buildSelectionDeadlineReminder({
    races: [race("r1", { raceClass: "TourFrance" })],
    scheduleByRace: schedule([["r1", [hours]]]),
    entryCountByRace: new Map([["r1", entries]]),
    team: { league_division_id: 1 }, now: NOW, urgentHours: URGENT_HOURS,
  });
}

test("6/8 uden for horisonten er gul", () => {
  const out = grandTour({ entries: 6, hours: 30 });
  assert.equal(out.tone, SELECTION_REMINDER_TONES.WARNING);
  assert.equal(out.races[0].will_not_start, false);
});

test("6/8 INDEN FOR horisonten er stadig gul — holdet stiller op", () => {
  const out = grandTour({ entries: 6, hours: 4 });
  assert.equal(out.count, 1, "truppen er stadig ikke fuld, så påmindelsen bliver stående");
  assert.equal(out.tone, SELECTION_REMINDER_TONES.WARNING);
  assert.equal(out.races[0].will_not_start, false);
});

test("5/8 inden for horisonten er rød — under gulvet, stiller ikke op", () => {
  const out = grandTour({ entries: 5, hours: 4 });
  assert.equal(out.tone, SELECTION_REMINDER_TONES.URGENT);
  assert.equal(out.races[0].will_not_start, true);
});

test("0/8 inden for horisonten er rød", () => {
  const out = grandTour({ entries: 0, hours: 4 });
  assert.equal(out.tone, SELECTION_REMINDER_TONES.URGENT);
  assert.equal(out.races[0].will_not_start, true);
});

test("5/8 UDEN for horisonten er gul — gulvet alene gør ikke rød", () => {
  const out = grandTour({ entries: 5, hours: 30 });
  assert.equal(out.tone, SELECTION_REMINDER_TONES.WARNING);
  assert.equal(out.races[0].will_not_start, true, "tilstanden er sand, men tonen venter på tiden");
});

test("et rødt løb ved siden af et gult 6/8 gør hele markeringen rød", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1", { raceClass: "TourFrance" }), race("r2", { raceClass: "TourFrance" })],
    scheduleByRace: schedule([["r1", [4]], ["r2", [8]]]),
    entryCountByRace: new Map([["r1", 6], ["r2", 5]]),
    team: { league_division_id: 1 }, now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.deepEqual(out.races.map((r) => r.tone), ["warning", "urgent"]);
  assert.equal(out.tone, SELECTION_REMINDER_TONES.URGENT);
});

test("afmeldt løb er et bevidst fravalg og påminder ikke", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1")], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map(), withdrawnRaceIds: new Set(["r1"]),
    team: { league_division_id: 1 }, now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 0);
});

test("løb uden for holdets pulje påminder ikke", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1", { pool: 2 })], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 0);
});

test("løb der allerede er i gang (stages_completed > 0) påminder ikke", () => {
  const out = buildSelectionDeadlineReminder({
    races: [race("r1", { stagesCompleted: 1 })], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.equal(out.count, 0);
});

test("flere løb sorteres med nærmeste frist først, og den røde bestemmer tonen", () => {
  const races = [race("r1", { name: "Later" }), race("r2", { name: "Sooner" })];
  const out = buildSelectionDeadlineReminder({
    races, scheduleByRace: schedule([["r1", [30]], ["r2", [8]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.deepEqual(out.races.map((r) => r.id), ["r2", "r1"]);
  assert.deepEqual(out.races.map((r) => r.tone), ["urgent", "warning"]);
  assert.equal(out.tone, SELECTION_REMINDER_TONES.URGENT);
});

// CodeRabbit-fund (#5108): `hours_until` er afrundet til to decimaler = 36
// sekunders opløsning. To frister tættere på hinanden end det gav komparatoren
// 0, og en stabil sort beholdt kildens rækkefølge — det nærmeste løb kunne stå
// nummer to. Sorteringen sker nu på den u-afrundede frist.
test("to frister under 36 sekunders forskel sorteres stadig med den nærmeste først", () => {
  // r1 ligger 20 sekunder EFTER r2, men står først i kilden.
  const races = [race("r1", { name: "Later" }), race("r2", { name: "Sooner" })];
  const out = buildSelectionDeadlineReminder({
    races,
    scheduleByRace: schedule([["r1", [10 + 20 / 3600]], ["r2", [10]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 },
    now: NOW, urgentHours: URGENT_HOURS,
  });
  assert.deepEqual(out.races.map((r) => r.hours_until), [10, 10.01],
    "afrundingen alene kan ikke skelne de to — derfor sorteres der på deadline_at");
  assert.deepEqual(out.races.map((r) => r.id), ["r2", "r1"]);
});

test("isSelectionReminderMigrationPending: kun 'kolonnen/tabellen findes ikke endnu'", () => {
  assert.equal(isSelectionReminderMigrationPending({ code: "42703", message: 'column "selection_reminder_enabled" does not exist' }), true);
  assert.equal(isSelectionReminderMigrationPending({ code: "42P01", message: 'relation "public.teams" does not exist' }), true);
  assert.equal(isSelectionReminderMigrationPending({ code: "PGRST204", message: "Could not find the column in the schema cache" }), true);
  assert.equal(isSelectionReminderMigrationPending({ code: "PGRST205", message: "Could not find the table in the schema cache" }), true);
  // Beskeden som sidste værn hvis koden mangler.
  assert.equal(isSelectionReminderMigrationPending({ message: "record 'selection_reminder_enabled' has no field" }), true);
  // Alt andet er en rigtig fejl og skal blive ved med at give 500.
  assert.equal(isSelectionReminderMigrationPending({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isSelectionReminderMigrationPending(null), false);
  assert.equal(isSelectionReminderMigrationPending(undefined), false);
});

// Kilde-assert (samme recipe som dashboardUxPakke.routes.test.js): PATCHen har
// ingen egen testharness, og pointen her er netop at ruten IKKE må svare 500
// eller "ok" i migrations-vinduet.
test("PATCH /me/selection-reminder-settings svarer 503 + Retry-After mens migrationen mangler", () => {
  const api = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  const block = api.slice(api.indexOf('router.patch("/me/selection-reminder-settings"'));
  const route = block.slice(0, block.indexOf("\n});"));
  assert.match(route, /isSelectionReminderMigrationPending\(error\)/, "skal genkende den manglende kolonne via helperen");
  assert.match(route, /res\.set\("Retry-After"/, "et retryable svar skal sige HVORNÅR der kan prøves igen");
  assert.match(route, /res\.status\(503\)/, "midlertidigt utilgængelig, ikke en programfejl");
  assert.match(route, /res\.status\(500\)/, "rigtige fejl skal stadig give 500");
});

test("en anden late fill-horisont flytter det røde trin med", () => {
  const args = {
    races: [race("r1")], scheduleByRace: schedule([["r1", [10]]]),
    entryCountByRace: new Map(), team: { league_division_id: 1 }, now: NOW,
  };
  assert.equal(buildSelectionDeadlineReminder({ ...args, urgentHours: 6 }).tone, SELECTION_REMINDER_TONES.WARNING);
  assert.equal(buildSelectionDeadlineReminder({ ...args, urgentHours: 12 }).tone, SELECTION_REMINDER_TONES.URGENT);
});
