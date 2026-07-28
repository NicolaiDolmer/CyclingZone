import test from "node:test";
import assert from "node:assert/strict";
import {
  copenhagenDayOrdinal, dateStringForOrdinal, seasonDayAxis,
  seasonDayForTime, seasonDayWindow, resolveSeasonDay,
} from "./seasonDay.js";

const sched = (...isoTimes) => isoTimes.map((scheduled_at) => ({ scheduled_at }));

test("copenhagenDayOrdinal: to tidspunkter på samme danske kalenderdag giver samme ordinal", () => {
  // 16:00 UTC = 18:00 CEST og 08:00 UTC = 10:00 CEST — samme danske dato.
  assert.equal(copenhagenDayOrdinal("2026-07-27T16:00:00Z"), copenhagenDayOrdinal("2026-07-27T08:00:00Z"));
});

test("copenhagenDayOrdinal: sen aften dansk tid hører til den danske dato, ikke UTC-datoen", () => {
  // 22:30 UTC 27/7 = 00:30 CEST 28/7 → dansk kalenderdag 28/7.
  assert.equal(copenhagenDayOrdinal("2026-07-27T22:30:00Z"), copenhagenDayOrdinal("2026-07-28T10:00:00Z"));
});

test("copenhagenDayOrdinal: ugyldigt input → null", () => {
  assert.equal(copenhagenDayOrdinal(null), null);
  assert.equal(copenhagenDayOrdinal("ikke-en-dato"), null);
});

test("dateStringForOrdinal er invers af copenhagenDayOrdinal", () => {
  assert.equal(dateStringForOrdinal(copenhagenDayOrdinal("2026-07-27T16:00:00Z")), "2026-07-27");
});

// ── Selve #3107-regressionen ──────────────────────────────────────────────────
// Den gamle model var `floor((t - firstMs) / 86400000) + 1` med firstMs = 27/7 16:00 UTC.
// Etaper FØR kl. 16:00 UTC på en kalenderdato faldt i gårsdagens bøtte.
test("#3107: etape før anker-klokkeslættet ligger på sin EGEN kalenderdag, ikke gårsdagens", () => {
  const rows = sched(
    "2026-07-27T16:00:00Z", // sæsonens første etape = ankeret, dag 1
    "2026-07-28T09:00:00Z", // næste kalenderdag, men KUN 17 timer senere
    "2026-07-28T18:00:00Z"
  );
  const { firstOrdinal } = seasonDayAxis(rows);

  // Gammel model: floor(17t/24t)+1 = 1 → forkert. Ny model: kalenderdag 2.
  assert.equal(seasonDayForTime("2026-07-28T09:00:00Z", firstOrdinal), 2);
  assert.equal(seasonDayForTime("2026-07-28T18:00:00Z", firstOrdinal), 2);
  assert.equal(seasonDayForTime("2026-07-27T16:00:00Z", firstOrdinal), 1);
});

test("#3107: alle etaper på samme kalenderdag havner i SAMME bøtte (0 afvigelser)", () => {
  // Et døgn med den fulde løbsblok 09:00-20:20 UTC, som i prod.
  const times = ["09:00", "11:00", "14:00", "16:20", "18:00", "20:20"];
  const rows = sched("2026-07-27T16:00:00Z", ...times.map((t) => `2026-08-04T${t}:00Z`));
  const { firstOrdinal } = seasonDayAxis(rows);
  const days = new Set(times.map((t) => seasonDayForTime(`2026-08-04T${t}:00Z`, firstOrdinal)));
  assert.equal(days.size, 1, `alle 6 etaper skal ligge på én dag, fik ${[...days].join(",")}`);
});

// Acceptkriteriet fra #3107: "for hver S2-etape er bøtte-dag == kalenderdag (0 afvigelser
// af 1.148)". Her genskabt som en syntetisk S2: 28 kalenderdage × den ægte daglige
// løbsblok (09:00-20:20 UTC). Den GAMLE model (anker 27/7 16:00 UTC, rullende 24t) lagde
// 61 % af slottene i gårsdagens bøtte; den nye skal have 0 afvigelser.
test("#3107: hele sæsonen — bøtte-dag == kalenderdag for hvert eneste etape-slot", () => {
  const BLOCK = ["09:00", "11:00", "13:00", "14:00", "16:20", "18:00", "20:20"];
  const dates = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 27) + i * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const rows = dates.flatMap((date) => BLOCK.map((hm) => ({ scheduled_at: `${date}T${hm}:00Z` })));
  assert.equal(rows.length, 196);

  const axis = seasonDayAxis(rows);
  assert.equal(axis.totalDays, 28, "sæsonen er 28 kalenderdage");

  let wrong = 0;
  for (const row of rows) {
    const bucket = seasonDayForTime(row.scheduled_at, axis.firstOrdinal);
    // Forventet dag = etapens EGEN danske kalenderdato minus sæsonens første, 1-baseret.
    const expected = copenhagenDayOrdinal(row.scheduled_at) - axis.firstOrdinal + 1;
    if (bucket !== expected) wrong += 1;
    // Og slottet skal ligge inde i sin egen dags vindue.
    const { start, end } = seasonDayWindow({ firstOrdinal: axis.firstOrdinal, day: bucket });
    const t = Date.parse(row.scheduled_at);
    if (t < start || t > end) wrong += 1;
  }
  assert.equal(wrong, 0, `${wrong} slots i forkert bøtte`);
});

test("seasonDayAxis: totalDays er antal KALENDERDAGE, ikke 24t-spring", () => {
  // 27/7 16:00 UTC → 23/8 20:00 UTC. Kalenderdage 27/7..23/8 inklusive = 28.
  const axis = seasonDayAxis(sched("2026-07-27T16:00:00Z", "2026-08-23T20:00:00Z"));
  assert.equal(axis.totalDays, 28);
});

test("seasonDayAxis: ingen etaper → falder tilbage til season.start_date som dag 1", () => {
  const axis = seasonDayAxis([], "2026-07-27");
  assert.equal(axis.totalDays, 1);
  assert.equal(dateStringForOrdinal(axis.firstOrdinal), "2026-07-27");
});

// ── Dagsvindue ────────────────────────────────────────────────────────────────

test("seasonDayWindow: dag 1 dækker det danske døgn midnat→midnat", () => {
  const { firstOrdinal } = seasonDayAxis(sched("2026-07-27T16:00:00Z"));
  const { start, end } = seasonDayWindow({ firstOrdinal, day: 1 });
  // CEST = UTC+2 → dansk midnat 27/7 er 26/7 22:00 UTC.
  assert.equal(new Date(start).toISOString(), "2026-07-26T22:00:00.000Z");
  assert.equal(new Date(end + 1).toISOString(), "2026-07-27T22:00:00.000Z");
  assert.equal(end - start + 1, 86_400_000, "normalt døgn = 24t");
});

test("seasonDayWindow: en etape kl. 09:00 UTC ligger INDE i sin egen dags vindue", () => {
  const { firstOrdinal } = seasonDayAxis(sched("2026-07-27T16:00:00Z", "2026-07-28T09:00:00Z"));
  const day2 = seasonDayWindow({ firstOrdinal, day: 2 });
  const t = Date.parse("2026-07-28T09:00:00Z");
  assert.ok(t >= day2.start && t <= day2.end, "09:00-etapen faldt uden for dag 2 (den gamle bug)");
});

test("seasonDayWindow: DST-skiftedøgn er 25 timer, ikke 24 (CEST→CET, 25/10 2026)", () => {
  const firstOrdinal = copenhagenDayOrdinal("2026-10-25T12:00:00Z");
  const { start, end } = seasonDayWindow({ firstOrdinal, day: 1 });
  assert.equal(end - start + 1, 25 * 3_600_000);
});

// ── resolveSeasonDay ──────────────────────────────────────────────────────────

const SEASON_ROWS = sched("2026-07-27T16:00:00Z", "2026-08-23T20:00:00Z");
const season = { start_date: "2026-07-27" };

test("resolveSeasonDay: currentDay skifter ved MIDNAT dansk tid, ikke kl. 18:00", () => {
  const axisArgs = { season, schedRows: SEASON_ROWS };
  // 27/7 23:00 CEST (= 21:00 UTC) er stadig dag 1.
  assert.equal(resolveSeasonDay({ ...axisArgs, now: new Date("2026-07-27T21:00:00Z") }).currentDay, 1);
  // 28/7 00:30 CEST (= 27/7 22:30 UTC) er dag 2 — den gamle model sagde stadig dag 1
  // indtil kl. 16:00 UTC næste dag.
  assert.equal(resolveSeasonDay({ ...axisArgs, now: new Date("2026-07-27T22:30:00Z") }).currentDay, 2);
  // 28/7 10:00 CEST er også dag 2 (gammel model: stadig dag 1).
  assert.equal(resolveSeasonDay({ ...axisArgs, now: new Date("2026-07-28T08:00:00Z") }).currentDay, 2);
});

test("resolveSeasonDay: totalDays kommer fra sæsonen (28), aldrig en hardcodet 60", () => {
  assert.equal(resolveSeasonDay({ season, schedRows: SEASON_ROWS }).totalDays, 28);
});

test("resolveSeasonDay: ?day=N klampes til sæsonen", () => {
  const args = { season, schedRows: SEASON_ROWS, now: new Date("2026-07-28T08:00:00Z") };
  assert.equal(resolveSeasonDay({ ...args, dayParam: 5 }).focusDay, 5);
  assert.equal(resolveSeasonDay({ ...args, dayParam: 999 }).focusDay, 28);
  assert.equal(resolveSeasonDay({ ...args, dayParam: -3 }).focusDay, 1);
});

test("resolveSeasonDay: uden ?day vælges holdets nærmeste KOMMENDE løbsdag", () => {
  const r = resolveSeasonDay({
    season, schedRows: SEASON_ROWS, myRaceDays: [2, 9, 20], now: new Date("2026-08-01T08:00:00Z"),
  });
  assert.equal(r.currentDay, 6);
  assert.equal(r.focusDay, 9);
});

test("resolveSeasonDay: er holdets løb overstået, vises den sidste løbsdag (ikke en tom dag)", () => {
  const r = resolveSeasonDay({
    season, schedRows: SEASON_ROWS, myRaceDays: [2, 3], now: new Date("2026-08-10T08:00:00Z"),
  });
  assert.equal(r.focusDay, 3);
});

test("resolveSeasonDay: ?day=N's vindue matcher præcis den kalenderdag labelen lover", () => {
  const { dayWindow, firstOrdinal } = resolveSeasonDay({ season, schedRows: SEASON_ROWS, dayParam: 5 });
  // Dag 5 = 27/7 + 4 dage = 31/7. Det er præcis den dato Discord-rapporten spurgte til.
  assert.equal(dateStringForOrdinal(firstOrdinal + 4), "2026-07-31");
  const noon = Date.parse("2026-07-31T12:00:00Z");
  assert.ok(noon >= dayWindow.start && noon <= dayWindow.end);
});
