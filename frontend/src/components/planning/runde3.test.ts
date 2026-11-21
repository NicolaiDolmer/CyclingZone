// #7535 runde 3 + ejervalg 16/11 (#8294): visningerne, belastning i ord, kolonnevalg paa mobil, Formtop-
// raekkerne (udtagne oeverst, advarsel), formtop-maerket og mobil-arkets pile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adjacentRace,
  buildPeakRows,
  daysBetween,
  isWorkbenchView,
  peakApplyPairs,
  peakTargetOpen,
  saveLabelKey,
  sortPeakRows,
  sortSquadRows,
  withLoad,
  isLoadWord,
  normalizeMobileColumns,
  toggleMobileColumn,
  groupPeakRows,
  peakCountsByRace,
  nextPeakByRider,
  DEFAULT_MOBILE_COLUMNS,
  EMPTY_SELECTION,
  type SquadRow,
} from "../../lib/planningWorkbench.ts";
import { OPTIONAL_COLUMNS, normalizeOptionalColumns, toggleOptionalColumn } from "./squadColumns.ts";

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

test("views: three, unknown values fall back, the head gold follows the view (punkt 8 B)", () => {
  assert.equal(isWorkbenchView("squad"), true);
  assert.equal(isWorkbenchView("peak"), true);
  assert.equal(isWorkbenchView("calendar"), false);
  assert.equal(isWorkbenchView(null), false);
  assert.equal(saveLabelKey("squad"), "race.save");
  assert.equal(saveLabelKey("tactics"), "race.saveTactics");
  assert.equal(saveLabelKey("tactics", { squadDirty: true }), "race.saveSquadAndTactics");
  assert.equal(saveLabelKey("peak"), "race.savePeaks");
});

test("load (punkt 5): only known words land on rows, unknown is null, and it sorts light to hard", () => {
  const rows = withLoad([row("a"), row("b"), row("c"), row("d")], { a: "hard", c: "light", d: 42 });
  assert.equal(rows[0].load, "hard");
  assert.equal(rows[1].load, null);
  assert.equal(rows[2].load, "light");
  assert.equal(rows[3].load, null); // et tal er aldrig et ord
  assert.equal(isLoadWord("medium"), true);
  assert.equal(isLoadWord(30), false);
  assert.deepEqual(sortSquadRows(rows, { key: "load", dir: "desc" }, EMPTY_SELECTION).map((r) => r.id), ["a", "c", "b", "d"]);
  assert.deepEqual(sortSquadRows(rows, { key: "load", dir: "asc" }, EMPTY_SELECTION).map((r) => r.id), ["c", "a", "b", "d"]);
  const same = [row("a")];
  assert.equal(withLoad(same, null), same); // slukket model: raekkerne er uroerte
});

test("mobile columns (punkt 2): at most three, at least one, invalid falls back", () => {
  assert.deepEqual(normalizeMobileColumns(null), DEFAULT_MOBILE_COLUMNS);
  assert.deepEqual(normalizeMobileColumns(["nope"]), DEFAULT_MOBILE_COLUMNS);
  assert.deepEqual(normalizeMobileColumns(["form", "routeMatch"]), ["routeMatch", "form"]);
  assert.deepEqual(toggleMobileColumn(["routeMatch", "form", "fatigue"], "load"), ["form", "fatigue", "load"]);
  assert.deepEqual(toggleMobileColumn(["form"], "form"), ["form"]);
  assert.deepEqual(toggleMobileColumn(["routeMatch", "form"], "form"), ["routeMatch"]);
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

test("peak (punkt 6 B): picked riders first, warning when the peak hits this race but the rider is not picked", () => {
  const riders = [
    { id: "a", firstname: "Ann", peaks: [{ id: "p1", targetRaceId: "r1" }] },
    { id: "b", firstname: "Bo", peaks: [{ id: "p2", targetRaceId: "r1" }] },
    { id: "c", firstname: "Cy", peaks: [] },
  ];
  const rows = buildPeakRows({ riders, races, raceId: "r1", maxPerRider: 2, today: "2026-11-16" });
  const g = groupPeakRows(rows, ["a"]);
  assert.deepEqual(g.inSquad.map((r) => r.id), ["a"]);
  assert.deepEqual(g.outside.map((r) => r.id), ["b", "c"]);
  assert.deepEqual([...g.warn], ["b"]); // a er udtaget, c har ingen formtop her
});

test("peak counts per race (punkt 3) and next peak per rider (punkt 7)", () => {
  const riders = [
    { id: "a", peaks: [{ id: "p1", targetRaceId: "r1" }, { id: "p2", targetRaceId: "r2" }] },
    { id: "b", peaks: [{ id: "p3", targetRaceId: "r1" }, { targetRaceId: "r2", isSuggestion: true }] },
  ];
  const counts = peakCountsByRace(riders);
  assert.equal(counts.get("r1"), 2);
  assert.equal(counts.get("r2"), 1); // et forslag er ikke en formtop
  assert.equal(peakCountsByRace(null).size, 0);
  const next = nextPeakByRider(buildPeakRows({ riders, races, raceId: "r1", maxPerRider: 2, today: "2026-11-16" }));
  assert.equal(next.get("a")?.name, "Race One");
  assert.equal(next.get("a")?.days, 4);
});

// Kontrakt (punkt 7 + 8): rute-match paa ratingens gradient (ingen guld-fremhaevning), formtoppen staar
// ikke i Status, og visningen har kun hovedets ene guld-knap (taktik-fanens eget gem skjules og trykkes).
test("route match uses the rating gradient, peak is not in Status, and tactics has one gold in the head", () => {
  const table = readFileSync(new URL("./SquadTable.tsx", import.meta.url), "utf8");
  assert.match(table, /statPlateStyle\(value, \{ scale: "rating" \}\)/);
  assert.doesNotMatch(table, /text-cz-accent-t" : ""/);
  const status = table.slice(table.indexOf("function StatusCell"), table.indexOf("function FatigueCell"));
  assert.doesNotMatch(status, /peak/i);
  const tactics = readFileSync(new URL("./TacticsView.tsx", import.meta.url), "utf8");
  assert.match(tactics, /race-tactics-tab\]_button\.bg-cz-accent\]:hidden/);
  const wb = readFileSync(new URL("./RaceWorkbench.tsx", import.meta.url), "utf8");
  assert.match(wb, /tacticsRef\.current\?\.save\(\)/);
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
  assert.match(data, /\/expected-load/);
  assert.doesNotMatch(data, /after-race-fatigue/);
});

test("every new text exists in all five languages", () => {
  const keys = [
    "race.saveTactics", "race.savePeaks", "race.saveSquadAndTactics", "squad.type", "squad.load", "squad.loadTitle", "squad.loadNote",
    "squad.loadWord.light", "squad.loadWord.medium", "squad.loadWord.hard", "squad.peakShort", "squad.peakTitle", "squad.columns",
    "squad.mobileColumn.routeMatch", "squad.mobileColumn.form", "squad.mobileColumn.fatigue", "squad.mobileColumn.load", "squad.mobileColumn.rating",
    "views.hint.squad", "views.hint.tactics", "views.hint.peak", "peak.group.inSquad", "peak.group.outside", "peak.notPicked", "peak.pickForRace",
    "raceList.peaks", "profile.km", "profile.gain",
    "views.label", "views.squad", "views.tactics", "views.peak",
    "tactics.noSquad.title", "tactics.noSquad.description", "tactics.squadUnsaved", "tactics.shared", "tactics.saveInTab", "tactics.saveFirst", "unsavedBar.saveAndClose",
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

// #7535 (ejervalg 20/11, A+B): overskrifterne staar paa én linje med fuld tekst i title, ryttertypen er et
// maerke uden afkortning, og Status/Traethed/Belastning er skjult som standard bag en kolonnevaelger.
test("squad table headers stay on one line with the full word in the title (#7535 A)", () => {
  const src = readFileSync(new URL("./SquadTable.tsx", import.meta.url), "utf8");
  const head = src.slice(src.indexOf("const th = ("), src.indexOf("const td ="));
  assert.match(head, /whitespace-nowrap/);
  assert.doesNotMatch(head, /whitespace-normal/);
  assert.doesNotMatch(head, /text-wrap/);
  for (const key of ["rating", "fatigue", "load", "routeMatch"]) {
    assert.match(src, new RegExp(`t\\("squad\\.short\\.${key}"\\)`), `short header ${key}`);
    assert.match(src, new RegExp(`title: [^\\n]*t\\("squad\\.${key}"\\)`), `full title ${key}`);
  }
  assert.match(src, /const td = "[^"]*tabular-nums/);
});

test("squad table type is the shared badge, never truncated (#7535 A)", () => {
  const src = readFileSync(new URL("./SquadTable.tsx", import.meta.url), "utf8");
  assert.match(src, /import RiderTypeBadge from "..\/rider\/RiderTypeBadge\.jsx"/);
  assert.match(src, /<RiderTypeBadge primaryType=\{row\.type\} secondaryType=\{null\} \/>/);
  const typeCell = src.slice(src.indexOf("<RiderTypeBadge primaryType") - 250, src.indexOf("<RiderTypeBadge primaryType") + 100);
  assert.doesNotMatch(typeCell, /truncate|max-w-\[4rem\]/);
});

test("squad columns (#7535 B): Status, Fatigue and Load are hidden by default, the choice is remembered safely", () => {
  assert.deepEqual(OPTIONAL_COLUMNS, ["status", "fatigue", "load"]);
  assert.deepEqual(normalizeOptionalColumns(null), []);
  assert.deepEqual(normalizeOptionalColumns("nope"), []);
  assert.deepEqual(normalizeOptionalColumns(["load", "bogus", "status"]), ["status", "load"]);
  assert.deepEqual(toggleOptionalColumn([], "fatigue"), ["fatigue"]);
  assert.deepEqual(toggleOptionalColumn(["load"], "status"), ["status", "load"]);
  assert.deepEqual(toggleOptionalColumn(["status", "load"], "status"), ["load"]);
  const src = readFileSync(new URL("./SquadTable.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("./squadColumns.ts", import.meta.url), "utf8");
  // Lageret er aldrig paakraevet: laes og skriv er begge i try/catch, og tabellen virker uden.
  assert.match(store, /function readColumnsPref[\s\S]*?try \{[\s\S]*?\} catch/);
  assert.match(store, /function writeColumnsPref[\s\S]*?try \{[\s\S]*?\} catch/);
  // Kolonnevaelgeren er sidens egen titellinje (stroke-ikon, "Kolonner"), kun paa pc; mobilens chip-raekke er uaendret.
  assert.match(src, /<TableTitleBar[\s\S]*?columns=\{\{/);
  assert.match(src, /className="hidden sm:block" data-testid="planning-squad-columns-bar"/);
  const race = readFileSync(new URL("./RaceWorkbench.tsx", import.meta.url), "utf8");
  assert.match(race, /data-testid="planning-column-chips"/);
});

test("short column headers exist in all five languages and are short (#7535 A)", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const json = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/planning.json`, import.meta.url), "utf8"));
    for (const key of ["rating", "fatigue", "load", "routeMatch"]) {
      const short = json.squad.short?.[key];
      assert.equal(typeof short, "string", `${lang}: squad.short.${key}`);
      assert.ok(short.length > 0 && short.length <= 8, `${lang}: squad.short.${key} is short`);
      assert.ok(short.length <= json.squad[key].length, `${lang}: squad.short.${key} is not longer than the full word`);
    }
  }
});
