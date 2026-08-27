import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyRaceDraft, buildDraftsFromEntries, roleOf, advanceCell, raceDraftDirty, dirtyRaceIds,
  buildDayColumns, buildDateBands, buildRiderRowSegments, raceForDay, countProblems,
  buildRaceHeaderGroups, riderLoadDays,
} from "./seasonMatrix.js";

test("buildDraftsFromEntries: grupperer entries pr. løb og udleder rolle-felter", () => {
  const drafts = buildDraftsFromEntries([
    { raceId: "r1", riderId: "a", raceRole: "captain" },
    { raceId: "r1", riderId: "b", raceRole: "helper" },
    { raceId: "r1", riderId: "c", raceRole: "free_role" },
    { raceId: "r2", riderId: "d", raceRole: "sprint_captain" },
  ]);
  assert.deepEqual(drafts.get("r1").rider_ids, ["a", "b", "c"]);
  assert.equal(drafts.get("r1").captain_id, "a");
  assert.deepEqual(drafts.get("r1").free_role_ids, ["c"]);
  assert.equal(drafts.get("r2").sprint_captain_id, "d");
});

test("roleOf: helper når rytteren er i rider_ids uden noget rolle-felt", () => {
  const d = { ...emptyRaceDraft(), rider_ids: ["a"] };
  assert.equal(roleOf(d, "a"), "helper");
  assert.equal(roleOf(d, "z"), null);
});

test("advanceCell: cyklus tom→helper→captain→sprint_captain→hunter→free_role→tom", () => {
  let d = emptyRaceDraft();
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), "helper");
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), "captain");
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), "sprint_captain");
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), "hunter");
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), "free_role");
  d = advanceCell(d, "a"); assert.equal(roleOf(d, "a"), null);
  assert.equal(d.rider_ids.includes("a"), false);
});

test("advanceCell: overtagelse af en eksklusiv rolle degraderer den forrige indehaver til helper (aldrig to captains)", () => {
  let d = emptyRaceDraft();
  d = advanceCell(d, "a"); d = advanceCell(d, "a"); // a → captain
  assert.equal(roleOf(d, "a"), "captain");
  d = advanceCell(d, "b"); d = advanceCell(d, "b"); // b → captain (overtager)
  assert.equal(roleOf(d, "b"), "captain");
  assert.equal(roleOf(d, "a"), "helper", "a skal degraderes til helper, ikke forsvinde fra truppen");
  assert.equal(d.rider_ids.includes("a"), true);
});

test("raceDraftDirty + dirtyRaceIds: kun reelt ændrede løb rapporteres", () => {
  const server = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }]]);
  const draft = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }], // uændret
    ["r2", { ...emptyRaceDraft(), rider_ids: ["b"] }], // nyt løb, ikke på serveren
  ]);
  assert.equal(raceDraftDirty(draft.get("r1"), server.get("r1")), false);
  assert.deepEqual(dirtyRaceIds(draft, server), ["r2"]);
});

test("buildDayColumns: unionen af alle løbs [gameDayStart,gameDayEnd], sorteret, HARD INVARIANT-felter", () => {
  const races = [
    { id: "r1", gameDayStart: 3, gameDayEnd: 5 },
    { id: "r2", gameDayStart: 5, gameDayEnd: 5 },
    { id: "r3", gameDayStart: 10, gameDayEnd: 11 },
  ];
  assert.deepEqual(buildDayColumns(races), [3, 4, 5, 10, 11]);
});

test("buildDayColumns: løb uden gyldigt spænd (mangler game_day) bidrager intet", () => {
  const races = [{ id: "r1", gameDayStart: null, gameDayEnd: null }];
  assert.deepEqual(buildDayColumns(races), []);
});

test("buildDateBands: grupperer sammenhængende dage med samme dato under ét bånd", () => {
  const dayDates = new Map([[3, "2027-01-05"], [4, "2027-01-05"], [5, "2027-01-06"]]);
  const bands = buildDateBands([3, 4, 5], dayDates);
  assert.deepEqual(bands, [
    { date: "2027-01-05", days: [3, 4] },
    { date: "2027-01-06", days: [5] },
  ]);
});

test("buildDateBands: en løbsdag uden kendt dato arver forrige bånds dato (ingen dato-gæt)", () => {
  const dayDates = new Map([[3, "2027-01-05"]]);
  const bands = buildDateBands([3, 4], dayDates);
  assert.deepEqual(bands, [{ date: "2027-01-05", days: [3, 4] }]);
});

test("buildRiderRowSegments: ét spænd pr. holdudtag (kontrakt #3), tomme celler ellers", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 6 },
    { id: "oneDay", gameDayStart: 8, gameDayEnd: 8 },
  ];
  const dayColumns = buildDayColumns(races); // [2..6, 8]
  const draftByRace = new Map([
    ["gt", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }],
    ["oneDay", emptyRaceDraft()],
  ]);
  const segs = buildRiderRowSegments(dayColumns, races, draftByRace, "rider1");
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { kind: "entry", race: races[0], role: "captain", days: [2, 3, 4, 5, 6], colSpan: 5 });
  assert.deepEqual(segs[1], { kind: "empty", day: 8 });
});

test("raceForDay: finder løbet der dækker en given løbsdag", () => {
  const races = [{ id: "r1", gameDayStart: 2, gameDayEnd: 6 }];
  assert.equal(raceForDay(races, 4).id, "r1");
  assert.equal(raceForDay(races, 9), null);
});

test("countProblems: overfyldt løb tælles med", () => {
  const races = [{ id: "r1", gameDayStart: 1, gameDayEnd: 1, sizeMin: 6, sizeMax: 6 }];
  const draftByRace = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a", "b", "c", "d", "e", "f", "g"] }]]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 1);
  assert.ok(p.affectedRaceIds.has("r1"));
});

test("countProblems: samme rytter i to overlappende løb i kladden er en peer-konflikt", () => {
  const races = [
    { id: "r1", gameDayStart: 1, gameDayEnd: 3, sizeMin: 6, sizeMax: 8 },
    { id: "r2", gameDayStart: 2, gameDayEnd: 2, sizeMin: 6, sizeMax: 6 },
  ];
  const draftByRace = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }],
    ["r2", { ...emptyRaceDraft(), rider_ids: ["a"] }],
  ]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 1);
  assert.equal(p.peerConflicts.length, 1);
  assert.ok(p.affectedRiderIds.has("a"));
});

test("buildRaceHeaderGroups: grupperer kolonnerne pr. løb, colSpan summerer til alle kolonner", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 4 },
    { id: "one", gameDayStart: 6, gameDayEnd: 6 },
  ];
  const dayColumns = buildDayColumns(races);
  const groups = buildRaceHeaderGroups(dayColumns, races);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].race.id, "gt");
  assert.deepEqual(groups[0].days, [2, 3, 4]);
  assert.equal(groups[1].race.id, "one");
  const totalCols = groups.reduce((n, g) => n + g.days.length, 0);
  assert.equal(totalCols, dayColumns.length);
});

test("riderLoadDays: summerer løbsdage over ALLE løb rytteren er udtaget til i kladden", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 6 }, // 5 dage
    { id: "one", gameDayStart: 8, gameDayEnd: 8 }, // 1 dag
  ];
  const draftByRace = new Map([
    ["gt", { ...emptyRaceDraft(), rider_ids: ["a"] }],
    ["one", { ...emptyRaceDraft(), rider_ids: ["a"] }],
  ]);
  assert.equal(riderLoadDays(races, draftByRace, "a"), 6);
  assert.equal(riderLoadDays(races, draftByRace, "z"), 0);
});

test("countProblems: ingen problemer → 'No problems'-tilstanden (count 0, tomme sæt)", () => {
  const races = [{ id: "r1", gameDayStart: 1, gameDayEnd: 1, sizeMin: 6, sizeMax: 6 }];
  const draftByRace = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }]]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 0);
});
