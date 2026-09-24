import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  packSquadCalendar, selectSquadRaces, raceDayAxis, calendarWeeks, weeklyRaceStarts, detectSquadCalendarViolations,
} from "./squadCalendarPacker.js";
import { SQUAD_CALENDAR } from "./calendarTierCaps.js";

const YOUTH = JSON.parse(readFileSync(new URL("./__fixtures__/racePoolCatalog.youth.json", import.meta.url), "utf8")).catalog;

test("calendarWeeks: 28 dage = 4 hele uger; en brudt uge til sidst er kort", () => {
  assert.deepEqual(calendarWeeks(28), [{ start: 0, end: 7 }, { start: 7, end: 14 }, { start: 14, end: 21 }, { start: 21, end: 28 }]);
  assert.deepEqual(calendarWeeks(10), [{ start: 0, end: 7 }, { start: 7, end: 10 }]);
});

test("raceDayAxis: 140 over 28 datoer = 5 pr. dato; uden mål én pr. dato", () => {
  const a = raceDayAxis({ days: 28, target: 140 });
  assert.equal(a.length, 140);
  assert.ok(a.perDate.every((n) => n === 5));
  assert.equal(a.firstOf[3], 15);
  const b = raceDayAxis({ days: 28, target: null });
  assert.equal(b.length, 28);
  assert.equal(b.firstOf[27], 27);
});

test("selectSquadRaces: prestige først, etape-budgettet holdes med plads til de resterende løb, navne-dedup", () => {
  const catalog = [
    { id: "a", name: "A", race_class: "ProSeries", stages: 8 },
    { id: "b", name: "B", race_class: "ProSeries", stages: 3 },
    { id: "c", name: "C", race_class: "Class1", stages: 1 },
    { id: "c2", name: "C", race_class: "Class2", stages: 1 },
    { id: "d", name: "D", race_class: "Class2", stages: 1 },
  ];
  const { picked, stageDays } = selectSquadRaces({ catalog, count: 3, stageBudget: 6 });
  assert.deepEqual(picked.map((r) => r.id), ["b", "c", "d"], "8-etapers løbet sprænger budgettet; dubletnavnet C springes over");
  assert.equal(stageDays, 5);
  const blocked = selectSquadRaces({ catalog, count: 2, stageBudget: 10, usedNames: new Set(["B"]) });
  assert.deepEqual(blocked.picked.map((r) => r.id), ["a", "c"]);
});

for (const squad of ["u23", "junior"]) {
  test(`packSquadCalendar (${squad}, ungdomskataloget): ${SQUAD_CALENDAR[squad].racesPerWeek.max} løb pr. uge, rene brud-lister, 140 løbsdage`, () => {
    const cfg = SQUAD_CALENDAR[squad];
    const catalog = YOUTH.filter((r) => r.squad === squad);
    const res = packSquadCalendar({ squad, catalog, days: 28, ...cfg, raceDayTarget: 140 });
    assert.deepEqual(res.violations, []);
    assert.deepEqual(res.weeklyStarts, [cfg.racesPerWeek.max, cfg.racesPerWeek.max, cfg.racesPerWeek.max, cfg.racesPerWeek.max]);
    assert.equal(res.timelineLength, 140);
    assert.ok(res.racingDates <= 28 * cfg.maxRacingDayShare, "de fleste datoer er rene træningsdage");
    assert.equal(res.trainingGameDays.length, 140 - res.naturalRaceDays);
    // Etaperne i træk, én pr. dato, game_day = datoens første løbsdag.
    for (const p of res.placements) {
      p.stagesPlaced.forEach((s, i) => {
        assert.equal(s.real_day, p.startRealDay + i);
        assert.equal(s.game_day, s.real_day * 5);
      });
    }
  });
}

test("packSquadCalendar: for lille katalog giver et højlydt brud, ikke en tavs tynd kalender", () => {
  const catalog = [{ id: "x", name: "X", race_class: "Class2", stages: 1 }];
  const res = packSquadCalendar({ squad: "u23", catalog, days: 28, ...SQUAD_CALENDAR.u23, raceDayTarget: 140 });
  assert.ok(res.violations.some((v) => v.includes("catalog supplied 1 of 8")));
  assert.ok(res.violations.some((v) => v.includes("week 2 has 0 race start")));
});

test("detectSquadCalendarViolations: for mange starter i en uge, to løb samme dato og for mange løbsdatoer fanges", () => {
  const placements = [
    { startRealDay: 0, stages: 4 }, { startRealDay: 2, stages: 1 }, { startRealDay: 5, stages: 1 },
    { startRealDay: 7, stages: 7 }, { startRealDay: 14, stages: 7 }, { startRealDay: 21, stages: 1 },
  ];
  const v = detectSquadCalendarViolations({ squad: "u23", placements, days: 28, racesPerWeek: { min: 1, max: 2 }, maxRacingDayShare: 0.5 });
  assert.ok(v.some((x) => x.includes("week 1 has 3")));
  assert.ok(v.some((x) => x.includes("same date")));
  assert.ok(v.some((x) => x.includes("dates carry a stage")));
  assert.deepEqual(weeklyRaceStarts(placements, 28), [3, 1, 1, 1]);
});
