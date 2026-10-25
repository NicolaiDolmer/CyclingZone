import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendarTableRows,
  filterCalendarTableRows,
  sortCalendarTableRows,
  nextSort,
  classOptions,
  terrainOptions,
  matchesRaceSearch,
  effectiveCalendarView,
} from "./calendarTable.ts";
import type { CalendarTableEntry } from "./calendarTable.ts";

const TODAY = "2026-10-27";

const ENTRIES: CalendarTableEntry[] = [
  {
    id: "r1", name: "Tour des Émirats", raceType: "stage_race", raceClass: "OtherWorldTourC", stages: 3,
    division: 2, poolId: 21, poolLabel: "Division 2 A", isMine: true, entered: true,
    stageSchedule: [
      { stage: 2, date: "2026-10-29", time: "12:00", terrain: "sprint", profileType: "flat" },
      { stage: 1, date: "2026-10-28", time: "12:00", terrain: "mountain", profileType: "high_mountain" },
      { stage: 3, date: "2026-10-30", time: "12:00", terrain: "itt", profileType: "itt" },
    ],
  },
  {
    id: "r2", name: "Klassieker van Kuurne", raceType: "single", raceClass: "ProSeries", stages: 1,
    division: 2, poolId: 21, poolLabel: "Division 2 A", isMine: true,
    stageSchedule: [{ stage: 1, date: "2026-10-28", time: "14:00", terrain: "cobbles", profileType: "cobbles" }],
  },
  {
    id: "r3", name: "Ocean Road Classic", raceType: "single", raceClass: "OtherWorldTourC", stages: 1,
    division: 2, poolId: 22, poolLabel: "Division 2 B", isMine: false,
    stageSchedule: [{ stage: 1, date: "2026-10-28", time: "16:00", terrain: "hilly", profileType: null }],
  },
  {
    id: "r4", name: "Giro dell'Appennino", raceType: "stage_race", raceClass: "OtherWorldTourB", stages: 2,
    division: 1, poolId: 11, poolLabel: "Division 1", isMine: false,
    stageSchedule: [
      { stage: 1, date: "2026-11-04", time: "12:00", profileType: "rolling" },
      { stage: 2, date: "2026-11-05", time: "12:00", profileType: "medium_mountain" },
    ],
  },
  // Løb uden etapeplan: én række på startdatoen med den grove kategori.
  { id: "r5", name: "Late Addition", raceType: "single", raceClass: "Class1", stages: 1, division: 1, poolId: 11, date: "2026-10-26", terrain: "mountain" },
];

const rows = buildCalendarTableRows(ENTRIES, TODAY);
const byId = (id: string) => rows.find((r) => r.id === id)!;

test("#6683 rækker: én pr. løb, etaper i rækkefølge, datoer, start og ét ikon pr. etape", () => {
  assert.equal(rows.length, 5);
  const r1 = byId("r1");
  assert.equal(r1.stageRace, true);
  assert.equal(r1.start, "2026-10-28");
  assert.equal(r1.end, "2026-10-30");
  assert.equal(r1.startTime, "12:00");
  assert.deepEqual(r1.stageTypes, ["high_mountain", "flat", "itt"]);
  assert.deepEqual(r1.kinds, ["mountain", "itt", "sprint"]);
  assert.equal(r1.stages, 3);
});

test("#6683 rækker: manglende profile_type falder tilbage til kalender-kategorien", () => {
  assert.deepEqual(byId("r3").stageTypes, ["hilly"]);
  const r5 = byId("r5");
  assert.deepEqual(r5.stageTypes, ["mountain"]);
  assert.equal(r5.start, "2026-10-26");
  assert.equal(r5.startTime, null);
});

test("#6683 holdstatus = myRaceStatus (samme regel som status-prikken og løbskortet)", () => {
  assert.equal(byId("r1").status, "selected");
  assert.equal(byId("r2").status, "missing");
  assert.equal(byId("r3").status, null); // ikke holdets løb
  const past = buildCalendarTableRows([{ ...ENTRIES[1], id: "old", stageSchedule: [{ stage: 1, date: "2026-10-01", time: "14:00" }] }], TODAY);
  assert.equal(past[0].status, null); // kørt løb har ingen status
});

test("#6683 filtre: faner (division, pulje, mit hold)", () => {
  assert.deepEqual(filterCalendarTableRows(rows, { division: 2 }).map((r) => r.id), ["r1", "r2", "r3"]);
  assert.deepEqual(filterCalendarTableRows(rows, { division: 2, poolId: 22 }).map((r) => r.id), ["r3"]);
  assert.deepEqual(filterCalendarTableRows(rows, { mineOnly: true }).map((r) => r.id), ["r1", "r2"]);
  assert.equal(filterCalendarTableRows(rows, {}).length, 5);
});

test("#6683 filtre: løbstype, klasse og terræn", () => {
  assert.deepEqual(filterCalendarTableRows(rows, { raceType: "stage_race" }).map((r) => r.id), ["r1", "r4"]);
  assert.deepEqual(filterCalendarTableRows(rows, { raceType: "single" }).map((r) => r.id), ["r2", "r3", "r5"]);
  assert.deepEqual(filterCalendarTableRows(rows, { raceClass: "OtherWorldTourC" }).map((r) => r.id), ["r1", "r3"]);
  // Terræn matcher hvis bare én etape har kategorien.
  assert.deepEqual(filterCalendarTableRows(rows, { terrain: "mountain" }).map((r) => r.id), ["r1", "r4", "r5"]);
  assert.deepEqual(filterCalendarTableRows(rows, { terrain: "cobbles" }).map((r) => r.id), ["r2"]);
  assert.deepEqual(filterCalendarTableRows(rows, { terrain: "itt", raceType: "single" }).map((r) => r.id), []);
});

test("#6683 søgning (fra #6636): accenter, småord og store bogstaver ignoreres", () => {
  assert.ok(matchesRaceSearch("Tour des Émirats", "tour emirats"));
  assert.ok(matchesRaceSearch("Giro dell'Appennino", "appennino"));
  assert.ok(!matchesRaceSearch("Ocean Road Classic", "kuurne"));
  assert.deepEqual(filterCalendarTableRows(rows, { search: "EMIRATS" }).map((r) => r.id), ["r1"]);
  assert.equal(filterCalendarTableRows(rows, { search: "   " }).length, 5);
});

test("#6683 sortering: datoer stigende som standard, starttid, så navn", () => {
  assert.deepEqual(sortCalendarTableRows(rows).map((r) => r.id), ["r5", "r1", "r2", "r3", "r4"]);
  assert.deepEqual(sortCalendarTableRows(rows, { key: "date", dir: "desc" }).map((r) => r.id), ["r4", "r3", "r2", "r1", "r5"]);
  assert.deepEqual(sortCalendarTableRows(rows, { key: "name" }).map((r) => r.id), ["r4", "r2", "r5", "r3", "r1"]);
  assert.deepEqual(sortCalendarTableRows(rows, { key: "stages", dir: "desc" }).map((r) => r.id)[0], "r1");
});

test("#6683 sortering: løb uden datoer står sidst i begge retninger", () => {
  const noDate = buildCalendarTableRows([{ id: "x", name: "Aaa", raceType: "single", stages: 1 }], TODAY);
  const all = [...rows, ...noDate];
  assert.equal(sortCalendarTableRows(all).at(-1)!.id, "x");
  assert.equal(sortCalendarTableRows(all, { key: "date", dir: "desc" }).at(-1)!.id, "x");
});

test("#6683 nextSort: samme kolonne vender, ny kolonne starter stigende", () => {
  assert.deepEqual(nextSort({ key: "date", dir: "asc" }, "date"), { key: "date", dir: "desc" });
  assert.deepEqual(nextSort({ key: "date", dir: "desc" }, "date"), { key: "date", dir: "asc" });
  assert.deepEqual(nextSort({ key: "date", dir: "desc" }, "name"), { key: "name", dir: "asc" });
});

test("#6683 filter-muligheder: klasser i prestige-rækkefølge, terræn hårdeste først", () => {
  assert.deepEqual(classOptions(rows), ["OtherWorldTourB", "OtherWorldTourC", "ProSeries", "Class1"]);
  // Et valgt filter forsvinder aldrig fra listen, selvom faneskift har fjernet rækkerne.
  assert.deepEqual(classOptions([], "Monuments"), ["Monuments"]);
  assert.deepEqual(terrainOptions(rows), ["mountain", "itt", "cobbles", "hilly", "sprint"]);
  assert.deepEqual(terrainOptions([], "ttt"), ["ttt"]);
});

test("#6683 flag off: kalenderen tegnes altid, uanset valgt visning", () => {
  assert.equal(effectiveCalendarView("table", false), "calendar");
  assert.equal(effectiveCalendarView("table", true), "table");
  assert.equal(effectiveCalendarView("calendar", true), "calendar");
  assert.equal(effectiveCalendarView(null, true), "calendar");
  assert.equal(effectiveCalendarView("bogus", true), "calendar");
});
