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
  saveSelectionWithReadback,
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
  settleBulkSave,
  createWriteGate,
  raceSwitchStep,
  addToDraft,
  actionTargets,
  capToRoom,
  createBulkStore,
  draftOverrides,
  draftSubmission,
  draftSummary,
  entriesWithDraft,
  scopeRaces,
  withdrawnWithDraft,
  BULK_KINDS,
  BULK_SCOPES,
  EMPTY_DRAFT,
  type BulkApi,
  type BulkCallResult,
  type BulkDraft,
  type BulkKind,
  type BulkScope,
  type SeasonRace,
  type SquadRow,
  type Selection,
} from "./planningWorkbench.ts";

test("a lost lineup response recovers only when the server has the full submitted selection", async () => {
  const submitted = { rider_ids: ["a", "b", "c"], captain_id: "a", free_role_ids: ["b", "c"] };
  const stored = { ...submitted, rider_ids: ["c", "a", "b"], free_role_ids: ["c", "b"], is_auto_filled: false };
  const calls: string[] = [];
  const send = async () => {
    calls.push("PUT");
    throw new Error("response lost");
  };
  assert.deepEqual(await saveSelectionWithReadback(submitted, send, async () => {
    calls.push("GET");
    return { ok: true, data: { selection: stored } };
  }), { ok: true });
  assert.deepEqual(calls, ["PUT", "GET"]);

  const rejected = { ok: false, data: { error: "selection_race_started" } };
  for (const data of [
    { selection: { ...stored, captain_id: "b" } },
    { selection: { ...stored, free_role_ids: ["b"] } },
    { selection: { ...stored, luxury_helper_id: "c" } },
    { selection: { ...stored, is_auto_filled: true } },
    { selection: stored, withdrawn: true },
    { selection: null },
  ]) {
    assert.equal(await saveSelectionWithReadback(submitted, async () => rejected, async () => ({ ok: true, data })), rejected);
  }
  assert.equal(await saveSelectionWithReadback(submitted, async () => rejected, async () => { throw new Error("offline"); }), rejected);
  assert.equal(await saveSelectionWithReadback(submitted, async () => rejected, async () => ({ ok: false })), rejected);
  assert.deepEqual(await saveSelectionWithReadback(
    { rider_ids: [] },
    send,
    async () => ({ ok: true, data: { selection: null, withdrawn: false } }),
  ), { ok: true });
});

test("a successful lineup save does not make a readback request", async () => {
  const result = { ok: true };
  let reads = 0;
  assert.equal(await saveSelectionWithReadback({ rider_ids: ["a"] }, async () => result, async () => {
    reads++;
    return { ok: false };
  }), result);
  assert.equal(reads, 0);
});

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

test("Fjern udtagelser: kun kommende, aabne loeb med ryttere der kan tages ud", () => {
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

test("Fjern udtagelser: de ryddede loeb beholder kun Train now-laaste ryttere, andre loeb er uroerte", () => {
  const entries = [
    { raceId: "r1", riderId: "a", raceRole: "captain" },
    { raceId: "r1", riderId: "t", raceRole: "hunter" },
    { raceId: "r2", riderId: "b", raceRole: "captain" },
  ];
  const shown = entriesAfterClear(entries, new Set(["r1"]), { r1: { riderIds: ["t"] } });
  assert.deepEqual(shown, [entries[1], entries[2]]);
  assert.equal(entriesAfterClear(entries, new Set()), entries, "ingen kladde: samme liste");
  const sel = selectionFromEntries([{ raceId: "r", riderId: "x", raceRole: "free_role" }, { raceId: "r", riderId: "y", raceRole: null }]);
  assert.deepEqual(sel.riderIds, ["x", "y"]);
  assert.deepEqual(sel.freeRoleIds, ["x"]);
});

test("Fjern udtagelser: et loeb hvor de laaste ryttere ville staa uden kaptajn, ryddes ikke (ét afvist loeb ville afvise hele kaldet)", () => {
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
  const draft = addToDraft(EMPTY_DRAFT, "clear", ["lockedCaptain", "plain"]);
  const { selections } = draftSubmission(entries, draft, locks);
  assert.equal(selections.get("lockedCaptain")!.captainId, "k");
  assert.deepEqual(selections.get("plain")!.riderIds, []);
});

// ── Handlinger-menuen (variant B, ejer 14/11) ───────────────────────────────
// Fast kalender og fast ur (TODAY), saa "naeste 7 dage" og "naeste loeb" altid er de samme.

function squad(ids: string[], captain: string | null = null): Selection {
  const base: Selection = { ...EMPTY_SELECTION, riderIds: ids, freeRoleIds: [] };
  return captain ? setRiderRole(base, captain, "captain") : base;
}

const TODAY = "2026-11-02";
const CAL = dateIndex([
  { gameDay: 27, date: "2026-11-02" },
  { gameDay: 28, date: "2026-11-03" },
  { gameDay: 29, date: "2026-11-04" },
  { gameDay: 30, date: "2026-11-05" },
  { gameDay: 31, date: "2026-11-16" },
  { gameDay: 32, date: "2026-11-17" },
]);
// done: koert · started: laast (kører) · full: fuld trup · part: 2 af 6 · empty: tom · out: afmeldt · late: om to uger
const RACES = [
  race("done", 27, 27, { status: "completed" }),
  race("started", 27, 27, { lineupLocked: true }),
  race("full", 28, 28),
  race("part", 29, 29),
  race("empty", 30, 30),
  race("out", 30, 30),
  race("late", 31, 32),
];
const SAVED = [
  ...["a", "b", "c", "d", "e", "f"].map((id, i) => ({ raceId: "full", riderId: id, raceRole: i === 0 ? "captain" : null })),
  { raceId: "part", riderId: "g", raceRole: "captain" },
  { raceId: "part", riderId: "h", raceRole: null },
  { raceId: "started", riderId: "z", raceRole: "captain" },
  { raceId: "out", riderId: "y", raceRole: "captain" },
];
const OUT = new Set(["out"]);
const LIST = visibleRaces(RACES, CAL, { scope: "next7", showPast: false, today: TODAY });

function ctxFor(checked: string[] = [], draft: BulkDraft = EMPTY_DRAFT) {
  const withdrawn = withdrawnWithDraft(OUT, draft);
  return {
    scope: { allRaces: RACES, listRaces: LIST, checked: new Set(checked), withdrawn },
    view: { entries: entriesWithDraft(SAVED, draft), withdrawn },
  };
}
const ids = (races: SeasonRace[]) => races.map((r) => r.id);

test("Handlinger: hvert omfang daekker de rigtige loeb (kun kommende, i kalenderens raekkefoelge)", () => {
  const { scope } = ctxFor(["late", "part", "done"]);
  assert.deepEqual(ids(scopeRaces("next", scope)), ["full"], "naeste loeb springer koerte, startede og afmeldte over");
  assert.deepEqual(ids(scopeRaces("checked", scope)), ["part", "late"], "afkrydsede, kommende, i kalender-raekkefoelge");
  assert.deepEqual(ids(scopeRaces("shown", scope)), ["started", "full", "part", "empty", "out"], "de viste: naeste 7 dage efter fast ur");
  assert.deepEqual(ids(scopeRaces("season", scope)), ["started", "full", "part", "empty", "out", "late"]);
  assert.deepEqual(BULK_SCOPES, ["next", "checked", "shown", "season"]);
});

test("Handlinger: hver handling x hvert omfang rammer kun de loeb, den faktisk aendrer", () => {
  const { scope, view } = ctxFor(["part", "late", "started"]);
  const expected: Record<BulkScope, Record<BulkKind, string[]>> = {
    next: { auto: [], clear: ["full"], withdraw: ["full"] },
    checked: { auto: ["part", "late"], clear: ["part"], withdraw: ["part", "late"] },
    shown: { auto: ["part", "empty"], clear: ["full", "part"], withdraw: ["full", "part", "empty"] },
    season: { auto: ["part", "empty", "late"], clear: ["full", "part"], withdraw: ["full", "part", "empty", "late"] },
  };
  for (const s of BULK_SCOPES) {
    for (const kind of BULK_KINDS) {
      const got = ids(actionTargets(kind, scopeRaces(s, scope), view));
      assert.deepEqual(got, expected[s][kind], `${kind} i ${s}`);
    }
  }
});

test("Handlinger: kladden viser ryddede loeb tomme, afmeldte som afmeldt og assistentens trup sat ind", () => {
  const auto = new Map([["empty", [{ raceId: "empty", riderId: "q", raceRole: "captain" }]]]);
  let draft = addToDraft(EMPTY_DRAFT, "clear", ["part"]);
  draft = addToDraft(draft, "withdraw", ["full"]);
  draft = addToDraft(draft, "auto", ["empty"], auto);
  const view = entriesWithDraft(SAVED, draft);
  const counts = pickedCounts(view);
  assert.equal(counts.get("part") ?? 0, 0);
  assert.equal(counts.get("full") ?? 0, 0, "et afmeldt loeb i kladden staar uden ryttere");
  assert.equal(counts.get("empty"), 1);
  assert.deepEqual([...withdrawnWithDraft(OUT, draft)].sort(), ["full", "out"]);
  assert.deepEqual(draftSummary(draft, SAVED), { auto: 1, added: 1, clear: 1, withdraw: 1 });
  // Kladden er ny for hver handling: den forrige er uroert (Fortryd kan stille den tilbage).
  assert.equal(EMPTY_DRAFT.kinds.size, 0);
});

test("Handlinger: Gem sender trupperne som masse-gem (samme form som et enkelt gem) og afmeldingerne for sig", () => {
  const auto = new Map([["empty", [{ raceId: "empty", riderId: "q", raceRole: "captain" }, { raceId: "empty", riderId: "r", raceRole: null }]]]);
  let draft = addToDraft(EMPTY_DRAFT, "auto", ["empty"], auto);
  draft = addToDraft(draft, "clear", ["part"]);
  draft = addToDraft(draft, "withdraw", ["late"]);
  const sub = draftSubmission(SAVED, draft);
  assert.deepEqual(sub.changes, [
    { raceId: "empty", rider_ids: ["q", "r"], captain_id: "q", sprint_captain_id: null, hunter_id: null, free_role_ids: [], co_captain_id: null },
    { raceId: "part", rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, free_role_ids: [], co_captain_id: null },
  ]);
  assert.deepEqual(sub.withdrawIds, ["late"]);
  assert.deepEqual(sub.selections.get("empty")!.riderIds, ["q", "r"]);
  // Assistenten regner med kladden: et ryddet loeb binder ingen; afmeldinger i kladden er ikke med.
  assert.deepEqual(draftOverrides(SAVED, draft), {
    empty: [{ rider_id: "q", race_role: "captain" }, { rider_id: "r", race_role: null }],
    part: [],
  });
});

test("Handlinger: kladden holdes altid inden for ét atomisk kald (loftet pr. gem)", () => {
  const many = Array.from({ length: 70 }, (_, i) => `r${i + 1}`);
  const first = capToRoom(many, EMPTY_DRAFT, 60);
  assert.equal(first.ids.length, 60, "kun op til loftet");
  assert.deepEqual(first.ids.slice(0, 2), ["r1", "r2"], "de foerste i kalenderens raekkefoelge");
  assert.equal(first.capped, true, "menuen siger, at resten venter");
  const full = addToDraft(EMPTY_DRAFT, "clear", first.ids);
  // Kladden er fuld: kun loeb der allerede er i den, kan faa en anden handling.
  assert.deepEqual(capToRoom(["r1", "r61"], full, 60), { ids: ["r1"], capped: true });
  assert.deepEqual(capToRoom(["a", "b"], EMPTY_DRAFT, 60), { ids: ["a", "b"], capped: false });
});

test("Handlinger: gemmet afstemmes mod det SENDTE loeb og den sendte udtagelse", () => {
  const old = squad(["a", "b", "t"], "a");
  const sent = squad(["t"], "t");
  // Codex P1: fladen viste den gemte trup (ren). Efter gemmet viser den det sendte og er stadig ren,
  // saa den gamle trup aldrig huskes som en kladde, der kan overskrive gemmet.
  const clean = settleBulkSave({ raceId: "r1", sel: old, saved: old }, { raceId: "r1", sel: sent });
  assert.deepEqual(clean, { mine: true, saved: sent, sel: sent, dirty: false });
  // Spillerens egne ugemte aendringer bliver staaende som ugemte.
  const edited = squad(["a", "x"], "a");
  const kept = settleBulkSave({ raceId: "r1", sel: edited, saved: old }, { raceId: "r1", sel: sent });
  assert.equal(kept.mine, true);
  if (kept.mine) {
    assert.equal(kept.saved, sent, "det gemte er det SENDTE, ikke det fladen viser");
    assert.equal(kept.sel, edited, "spillerens egne aendringer roeres ikke");
    assert.equal(kept.dirty, true);
  }
  assert.deepEqual(settleBulkSave({ raceId: "r3", sel: squad(["c"]), saved: squad(["c"]) }, { raceId: "r1", sel: sent }), { mine: false });
});

// ── Kladdens tilstand med styrede loefter ───────────────────────────────────
// Testen bestemmer selv, hvornaar et kald "naar serveren". Ingen sleep, intet vaegur.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Call = { kind: string; args: unknown; done: ReturnType<typeof deferred<BulkCallResult>> };

/** En falsk server: hvert kald venter, til testen svarer paa det. */
function fakeApi() {
  const calls: Call[] = [];
  const make = (kind: string) => (...args: unknown[]) => {
    const done = deferred<BulkCallResult>();
    calls.push({ kind, args, done });
    return done.promise;
  };
  const api: BulkApi = { propose: make("propose"), saveSelections: make("save"), withdraw: make("withdraw") };
  return { api, calls };
}

const proposal = (raceId: string, riders: string[]) => ({ race_id: raceId, entries: riders.map((r, i) => ({ rider_id: r, race_role: i === 0 ? "captain" : "helper" })) });
const CTX = { entries: SAVED, withdrawn: OUT };

test("Handlinger: assistenten spoerges gennem skrive-laasen og lander som kladde; intet gemmes", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  const running = store.run("auto", ["part", "empty"], CTX);
  assert.equal(gate.current(), "assist");
  assert.deepEqual(calls[0].args, [["part", "empty"], {}]);
  calls[0].done.resolve({ ok: true, data: { proposals: [proposal("part", ["g", "h", "i"]), proposal("empty", ["j", "k"])] } });
  assert.equal(await running, "done");
  assert.equal(gate.current(), null);
  assert.deepEqual([...store.draft().kinds], [["part", "auto"], ["empty", "auto"]]);
  assert.deepEqual(calls.map((c) => c.kind), ["propose"], "intet gem er sendt");
  // "helper" er ingen rolle i kladden (samme som saesonmatrixen).
  assert.deepEqual(store.draft().auto.get("part")!.map((e) => e.raceRole), ["captain", null, null]);
});

test("Handlinger: Fortryd gendanner kladden fra foer den seneste handling, ogsaa efter to handlinger i traek", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  const first = store.run("auto", ["part", "empty"], CTX);
  calls[0].done.resolve({ ok: true, data: { proposals: [proposal("part", ["g", "h", "i"]), proposal("empty", ["j", "k"])] } });
  await first;
  const afterAuto = store.draft();
  // To handlinger efter hinanden: rydningen af "part" afloeser assistentens trup (sidste handling vinder).
  assert.equal(await store.run("clear", ["part", "full"], CTX), "done");
  assert.deepEqual([...store.draft().kinds], [["part", "clear"], ["empty", "auto"], ["full", "clear"]]);
  assert.equal(store.draft().auto.has("part"), false);
  assert.deepEqual(draftSummary(store.draft(), SAVED), { auto: 1, added: 2, clear: 2, withdraw: 0 });
  assert.equal(store.undo(), true);
  assert.equal(store.draft(), afterAuto, "Fortryd giver praecis kladden fra foer");
  assert.equal(store.undo(), true);
  assert.equal(store.draft().kinds.size, 0, "og saa den tomme kladde");
  assert.equal(store.undo(), false, "intet at fortryde");
});

test("Handlinger: et afmeldt loeb faar aldrig en trup af assistenten (gemt eller i kladden)", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("withdraw", ["empty"], CTX);
  // Menuen tilbyder ikke assistenten for afmeldte loeb ...
  const { scope, view } = ctxFor([], store.draft());
  assert.deepEqual(ids(actionTargets("auto", scopeRaces("season", scope), view)), ["part", "late"]);
  // ... og svarer serveren alligevel med et forslag til et afmeldt loeb, laegges det aldrig i kladden.
  const running = store.run("auto", ["part", "empty", "out"], CTX);
  calls[0].done.resolve({ ok: true, data: { proposals: [proposal("part", ["g", "h", "i"]), proposal("empty", ["j"]), proposal("out", ["y"])] } });
  assert.equal(await running, "done");
  assert.equal(store.draft().kinds.get("empty"), "withdraw", "afmeldingen i kladden bliver staaende");
  assert.equal(store.draft().kinds.has("out"), false, "det gemt afmeldte loeb faar intet");
  assert.deepEqual([...store.draft().auto.keys()], ["part"]);
});

test("Handlinger: mens et gem koerer, kan hverken en handling, Fortryd eller et nyt Gem sendes", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["part"], CTX);
  const before = store.draft();
  const saving = store.save(CTX);
  assert.equal(gate.current(), "bulk");
  assert.equal(await store.run("withdraw", ["full"], CTX), "busy", "handlingen venter");
  assert.equal(await store.run("auto", ["empty"], CTX), "busy", "assistenten spoerges ikke");
  assert.equal(store.undo(), false, "Fortryd venter");
  assert.equal(await store.save(CTX), "busy", "et dobbeltklik paa Gem sender intet");
  assert.equal(store.draft(), before, "kladden er uroert imens");
  assert.deepEqual(calls.map((c) => c.kind), ["save"]);
  calls[0].done.resolve({ ok: true });
  assert.equal(await saving, "saved");
  assert.equal(store.draft().kinds.size, 0);
  // Efter gemmet virker handlingerne igen.
  assert.equal(await store.run("withdraw", ["full"], CTX), "done");
});

test("Handlinger: mens assistenten regner, kan Gem ikke sendes, og fladens gem venter ogsaa", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["part"], CTX);
  const running = store.run("auto", ["empty"], CTX);
  assert.equal(await store.save(CTX), "busy");
  assert.deepEqual(await gate.run("save", async () => true), { ran: false }, "fladens gem sendes ikke midt i assistentens kald");
  calls[0].done.resolve({ ok: true, data: { proposals: [proposal("empty", ["j", "k"])] } });
  assert.equal(await running, "done");
  assert.deepEqual(calls.map((c) => c.kind), ["propose"]);
});

test("Handlinger: Gem er alt eller intet; et afvist masse-gem efterlader hele kladden og intet afmeldes", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["part"], CTX);
  await store.run("withdraw", ["late"], CTX);
  const draft = store.draft();
  let saved = false;
  const saving = store.save(CTX, () => {
    saved = true;
  });
  // Foerst kontrolleres afmeldingerne uden at skrive ...
  assert.deepEqual(calls[0].args, [["late"], true]);
  calls[0].done.resolve({ ok: true });
  await new Promise((r) => setImmediate(r));
  // ... saa afvises masse-gemmet: intet afmeldes bagefter.
  assert.equal(calls[1].kind, "save");
  calls[1].done.resolve({ ok: false, data: { error: "selection_race_started", race_id: "part" } });
  assert.equal(await saving, "failed");
  assert.deepEqual(calls.map((c) => c.kind), ["withdraw", "save"], "ingen rigtig afmelding efter et afvist gem");
  assert.equal(store.draft(), draft, "hele kladden er der stadig");
  assert.equal(saved, false);
  assert.deepEqual(store.get().failure, { step: "save", partial: false, body: { error: "selection_race_started", race_id: "part" } });
});

test("Handlinger: fejler afmeldingen efter et gemt masse-gem, siger kladden det aerligt og beholder kun afmeldingerne", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["part"], CTX);
  await store.run("withdraw", ["late"], CTX);
  const seen: string[][] = [];
  const saving = store.save(CTX, ({ selections, withdrawn }) => {
    seen.push([...selections.keys(), ...withdrawn]);
  });
  calls[0].done.resolve({ ok: true });
  await new Promise((r) => setImmediate(r));
  calls[1].done.resolve({ ok: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls[2].args, [["late"], false]);
  calls[2].done.resolve({ ok: false, data: { error: "selection_race_started", race_id: "late" } });
  assert.equal(await saving, "partial");
  assert.deepEqual([...store.draft().kinds], [["late", "withdraw"]], "kun afmeldingen venter stadig");
  assert.equal(store.get().failure?.partial, true);
  assert.deepEqual(seen, [["part"]], "siden afstemmer de gemte trupper");
});

test("Handlinger: et helt gem afstemmer siden og toemmer kladden; assistenten regner med kladden", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["full"], CTX);
  const running = store.run("auto", ["part"], CTX);
  assert.deepEqual(calls[0].args, [["part"], { full: [] }], "det ryddede loeb binder ingen ryttere");
  calls[0].done.resolve({ ok: true, data: { proposals: [proposal("part", ["g", "h", "a"])] } });
  await running;
  let saw: { selections: string[]; withdrawn: string[] } | null = null;
  const saving = store.save(CTX, async ({ selections, withdrawn }) => {
    assert.equal(gate.current(), "bulk", "siden afstemmer inden for laasen");
    saw = { selections: [...selections.keys()], withdrawn };
  });
  assert.equal(calls[1].kind, "save", "ingen afmeldinger: ingen kontrol foerst");
  calls[1].done.resolve({ ok: true });
  assert.equal(await saving, "saved");
  assert.deepEqual(saw, { selections: ["full", "part"], withdrawn: [] });
  assert.equal(store.draft().kinds.size, 0);
  assert.equal(gate.current(), null);
});

test("Handlinger: spillerens eget valg paa fladen tager loebet ud af kladden, ogsaa i Fortryd-historikken", async () => {
  const gate = createWriteGate();
  const { api } = fakeApi();
  const store = createBulkStore({ gate, api });
  await store.run("clear", ["part"], CTX);
  await store.run("withdraw", ["full"], CTX);
  store.drop(["part"]);
  assert.deepEqual([...store.draft().kinds], [["full", "withdraw"]]);
  assert.equal(store.undo(), true);
  assert.equal(store.draft().kinds.size, 0, "rydningen af det loeb kommer ikke igen med Fortryd");
});

test("Handlinger: assistenten uden ledige ryttere eller med en fejl aendrer intet og siger det", async () => {
  const gate = createWriteGate();
  const { api, calls } = fakeApi();
  const store = createBulkStore({ gate, api });
  const none = store.run("auto", ["part"], CTX);
  calls[0].done.resolve({ ok: true, data: { proposals: [], skipped: [{ race_id: "part", reason: "selection_no_eligible_riders" }] } });
  assert.equal(await none, "empty");
  assert.equal(store.get().emptyAssist, true);
  assert.equal(store.draft().kinds.size, 0);
  const failing = store.run("auto", ["part"], CTX);
  calls[1].done.resolve({ ok: false, data: { error: "selection_flag_disabled" } });
  assert.equal(await failing, "failed");
  assert.equal(store.get().failure?.step, "assist");
  assert.equal(store.draft().kinds.size, 0);
});

// ── Skrive-laasen (PR #8160) ────────────────────────────────────────────────

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
