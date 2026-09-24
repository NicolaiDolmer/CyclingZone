// #5592: mindst 24 timer til trupudtagelse, KUN ved sæsonskiftet (ejer 23/9 + præcisering
// 24/9): sæsonens sidste løbsdag slutter kl. 15, og den nye sæsons første etape ligger mindst
// 24 t efter det tidligst mulige skifte. Alle andre dage, også søndage og mandage, er uændrede.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TIER_STAGE_SLOTS, SEASON_LAST_DAY_END_SLOT, LATEST_STAGE_SLOT,
  SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES,
  slotsFor, seasonLastDaySlots, applySeasonStartNotBefore, resolveSeasonStartNotBefore,
  resolveEarliestSeasonTransition, latestInstant,
  firstCalendarDay, lastCalendarDay, copenhagenClock, measurePlanningWindows, detectPlanningWindowViolations,
} from "./calendarPlanningWindow.js";
import { TIER_STAGE_SLOTS as REEXPORTED_SLOTS } from "./tierCalendarMaterializer.js";
import { TIER_DENSITY } from "./calendarTierCaps.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { resolveSeasonWindow } from "./calendarStartDate.js";
import { lastStageAtByTier, formatPlanningWindowReport, datesOffNormalSlots } from "../scripts/buildSeasonCalendar.js";

const TIERS = [1, 2, 3, 4];
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Datoer (dansk tid): 30/9 onsdag, 4/10 søndag, 5/10 mandag, 25/10 søndag (vintertid kl. 03).
const WEDNESDAY = "2026-09-30";
const SUNDAY = "2026-10-04";
const MONDAY = "2026-10-05";
// S4: første løbsdag mandag 28/9, sidste løbsdag søndag 25/10 (§2-vinduet, 28 løbsdatoer).
const S4_FROM = new Date("2026-09-27T12:00:00Z"); // buildSeasonCalendar: dagen FØR første løbsdag
const S4_LAST = "2026-10-25";
const S4_NOT_BEFORE = new Date("2026-09-28T17:30:00Z"); // 28/9 kl. 19:30 = 27/9 19:30 + 24 t

test("#5592 én kilde: materializeren re-eksporterer SAMME tabel, og antal slots = density", () => {
  assert.equal(REEXPORTED_SLOTS, TIER_STAGE_SLOTS);
  for (const t of TIERS) assert.equal(TIER_STAGE_SLOTS[t].length, TIER_DENSITY[t], `tier ${t}`);
});

test("#5592 almindelige dage er uændrede: TIER_STAGE_SLOTS hver ugedag, OGSÅ søndag og mandag midt i sæsonen", () => {
  const midSeason = ["2026-09-29", WEDNESDAY, "2026-10-01", "2026-10-02", "2026-10-03", SUNDAY, MONDAY, "2026-10-18", "2026-10-19"];
  for (const t of TIERS) {
    for (const d of midSeason) {
      assert.deepEqual(slotsFor(t, d), [...TIER_STAGE_SLOTS[t]], `tier ${t} ${d} uden kontekst`);
      assert.deepEqual(
        slotsFor(t, d, { notBefore: S4_NOT_BEFORE, seasonLastRaceDay: S4_LAST }), [...TIER_STAGE_SLOTS[t]],
        `tier ${t} ${d} midt i S4`,
      );
    }
  }
  // De konkrete tider for en almindelig søndag og mandag, præcis som før #5592.
  assert.deepEqual(slotsFor(1, SUNDAY, { seasonLastRaceDay: S4_LAST }), ["11:00", "13:00", "15:00", "17:00", "19:00"]);
  assert.deepEqual(slotsFor(1, MONDAY, { seasonLastRaceDay: S4_LAST }), ["11:00", "13:00", "15:00", "17:00", "19:00"]);
  assert.deepEqual(slotsFor(3, SUNDAY, { seasonLastRaceDay: S4_LAST }), ["12:00", "15:00", "18:00"]);
  assert.deepEqual(slotsFor(3, MONDAY, { seasonLastRaceDay: S4_LAST }), ["12:00", "15:00", "18:00"]);
});

test("#5592 sæsonens SIDSTE løbsdag slutter kl. 15 — de konkrete tider pr. division", () => {
  const ctx = { seasonLastRaceDay: S4_LAST };
  assert.deepEqual(slotsFor(1, S4_LAST, ctx), ["11:00", "12:00", "13:00", "14:00", "15:00"]);
  assert.deepEqual(slotsFor(2, S4_LAST, ctx), ["12:00", "13:00", "14:00", "15:00"]);
  for (const t of [3, 4]) assert.deepEqual(slotsFor(t, S4_LAST, ctx), ["12:00", "13:30", "15:00"], `tier ${t}`);
  // Samme dato uden kontekst er en almindelig søndag.
  for (const t of TIERS) assert.deepEqual(slotsFor(t, S4_LAST), [...TIER_STAGE_SLOTS[t]], `tier ${t} uden kontekst`);
});

test("#5592 sidste løbsdag: samme antal slots, stigende, starter som normalt og slutter kl. 15", () => {
  for (const t of TIERS) {
    const base = TIER_STAGE_SLOTS[t];
    const s = slotsFor(t, S4_LAST, { seasonLastRaceDay: S4_LAST });
    assert.equal(s.length, base.length, `tier ${t}: antal slots`);
    for (let i = 1; i < s.length; i++) assert.ok(toMin(s[i]) > toMin(s[i - 1]), `tier ${t}: ${s} ikke stigende`);
    assert.equal(s[0], base[0], `tier ${t}: dagen starter som normalt`);
    assert.equal(s.at(-1), SEASON_LAST_DAY_END_SLOT, `tier ${t}: dagen slutter kl. 15`);
  }
});

test("#5592 seasonLastDaySlots: en tabel der allerede slutter kl. 15 røres ikke; mindste-afstanden holder", () => {
  assert.deepEqual(seasonLastDaySlots(["09:00", "10:00"]), ["09:00", "10:00"]);
  assert.deepEqual(seasonLastDaySlots(["19:00"]), ["15:00"], "én slot efter kl. 15 rykkes ned på kl. 15");
  assert.deepEqual(seasonLastDaySlots(["14:00", "16:00", "18:00"]), ["14:00", "14:30", "15:00"]);
  assert.deepEqual(seasonLastDaySlots([]), []);
});

// Syntetisk kalender: én etape pr. bane pr. dag i `days` dage fra `from` — samme vej som
// materializeren (buildScheduleRows + slotsFor), så de målte tider er de der ville blive skrevet.
function scheduleFor(tier, from, days, { notBefore = null, seasonLastRaceDay = null } = {}) {
  const lanes = TIER_STAGE_SLOTS[tier].length;
  const placements = Array.from({ length: lanes }, (_, lane) => ({
    id: `lane-${lane}`,
    stagesPlaced: Array.from({ length: days }, (_, d) => ({ stage_number: d + 1, real_day: d, game_day: d * lanes + lane, lane })),
  }));
  return buildScheduleRows({ placements, from, slots: (date) => slotsFor(tier, date, { notBefore, seasonLastRaceDay }) }).stageRows;
}

test("#5592 et helt år: KUN sæsonens første og sidste løbsdag afviger fra de normale tider, inkl. sommertid ↔ vintertid", () => {
  const days = 371; // 53 uger: mandag 28/9 2026 → søndag 3/10 2027
  const lastDay = lastCalendarDay(S4_FROM, days);
  assert.equal(lastDay, "2027-10-03");
  for (const t of TIERS) {
    const rows = scheduleFor(t, S4_FROM, days, { notBefore: S4_NOT_BEFORE, seasonLastRaceDay: lastDay });
    const { dates, off } = datesOffNormalSlots({ tier: t, stageRows: rows });
    assert.equal(dates, days, `tier ${t}: alle datoer har etaper`);
    assert.deepEqual(off, ["2026-09-28", lastDay], `tier ${t}: kun første og sidste løbsdag`);
    // En almindelig weekend har de normale tider: søndag slutter som normalt, mandag starter som normalt.
    const { days: byDate } = measurePlanningWindows(rows);
    for (const sunday of [SUNDAY, "2026-10-25", "2027-03-28"]) {
      assert.equal(copenhagenClock(byDate.get(sunday).last).minutes, toMin(TIER_STAGE_SLOTS[t].at(-1)), `tier ${t} ${sunday}`);
    }
    assert.equal(copenhagenClock(byDate.get(MONDAY).first).minutes, toMin(TIER_STAGE_SLOTS[t][0]), `tier ${t} mandag 5/10`);
    assert.deepEqual(
      detectPlanningWindowViolations({ tier: t, stageRows: rows, notBefore: S4_NOT_BEFORE, seasonLastRaceDay: lastDay }), [],
    );
  }
});

test("#5592 gaten: en sidste løbsdag der slutter efter kl. 15 fældes; almindelige dage gates ikke", () => {
  const rows = scheduleFor(2, S4_FROM, 28); // ingen kontekst: 25/10 slutter kl. 18
  const v = detectPlanningWindowViolations({ tier: 2, stageRows: rows, seasonLastRaceDay: S4_LAST });
  assert.equal(v.length, 1);
  assert.match(v[0], /tier 2: season's last race day 2026-10-25 ends .* after 15:00/);
  assert.deepEqual(detectPlanningWindowViolations({ tier: 2, stageRows: rows }), [], "uden sidste løbsdag: intet at dømme");
});

test("#5592 sæsonskiftet: konventionen er aftenen før første kalenderdag kl. 18 → første etape tidligst kl. 18 dagen efter", () => {
  const from = S4_FROM;
  assert.equal(firstCalendarDay(from), "2026-09-28");
  assert.equal(lastCalendarDay(from, 28), S4_LAST, "S4's 28 løbsdatoer slutter søndag 25/10");
  assert.equal(resolveSeasonWindow({ firstRaceDay: "2026-09-28", raceDays: 28 }).lastRaceDay, S4_LAST, "§2-vinduet (buildSeasonCalendar) = kalenderens sidste dato");
  const nb = resolveSeasonStartNotBefore({ from });
  assert.equal(nb.toISOString(), "2026-09-28T16:00:00.000Z", "28/9 kl. 18 dansk tid (CEST)");
  assert.equal(resolveSeasonStartNotBefore({ from, seasonTransitionAt: null }), null, "null = slået fra (§2e)");
  assert.equal(
    resolveSeasonStartNotBefore({ from, seasonTransitionAt: "2026-09-27T18:30:00Z" }).toISOString(),
    "2026-09-28T18:30:00.000Z", "et eksplicit sæsonskifte bruges som det er",
  );
  assert.equal(
    resolveSeasonStartNotBefore({ from, previousSeasonLastStageAt: "2026-09-27T17:00:00Z" }).toISOString(),
    "2026-09-28T17:00:00.000Z", "forrige sæsons sidste etape (19:00) er senere end skiftet (18:00) → den vinder",
  );
  assert.equal(
    resolveSeasonStartNotBefore({ from, seasonTransitionAt: null, previousSeasonLastStageAt: "2026-09-27T17:00:00Z" }).toISOString(),
    "2026-09-28T17:00:00.000Z",
  );
  assert.throws(() => resolveSeasonStartNotBefore({ from, seasonTransitionAt: "ikke en dato" }), /not a valid timestamp/);
});

test("#5592 S4's første dag (mandag 28/9): D1 fra 19:00, D2-D4 fra 18:00 — ingen etape efter kl. 22", () => {
  const d1 = slotsFor(1, "2026-09-28", { notBefore: new Date("2026-09-28T17:00:00Z") });
  assert.deepEqual(d1, ["19:00", "19:30", "20:00", "20:30", "21:00"]);
  const nb18 = new Date("2026-09-28T16:00:00Z");
  assert.deepEqual(slotsFor(2, "2026-09-28", { notBefore: nb18 }), ["18:00", "18:30", "19:00", "19:30"]);
  assert.deepEqual(slotsFor(3, "2026-09-28", { notBefore: nb18 }), ["18:00", "18:30", "19:00"]);
  assert.deepEqual(slotsFor(4, "2026-09-28", { notBefore: nb18 }), ["18:00", "18:30", "19:00"]);
  // Dagen efter er en helt almindelig tirsdag.
  assert.deepEqual(slotsFor(1, "2026-09-29", { notBefore: nb18 }), [...TIER_STAGE_SLOTS[1]]);
});

test("#5592 sæsonskifte-reglen målt: første etape ≥ 24 t efter ankeret, alle divisioner", () => {
  for (const t of TIERS) {
    const nb = resolveSeasonStartNotBefore({ from: S4_FROM, previousSeasonLastStageAt: t === 1 ? "2026-09-27T17:00:00Z" : "2026-09-27T16:00:00Z" });
    const rows = scheduleFor(t, S4_FROM, 28, { notBefore: nb });
    const { firstStageAt } = measurePlanningWindows(rows);
    assert.ok(Date.parse(firstStageAt) >= nb.getTime(), `tier ${t}: ${firstStageAt} < ${nb.toISOString()}`);
    assert.deepEqual(detectPlanningWindowViolations({ tier: t, stageRows: rows, notBefore: nb }), []);
    for (const s of rows) assert.ok(copenhagenClock(s.scheduled_at).minutes <= toMin(LATEST_STAGE_SLOT), `tier ${t}: ${s.scheduled_at}`);
  }
});

test("#5592 sæsonskifte-reglen: en etape før ankeret fældes af gaten", () => {
  const rows = [{ scheduled_at: "2026-09-28T13:00:00Z" }, { scheduled_at: "2026-09-28T17:00:00Z" }];
  const v = detectPlanningWindowViolations({ tier: 2, stageRows: rows, notBefore: "2026-09-28T16:00:00Z" });
  assert.equal(v.length, 1);
  assert.match(v[0], /tier 2: season's first stage/);
});

test("#5592 applySeasonStartNotBefore: uforenelig sæsonstart kaster højlydt i stedet for natte-etaper", () => {
  // Ankeret ligger EFTER dagen: dagen kan slet ikke bære etaper.
  assert.throws(() => applySeasonStartNotBefore(["12:00"], "2026-09-28", new Date("2026-09-29T10:00:00Z")), /before the planning window ends/);
  // Ankeret kl. 21:30 på dagen: 5 etaper med 30 min kan ikke nå at slutte kl. 22.
  assert.throws(() => applySeasonStartNotBefore([...TIER_STAGE_SLOTS[1]], "2026-09-28", new Date("2026-09-28T19:30:00Z")), /cannot start at 21:30/);
  // Ankeret en tidligere dag: intet at gøre.
  assert.deepEqual(applySeasonStartNotBefore(["12:00", "15:00"], "2026-09-29", new Date("2026-09-28T16:00:00Z")), ["12:00", "15:00"]);
  // Ankeret før dagens første slot: intet at gøre.
  assert.deepEqual(applySeasonStartNotBefore(["19:00", "20:00"], "2026-09-28", new Date("2026-09-28T16:00:00Z")), ["19:00", "20:00"]);
  // Et skæve minut rundes OP til 5 minutter.
  assert.deepEqual(applySeasonStartNotBefore(["12:00", "15:00", "18:00"], "2026-09-28", new Date("2026-09-28T16:02:10Z")), ["18:05", "18:35", "19:05"]);
});

test("#5592 buildScheduleRows: en liste virker som før, en funktion giver tider pr. dato", () => {
  const placements = [{ id: "r", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0, lane: 1 }, { stage_number: 2, real_day: 6, game_day: 6, lane: 1 }] }];
  // real_day 0 = man 28/9, real_day 6 = søn 4/10
  const fixed = buildScheduleRows({ placements, from: S4_FROM, slots: ["12:00", "15:00", "18:00"] }).stageRows;
  assert.deepEqual(fixed.map((s) => s.scheduled_at), ["2026-09-28T13:00:00.000Z", "2026-10-04T13:00:00.000Z"]);
  const ordinary = buildScheduleRows({ placements, from: S4_FROM, slots: (d) => slotsFor(3, d) }).stageRows;
  assert.deepEqual(ordinary.map((s) => s.scheduled_at), fixed.map((s) => s.scheduled_at), "uden kontekst = den faste liste");
  const lastDay = buildScheduleRows({ placements, from: S4_FROM, slots: (d) => slotsFor(3, d, { seasonLastRaceDay: SUNDAY }) }).stageRows;
  assert.deepEqual(lastDay.map((s) => s.scheduled_at), ["2026-09-28T13:00:00.000Z", "2026-10-04T11:30:00.000Z"], "kun sidste løbsdag flytter sig");
});

// ── Det tidligst mulige sæsonskifte (diff-tjek 24/9 nat) ──
//
// "Afslut sæson" er spærret til hvert løb er afviklet (assessSeasonEndBlockers). S3's sidste
// etape søndag 27/9 er kl. 19 i D1 og kl. 18 i D2-D4, så skiftet kan tidligst ske kl. 19 +
// bufferen — ikke konventionens kl. 18.

// Prod-formen af S3's sidste dag (målt 23/9): D1 slutter 19:00, D2-D4 18:00 (CEST = UTC+2).
const S3_LAST_BY_TIER = { 1: "2026-09-27T17:00:00.000Z", 2: "2026-09-27T16:00:00.000Z", 3: "2026-09-27T16:00:00.000Z", 4: "2026-09-27T16:00:00.000Z" };

test("#5592 bufferen er navngivet og ligger inden D1's loft", () => {
  assert.equal(SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES, 30);
  // D1 slutter S3 kl. 19; 5 etaper × 30 min skal kunne slutte kl. 22 → bufferen ≤ 60 min.
  assert.ok(SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES <= 60);
});

test("#5592 tidligst mulige skifte = SENESTE etape på tværs af ALLE divisioner + buffer", () => {
  const latest = latestInstant(Object.values(S3_LAST_BY_TIER));
  assert.equal(latest.toISOString(), "2026-09-27T17:00:00.000Z", "D1's etape kl. 19 er den seneste");
  const t = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: latest, firstRaceDay: "2026-09-28" });
  assert.equal(t.at.toISOString(), "2026-09-27T17:30:00.000Z", "27/9 kl. 19:30 dansk tid, ikke kl. 18");
  assert.equal(t.earliestPossibleAt.toISOString(), "2026-09-27T17:30:00.000Z");
  assert.match(t.source, /seneste etape \+ 30 min/);
  // Skal ikke afhænge af hvilken division der slutter sidst.
  const d3Last = latestInstant(["2026-09-27T16:00:00Z", "2026-09-27T18:10:00Z", null, "ikke en dato"]);
  assert.equal(resolveEarliestSeasonTransition({ previousSeasonLastStageAt: d3Last }).at.toISOString(), "2026-09-27T18:40:00.000Z");
});

test("#5592 et SENERE planlagt skifte (app_config) vinder; et tidligere kan ikke nås og taber", () => {
  const previousSeasonLastStageAt = "2026-09-27T17:00:00Z";
  const later = resolveEarliestSeasonTransition({ previousSeasonLastStageAt, plannedAt: "2026-09-27T19:00:00Z", firstRaceDay: "2026-09-28" });
  assert.equal(later.at.toISOString(), "2026-09-27T19:00:00.000Z", "27/9 kl. 21 vinder");
  assert.match(later.source, /app_config/);
  const earlier = resolveEarliestSeasonTransition({ previousSeasonLastStageAt, plannedAt: "2026-09-27T16:00:00Z", firstRaceDay: "2026-09-28" });
  assert.equal(earlier.at.toISOString(), "2026-09-27T17:30:00.000Z", "konventionens kl. 18 kan ikke nås");
  assert.match(earlier.source, /kan ikke nås/);
  const stale = resolveEarliestSeasonTransition({ previousSeasonLastStageAt, plannedAt: "2026-08-23T16:00:00Z" });
  assert.equal(stale.at.toISOString(), "2026-09-27T17:30:00.000Z", "S3's efterladte skifte taber");
});

test("#5592 uden forrige sæsons etaper: det seneste af app_config og konventionen (aftenen før kl. 18)", () => {
  const firstRaceDay = "2026-09-28";
  const none = resolveEarliestSeasonTransition({ firstRaceDay });
  assert.equal(none.at.toISOString(), "2026-09-27T16:00:00.000Z");
  assert.match(none.source, /konvention/);
  const stale = resolveEarliestSeasonTransition({ plannedAt: "2026-08-27T16:00:00Z", firstRaceDay });
  assert.equal(stale.at.toISOString(), "2026-09-27T16:00:00.000Z", "en efterladt værdi taber");
  assert.match(stale.source, /ældre/);
  const later = resolveEarliestSeasonTransition({ plannedAt: "2026-09-27T18:00:00Z", firstRaceDay });
  assert.equal(later.at.toISOString(), "2026-09-27T18:00:00.000Z");
  assert.equal(later.source, "app_config");
  const garbage = resolveEarliestSeasonTransition({ plannedAt: "ikke en dato", firstRaceDay });
  assert.equal(garbage.at.toISOString(), "2026-09-27T16:00:00.000Z");
  assert.throws(() => resolveEarliestSeasonTransition({ previousSeasonLastStageAt: "ikke en dato" }), /not a valid timestamp/);
});

test("#5592 S4 målt: HVER division starter ≥ 24 t efter det tidligst mulige skifte og slutter 25/10 kl. 15; resten er normalt", () => {
  const transition = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: latestInstant(Object.values(S3_LAST_BY_TIER)), firstRaceDay: "2026-09-28" });
  const expectedFirstDay = {
    1: ["19:30", "20:00", "20:30", "21:00", "21:30"],
    2: ["19:30", "20:00", "20:30", "21:00"],
    3: ["19:30", "20:00", "20:30"],
    4: ["19:30", "20:00", "20:30"],
  };
  for (const t of TIERS) {
    const nb = resolveSeasonStartNotBefore({ from: S4_FROM, seasonTransitionAt: transition.at, previousSeasonLastStageAt: S3_LAST_BY_TIER[t] });
    assert.equal(nb.toISOString(), S4_NOT_BEFORE.toISOString(), `tier ${t}: samme anker i alle divisioner`);
    assert.deepEqual(slotsFor(t, "2026-09-28", { notBefore: nb, seasonLastRaceDay: S4_LAST }), expectedFirstDay[t], `tier ${t}: 28/9`);
    const rows = scheduleFor(t, S4_FROM, 28, { notBefore: nb, seasonLastRaceDay: S4_LAST });
    const { firstStageAt, lastStageAt } = measurePlanningWindows(rows);
    assert.equal((Date.parse(firstStageAt) - transition.at.getTime()) / 3_600_000, 24, `tier ${t}: præcis 24 t fra det tidligst mulige skifte`);
    assert.equal(lastStageAt, "2026-10-25T14:00:00.000Z", `tier ${t}: S4's sidste etape 25/10 kl. 15 (CET)`);
    assert.deepEqual(datesOffNormalSlots({ tier: t, stageRows: rows }).off, ["2026-09-28", S4_LAST], `tier ${t}: kun to datoer afviger`);
    assert.deepEqual(detectPlanningWindowViolations({ tier: t, stageRows: rows, notBefore: nb, seasonLastRaceDay: S4_LAST }), []);
    for (const s of rows) assert.ok(copenhagenClock(s.scheduled_at).minutes <= toMin(LATEST_STAGE_SLOT), `tier ${t}: ${s.scheduled_at}`);
  }
});

test("#5592 D1-loftet: bufferen kan højst være 60 min før D1's 5 etaper ikke kan nå kl. 22", () => {
  const d1Last = S3_LAST_BY_TIER[1]; // 27/9 kl. 19
  const firstDay = (buffer) => {
    const t = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: d1Last, bufferMinutes: buffer });
    const nb = resolveSeasonStartNotBefore({ from: S4_FROM, seasonTransitionAt: t.at });
    return slotsFor(1, "2026-09-28", { notBefore: nb });
  };
  assert.equal(firstDay(SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES).at(-1), "21:30");
  assert.equal(firstDay(60).at(-1), "22:00", "60 min er loftet");
  assert.throws(() => firstDay(65), /cannot start at 20:05 and end by 22:00/);
});

test("#5592 sommertid → vintertid: S4 slutter 25/10 kl. 15 (CET), S5 starter 26/10 24 VIRKELIGE timer efter skiftet", () => {
  // S4's sidste løbsdag er søndag 25/10, hvor uret stilles tilbage kl. 03 (CEST → CET, UTC+1).
  const s4LastByTier = {};
  for (const t of TIERS) {
    const rows = scheduleFor(t, S4_FROM, 28, { notBefore: S4_NOT_BEFORE, seasonLastRaceDay: S4_LAST });
    s4LastByTier[t] = measurePlanningWindows(rows).lastStageAt;
    assert.equal(s4LastByTier[t], "2026-10-25T14:00:00.000Z", `tier ${t}: 15:00 CET`);
  }
  const t = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: latestInstant(Object.values(s4LastByTier)), firstRaceDay: "2026-10-26" });
  assert.equal(t.at.toISOString(), "2026-10-25T14:30:00.000Z", "tidligst mulige skifte 25/10 kl. 15:30 CET");
  const s5From = new Date("2026-10-25T12:00:00Z"); // første kalenderdag = mandag 26/10
  for (const tier of TIERS) {
    const nb = resolveSeasonStartNotBefore({ from: s5From, seasonTransitionAt: t.at, previousSeasonLastStageAt: s4LastByTier[tier] });
    assert.equal(nb.toISOString(), "2026-10-26T14:30:00.000Z", `tier ${tier}: 26/10 kl. 15:30 CET`);
    const rows = scheduleFor(tier, s5From, 7, { notBefore: nb });
    const { firstStageAt } = measurePlanningWindows(rows);
    assert.equal(copenhagenClock(firstStageAt).minutes, toMin("15:30"), `tier ${tier}: første etape 15:30`);
    assert.equal((Date.parse(firstStageAt) - t.at.getTime()) / 3_600_000, 24, `tier ${tier}: 24 virkelige timer`);
    assert.equal((Date.parse(firstStageAt) - Date.parse(s4LastByTier[tier])) / 3_600_000, 24.5, `tier ${tier}: 24,5 t fra S4's sidste etape`);
    assert.deepEqual(datesOffNormalSlots({ tier, stageRows: rows }).off, ["2026-10-26"], `tier ${tier}: resten af ugen er normal`);
  }
  // Og en sæson der slutter lørdag 24/10 kl. 19 (CEST) med første løbsdag søndag 25/10:
  // 24 virkelige timer efter 19:30 CEST er 18:30 CET.
  const t2 = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: "2026-10-24T17:00:00Z" });
  const nb2 = resolveSeasonStartNotBefore({ from: new Date("2026-10-24T12:00:00Z"), seasonTransitionAt: t2.at });
  assert.equal(nb2.toISOString(), "2026-10-25T17:30:00.000Z");
  assert.deepEqual(slotsFor(1, "2026-10-25", { notBefore: nb2 }), ["18:30", "19:00", "19:30", "20:00", "20:30"]);
});

test("#5592 CLI: forrige sæsons sidste etape pr. division", () => {
  const out = lastStageAtByTier({
    divisions: [{ id: 10, tier: 1 }, { id: 20, tier: 2 }, { id: 21, tier: 2 }],
    races: [{ id: "a", league_division_id: 10 }, { id: "b", league_division_id: 20 }, { id: "c", league_division_id: 21 }, { id: "x", league_division_id: 99 }],
    schedule: [
      { race_id: "a", scheduled_at: "2026-09-27T09:00:00Z" }, { race_id: "a", scheduled_at: "2026-09-27T17:00:00Z" },
      { race_id: "b", scheduled_at: "2026-09-27T16:00:00Z" }, { race_id: "c", scheduled_at: "2026-09-26T16:00:00Z" },
      { race_id: "x", scheduled_at: "2026-09-30T16:00:00Z" }, { race_id: "a", scheduled_at: null },
    ],
  });
  assert.deepEqual(out, { 1: "2026-09-27T17:00:00.000Z", 2: "2026-09-27T16:00:00.000Z" });
});

test("#5592 CLI: rapporten viser skiftet, første og sidste løbsdag, og at alle andre datoer er normale", () => {
  const transition = resolveEarliestSeasonTransition({ previousSeasonLastStageAt: "2026-09-27T17:00:00Z", firstRaceDay: "2026-09-28" });
  const notBefore = resolveSeasonStartNotBefore({ from: S4_FROM, seasonTransitionAt: transition.at, previousSeasonLastStageAt: "2026-09-27T16:00:00Z" });
  const seasonLastRaceDay = lastCalendarDay(S4_FROM, 14); // søndag 11/10
  const stageRows = scheduleFor(2, S4_FROM, 14, { notBefore, seasonLastRaceDay });
  const report = (rows) => formatPlanningWindowReport({
    planTiers: [{ tier: 2, calendarViolations: [], planningWindow: { notBefore: notBefore.toISOString(), seasonLastRaceDay }, pools: [{ stageRows: rows }] }],
    transition,
    previousByTier: { 2: "2026-09-27T16:00:00Z" },
    previousLatestAt: "2026-09-27T17:00:00Z",
  }).join("\n");
  const lines = report(stageRows);
  assert.match(lines, /forrige sæsons seneste etape \(alle divisioner\): 2026-09-27 19:00/);
  assert.match(lines, /app_config\.season_transition_planned_at: ikke sat/);
  assert.match(lines, /sæsonskifte der planlægges mod \(tidligst mulige\): 2026-09-27 19:30/);
  assert.match(lines, /D2: første dag 2026-09-28 19:30–21:00/);
  assert.match(lines, /pause fra divisionens sidste etape i forrige sæson \(2026-09-27 18:00\): 25,5 t/);
  assert.match(lines, /fra tidligst mulige skifte: 24,0 t/);
  assert.match(lines, /sidste løbsdag 2026-10-11: 12:00–15:00/);
  assert.match(lines, /normale tider på 12 af 14 datoer · afviger: 2026-09-28, 2026-10-11 {2}✅/);
  assert.doesNotMatch(lines, /❌/);
  // En søndag midt i sæsonen med tidlige tider ville blive fanget.
  const wrong = scheduleFor(2, S4_FROM, 14, { notBefore, seasonLastRaceDay: SUNDAY });
  assert.match(report(wrong), /afviger: 2026-09-28, 2026-10-04 {2}❌ kun første og sidste løbsdag må afvige/);
});
