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
  clearSquad,
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
  gameDaySpan,
  gameDaysOnDate,
  raceDayLabelKey,
  copySquadFrom,
  buildSquadRows,
  availableRoles,
  EMPTY_SELECTION,
  clearableRaceIds,
  entriesAfterClear,
  selectionFromEntries,
  clearChanges,
  clearSubmission,
  capClearable,
  applyPageClear,
  undoPageClear,
  draftCacheAction,
  settleClearSave,
  createWriteGate,
  pageClearStep,
  raceSwitchStep,
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

test("begge akser: loebsdags-spaendet vises ved siden af datoen, ogsaa naar datoen findes", () => {
  assert.equal(gameDaySpan(41), "41");
  assert.equal(gameDaySpan(41, 43), "41-43");
  assert.equal(gameDaySpan(43, 41), "41-43");
  const dates = dateIndex([
    { gameDay: 41, date: "2026-11-12" },
    { gameDay: 42, date: "2026-11-12" },
    { gameDay: 43, date: "2026-11-13" },
  ]);
  assert.equal(gameDaysOnDate(dates, "2026-11-12"), "41-42");
  assert.equal(gameDaysOnDate(dates, "2026-11-13"), "43");
  assert.equal(gameDaysOnDate(dates, "2026-11-14"), null);
  assert.equal(raceDayLabelKey(race("a", 41, 41)), "raceList.raceDay");
  assert.equal(raceDayLabelKey(race("a", 41, 43)), "raceList.raceDays");
});

test("forslag: en Train now-laast jaeger med hoejest rute-match beholder rollen, og truppen faar stadig en kaptajn", () => {
  // Codex P2 (#8056): resolveBoardRoles gjorde den laaste jaeger til kaptajn, og loekken der
  // gendanner hans rolle nulstillede derefter kaptajnen, saa Gem var slaaet fra.
  const rows = [
    row("lock", { routeMatch: 95, trainNowLocked: true, selectable: false }),
    row("cap", { routeMatch: 80 }),
    row("c", { routeMatch: 60 }),
  ];
  const current = sel({ riderIds: ["lock"], hunterId: "lock" });
  for (const sprintLeaderAllowed of [false, true]) {
    const s = suggestSquad({ rows, max: 3, sprintLeaderAllowed, current });
    assert.deepEqual(s.riderIds, ["lock", "cap", "c"]);
    assert.equal(s.hunterId, "lock");
    assert.equal(s.captainId, "cap");
    assert.equal(roleOf(s, "lock"), "hunter");
  }
  // En laast delt kaptajn rykker ikke op og efterlader ikke truppen uden kaptajn.
  const co = suggestSquad({ rows, max: 3, sprintLeaderAllowed: true, current: sel({ riderIds: ["lock"], coCaptainId: "lock" }) });
  assert.equal(co.coCaptainId, "lock");
  assert.equal(co.captainId, "cap");
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

test("clearSquad: alle ud, men en laast rytter beholder plads og rolle", () => {
  const start = sel({ riderIds: ["a", "b", "c"], captainId: "a", hunterId: "b", freeRoleIds: ["c"] });
  const cleared = clearSquad(start, ["b"]);
  assert.deepEqual(cleared.riderIds, ["b"]);
  assert.equal(cleared.captainId, null);
  assert.equal(cleared.hunterId, "b");
  assert.deepEqual(cleared.freeRoleIds, []);
  assert.deepEqual(clearSquad(start).riderIds, []);
  assert.deepEqual(start.riderIds, ["a", "b", "c"], "kladden aendres ikke i stedet");
});

test("Ryd udtagelser: kun viste, kommende, aabne loeb med ryttere der kan tages ud", () => {
  const races = [
    race("open", 1, 1),
    race("empty", 2, 2),
    race("locked", 3, 3, { lineupLocked: true }),
    race("past", 1, 1, { status: "completed" }),
    race("out", 4, 4),
    race("onlyLocked", 5, 5),
  ];
  const entries = [
    { raceId: "open", riderId: "a", raceRole: "captain" },
    { raceId: "locked", riderId: "a", raceRole: null },
    { raceId: "past", riderId: "a", raceRole: null },
    { raceId: "out", riderId: "a", raceRole: null },
    { raceId: "onlyLocked", riderId: "t", raceRole: "captain" },
  ];
  const ids = clearableRaceIds(races, entries, new Set(["out"]), { onlyLocked: { riderIds: ["t"] } });
  assert.deepEqual(ids, ["open"]);
});

test("Ryd udtagelser som kladde: de ryddede loeb beholder kun Train now-laaste ryttere, andre loeb er uroerte", () => {
  const entries = [
    { raceId: "r1", riderId: "a", raceRole: "captain" },
    { raceId: "r1", riderId: "t", raceRole: "hunter" },
    { raceId: "r2", riderId: "b", raceRole: "captain" },
  ];
  const shown = entriesAfterClear(entries, new Set(["r1"]), { r1: { riderIds: ["t"] } });
  assert.deepEqual(shown, [entries[1], entries[2]]);
  assert.equal(entriesAfterClear(entries, new Set()), entries, "ingen kladde: samme liste");
});

test("Ryd udtagelser gemmes som bulk-aendringer i samme form som et enkelt gem", () => {
  const entries = [
    { raceId: "r1", riderId: "a", raceRole: "hunter" },
    { raceId: "r1", riderId: "t", raceRole: "captain" },
    { raceId: "r2", riderId: "b", raceRole: "captain" },
  ];
  const changes = clearChanges(entries, ["r1", "r2"], { r1: { riderIds: ["t"] } });
  assert.deepEqual(changes, [
    { raceId: "r1", rider_ids: ["t"], captain_id: "t", sprint_captain_id: null, hunter_id: null, free_role_ids: [], co_captain_id: null },
    { raceId: "r2", rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, free_role_ids: [], co_captain_id: null },
  ]);
  const sel = selectionFromEntries([{ raceId: "r", riderId: "x", raceRole: "free_role" }, { raceId: "r", riderId: "y", raceRole: null }]);
  assert.deepEqual(sel.riderIds, ["x", "y"]);
  assert.deepEqual(sel.freeRoleIds, ["x"]);
});

// ── Rettelsesrunde PR #8160 (Codex-fund) ────────────────────────────────────

function squad(ids: string[], captain: string | null = null): Selection {
  const base: Selection = { ...EMPTY_SELECTION, riderIds: ids, freeRoleIds: [] };
  return captain ? setRiderRole(base, captain, "captain") : base;
}

test("Ryd udtagelser (P1): Fortryd stiller spillerens UGEMTE kladde tilbage, ikke den gemte trup", () => {
  const saved = squad(["a", "b", "t"], "a");
  const draft = squad(["a", "c", "t"], "c"); // ugemt: b ud, c ind og kaptajn
  const step = applyPageClear(draft, saved, ["t"]);
  assert.deepEqual(step.sel.riderIds, ["t"], "rydningen viser kun den Train now-laaste");
  assert.equal(step.before, draft, "kladden foer rydningen huskes");
  const back = undoPageClear(step.before, saved);
  assert.equal(back, draft, "Fortryd giver den ugemte kladde tilbage");
  assert.equal(selectionDirty(back, saved), true, "den er stadig ugemt efter Fortryd");
  // Uden en kladde foer rydningen (fx ny flade) falder Fortryd tilbage til den gemte trup.
  assert.equal(undoPageClear(null, saved), saved);
});

test("Ryd udtagelser (P1): den huskede kladde slettes aldrig, mens rydningen vises", () => {
  assert.equal(draftCacheAction({ ready: true, clearShown: true, dirty: true }), "keep");
  assert.equal(draftCacheAction({ ready: true, clearShown: true, dirty: false }), "keep");
  assert.equal(draftCacheAction({ ready: false, clearShown: false, dirty: false }), "keep", "ikke klar: roer intet");
  // Efter Fortryd er den gendannede kladde dirty og huskes igen; en ren flade glemmer.
  assert.equal(draftCacheAction({ ready: true, clearShown: false, dirty: true }), "remember");
  assert.equal(draftCacheAction({ ready: true, clearShown: false, dirty: false }), "forget");
});

test("Ryd udtagelser (P1): gemmet afstemmes mod det SENDTE loeb og den sendte udtagelse", () => {
  const entries = [
    { raceId: "r1", riderId: "a", raceRole: "hunter" },
    { raceId: "r1", riderId: "t", raceRole: "captain" },
    { raceId: "r2", riderId: "b", raceRole: "captain" },
  ];
  const { changes, selections } = clearSubmission(entries, ["r1", "r2"], { r1: { riderIds: ["t"] } });
  assert.deepEqual(changes, clearChanges(entries, ["r1", "r2"], { r1: { riderIds: ["t"] } }), "samme body som foer");
  const sentR1 = selections.get("r1")!;
  assert.deepEqual(sentR1.riderIds, ["t"]);
  assert.equal(sentR1.captainId, "t", "den laaste rytters rolle sendes med");

  // Uaendret flade: den sendte trup er nu den gemte, intet er ugemt.
  const same = settleClearSave({ raceId: "r1", sel: sentR1 }, { raceId: "r1", sel: sentR1 });
  assert.deepEqual(same, { mine: true, saved: sentR1, dirty: false });

  // Spilleren tilfoejede en rytter, mens kaldet koerte: aendringen forbliver ugemt.
  const edited = squad(["t", "x"]);
  const kept = settleClearSave({ raceId: "r1", sel: edited }, { raceId: "r1", sel: sentR1 });
  assert.equal(kept.mine, true);
  if (kept.mine) {
    assert.equal(kept.saved, sentR1, "det gemte er det SENDTE, ikke det fladen viser");
    assert.equal(kept.dirty, true, "aendringen lavet imens er stadig ugemt");
  }

  // Spilleren skiftede loeb imens: et andet loebs flade maerkes aldrig som gemt.
  assert.deepEqual(settleClearSave({ raceId: "r3", sel: squad(["c"]) }, { raceId: "r1", sel: sentR1 }), { mine: false });
});

test("Ryd udtagelser: et loeb hvor de laaste ryttere ville staa uden kaptajn, ryddes ikke (ét afvist loeb ville afvise hele kaldet)", () => {
  const races = [race("noLeader", 1, 1), race("lockedCaptain", 2, 2), race("plain", 3, 3)];
  const entries = [
    { raceId: "noLeader", riderId: "c", raceRole: "captain" },
    { raceId: "noLeader", riderId: "t", raceRole: "hunter" },
    { raceId: "lockedCaptain", riderId: "a", raceRole: "hunter" },
    { raceId: "lockedCaptain", riderId: "k", raceRole: "captain" },
    { raceId: "plain", riderId: "a", raceRole: "captain" },
  ];
  const locks = { noLeader: { riderIds: ["t"] }, lockedCaptain: { riderIds: ["k"] } };
  assert.deepEqual(clearableRaceIds(races, entries, new Set(), locks), ["lockedCaptain", "plain"]);
  // Det der sendes for de ryddelige loeb er en gyldig trup: tom, eller med den laaste kaptajn.
  const { selections } = clearSubmission(entries, ["lockedCaptain", "plain"], locks);
  assert.equal(selections.get("lockedCaptain")!.captainId, "k");
  assert.deepEqual(selections.get("plain")!.riderIds, []);
});

test("Ryd udtagelser (P2): kladden holdes altid inden for ét atomisk kald", () => {
  const ids = Array.from({ length: 70 }, (_, i) => `r${i + 1}`);
  const first = capClearable(ids, 0, 60);
  assert.equal(first.ids.length, 60, "kun op til loftet");
  assert.deepEqual(first.ids.slice(0, 2), ["r1", "r2"], "de foerste i listens raekkefoelge");
  assert.equal(first.capped, true, "knappen siger, at resten venter");

  // Kladden er fuld: intet mere kan laegges i, foer den er gemt eller fortrudt.
  const full = capClearable(ids.slice(60), 60, 60);
  assert.deepEqual(full, { ids: [], capped: true });

  // Delvis kladde: kun resten af pladsen.
  assert.equal(capClearable(ids, 55, 60).ids.length, 5);

  // Under loftet: alt, intet loft at naevne.
  assert.deepEqual(capClearable(["a", "b"], 0, 60), { ids: ["a", "b"], capped: false });

  // Det der gemmes er ét kald med hoejst loftet af aendringer.
  const entries = first.ids.map((raceId) => ({ raceId, riderId: "a", raceRole: null }));
  assert.equal(clearSubmission(entries, first.ids).changes.length, 60);
});

// ── Rettelsesrunde 2 PR #8160: én skrive-laas for alle skrivekald ───────────
// Styrede loefter: testen bestemmer selv, hvornaar et kald "naar serveren", saa raekkefoelgen er
// praecis den Codex beskrev. Ingen sleep, intet vaegur.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** En falsk server: et skrivekald laegges foerst ind, naar testen slipper dets loefte (sidst ankomne vinder). */
function fakeServer(initial: Record<string, Selection>) {
  const rows = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    rows,
    calls,
    put(raceId: string, sel: Selection, arrive: Promise<void>) {
      calls.push(`put:${raceId}`);
      return arrive.then(() => {
        rows.set(raceId, sel);
        return true;
      });
    },
    bulk(selections: Map<string, Selection>, arrive: Promise<void>) {
      calls.push(`bulk:${[...selections.keys()].join(",")}`);
      return arrive.then(() => {
        for (const [raceId, sel] of selections) rows.set(raceId, sel);
        return true;
      });
    },
  };
}

test("skrive-laas (P1, Codex runde 2): Ryd udtagelser under et koerende gem kan ikke slippe laasen eller sende et masse-gem samtidig", async () => {
  const gate = createWriteGate();
  const saved = squad(["a", "b"], "a");
  const draft = squad(["a", "b", "c"], "a");
  const server = fakeServer({ r1: saved });

  // 1. Det almindelige gem af r1 koerer (svaret er ikke kommet endnu).
  const firstArrives = deferred();
  const firstSave = gate.run("save", () => server.put("r1", draft, firstArrives.promise));
  assert.equal(gate.current(), "save");

  // 2. Manageren trykker "Ryd udtagelser": fladen venter med at anvende rydningen.
  const view = { ready: true, pendingClear: true, clearShown: false };
  assert.equal(pageClearStep({ ...view, writing: gate.current() }), "wait", "rydningen anvendes ikke midt i et gem");
  // Selv hvis en kladde anvendes og fortrydes, roeres laasen ikke: kun gem-kaldet selv kan slippe den.
  applyPageClear(draft, saved, []);
  undoPageClear(draft, saved);
  assert.equal(gate.current(), "save", "at anvende en kladde slipper aldrig laasen");

  // 3. Masse-gemmet for samme loeb forsoeges: intet sendes, mens gemmet koerer.
  let bulkSent = false;
  const blocked = await gate.run("bulk", async () => {
    bulkSent = true;
    return server.bulk(new Map([["r1", squad([])]]), Promise.resolve());
  });
  assert.deepEqual(blocked, { ran: false });
  assert.equal(bulkSent, false);
  assert.deepEqual(server.calls, ["put:r1"], "kun det foerste gem er sendt");

  // 4. Det foerste gem bliver faerdigt (sidst, som i Codex' raekkefoelge): laasen slippes nu.
  firstArrives.resolve();
  assert.deepEqual(await firstSave, { ran: true, value: true });
  assert.equal(gate.current(), null);
  assert.deepEqual(server.rows.get("r1"), draft);

  // 5. Rydningen anvendes foerst nu, som en ugemt kladde oven paa det gemte (ejerens valg: Gem eller Fortryd).
  assert.equal(pageClearStep({ ...view, writing: gate.current() }), "apply");
  const shown = applyPageClear(draft, draft, []).sel;
  assert.equal(selectionDirty(shown, server.rows.get("r1")!), true, "siden viser rydningen som UGEMT, ikke gemt");

  // 6. Masse-gemmet sendes efter gemmet; serveren ender med det, siden viser som gemt.
  const bulkArrives = deferred();
  const bulk = gate.run("bulk", () => server.bulk(new Map([["r1", shown]]), bulkArrives.promise));
  assert.equal(gate.current(), "bulk");
  bulkArrives.resolve();
  assert.equal((await bulk).ran, true);
  assert.deepEqual(server.calls, ["put:r1", "bulk:r1"], "kaldene krydser aldrig");
  assert.deepEqual(server.rows.get("r1"), shown);
});

test("skrive-laas: Fortryd venter ogsaa paa et koerende kald (masse-gem eller afmeld)", async () => {
  const gate = createWriteGate();
  const arrives = deferred();
  const running = gate.run("bulk", () => arrives.promise);
  const shownClear = { ready: true, pendingClear: false, clearShown: true };
  assert.equal(pageClearStep({ ...shownClear, writing: gate.current() }), "wait");
  arrives.resolve();
  await running;
  assert.equal(pageClearStep({ ...shownClear, writing: gate.current() }), "undo");
  // Ikke klar (fladen henter), eller intet at goere: ingen handling.
  assert.equal(pageClearStep({ ready: false, pendingClear: true, clearShown: false, writing: null }), "none");
  assert.equal(pageClearStep({ ready: true, pendingClear: true, clearShown: true, writing: "save" }), "none");
});

test("skrive-laas: et dobbeltklik sender kun ét kald, ogsaa foer siden naar at tegne igen", async () => {
  const gate = createWriteGate();
  const arrives = deferred();
  let sent = 0;
  const task = () => {
    sent += 1;
    return arrives.promise;
  };
  // To klik i samme tik: laasen tages synkront i det foerste.
  const first = gate.run("save", task);
  const second = gate.run("save", task);
  assert.deepEqual(await second, { ran: false });
  assert.equal(sent, 1);
  arrives.resolve();
  assert.equal((await first).ran, true);
});

test("skrive-laas: et kald der fejler, slipper laasen og melder fejlen videre", async () => {
  const gate = createWriteGate();
  const seen: Array<string | null> = [];
  const unsubscribe = gate.subscribe(() => seen.push(gate.current()));
  const failing = deferred();
  const run = gate.run("withdraw", () => failing.promise);
  failing.reject(new Error("net"));
  await assert.rejects(run, /net/);
  assert.equal(gate.current(), null, "laasen haenger aldrig efter en fejl");
  assert.deepEqual(seen, ["withdraw", null], "abonnenter hoerer baade tag og slip");
  unsubscribe();
  await gate.run("save", async () => true);
  assert.deepEqual(seen, ["withdraw", null], "et afmeldt abonnement kaldes ikke");
});

test("skrive-laas: et loebsskift under et kald saettes i koe, saa svaret aldrig lander paa en anden flade", async () => {
  const gate = createWriteGate();
  const arrives = deferred();
  const running = gate.run("save", () => arrives.promise);
  assert.equal(raceSwitchStep({ same: false, writing: gate.current(), dirty: true }), "queue");
  assert.equal(raceSwitchStep({ same: false, writing: gate.current(), dirty: false }), "queue");
  arrives.resolve();
  await running;
  // Efter kaldet: ugemt kladde aabner bjaelken (et fejlet gem), ellers skiftes der.
  assert.equal(raceSwitchStep({ same: false, writing: gate.current(), dirty: true }), "ask");
  assert.equal(raceSwitchStep({ same: false, writing: gate.current(), dirty: false }), "go");
  assert.equal(raceSwitchStep({ same: true, writing: "bulk", dirty: true }), "none");
});
