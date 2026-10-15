import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  packSquadCalendar, selectSquadRaces, raceDayAxis, calendarWeeks, weeklyRaceStarts, detectSquadCalendarViolations,
  youthSlotsApartFromSenior, squadSlotsForDate, STAGE_RACE_REST_DAYS, LAST_WEEK_DAYS, SENIOR_FIRST_STAGE_GAP_MINUTES,
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

// ── #6667 (ejer 15/10): S5's ungdomskalender uden S4's fejl ─────────────────────────────

const S5_DAYS = 32;
const racingDatesOf = (res) => new Set(res.placements.flatMap((p) => p.stagesPlaced.map((s) => s.real_day)));

for (const days of [28, S5_DAYS]) {
  for (const squad of ["u23", "junior"]) {
    test(`#6667 byggeregler (${squad}, ${days} datoer): ingen start dagen efter et etapeløb, sidste uge har en etape, rene brud-lister`, () => {
      const catalog = YOUTH.filter((r) => r.squad === squad);
      const res = packSquadCalendar({ squad, catalog, days, ...SQUAD_CALENDAR[squad], raceDayTarget: days * 5 });
      assert.deepEqual(res.violations, []);
      for (const p of res.placements.filter((x) => x.stages > 1)) {
        const end = p.startRealDay + p.stages - 1;
        const next = res.placements.filter((q) => q.startRealDay > end).sort((a, b) => a.startRealDay - b.startRealDay)[0];
        if (next) assert.ok(next.startRealDay > end + STAGE_RACE_REST_DAYS, `${squad}: løb ${next.id} starter dag ${next.startRealDay + 1}, dagen efter etapeløbet ${p.id} slutter`);
      }
      const dates = racingDatesOf(res);
      assert.ok([...dates].some((d) => d >= days - LAST_WEEK_DAYS), `${squad}: sæsonens sidste uge er tom`);
    });
  }
}

test("#6667 U23 kører flere løbsdatoer end junior (ejer: U23 ~18, junior ~12 af 32), og ingen af dem over sit loft", () => {
  const dates = {};
  for (const squad of ["u23", "junior"]) {
    const cfg = SQUAD_CALENDAR[squad];
    const res = packSquadCalendar({ squad, catalog: YOUTH.filter((r) => r.squad === squad), days: S5_DAYS, ...cfg, raceDayTarget: S5_DAYS * 5 });
    dates[squad] = racingDatesOf(res).size;
    assert.ok(dates[squad] <= Math.floor(S5_DAYS * cfg.maxRacingDayShare), `${squad}: ${dates[squad]} datoer, over loftet`);
    assert.ok(dates[squad] >= Math.floor(S5_DAYS * cfg.maxRacingDayShare) - 2, `${squad}: ${dates[squad]} datoer, for langt under ejerens mål`);
  }
  assert.ok(dates.u23 > dates.junior, `U23 ${dates.u23} skal være over junior ${dates.junior}`);
  assert.equal(Math.floor(S5_DAYS * SQUAD_CALENDAR.u23.maxRacingDayShare), 18);
  assert.equal(Math.floor(S5_DAYS * SQUAD_CALENDAR.junior.maxRacingDayShare), 12);
});

test("#6667 regel 1: gaten fanger en start dagen efter et etapeløb, men ikke efter et endagsløb", () => {
  const base = { squad: "u23", days: 14, racesPerWeek: { min: 1, max: 2 }, maxRacingDayShare: 1 };
  const bad = detectSquadCalendarViolations({ ...base, placements: [{ startRealDay: 0, stages: 3 }, { startRealDay: 3, stages: 1 }, { startRealDay: 8, stages: 1 }, { startRealDay: 12, stages: 1 }] });
  assert.ok(bad.some((v) => v.includes("#6667 rule 1") && v.includes("day 4")), bad.join("\n"));
  const ok = detectSquadCalendarViolations({ ...base, placements: [{ startRealDay: 0, stages: 3 }, { startRealDay: 4, stages: 1 }, { startRealDay: 5, stages: 1 }, { startRealDay: 12, stages: 1 }] });
  assert.deepEqual(ok.filter((v) => v.includes("rule 1")), [], "efter fridagen må truppen starte igen, og endagsløb i træk er tilladt");
});

test("#6667 regel 2: gaten fanger en tom sidste uge, også når kalenderugerne er hele", () => {
  const v = detectSquadCalendarViolations({
    squad: "junior", days: 28, racesPerWeek: { min: 1, max: 1 }, maxRacingDayShare: 0.5,
    placements: [{ startRealDay: 0, stages: 1 }, { startRealDay: 7, stages: 1 }, { startRealDay: 14, stages: 1 }, { startRealDay: 20, stages: 1 }],
  });
  assert.ok(v.some((x) => x.includes("#6667 rule 2") && x.includes("day 22-28")), v.join("\n"));
  const ok = detectSquadCalendarViolations({
    squad: "junior", days: 28, racesPerWeek: { min: 1, max: 1 }, maxRacingDayShare: 0.5,
    placements: [{ startRealDay: 0, stages: 1 }, { startRealDay: 7, stages: 1 }, { startRealDay: 14, stages: 1 }, { startRealDay: 27, stages: 1 }],
  });
  assert.deepEqual(ok.filter((x) => x.includes("rule 2")), []);
});

test("#6667 egen starttid: en ungdomsetape inden for en halv time af seniorens første etape flyttes; ellers uændret", () => {
  const senior = ["15:30", "16:20", "16:25", "16:45", "17:10"];
  assert.deepEqual(youthSlotsApartFromSenior({ squad: "u23", slots: ["16:30"], seniorSlots: ["11:00", "12:00", "13:00"] }), ["16:30"], "en almindelig dag er urørt");
  assert.deepEqual(youthSlotsApartFromSenior({ squad: "junior", slots: ["15:30"], seniorSlots: senior }), ["16:15"]);
  // U23's mål (15:30 + 30 + 45 = 16:45) er en senior-tid, så den rykker 5 min videre.
  assert.deepEqual(youthSlotsApartFromSenior({ squad: "u23", slots: ["15:30"], seniorSlots: senior }), ["16:50"]);
  // To trupper skubbet til samme minut lander aldrig sammen.
  const j = youthSlotsApartFromSenior({ squad: "junior", slots: ["19:30"], seniorSlots: ["19:30", "20:00"] });
  const u = youthSlotsApartFromSenior({ squad: "u23", slots: ["19:30"], seniorSlots: ["19:30", "20:00"] });
  assert.notEqual(j[0], u[0]);
  // En anden trups tid er optaget.
  assert.deepEqual(youthSlotsApartFromSenior({ squad: "junior", slots: ["15:45"], seniorSlots: ["15:45"], otherSquadSlots: ["16:30"] }), ["16:35"]);
  assert.throws(() => youthSlotsApartFromSenior({ squad: "u23", slots: ["21:30"], seniorSlots: ["21:30"] }), /#6667/);
  for (const [squad, slot] of [["junior", "15:30"], ["u23", "15:30"]]) {
    const [moved] = youthSlotsApartFromSenior({ squad, slots: [slot], seniorSlots: senior });
    const [h, m] = moved.split(":").map(Number);
    assert.ok(h * 60 + m - (15 * 60 + 30) >= SENIOR_FIRST_STAGE_GAP_MINUTES, `${squad}: ${moved} for tæt på 15:30`);
    assert.ok(!senior.includes(moved), `${squad}: ${moved} er en senior-tid`);
  }
});

test("#6667 squadSlotsForDate: sæsonens første dag (planlægningsvinduet 15:30) giver junior egen tid; andre dage er SQUAD_CALENDAR's", () => {
  const notBefore = new Date("2026-10-28T14:30:00Z"); // 15:30 dansk tid (CET)
  const firstDay = (squad) => squadSlotsForDate({
    squad, tier: 1, localDate: "2026-10-28", squadSlots: [SQUAD_CALENDAR[squad].stageSlot],
    otherSquadSlots: Object.entries(SQUAD_CALENDAR).filter(([s]) => s !== squad).map(([, c]) => c.stageSlot), notBefore,
  });
  const junior = firstDay("junior");
  assert.notEqual(junior[0], "15:30", "junior skubbes ikke længere til seniorens første minut");
  assert.ok(junior[0] >= "16:00", `junior ${junior[0]} ligger i seniorens første halve time`);
  assert.deepEqual(firstDay("u23"), [SQUAD_CALENDAR.u23.stageSlot], "U23's normale tid ligger allerede en time efter");
  assert.deepEqual(
    squadSlotsForDate({ squad: "junior", tier: 1, localDate: "2026-11-04", squadSlots: [SQUAD_CALENDAR.junior.stageSlot], notBefore }),
    [SQUAD_CALENDAR.junior.stageSlot], "en almindelig dag er urørt",
  );
});
