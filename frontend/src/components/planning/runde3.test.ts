// #7535 runde 3: visningerne, "Efter loebet", Formtop-raekkerne og mobil-arkets pile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adjacentRace,
  afterRaceWarns,
  buildPeakRows,
  daysBetween,
  isWorkbenchView,
  peakApplyPairs,
  peakTargetOpen,
  saveLabelKey,
  sortPeakRows,
  sortSquadRows,
  withAfterRace,
  EMPTY_SELECTION,
  type SquadRow,
} from "../../lib/planningWorkbench.ts";

const row = (id: string, extra: Partial<SquadRow> = {}): SquadRow => ({
  id,
  name: id,
  selectable: true,
  injured: false,
  overAge: false,
  outgoing: false,
  trainNowLocked: false,
  busyIn: null,
  rating: 60,
  ratingRole: null,
  form: 60,
  fatigue: 20,
  routeMatch: 60,
  byProfile: {},
  ...extra,
});

test("views: three, unknown values fall back, save label follows the view", () => {
  assert.equal(isWorkbenchView("squad"), true);
  assert.equal(isWorkbenchView("peak"), true);
  assert.equal(isWorkbenchView("calendar"), false);
  assert.equal(isWorkbenchView(null), false);
  assert.equal(saveLabelKey("squad"), "race.save");
  assert.equal(saveLabelKey("tactics"), "race.saveTactics");
  assert.equal(saveLabelKey("peak"), "race.savePeaks");
});

test("after race: server numbers land on rows, missing is unknown (never 0), and it sorts", () => {
  const rows = withAfterRace([row("a"), row("b"), row("c")], { a: 38, c: 64 });
  assert.equal(rows[0].afterRace, 38);
  assert.equal(rows[1].afterRace, null);
  assert.equal(rows[2].afterRace, 64);
  const sorted = sortSquadRows(rows, { key: "afterRace", dir: "desc" }, EMPTY_SELECTION);
  assert.deepEqual(sorted.map((r) => r.id), ["c", "a", "b"]);
  const asc = sortSquadRows(rows, { key: "afterRace", dir: "asc" }, EMPTY_SELECTION);
  assert.deepEqual(asc.map((r) => r.id), ["a", "c", "b"]);
  // Slukket model: raekkerne er uroerte.
  const same = [row("a")];
  assert.equal(withAfterRace(same, null), same);
});

test("after race warns at the design's amber level", () => {
  assert.equal(afterRaceWarns(null), false);
  assert.equal(afterRaceWarns(59), false);
  assert.equal(afterRaceWarns(60), true);
});

test("sheet arrows step through the list and stop at both ends", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(adjacentRace(list, "b", -1)?.id, "a");
  assert.equal(adjacentRace(list, "b", 1)?.id, "c");
  assert.equal(adjacentRace(list, "a", -1), null);
  assert.equal(adjacentRace(list, "c", 1), null);
  assert.equal(adjacentRace(list, "x", 1), null);
});

test("daysBetween counts whole calendar days", () => {
  assert.equal(daysBetween("2026-11-16", "2026-11-16"), 0);
  assert.equal(daysBetween("2026-11-16", "2026-11-23"), 7);
  assert.equal(daysBetween("2026-11-16", "2026-11-15"), -1);
});

const races = [
  { id: "r1", name: "Race One", date: "2026-11-20", isMine: true, started: false },
  { id: "r2", name: "Race Two", date: "2026-11-30", isMine: true, started: false },
  { id: "r3", name: "Race Old", date: "2026-11-01", isMine: true, started: true },
];

test("peak rows: target here, full, senior only; suggestions are not targets", () => {
  const riders = [
    { id: "a", firstname: "Ann", lastname: "A", peaks: [{ id: "p1", targetRaceId: "r1" }] },
    { id: "b", firstname: "Bo", lastname: "B", peaks: [{ id: "p2", targetRaceId: "r2" }, { id: "p3", targetRaceId: "r3" }] },
    { id: "c", firstname: "Cy", lastname: "C", peaks: [{ targetRaceId: "r1", isSuggestion: true }] },
    { id: "d", firstname: "Di", lastname: "D", squad: "u23", peaks: [] },
  ];
  const rows = buildPeakRows({ riders, races, raceId: "r1", maxPerRider: 2, today: "2026-11-16" });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.a.state, "here");
  assert.equal(by.a.next?.days, 4);
  assert.equal(by.b.state, "full");
  assert.equal(by.b.next?.name, "Race Two"); // et passeret mål er ikke "naeste"
  assert.equal(by.c.state, "open");
  assert.equal(by.c.targets.length, 0);
  assert.equal(by.d.state, "notSenior");
  assert.equal(by.a.name, "Ann A");

  const pairs = peakApplyPairs(rows, new Set(["a", "b", "c", "d"]), "r1");
  assert.deepEqual(pairs, [{ riderId: "c", raceId: "r1" }]);
});

test("peak target must be own, not started and not past", () => {
  assert.equal(peakTargetOpen(races[0], "2026-11-16"), true);
  assert.equal(peakTargetOpen(races[2], "2026-11-16"), false);
  assert.equal(peakTargetOpen({ id: "x", name: "x", isMine: false, date: "2026-12-01" }, "2026-11-16"), false);
  assert.equal(peakTargetOpen({ id: "x", name: "x", date: "2026-11-10" }, "2026-11-16"), false);
  assert.equal(peakTargetOpen(null, "2026-11-16"), false);
});

test("peak rows sort by every column, missing last", () => {
  const rows = buildPeakRows({
    riders: [
      { id: "a", firstname: "Zed", form: 70, fatigue: 10, rating: 60, peaks: [] },
      { id: "b", firstname: "Amy", form: 80, fatigue: null, rating: 65, peaks: [{ id: "p", targetRaceId: "r2" }] },
    ],
    races,
    raceId: "r1",
    maxPerRider: 2,
    today: "2026-11-16",
  });
  assert.deepEqual(sortPeakRows(rows, { key: "form", dir: "desc" }).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortPeakRows(rows, { key: "name", dir: "asc" }).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortPeakRows(rows, { key: "fatigue", dir: "asc" }).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortPeakRows(rows, { key: "start", dir: "asc" }).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortPeakRows(rows, { key: "target", dir: "desc" }).map((r) => r.id), ["b", "a"]);
});

// Kontrakt: Taktik er loebssidens egen fane (ingen kopi), og Formtop bruger Form-fanens kald.
test("tactics view mounts the race page's tactics tab; peak view uses the Form tab's endpoints", () => {
  const prim = readFileSync(new URL("./primitives.ts", import.meta.url), "utf8");
  assert.match(prim, /from "\.\.\/race\/RaceTacticsTab\.jsx"/);
  const tactics = readFileSync(new URL("./TacticsView.tsx", import.meta.url), "utf8");
  assert.match(tactics, /<RaceTacticsTab/);
  const data = readFileSync(new URL("../../lib/planningWorkbenchData.ts", import.meta.url), "utf8");
  assert.match(data, /\/api\/peak-plans\/board/);
  assert.match(data, /\/api\/peak-plans\/bulk/);
  assert.match(data, /\/after-race-fatigue/);
});

test("every new text exists in all five languages", () => {
  const keys = [
    "race.saveTactics", "race.savePeaks", "squad.afterRace", "squad.afterRaceTitle", "squad.afterRaceNote",
    "views.label", "views.squad", "views.tactics", "views.peak",
    "tactics.noSquad.title", "tactics.noSquad.description", "tactics.squadUnsaved", "tactics.shared", "tactics.saveInTab",
    "peak.target", "peak.targetClosed", "peak.selected", "peak.col.target", "peak.col.start", "peak.inDays",
    "peak.here", "peak.remove", "peak.removed", "peak.clear", "peak.full", "peak.notSenior",
    "peak.applied", "peak.appliedPartial", "peak.count", "sheet.prev", "sheet.next", "sheet.close", "sheet.position",
  ];
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const json = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/planning.json`, import.meta.url), "utf8"));
    for (const key of keys) {
      const v = key.split(".").reduce((o: any, k) => (o == null ? o : o[k]), json);
      assert.equal(typeof v, "string", `${lang}: ${key}`);
      assert.ok(v.length > 0, `${lang}: ${key}`);
    }
  }
});
