import test from "node:test";
import assert from "node:assert/strict";
import { deriveGameDayAxis } from "./calendarGameDayRepair.js";
import { checkCalendarOverlapInvariants } from "./calendarOverlapInvariant.js";
import { packLaneCalendar } from "./raceCalendarLanePacker.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { TIER_DENSITY, TIER_OVERLAP_CAP } from "./calendarTierCaps.js";

const at = (date, hhmm) => `${date}T${hhmm}:00.000Z`;

test("fire samtidige loeb paa én dato deles i sub-dage saa cap 3 holder", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-25", "09:00"), game_day: 0 },
    { race_id: "b", stage_number: 1, scheduled_at: at("2026-08-25", "11:00"), game_day: 0 },
    { race_id: "c", stage_number: 1, scheduled_at: at("2026-08-25", "13:00"), game_day: 0 },
    { race_id: "d", stage_number: 1, scheduled_at: at("2026-08-25", "15:00"), game_day: 0 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  assert.equal(r.gameDayCount, 2, "4 loeb / cap 3 kraever 2 in-game-dage");
  const check = checkCalendarOverlapInvariants({ scheduleRows: r.rows, overlapCap: 3 });
  assert.equal(check.overlapViolationCount, 0);
  assert.equal(check.stageRepeatViolationCount, 0);
});

test("to etaper af SAMME loeb paa én dato faar hver sin in-game-dag, i etape-raekkefoelge", () => {
  const rows = [
    { race_id: "gt", stage_number: 1, scheduled_at: at("2026-08-25", "09:00"), game_day: 0 },
    { race_id: "gt", stage_number: 2, scheduled_at: at("2026-08-25", "13:00"), game_day: 0 },
    { race_id: "gt", stage_number: 3, scheduled_at: at("2026-08-25", "17:00"), game_day: 0 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  assert.deepEqual(r.rows.map((x) => [x.stage_number, x.game_day]), [[1, 0], [2, 1], [3, 2]]);
  assert.equal(checkCalendarOverlapInvariants({ scheduleRows: r.rows, overlapCap: 3 }).stageRepeatViolationCount, 0);
});

test("aksen er monoton over datoer: alle in-game-dage paa dag 1 ligger foer dag 2", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-26", "09:00"), game_day: 1 },
    { race_id: "a", stage_number: 2, scheduled_at: at("2026-08-26", "13:00"), game_day: 1 },
    { race_id: "b", stage_number: 1, scheduled_at: at("2026-08-25", "09:00"), game_day: 0 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  const byDate = new Map();
  for (const x of r.rows) {
    const d = x.scheduled_at.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(x.game_day);
  }
  assert.ok(Math.max(...byDate.get("2026-08-25")) < Math.min(...byDate.get("2026-08-26")));
});

test("Div 4-form (2 loeb/dag, cap 2) giver PRAECIS én in-game-dag pr. kalenderdag", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-25", "10:00"), game_day: 0 },
    { race_id: "b", stage_number: 1, scheduled_at: at("2026-08-25", "16:00"), game_day: 0 },
    { race_id: "a", stage_number: 2, scheduled_at: at("2026-08-26", "10:00"), game_day: 1 },
    { race_id: "c", stage_number: 1, scheduled_at: at("2026-08-26", "16:00"), game_day: 1 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: TIER_OVERLAP_CAP[4] });
  assert.deepEqual(r.gameDaysPerDate, { "2026-08-25": 1, "2026-08-26": 1 });
  assert.equal(r.changed, 0, "en korrekt D4-akse skal genskabes uaendret");
});

test("deterministisk: samme input giver samme akse", () => {
  const rows = [
    { race_id: "b", stage_number: 1, scheduled_at: at("2026-08-25", "11:00"), game_day: 0 },
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-25", "11:00"), game_day: 0 },
    { race_id: "c", stage_number: 2, scheduled_at: at("2026-08-25", "13:00"), game_day: 0 },
  ];
  assert.deepEqual(deriveGameDayAxis({ scheduleRows: rows, overlapCap: 2 }),
                   deriveGameDayAxis({ scheduleRows: rows, overlapCap: 2 }));
});

// Den afgoerende: tag pakkerens EGET Div 1-layout, smid dens game_day vaek (som
// #4155-reparationen gjorde), udled aksen igen fra datoerne alene — og bekraeft at
// resultatet opfylder de samme invarianter som originalen.
test("pakkerens Div 1-layout kan genskabes fra datoerne alene og bestaar invarianterne", () => {
  const stageRaces = [
    { id: "gt-1", stages: 21, race_class: "TourFrance" },
    { id: "gt-2", stages: 21, race_class: "GiroVuelta" },
    { id: "gt-3", stages: 21, race_class: "GiroVuelta" },
    { id: "wt-1", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-2", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-3", stages: 7, race_class: "OtherWorldTourA" },
    { id: "wt-4", stages: 6, race_class: "OtherWorldTourA" },
  ];
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments" })),
    ...Array.from({ length: 43 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA" })),
  ];
  const packed = packLaneCalendar({
    stageRaces, oneDayRaces, density: TIER_DENSITY[1], days: 28, overlapCap: TIER_OVERLAP_CAP[1],
  });
  const { stageRows } = buildScheduleRows({
    placements: packed.placements,
    from: new Date("2026-08-24T00:00:00Z"),
    slots: ["11:00", "13:00", "15:00", "17:00", "19:00"],
  });

  // Simulér #4155-skaden: game_day = dato-offset.
  const dates = [...new Set(stageRows.map((r) => r.scheduled_at.slice(0, 10)))].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const skadede = stageRows.map((r) => ({ ...r, game_day: dateIndex.get(r.scheduled_at.slice(0, 10)) }));

  const foer = checkCalendarOverlapInvariants({ scheduleRows: skadede, overlapCap: TIER_OVERLAP_CAP[1] });
  assert.ok(foer.overlapViolationCount > 0, "den simulerede skade skal faktisk bryde cap'en");

  const r = deriveGameDayAxis({ scheduleRows: skadede, overlapCap: TIER_OVERLAP_CAP[1] });
  const efter = checkCalendarOverlapInvariants({ scheduleRows: r.rows, overlapCap: TIER_OVERLAP_CAP[1] });
  assert.equal(efter.overlapViolationCount, 0, `stadig cap-brud: ${JSON.stringify(efter.overlapViolations.slice(0, 2))}`);
  assert.equal(efter.stageRepeatViolationCount, 0, `stadig 2 etaper af samme loeb paa én in-game-dag: ${JSON.stringify(efter.stageRepeatViolations.slice(0, 2))}`);
  assert.ok(r.gameDayCount > dates.length, `aksen skal vaere bredere end kalenderen (${r.gameDayCount} vs ${dates.length})`);

  // Ingen etape har flyttet dato.
  const origVedNoegle = new Map(stageRows.map((x) => [`${x.race_id}|${x.stage_number}`, x.scheduled_at]));
  for (const x of r.rows) {
    assert.equal(x.scheduled_at, origVedNoegle.get(`${x.race_id}|${x.stage_number}`), "reparationen maa ikke flytte en etape");
  }
});

// ── #4236/#4465: monumentet faar IKKE laengere sin egen loebsdag ──────────────────
//
// #4075 (laast 21/8) reserverede en eksklusiv loebsdag til hvert monument. Ejeren
// ophaevede reglen 26/8 (#4236): #4217's spaend-baserede binding havde fjernet
// gevinsten (0 delte ryttere i alle 9 monument/etapeloeb-kombinationer, maalt mod
// prod), mens det eksklusive indskud stadig rev hul i fem D1-etapeloebs loebsdage.
// Afledningen pakker derfor monumenter som ethvert andet loeb.

test("monument pakkes som ethvert andet loeb — ingen reserveret loebsdag (#4236/#4465)", () => {
  const rows = [
    { race_id: "gt", stage_number: 4, scheduled_at: at("2026-08-31", "11:00"), game_day: 13 },
    { race_id: "mon", stage_number: 1, scheduled_at: at("2026-08-31", "13:00"), game_day: 13 },
    { race_id: "owt", stage_number: 2, scheduled_at: at("2026-08-31", "15:00"), game_day: 13 },
    { race_id: "gt", stage_number: 5, scheduled_at: at("2026-09-01", "11:00"), game_day: 14 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  assert.equal(r.gameDayCount, 2, "3 loeb paa dato 1 (cap 3) + 1 paa dato 2");
  assert.deepEqual(r.rows.map((x) => x.game_day), [0, 0, 0, 1]);
  assert.equal(
    r.monumentDayCount, undefined,
    "monument-taellingen er fjernet — kommer den tilbage, er en ophaevet regel genindfoert"
  );

  // Ingen etape har flyttet dato, og aksen holder stadig cap + etape-reglen.
  for (const x of r.rows) {
    assert.ok(["2026-08-31", "2026-09-01"].includes(String(x.scheduled_at).slice(0, 10)));
  }
  const check = checkCalendarOverlapInvariants({ scheduleRows: r.rows, overlapCap: 3 });
  assert.equal(check.overlapViolationCount, 0);
  assert.equal(check.stageRepeatViolationCount, 0);
});

test("et efterladt monumentRaceIds-argument kan ikke genoplive reglen (#4465)", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-31", "09:00"), game_day: 0 },
    { race_id: "mon", stage_number: 1, scheduled_at: at("2026-08-31", "17:00"), game_day: 0 },
  ];
  const uden = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  const med = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3, monumentRaceIds: ["mon"] });
  assert.deepEqual(med.rows, uden.rows);
  assert.equal(uden.gameDayCount, 1, "begge loeb deler nu loebsdag — cap 3 er ikke naaet");
});
