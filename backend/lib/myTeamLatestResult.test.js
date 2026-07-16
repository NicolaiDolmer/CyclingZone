// #2466 — unit-tests for udvælgelseslogikken bag dashboardets resultat-push-
// modul ("How your team did"): seneste finaliserede løb med holdets ryttere,
// placerings-summering og recap-row-trim.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickLatestTeamRace,
  summarizeTeamRace,
  trimRecapRows,
} from "./myTeamLatestResult.js";

// ── pickLatestTeamRace ────────────────────────────────────────────────────────

test("pickLatestTeamRace vælger løbet med nyeste imported_at", () => {
  const rows = [
    { race_id: "race-old", imported_at: "2026-07-14T13:06:19.655Z" },
    { race_id: "race-new", imported_at: "2026-07-15T13:03:12.076Z" },
    { race_id: "race-mid", imported_at: "2026-07-15T10:03:12.394Z" },
  ];
  assert.equal(pickLatestTeamRace(rows), "race-new");
});

test("pickLatestTeamRace er stabil når batch-rækker fra samme løb er interleaved", () => {
  const rows = [
    { race_id: "race-b", imported_at: "2026-07-15T10:00:01.000Z" },
    { race_id: "race-a", imported_at: "2026-07-15T10:00:02.000Z" },
    { race_id: "race-b", imported_at: "2026-07-15T10:00:03.000Z" },
    { race_id: "race-a", imported_at: "2026-07-15T10:00:00.000Z" },
  ];
  assert.equal(pickLatestTeamRace(rows), "race-b");
});

test("pickLatestTeamRace: tom/ugyldig input → null", () => {
  assert.equal(pickLatestTeamRace([]), null);
  assert.equal(pickLatestTeamRace(null), null);
  assert.equal(pickLatestTeamRace(undefined), null);
  assert.equal(pickLatestTeamRace([{ imported_at: "2026-01-01" }]), null);
});

test("pickLatestTeamRace: rækker uden imported_at taber til daterede, men kan vinde alene", () => {
  assert.equal(
    pickLatestTeamRace([
      { race_id: "race-undated", imported_at: null },
      { race_id: "race-dated", imported_at: "2026-07-01T00:00:00.000Z" },
    ]),
    "race-dated"
  );
  assert.equal(pickLatestTeamRace([{ race_id: "race-undated", imported_at: null }]), "race-undated");
});

// ── summarizeTeamRace ─────────────────────────────────────────────────────────

const RIDER = (first, last) => ({ firstname: first, lastname: last, nationality_code: "dk" });

test("summarizeTeamRace: gc-rækker er det endelige klassement, sorteret efter rank", () => {
  const myRows = [
    { result_type: "gc", stage_number: 1, rank: 17, rider_id: "r3", rider: RIDER("Hamza", "Bennani"), finish_time: "+0:26", points_earned: 4, prize_money: 300 },
    { result_type: "gc", stage_number: 1, rank: 3, rider_id: "r1", rider: RIDER("Naoki", "Goto"), finish_time: "+0:00", points_earned: 100, prize_money: 7500 },
    { result_type: "team", stage_number: 1, rank: 3, rider_id: null, rider: null, finish_time: null, points_earned: 0, prize_money: 0 },
  ];
  const s = summarizeTeamRace({ raceMeta: { race_type: "single", stages: 1 }, myRows });
  assert.equal(s.placements.length, 2);
  assert.equal(s.placements[0].rank, 3);
  assert.equal(s.placements[0].firstname, "Naoki");
  assert.equal(s.placements[1].rank, 17);
  // Totaler summerer ALLE rækker (inkl. holdklassement), ikke kun placeringerne.
  assert.equal(s.totals.points, 104);
  assert.equal(s.totals.prize_money, 7800);
});

test("summarizeTeamRace: uden gc falder klassementet tilbage til stage-rækker ved højeste etape", () => {
  const myRows = [
    { result_type: "stage", stage_number: 1, rank: 5, rider_id: "r1", rider: RIDER("A", "A"), finish_time: "+0:10", points_earned: 10, prize_money: 100 },
    { result_type: "stage", stage_number: 2, rank: 2, rider_id: "r1", rider: RIDER("A", "A"), finish_time: "+0:04", points_earned: 20, prize_money: 200 },
    { result_type: "stage", stage_number: 2, rank: 9, rider_id: "r2", rider: RIDER("B", "B"), finish_time: "+0:31", points_earned: 2, prize_money: 0 },
  ];
  const s = summarizeTeamRace({ raceMeta: { race_type: "stage_race", stages: 2 }, myRows });
  assert.deepEqual(s.placements.map((p) => p.rank), [2, 9]);
});

test("summarizeTeamRace: etapesejre tælles kun for etapeløb", () => {
  const stageWinRow = { result_type: "stage", stage_number: 1, rank: 1, rider_id: "r1", rider: RIDER("A", "A"), points_earned: 25, prize_money: 1000 };
  const gcRow = { result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider: RIDER("A", "A"), points_earned: 50, prize_money: 2000 };
  const stageRace = summarizeTeamRace({ raceMeta: { race_type: "stage_race", stages: 4 }, myRows: [stageWinRow, gcRow] });
  assert.equal(stageRace.stage_wins, 1);
  // Gammelt PCM-endagsløb: finish gemt som 'stage'-række — IKKE en etapesejr.
  const oneDay = summarizeTeamRace({ raceMeta: { race_type: "single", stages: 1 }, myRows: [stageWinRow] });
  assert.equal(oneDay.stage_wins, 0);
});

test("summarizeTeamRace: rider_name-fallback når rider-join mangler (solgt/slettet rytter)", () => {
  const myRows = [
    { result_type: "gc", stage_number: 1, rank: 7, rider_id: null, rider: null, rider_name: "Yamato Suzuki", finish_time: "+0:58", points_earned: 0, prize_money: 0 },
  ];
  const s = summarizeTeamRace({ raceMeta: { race_type: "single", stages: 1 }, myRows });
  assert.equal(s.placements[0].rider_name, "Yamato Suzuki");
  assert.equal(s.placements[0].firstname, null);
});

test("summarizeTeamRace: tomme rækker → tom summering, aldrig kast", () => {
  const s = summarizeTeamRace({ raceMeta: { race_type: "single", stages: 1 }, myRows: [] });
  assert.deepEqual(s, { placements: [], stage_wins: 0, totals: { points: 0, prize_money: 0 } });
});

// ── trimRecapRows ─────────────────────────────────────────────────────────────

test("trimRecapRows beholder top-10 + udbruds-flaggede rækker, dropper resten", () => {
  const rows = [
    { rank: 1, result_type: "gc" },
    { rank: 10, result_type: "gc" },
    { rank: 11, result_type: "gc" },
    { rank: 47, result_type: "gc", in_breakaway: true },
    { rank: 52, result_type: "gc", breakaway_caught: true },
    { rank: 90, result_type: "gc" },
    { rank: null, result_type: "gc" },
    { rank: 1, result_type: "team" },
    { rank: 1, result_type: "points" },
  ];
  const kept = trimRecapRows(rows);
  assert.deepEqual(
    kept.map((r) => `${r.result_type}:${r.rank}`),
    ["gc:1", "gc:10", "gc:47", "gc:52", "team:1", "points:1"]
  );
});

test("trimRecapRows: ugyldig input → tom liste", () => {
  assert.deepEqual(trimRecapRows(null), []);
  assert.deepEqual(trimRecapRows(undefined), []);
});
