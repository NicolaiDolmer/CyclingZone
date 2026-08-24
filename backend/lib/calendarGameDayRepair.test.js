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

// ── #4075: monumentet faar sin EGEN loebsdag, men beholder sin kalenderdato ───────

test("monument faar egen eksklusiv in-game-dag paa en dato det deler med andre loeb (#4075)", () => {
  const rows = [
    { race_id: "gt", stage_number: 4, scheduled_at: at("2026-08-31", "11:00"), game_day: 13 },
    { race_id: "mon", stage_number: 1, scheduled_at: at("2026-08-31", "13:00"), game_day: 13 },
    { race_id: "owt", stage_number: 2, scheduled_at: at("2026-08-31", "15:00"), game_day: 13 },
  ];
  const r = deriveGameDayAxis({
    scheduleRows: rows, overlapCap: 3, monumentRaceIds: new Set(["mon"]),
  });
  const gdOf = (id) => r.rows.find((x) => x.race_id === id).game_day;
  assert.equal(r.monumentDayCount, 1);
  assert.notEqual(gdOf("mon"), gdOf("gt"));
  assert.notEqual(gdOf("mon"), gdOf("owt"));

  // Kalenderdatoen deles fortsat — kun loebsdagen er eksklusiv.
  for (const x of r.rows) assert.equal(String(x.scheduled_at).slice(0, 10), "2026-08-31");

  const check = checkCalendarOverlapInvariants({
    scheduleRows: r.rows, overlapCap: 3, monumentRaceIds: new Set(["mon"]),
  });
  assert.equal(check.monumentSharedDayViolationCount, 0);
  assert.equal(check.overlapViolationCount, 0);
});

test("monumentets loebsdag foelger tidsslottet — tidligere loeb faar lavere loebsdag (#4075)", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: at("2026-08-31", "09:00"), game_day: 0 },
    { race_id: "mon", stage_number: 1, scheduled_at: at("2026-08-31", "17:00"), game_day: 0 },
  ];
  const r = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3, monumentRaceIds: ["mon"] });
  const gdOf = (id) => r.rows.find((x) => x.race_id === id).game_day;
  assert.ok(gdOf("a") < gdOf("mon"), "det tidligste loeb skal have den laveste loebsdag");
  assert.equal(r.gameDayCount, 2);
});

test("uden monumentRaceIds er afledningen BIT-IDENTISK med foer #4075-reglen", () => {
  const rows = [
    { race_id: "gt", stage_number: 4, scheduled_at: at("2026-08-31", "11:00"), game_day: 13 },
    { race_id: "mon", stage_number: 1, scheduled_at: at("2026-08-31", "13:00"), game_day: 13 },
    { race_id: "owt", stage_number: 2, scheduled_at: at("2026-08-31", "15:00"), game_day: 13 },
    { race_id: "gt", stage_number: 5, scheduled_at: at("2026-09-01", "11:00"), game_day: 14 },
  ];
  const uden = deriveGameDayAxis({ scheduleRows: rows, overlapCap: 3 });
  assert.equal(uden.gameDayCount, 2, "3 loeb paa dato 1 (cap 3) + 1 paa dato 2");
  assert.equal(uden.monumentDayCount, 0);
  assert.deepEqual(uden.rows.map((x) => x.game_day), [0, 0, 0, 1]);
});

test("gen-afledning af et D1-layout med monumenter: eksklusiviteten genskabes, ikke tabes (#4075/#4161)", () => {
  const stageRaces = [
    { id: "gt-1", stages: 21, race_class: "GrandTour" },
    { id: "gt-2", stages: 21, race_class: "GiroVuelta" },
    { id: "wt-1", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-2", stages: 7, race_class: "OtherWorldTourA" },
  ];
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments" })),
    ...Array.from({ length: 43 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA" })),
  ];
  const monIds = new Set(oneDayRaces.filter((r) => r.race_class === "Monuments").map((r) => r.id));

  const packed = packLaneCalendar({
    stageRaces, oneDayRaces, density: TIER_DENSITY[1], days: 28, overlapCap: TIER_OVERLAP_CAP[1],
  });
  const { stageRows } = buildScheduleRows({
    placements: packed.placements,
    from: new Date("2026-08-24T00:00:00Z"),
    slots: ["11:00", "13:00", "15:00", "17:00", "19:00"],
  });

  // Pakkeren leverer selv eksklusive monument-loebsdage (B2, #4075).
  const pakket = checkCalendarOverlapInvariants({
    scheduleRows: stageRows, overlapCap: TIER_OVERLAP_CAP[1], monumentRaceIds: monIds,
  });
  assert.equal(pakket.monumentSharedDayViolationCount, 0, "pakkerens eget output skal allerede holde reglen");

  // Simulér #4155-skaden (game_day = dato-offset) — praecis dét #4161-reparationen ryddede op i.
  const dates = [...new Set(stageRows.map((r) => r.scheduled_at.slice(0, 10)))].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const skadede = stageRows.map((r) => ({ ...r, game_day: dateIndex.get(r.scheduled_at.slice(0, 10)) }));
  const skade = checkCalendarOverlapInvariants({
    scheduleRows: skadede, overlapCap: TIER_OVERLAP_CAP[1], monumentRaceIds: monIds,
  });
  assert.ok(skade.monumentSharedDayViolationCount > 0, "skaden skal faktisk klappe monumenterne sammen med naboloeb");

  // Uden monument-reglen genskaber afledningen cap'en, men IKKE eksklusiviteten — det var
  // praecis hullet der ramte S3 24/8.
  const uden = deriveGameDayAxis({ scheduleRows: skadede, overlapCap: TIER_OVERLAP_CAP[1] });
  const udenCheck = checkCalendarOverlapInvariants({
    scheduleRows: uden.rows, overlapCap: TIER_OVERLAP_CAP[1], monumentRaceIds: monIds,
  });
  assert.equal(udenCheck.overlapViolationCount, 0);
  assert.ok(udenCheck.monumentSharedDayViolationCount > 0, "uden reglen forbliver monumenterne sammenklappede");

  // Med reglen: eksklusiviteten er tilbage, og intet andet er brudt.
  const med = deriveGameDayAxis({
    scheduleRows: skadede, overlapCap: TIER_OVERLAP_CAP[1], monumentRaceIds: monIds,
  });
  const medCheck = checkCalendarOverlapInvariants({
    scheduleRows: med.rows, overlapCap: TIER_OVERLAP_CAP[1], monumentRaceIds: monIds,
  });
  assert.equal(medCheck.monumentSharedDayViolationCount, 0);
  assert.equal(medCheck.overlapViolationCount, 0);
  assert.equal(medCheck.stageRepeatViolationCount, 0);
  assert.equal(med.monumentDayCount, 5);
  // Aksen vokser med hoejst ét loebsdag pr. monument — og kan vokse mindre, fordi
  // monumentet forlader pakningen og dermed kan frigoere en sub-dag paa sin egen dato.
  assert.ok(med.gameDayCount > uden.gameDayCount, "eksklusive monument-dage skal udvide aksen");
  assert.ok(med.gameDayCount <= uden.gameDayCount + 5, `aksen voksede mere end 5 loebsdage: ${uden.gameDayCount} -> ${med.gameDayCount}`);

  // Ingen etape har flyttet kalenderdato.
  const datoVedNoegle = new Map(stageRows.map((x) => [`${x.race_id}|${x.stage_number}`, x.scheduled_at]));
  for (const x of med.rows) {
    assert.equal(x.scheduled_at, datoVedNoegle.get(`${x.race_id}|${x.stage_number}`), "monument-reglen maa ikke flytte en etape");
  }
});
