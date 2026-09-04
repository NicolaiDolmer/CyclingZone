// #2466 — unit-tests for udvælgelseslogikken bag dashboardets resultat-push-
// modul ("How your team did"): seneste finaliserede løb med holdets ryttere,
// placerings-summering og recap-row-trim.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickLatestTeamRace,
  summarizeTeamRace,
  trimRecapRows,
  buildSeasonHistory,
  buildPrizeBreakdown,
  buildSponsorPayoutLine,
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

// ── buildSeasonHistory (#2886) ────────────────────────────────────────────────
// Rækkerne kommer fra dashboard_my_team_season_races-RPC'en, som gentager
// sæson-totalerne på hver række (beregnet over HELE sæsonen, før LIMIT).

const RPC_ROWS = [
  { race_id: "race-c", race_name: "Classique de Touraine", race_type: "single", stages: 1, best_rank: 4, points: 92, prize_money: 6900, season_points: 6819, season_prize_money: 511425, season_races: 44 },
  { race_id: "race-b", race_name: "Klassieker van Kuurne", race_type: "single", stages: 1, best_rank: 4, points: 94, prize_money: 7050, season_points: 6819, season_prize_money: 511425, season_races: 44 },
  { race_id: "race-a", race_name: "Tour des Fjords", race_type: "stage_race", stages: 4, best_rank: 3, points: 108, prize_money: 8100, season_points: 6819, season_prize_money: 511425, season_races: 44 },
];

test("buildSeasonHistory: sæson-totaler læses af første række og dækker HELE sæsonen, ikke kun de returnerede løb", () => {
  const { season_totals } = buildSeasonHistory({ rows: RPC_ROWS, latestRaceId: "race-c" });
  assert.deepEqual(season_totals, { points: 6819, prize_money: 511425, races: 44 });
});

test("buildSeasonHistory: det viste løb filtreres ud af historikken (ingen dublet med kortets top-blok)", () => {
  const { history } = buildSeasonHistory({ rows: RPC_ROWS, latestRaceId: "race-c" });
  assert.deepEqual(history.map((h) => h.race_id), ["race-b", "race-a"]);
  assert.deepEqual(history[0], {
    race_id: "race-b",
    name: "Klassieker van Kuurne",
    race_type: "single",
    stages: 1,
    best_rank: 4,
    points: 94,
    prize_money: 7050,
  });
});

test("buildSeasonHistory: RPC'ens rækkefølge (nyeste import først) bevares", () => {
  const { history } = buildSeasonHistory({ rows: RPC_ROWS, latestRaceId: null });
  assert.deepEqual(history.map((h) => h.name), [
    "Classique de Touraine",
    "Klassieker van Kuurne",
    "Tour des Fjords",
  ]);
});

test("buildSeasonHistory: bigint fra PostgREST kan komme som streng — koerceres til tal så formatNumber ikke får \"16249\"", () => {
  const { history, season_totals } = buildSeasonHistory({
    rows: [{ race_id: "r1", race_name: "R", points: "212", prize_money: "15900", best_rank: "3", stages: "4", season_points: "16249", season_prize_money: "1218675", season_races: "44" }],
    latestRaceId: null,
  });
  assert.equal(history[0].points, 212);
  assert.equal(history[0].prize_money, 15900);
  assert.equal(history[0].best_rank, 3);
  assert.equal(history[0].stages, 4);
  assert.deepEqual(season_totals, { points: 16249, prize_money: 1218675, races: 44 });
});

test("buildSeasonHistory: løb uden placering (kun trøje-/holdklassement) beholder best_rank null i stedet for 0", () => {
  const { history } = buildSeasonHistory({
    rows: [{ race_id: "r1", race_name: "R", best_rank: null, points: 15, prize_money: 24000, season_points: 15, season_prize_money: 24000, season_races: 1 }],
    latestRaceId: null,
  });
  assert.equal(history[0].best_rank, null);
});

test("buildSeasonHistory: ingen rækker → tom historik og season_totals null (sektionerne skjules frem for at vise 0 point)", () => {
  assert.deepEqual(buildSeasonHistory({ rows: [], latestRaceId: "x" }), { history: [], season_totals: null });
  assert.deepEqual(buildSeasonHistory({ rows: null }), { history: [], season_totals: null });
  assert.deepEqual(buildSeasonHistory(), { history: [], season_totals: null });
});

// ── buildPrizeBreakdown (#4697/#4698) ────────────────────────────────────────

test("buildPrizeBreakdown: folder etapeplacering, klassifikation og holdbonus i tre grupper", () => {
  const myRows = [
    { result_type: "stage", stage_number: 1, rank: 2, rider_id: "r1", rider_name: "Naoki Goto", points_earned: 40, prize_money: 3000 },
    { result_type: "stage", stage_number: 3, rank: 1, rider_id: "r1", rider_name: "Naoki Goto", points_earned: 60, prize_money: 4500 },
    { result_type: "gc", stage_number: 4, rank: 3, rider_id: "r1", rider_name: "Naoki Goto", points_earned: 100, prize_money: 7500 },
    { result_type: "team", stage_number: 4, rank: 3, rider_id: null, rider_name: null, points_earned: 30, prize_money: 2250 },
    // rank 9999/prize 0 — skal IKKE tælle med (ingen tom "0 CZ$"-linje).
    { result_type: "stage", stage_number: 2, rank: 45, rider_id: "r2", rider_name: "Someone Else", points_earned: 0, prize_money: 0 },
  ];
  const b = buildPrizeBreakdown({ myRows });

  assert.equal(b.prize_total, 3000 + 4500 + 7500 + 2250);
  assert.equal(b.points_total, 40 + 60 + 100 + 30);

  assert.equal(b.stages.length, 2);
  assert.equal(b.stages[0].stage_number, 1);
  assert.equal(b.stages[0].amount, 3000);
  assert.equal(b.stages[0].riders[0].rider_name, "Naoki Goto");
  assert.equal(b.stages[1].stage_number, 3);
  assert.equal(b.stages[1].amount, 4500);

  assert.equal(b.classifications.length, 1);
  assert.equal(b.classifications[0].classification, "gc");
  assert.equal(b.classifications[0].amount, 7500);

  assert.deepEqual(b.team_bonus, { amount: 2250, points: 30 });
});

test("buildPrizeBreakdown: dagstrøje-mikrobonusser (mountain_day/points_day/young_day/leader) lægges under deres slutklassifikation", () => {
  const myRows = [
    { result_type: "leader", stage_number: 2, rank: 1, rider_id: "r1", rider_name: "A", points_earned: 5, prize_money: 375 },
    { result_type: "mountain_day", stage_number: 2, rank: 1, rider_id: "r2", rider_name: "B", points_earned: 5, prize_money: 375 },
    { result_type: "points_day", stage_number: 2, rank: 2, rider_id: "r1", rider_name: "A", points_earned: 3, prize_money: 225 },
    { result_type: "young_day", stage_number: 2, rank: 1, rider_id: "r3", rider_name: "C", points_earned: 5, prize_money: 375 },
  ];
  const b = buildPrizeBreakdown({ myRows });
  assert.equal(b.stages.length, 0);
  assert.equal(b.team_bonus, null);
  assert.equal(b.classifications.length, 4);
  const byKey = Object.fromEntries(b.classifications.map((c) => [c.classification, c]));
  assert.equal(byKey.gc.amount, 375); // leader → gc
  assert.equal(byKey.mountain.amount, 375);
  assert.equal(byKey.points.amount, 225);
  assert.equal(byKey.young.amount, 375);
});

test("buildPrizeBreakdown: klassifikations-rækkefølgen er altid gc→points→mountain→young, uanset inputrækkefølge", () => {
  const myRows = [
    { result_type: "young", stage_number: 4, rank: 1, rider_id: "r1", rider_name: "A", points_earned: 20, prize_money: 1500 },
    { result_type: "gc", stage_number: 4, rank: 1, rider_id: "r1", rider_name: "A", points_earned: 100, prize_money: 7500 },
  ];
  const b = buildPrizeBreakdown({ myRows });
  assert.deepEqual(b.classifications.map((c) => c.classification), ["gc", "young"]);
});

test("buildPrizeBreakdown: tom/ugyldig input → nul-total og tomme grupper, ingen kast", () => {
  assert.deepEqual(buildPrizeBreakdown({ myRows: [] }), {
    prize_total: 0, points_total: 0, stages: [], classifications: [], team_bonus: null,
  });
  assert.deepEqual(buildPrizeBreakdown({ myRows: null }), {
    prize_total: 0, points_total: 0, stages: [], classifications: [], team_bonus: null,
  });
  assert.deepEqual(buildPrizeBreakdown(), {
    prize_total: 0, points_total: 0, stages: [], classifications: [], team_bonus: null,
  });
});

// Ret-runde PR #4728 fund #1/#2: to ryttere der begge scorer i SAMME etape/
// klassifikation må ikke smelte sammen til én anonym sum uden navn — hver
// rytters riders[]-entry skal bære sin EGEN andel, ikke gruppens total, ellers
// kan frontend ikke vise "hvilken rytter tjente hvad" (#4697's kernekrav).
test("buildPrizeBreakdown: to ryttere i samme etape/klassifikation-gruppe beholder hver deres EGEN andel i riders[].amount", () => {
  const myRows = [
    { result_type: "stage", stage_number: 5, rank: 3, rider_id: "r1", rider_name: "Naoki Goto", points_earned: 30, prize_money: 2250 },
    { result_type: "stage", stage_number: 5, rank: 7, rider_id: "r2", rider_name: "Someone Else", points_earned: 10, prize_money: 750 },
    { result_type: "gc", stage_number: 6, rank: 5, rider_id: "r1", rider_name: "Naoki Goto", points_earned: 20, prize_money: 1500 },
    { result_type: "gc", stage_number: 6, rank: 8, rider_id: "r2", rider_name: "Someone Else", points_earned: 5, prize_money: 375 },
  ];
  const b = buildPrizeBreakdown({ myRows });

  assert.equal(b.stages[0].amount, 3000); // gruppetotal uændret
  assert.equal(b.stages[0].riders.length, 2);
  assert.deepEqual(
    b.stages[0].riders.map((r) => [r.rider_name, r.amount]).sort(),
    [["Naoki Goto", 2250], ["Someone Else", 750]].sort(),
  );

  assert.equal(b.classifications[0].amount, 1875);
  assert.deepEqual(
    b.classifications[0].riders.map((r) => [r.rider_name, r.amount]).sort(),
    [["Naoki Goto", 1500], ["Someone Else", 375]].sort(),
  );
});

// ── buildSponsorPayoutLine (#4698) ───────────────────────────────────────────

test("buildSponsorPayoutLine: summerer race-day + resultat-bonus til én linje med begge kilder", () => {
  const line = buildSponsorPayoutLine({
    sponsorRows: [
      { type: "sponsor_race_day", amount: 6000 },
      { type: "sponsor_result_bonus", amount: 1500 },
    ],
  });
  assert.deepEqual(line, {
    total: 7500,
    items: [
      { type: "sponsor_race_day", amount: 6000 },
      { type: "sponsor_result_bonus", amount: 1500 },
    ],
  });
});

test("buildSponsorPayoutLine: ingen sponsor-udbetaling for løbet → null (ingen tom linje i UI'et)", () => {
  assert.equal(buildSponsorPayoutLine({ sponsorRows: [] }), null);
  assert.equal(buildSponsorPayoutLine({ sponsorRows: null }), null);
  assert.equal(buildSponsorPayoutLine(), null);
  assert.equal(buildSponsorPayoutLine({ sponsorRows: [{ type: "sponsor_race_day", amount: 0 }] }), null);
});
