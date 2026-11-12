import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  mondayOf,
  isoWeekNumber,
  dateIndex,
  isRacePast,
  sharesRaceDays,
  overlappingRaces,
  pickedCounts,
  raceReadiness,
  groupRacesByWeek,
  visibleRaces,
  layoutWeek,
  roleOf,
  setRiderRole,
  selectionFromServer,
  selectionDirty,
  toPutBody,
  entriesFromSelection,
  replaceRaceEntries,
  profileColumns,
  routeMatchByProfile,
  sortSquadRows,
  nextSort,
  DEFAULT_SQUAD_SORT,
  suggestSquad,
  copySquadFrom,
  buildSquadRows,
  availableRoles,
  EMPTY_SELECTION,
  type SeasonRace,
  type SquadRow,
  type Selection,
} from "./planningWorkbench.ts";

function race(id: string, start: number, end: number, extra: Partial<SeasonRace> = {}): SeasonRace {
  return {
    id,
    name: `Race ${id}`,
    raceClass: "2.1",
    stages: end - start + 1,
    status: "scheduled",
    stagesCompleted: 0,
    lineupLocked: false,
    gameDayStart: start,
    gameDayEnd: end,
    sizeMin: 6,
    sizeMax: 6,
    ...extra,
  };
}

function row(id: string, extra: Partial<SquadRow> = {}): SquadRow {
  return {
    id,
    name: `Rider ${id}`,
    selectable: true,
    injured: false,
    overAge: false,
    outgoing: false,
    trainNowLocked: false,
    busyIn: null,
    rating: 60,
    ratingRole: "climber",
    form: 50,
    fatigue: 20,
    routeMatch: 50,
    byProfile: {},
    ...extra,
  };
}

const sel = (extra: Partial<Selection> = {}): Selection => ({ ...EMPTY_SELECTION, riderIds: [], freeRoleIds: [], ...extra });

// 2026-11-02 er en mandag.
const DATES = dateIndex([
  { gameDay: 27, date: "2026-11-02" },
  { gameDay: 28, date: "2026-11-03" },
  { gameDay: 29, date: "2026-11-04" },
  { gameDay: 30, date: "2026-11-05" },
  { gameDay: 31, date: "2026-11-09" },
  { gameDay: 32, date: "2026-11-10" },
]);

test("datoer: mandag, ugenummer og dagsaritmetik", () => {
  assert.equal(mondayOf("2026-11-04"), "2026-11-02");
  assert.equal(mondayOf("2026-11-02"), "2026-11-02");
  assert.equal(mondayOf("2026-11-08"), "2026-11-02");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(isoWeekNumber("2026-11-02"), 45);
  assert.equal(isoWeekNumber("2026-11-09"), 46);
  assert.equal(isoWeekNumber("2027-01-01"), 53);
});

test("overlap: loeb der deler loebsdage, ikke dem der kun graenser op til hinanden", () => {
  const a = race("a", 27, 29);
  const b = race("b", 29, 30);
  const c = race("c", 30, 31);
  assert.equal(sharesRaceDays(a, b), true);
  assert.equal(sharesRaceDays(a, c), false);
  assert.equal(sharesRaceDays(a, a), false);
  assert.deepEqual(overlappingRaces(a, [a, b, c]).map((r) => r.id), ["b"]);
});

test("overlap: afmeldte og forbi-loeb tæller ikke som overlap", () => {
  const a = race("a", 27, 29);
  const b = race("b", 28, 28);
  const done = race("done", 28, 28, { status: "completed" });
  assert.deepEqual(overlappingRaces(a, [a, b, done], new Set(["b"])), []);
  assert.equal(isRacePast(done), true);
  assert.equal(isRacePast(b), false);
});

test("klar-status: fuld trup er klar, ellers N mangler; laast og afmeldt har egen status", () => {
  const r = race("a", 27, 27);
  assert.deepEqual(raceReadiness(r, 6), { state: "ready", picked: 6, target: 6, missing: 0 });
  assert.deepEqual(raceReadiness(r, 4), { state: "missing", picked: 4, target: 6, missing: 2 });
  assert.equal(raceReadiness(race("l", 27, 27, { lineupLocked: true }), 3).state, "locked");
  assert.equal(raceReadiness(r, 6, new Set(["a"])).state, "withdrawn");
  assert.equal(raceReadiness(race("z", 27, 27, { sizeMax: 0 }), 0).state, "missing");
});

test("pickedCounts taeller entries pr. loeb", () => {
  const counts = pickedCounts([
    { raceId: "a", riderId: "1", raceRole: null },
    { raceId: "a", riderId: "2", raceRole: "captain" },
    { raceId: "b", riderId: "1", raceRole: null },
  ]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.get("c"), undefined);
});

test("uger: loeb grupperes efter ugen deres start ligger i, loeb uden dato udelades", () => {
  const groups = groupRacesByWeek([race("a", 27, 28), race("b", 31, 31), race("c", 32, 32), race("x", 99, 99)], DATES);
  assert.deepEqual(groups.map((g) => [g.monday, g.week, g.races.map((r) => r.id)]), [
    ["2026-11-02", 45, ["a"]],
    ["2026-11-09", 46, ["b", "c"]],
  ]);
});

test("loebslisten: naeste 7 dage, hele saesonen og skjulte forbi-loeb", () => {
  const races = [race("a", 27, 27), race("b", 31, 31), race("old", 27, 27, { status: "completed" })];
  const today = "2026-11-02";
  assert.deepEqual(visibleRaces(races, DATES, { scope: "next7", showPast: false, today }).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(visibleRaces(races, DATES, { scope: "next7", showPast: true, today }).map((r) => r.id), ["a", "b", "old"]);
  assert.deepEqual(visibleRaces(races, DATES, { scope: "next7", showPast: false, today: "2026-10-28" }).map((r) => r.id), ["a"]);
  assert.deepEqual(visibleRaces(races, DATES, { scope: "season", showPast: false, today: "2026-10-20" }).map((r) => r.id), ["a", "b"]);
});

test("ugeoversigt: loeb med faelles loebsdage ligger i hver sin bane, og baren bliver i ugen", () => {
  const races = [race("a", 27, 29), race("b", 28, 28), race("c", 30, 31), race("far", 40, 41)];
  const layout = layoutWeek(races, DATES, "2026-11-02");
  assert.equal(layout.days.length, 7);
  const byId = Object.fromEntries(layout.bars.map((b) => [b.race.id, b]));
  assert.equal(byId.a.lane, 0);
  assert.equal(byId.b.lane, 1);
  assert.equal(byId.c.lane, 0, "c deler ingen loebsdage med a, saa den genbruger bane 0");
  assert.equal(byId.far, undefined);
  assert.equal(layout.laneCount, 2);
  assert.deepEqual([byId.a.startCol, byId.a.endCol], [0, 2]);
  assert.deepEqual([byId.c.startCol, byId.c.endCol], [3, 6], "c slutter paa en dato i naeste uge og afkortes ved soendag");
});

test("roller: en enkeltrolle har en indehaver, free_role er additiv, og fjernelse rydder rollen", () => {
  let s = sel({ riderIds: ["1", "2", "3"] });
  s = setRiderRole(s, "1", "captain");
  s = setRiderRole(s, "2", "captain");
  assert.equal(s.captainId, "2");
  assert.equal(roleOf(s, "1"), "rider");
  s = setRiderRole(s, "1", "free_role");
  s = setRiderRole(s, "3", "free_role");
  assert.deepEqual(s.freeRoleIds, ["1", "3"]);
  s = setRiderRole(s, "1", "hunter");
  assert.deepEqual(s.freeRoleIds, ["3"]);
  assert.equal(roleOf(s, "1"), "hunter");
  assert.equal(setRiderRole(s, "ikke-i-truppen", "captain"), s);
});

test("roller: delt kaptajn og luksushjaelper kraever at loebet kender dem", () => {
  assert.equal(availableRoles(false).includes("co_captain"), false);
  assert.equal(availableRoles(true).includes("luxury_helper"), true);
});

test("ugemt: kladde mod gemt er uafhaengig af raekkefoelge men ser rolleskift", () => {
  const saved = sel({ riderIds: ["1", "2"], captainId: "1" });
  assert.equal(selectionDirty(sel({ riderIds: ["2", "1"], captainId: "1" }), saved), false);
  assert.equal(selectionDirty(sel({ riderIds: ["1", "2"], captainId: "2" }), saved), true);
  assert.equal(selectionDirty(sel({ riderIds: ["1"], captainId: "1" }), saved), true);
  assert.equal(selectionDirty(selectionFromServer(null), sel()), false);
});

test("gem: PUT-body filtrerer roller til truppen og sender luksushjaelper kun hvor den findes", () => {
  const s = sel({ riderIds: ["1", "2"], captainId: "1", hunterId: "9", freeRoleIds: ["2", "9"], luxuryHelperId: "2" });
  const body = toPutBody(s, false);
  assert.deepEqual(body, {
    rider_ids: ["1", "2"],
    captain_id: "1",
    sprint_captain_id: null,
    hunter_id: null,
    free_role_ids: ["2"],
    co_captain_id: null,
  });
  assert.equal((toPutBody(s, true) as { luxury_helper_id: string }).luxury_helper_id, "2");
});

test("entries: en gemt udtagelse bliver til saesonmatrixens entries og erstatter loebets gamle", () => {
  const s = sel({ riderIds: ["1", "2"], captainId: "1" });
  const next = entriesFromSelection("r1", s);
  assert.deepEqual(next, [
    { raceId: "r1", riderId: "1", raceRole: "captain" },
    { raceId: "r1", riderId: "2", raceRole: null },
  ]);
  const merged = replaceRaceEntries(
    [{ raceId: "r1", riderId: "old", raceRole: null }, { raceId: "r2", riderId: "x", raceRole: null }],
    "r1",
    next,
  );
  assert.deepEqual(merged.map((e) => `${e.raceId}:${e.riderId}`).sort(), ["r1:1", "r1:2", "r2:x"]);
});

test("rutekolonner: en pr. rutetype med antal, og rute-match er gennemsnit pr. type", () => {
  const types = ["hilly", "flat", "hilly", "mountain"];
  assert.deepEqual(profileColumns(types), [
    { profileType: "hilly", count: 2 },
    { profileType: "flat", count: 1 },
    { profileType: "mountain", count: 1 },
  ]);
  assert.deepEqual(routeMatchByProfile([60, 40, 70, null], types), { hilly: 65, flat: 40, mountain: null });
  assert.deepEqual(routeMatchByProfile(null, ["flat"]), { flat: null });
});

test("raekker: skadet, for gammel, udgaaende, optaget og Train now-laast rytter kan ikke vaelges; resten kan", () => {
  const rows = buildSquadRows(
    {
      riders: [
        { id: "ok", name: "Ok", suitability: 70, form: 55, fatigue: 12, stageSuitability: [60, 80], abilities: { climbing: 70 } },
        { id: "inj", name: "Inj", injured: true },
        { id: "old", name: "Old", overAge: true },
        { id: "out", name: "Out", outgoing: true },
        { id: "bus", name: "Bus" },
        { id: "trn", name: "Trn" },
      ],
      bound_riders: [{ rider_id: "bus", bound_race_name: "Race x" }],
      trainNowLock: { riderIds: ["trn"] },
    },
    ["hilly", "flat"],
    (flat) => ({ rating: flat.climbing === 70 ? 64 : null, role: "climber" }),
  );
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.ok.selectable, true);
  assert.deepEqual([by.inj, by.old, by.out, by.bus, by.trn].map((r) => r.selectable), [false, false, false, false, false]);
  assert.equal(by.bus.busyIn, "Race x");
  assert.deepEqual([by.ok.rating, by.ok.routeMatch, by.ok.form, by.ok.fatigue], [64, 70, 55, 12]);
  assert.deepEqual(by.ok.byProfile, { hilly: 60, flat: 80 });
  assert.equal(by.inj.rating, null, "uden evner er der ingen rating at vise");
});

test("sortering: standard er rute-match faldende, tal uden vaerdi ligger nederst i begge retninger", () => {
  const rows = [row("a", { routeMatch: 40 }), row("b", { routeMatch: 80 }), row("c", { routeMatch: null }), row("d", { routeMatch: 60 })];
  assert.deepEqual(sortSquadRows(rows, DEFAULT_SQUAD_SORT, sel()).map((r) => r.id), ["b", "d", "a", "c"]);
  assert.deepEqual(sortSquadRows(rows, { key: "routeMatch", dir: "asc" }, sel()).map((r) => r.id), ["a", "d", "b", "c"]);
});

test("sortering: hver kolonne sorterer, ogsaa pr. rutetype, pick og navn", () => {
  const rows = [
    row("a", { name: "Zed", byProfile: { flat: 10 }, form: 30, fatigue: 50, rating: 70 }),
    row("b", { name: "Abe", byProfile: { flat: 90 }, form: 70, fatigue: 10, rating: 50 }),
  ];
  const s = sel({ riderIds: ["a"] });
  assert.deepEqual(sortSquadRows(rows, { key: "name", dir: "asc" }, s).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortSquadRows(rows, { key: "profile:flat", dir: "desc" }, s).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortSquadRows(rows, { key: "form", dir: "asc" }, s).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortSquadRows(rows, { key: "fatigue", dir: "desc" }, s).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortSquadRows(rows, { key: "rating", dir: "desc" }, s).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortSquadRows(rows, { key: "pick", dir: "desc" }, s).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortSquadRows(rows, { key: "role", dir: "asc" }, sel({ riderIds: ["a"], captainId: "a" })).map((r) => r.id), ["a", "b"]);
});

test("sortering: et klik paa samme kolonne vender retningen, en ny kolonne starter naturligt", () => {
  assert.deepEqual(nextSort(DEFAULT_SQUAD_SORT, "routeMatch"), { key: "routeMatch", dir: "asc" });
  assert.deepEqual(nextSort(DEFAULT_SQUAD_SORT, "name"), { key: "name", dir: "asc" });
  assert.deepEqual(nextSort(DEFAULT_SQUAD_SORT, "fatigue"), { key: "fatigue", dir: "desc" });
});

test("forslag: kun ledige ryttere, bedst rute-match foerst, op til feltet, med en kaptajn, og aldrig mere end max", () => {
  const rows = [
    row("a", { routeMatch: 90 }),
    row("b", { routeMatch: 80, injured: true, selectable: false }),
    row("c", { routeMatch: 70 }),
    row("d", { routeMatch: 60, busyIn: "Race x", selectable: false }),
    row("e", { routeMatch: 50 }),
  ];
  const s = suggestSquad({ rows, max: 2, sprintLeaderAllowed: false });
  assert.deepEqual(s.riderIds, ["a", "c"]);
  assert.equal(s.captainId, "a");
  const all = suggestSquad({ rows, max: 10, sprintLeaderAllowed: false });
  assert.deepEqual(all.riderIds, ["a", "c", "e"]);
  assert.deepEqual(suggestSquad({ rows: [], max: 6, sprintLeaderAllowed: false }).riderIds, []);
});

test("ugeoversigt: to loeb paa forskellige loebsdage men samme kalenderdato ligger i hver sin bane", () => {
  const same = dateIndex([
    { gameDay: 1, date: "2026-11-12" },
    { gameDay: 2, date: "2026-11-12" },
  ]);
  const layout = layoutWeek([race("a", 1, 1), race("b", 2, 2)], same, "2026-11-09");
  const byId = Object.fromEntries(layout.bars.map((b) => [b.race.id, b]));
  assert.notEqual(byId.a.lane, byId.b.lane);
  assert.equal(layout.laneCount, 2);
});

test("forslag og kopier: en Train now-laast rytter der allerede er valgt bliver i truppen og beholder sin rolle", () => {
  const rows = [row("a", { routeMatch: 90 }), row("lock", { routeMatch: 10, trainNowLocked: true, selectable: false }), row("c", { routeMatch: 70 })];
  const current = sel({ riderIds: ["lock"], captainId: "lock" });
  const suggested = suggestSquad({ rows, max: 2, sprintLeaderAllowed: false, current });
  assert.deepEqual(suggested.riderIds, ["lock", "a"]);
  assert.equal(suggested.captainId, "lock");
  const copied = copySquadFrom({ source: [{ raceId: "x", riderId: "c", raceRole: "captain" }], rows, max: 2, sprintLeaderAllowed: false, current });
  assert.deepEqual(copied.selection.riderIds, ["lock", "c"]);
  assert.equal(copied.selection.captainId, "c");
});

test("kopiér trup: optagne og skadede ryttere springes over, roller foelger med de der bliver", () => {
  const rows = [row("a"), row("b", { busyIn: "Race x", selectable: false }), row("c"), row("d", { injured: true, selectable: false })];
  const { selection, skipped } = copySquadFrom({
    source: [
      { raceId: "src", riderId: "a", raceRole: "captain" },
      { raceId: "src", riderId: "b", raceRole: "hunter" },
      { raceId: "src", riderId: "c", raceRole: "co_captain" },
      { raceId: "src", riderId: "d", raceRole: null },
    ],
    rows,
    max: 6,
    sprintLeaderAllowed: false,
  });
  assert.deepEqual(selection.riderIds, ["a", "c"]);
  assert.equal(selection.captainId, "a");
  assert.equal(selection.coCaptainId, null, "delt kaptajn kopieres ikke ind i et loeb der ikke kender den");
  assert.equal(selection.hunterId, null);
  assert.equal(skipped, 2);
});
