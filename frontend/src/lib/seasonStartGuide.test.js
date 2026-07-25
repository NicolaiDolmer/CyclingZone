import test from "node:test";
import assert from "node:assert/strict";
import {
  SEASON_START_WINDOW_DAYS,
  SEASON_START_SQUAD_TARGET,
  daysSinceSeasonStart,
  isSeasonStartWindow,
  seasonStartDismissKey,
  buildSeasonStartItems,
  countDoneItems,
} from "./seasonStartGuide.js";

const season2 = { id: "s2", number: 2, status: "active", start_date: "2026-07-27" };

test("daysSinceSeasonStart: hele døgn, uafhængigt af tidspunkt på dagen", () => {
  assert.equal(daysSinceSeasonStart("2026-07-27", new Date("2026-07-27T06:00:00Z")), 0);
  assert.equal(daysSinceSeasonStart("2026-07-27", new Date("2026-07-27T23:59:00Z")), 0);
  assert.equal(daysSinceSeasonStart("2026-07-28", new Date("2026-07-29T01:00:00Z")), 1);
  assert.equal(daysSinceSeasonStart("2026-07-27", new Date("2026-08-03T12:00:00Z")), 7);
});

test("daysSinceSeasonStart: manglende/ugyldig dato giver null", () => {
  assert.equal(daysSinceSeasonStart(null), null);
  assert.equal(daysSinceSeasonStart(undefined), null);
  assert.equal(daysSinceSeasonStart("ikke-en-dato", new Date("2026-07-27T06:00:00Z")), null);
});

test("isSeasonStartWindow: åbent på dag 0 og på sidste dag, lukket dagen efter", () => {
  assert.equal(isSeasonStartWindow(season2, new Date("2026-07-27T06:00:00Z")), true);
  assert.equal(isSeasonStartWindow(season2, new Date("2026-08-03T12:00:00Z")), true);
  assert.equal(isSeasonStartWindow(season2, new Date("2026-08-04T00:30:00Z")), false);
});

test("isSeasonStartWindow: vinduet er forankret i akademi-deadlinen (7 dage)", () => {
  assert.equal(SEASON_START_WINDOW_DAYS, 7);
});

test("isSeasonStartWindow: sæson 1 er onboarding, ikke genopsætning", () => {
  const season1 = { ...season2, number: 1, start_date: "2026-06-22" };
  assert.equal(isSeasonStartWindow(season1, new Date("2026-06-22T06:00:00Z")), false);
});

test("isSeasonStartWindow: kun aktive sæsoner, og aldrig uden startdato", () => {
  assert.equal(isSeasonStartWindow({ ...season2, status: "upcoming" }, new Date("2026-07-27T06:00:00Z")), false);
  assert.equal(isSeasonStartWindow({ ...season2, start_date: null }, new Date("2026-07-27T06:00:00Z")), false);
  assert.equal(isSeasonStartWindow(null, new Date("2026-07-27T06:00:00Z")), false);
});

test("isSeasonStartWindow: start_date i fremtiden fejler ÅBENT (guiden vises)", () => {
  assert.equal(isSeasonStartWindow(season2, new Date("2026-07-26T06:00:00Z")), true);
});

test("seasonStartDismissKey: nøglen er pr. sæson, så guiden vender tilbage næste skifte", () => {
  assert.notEqual(seasonStartDismissKey("s2"), seasonStartDismissKey("s3"));
  assert.match(seasonStartDismissKey("s2"), /s2$/);
});

test("buildSeasonStartItems: fire punkter med akademi, tre uden", () => {
  const withAcademy = buildSeasonStartItems({ academyEnabled: true });
  assert.deepEqual(withAcademy.map((i) => i.key), ["squad", "training", "board", "academy"]);
  const withoutAcademy = buildSeasonStartItems({ academyEnabled: false });
  assert.deepEqual(withoutAcademy.map((i) => i.key), ["squad", "training", "board"]);
});

test("buildSeasonStartItems: hvert punkt deep-linker til den side beslutningen træffes på", () => {
  const items = buildSeasonStartItems({ academyEnabled: true });
  assert.deepEqual(
    Object.fromEntries(items.map((i) => [i.key, i.to])),
    { squad: "/auctions", training: "/training", board: "/board", academy: "/academy" },
  );
});

test("buildSeasonStartItems: trup er udført ved måltallet, ikke under", () => {
  assert.equal(buildSeasonStartItems({ squadCount: SEASON_START_SQUAD_TARGET })[0].done, true);
  assert.equal(buildSeasonStartItems({ squadCount: SEASON_START_SQUAD_TARGET - 1 })[0].done, false);
  assert.equal(SEASON_START_SQUAD_TARGET, 18);
});

test("buildSeasonStartItems: træningsplan udført når der findes rækker for sæsonen", () => {
  assert.equal(buildSeasonStartItems({ trainingPlanCount: 12 })[1].done, true);
  assert.equal(buildSeasonStartItems({ trainingPlanCount: 0 })[1].done, false);
});

test("buildSeasonStartItems: ukendt data giver null, ALDRIG et falsk udført", () => {
  const items = buildSeasonStartItems({
    trainingPlanCount: null, boardStatusLoaded: false,
    pendingGraduations: null, academyEnabled: true,
  });
  assert.equal(items[1].done, null); // træning ikke hentet
  assert.equal(items[2].done, null); // board-status fejlede
  assert.equal(items[3].done, null); // graduates ikke hentet
});

test("buildSeasonStartItems: board er udført når en plan er forhandlet færdig", () => {
  assert.equal(buildSeasonStartItems({ boardStatusLoaded: true, boardPlanMissing: false })[2].done, true);
  assert.equal(buildSeasonStartItems({ boardStatusLoaded: true, boardPlanMissing: true })[2].done, false);
});

test("buildSeasonStartItems: akademi udført når ingen graduates afventer", () => {
  const done = buildSeasonStartItems({ academyEnabled: true, pendingGraduations: 0 });
  assert.equal(done[3].done, true);
  const pending = buildSeasonStartItems({ academyEnabled: true, pendingGraduations: 3 });
  assert.equal(pending[3].done, false);
});

test("countDoneItems: kun bekræftet udførte tæller med", () => {
  assert.equal(countDoneItems([{ done: true }, { done: false }, { done: null }, { done: true }]), 2);
  assert.equal(countDoneItems([]), 0);
  assert.equal(countDoneItems(), 0);
});
