// #2469 · Context-drift på fan-in: bestyrelses-motoren (calculateBoardPerformance/
// evaluateBoardSeason) er ÉN delt motor, men kaldestederne håndbyggede hver sit
// context-objekt — og de drev fra hinanden. #2308 rettede tre stier (/board/status,
// weekend-finalization, season-end); /board/request var en fjerde der stadig
// manglede isFinalSeason + goal-context (divisionManagerCount/divisionTeamCount,
// cumulative metrics). Scoren der afgør om bestyrelsen accepterer en forhandling
// blev dermed beregnet på et andet grundlag end det /board/status viste spilleren
// sekunder forinden (6 rigtige spillere ramt 26.-30/6, 2 fik rejected).
//
// buildBoardEvalContext() er den strukturelle lukning: én delt bygger som alle
// live-stier kalder, så en ny kontekst-parameter tilføjes ét sted i stedet for
// at skulle huskes i N håndbyggede literals.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBoardEvalContext } from "./boardGoalContext.js";
import { calculateBoardPerformance } from "./boardEvaluation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Builder: kanoniske felter ────────────────────────────────────────────────

test("buildBoardEvalContext: kanoniske felter fra board + standing", () => {
  const ctx = buildBoardEvalContext({
    board: {
      plan_type: "3yr",
      seasons_completed: 1,
      plan_start_sponsor_income: 200_000,
      cumulative_stage_wins: 3,
      cumulative_gc_wins: 1,
    },
    standing: { stage_wins: 2, gc_wins: 1 },
    activeLoanCount: 2,
    currentSponsorIncome: 240_000,
    recentSnapshots: [{ goals_met: 2, goals_total: 3, satisfaction_delta: 5 }],
  });

  assert.equal(ctx.planDuration, 3);
  // Arbejds-sæson-indeks = den sæson planen er I (seasons_completed + 1).
  assert.equal(ctx.seasonsCompleted, 2);
  assert.equal(ctx.isFinalSeason, false);
  assert.equal(ctx.activeLoanCount, 2);
  assert.equal(ctx.planStartSponsorIncome, 200_000);
  assert.equal(ctx.currentSponsorIncome, 240_000);
  assert.equal(ctx.hasSeasonData, true);
  // Kumulativ = afsluttede sæsoner (board.cumulative_*) + indeværende (standing.*),
  // samme regel som #979 låste for /board/status.
  assert.deepEqual(ctx.cumulativeStats, { stageWins: 5, gcWins: 2 });
  assert.equal(ctx.recentSnapshots.length, 1);
});

test("buildBoardEvalContext: 1yr-plan er altid i sin finale sæson + indekset capper", () => {
  const ctx = buildBoardEvalContext({ board: { plan_type: "1yr", seasons_completed: 0 } });
  assert.equal(ctx.seasonsCompleted, 1);
  assert.equal(ctx.isFinalSeason, true);

  // Udløbet plan (seasons_completed == planDuration): indekset capper på
  // planDuration — samme min()-regel som /board/status har brugt siden #2308
  // (ækvivalent for isFinalSeason-flaget, se kommentaren i builderen).
  const expired = buildBoardEvalContext({ board: { plan_type: "1yr", seasons_completed: 1 } });
  assert.equal(expired.seasonsCompleted, 1);
  assert.equal(expired.isFinalSeason, true);
});

test("buildBoardEvalContext: uden standing = hasSeasonData false + cumulative fra board alene", () => {
  const ctx = buildBoardEvalContext({
    board: { plan_type: "5yr", seasons_completed: 2, cumulative_stage_wins: 4 },
  });
  assert.equal(ctx.hasSeasonData, false);
  assert.equal(ctx.isFinalSeason, false);
  assert.deepEqual(ctx.cumulativeStats, { stageWins: 4, gcWins: 0 });
});

test("buildBoardEvalContext: goalContext + per-sti-ekstra spredes ind", () => {
  const ctx = buildBoardEvalContext({
    board: { plan_type: "1yr", seasons_completed: 0 },
    goalContext: { divisionManagerCount: 5, divisionTeamCount: 12, cumulativeJerseyWins: 1 },
    extra: { isExpired: true, requestUsedThisSeason: false, assignedMembers: [] },
  });
  assert.equal(ctx.divisionManagerCount, 5);
  assert.equal(ctx.divisionTeamCount, 12);
  assert.equal(ctx.cumulativeJerseyWins, 1);
  assert.equal(ctx.isExpired, true);
  assert.equal(ctx.requestUsedThisSeason, false);
  assert.deepEqual(ctx.assignedMembers, []);
});

// ── Driften der bed (#2469 bug 1) ────────────────────────────────────────────
// Samme board, samme standing, samme motor — men /board/request's håndbyggede
// context (uden isFinalSeason + goal-context) gav en ANDEN score end den fulde
// context /board/status viste spilleren. Testen dokumenterer alle tre mekanismer:
//   1. relative_rank pinnes til awaiting_data (0.6) og fortynder snittet
//   2. results-competitiveness-gulvet kollapser til 0 (divisionTeamCount mangler)
//   3. no_outstanding_debt scorer 1.0 i stedet for 1.05 (isFinalSeason mangler)

const DRIFT_BOARD = {
  plan_type: "1yr",
  seasons_completed: 0,
  focus: "balanced",
  satisfaction: 55,
  plan_start_sponsor_income: 200_000,
  cumulative_stage_wins: 0,
  cumulative_gc_wins: 0,
  current_goals: [
    { type: "relative_rank", target: 2 },
    { type: "stage_wins", target: 3 },
    { type: "no_outstanding_debt", target: 0 },
  ],
};
const DRIFT_STANDING = { rank_in_division: 2, stage_wins: 0, gc_wins: 0 };
const DRIFT_TEAM = { riders: [], sponsor_income: 200_000 };

// Nøjagtig den context /board/request håndbyggede FØR fixet (api.js pre-#2469):
// 13 felter, ingen isFinalSeason, ingen loadGoalContextForBoard-felter.
const PRE_FIX_REQUEST_CONTEXT = {
  activeLoanCount: 0,
  currentSponsorIncome: 200_000,
  hasSeasonData: true,
  isExpired: false,
  planDuration: 1,
  planStartSponsorIncome: 200_000,
  recentSnapshots: [],
  requestUsedThisSeason: false,
  seasonsCompleted: 1,
  cumulativeStats: { stageWins: 0, gcWins: 0 },
  raceDaysLeft: 20,
  satisfactionDeltaPct: 5,
  activeSeasonId: "season-1",
};

function fullRequestContext() {
  return buildBoardEvalContext({
    board: DRIFT_BOARD,
    standing: DRIFT_STANDING,
    activeLoanCount: 0,
    currentSponsorIncome: 200_000,
    recentSnapshots: [],
    goalContext: { divisionManagerCount: 6, divisionTeamCount: 12 },
    extra: {
      isExpired: false,
      requestUsedThisSeason: false,
      raceDaysLeft: 20,
      satisfactionDeltaPct: 5,
      activeSeasonId: "season-1",
    },
  });
}

test("#2469: den håndbyggede /board/request-context gav en anden score end den fulde", () => {
  const drifted = calculateBoardPerformance({
    board: DRIFT_BOARD, standing: DRIFT_STANDING, team: DRIFT_TEAM,
    context: PRE_FIX_REQUEST_CONTEXT,
  });
  const full = calculateBoardPerformance({
    board: DRIFT_BOARD, standing: DRIFT_STANDING, team: DRIFT_TEAM,
    context: fullRequestContext(),
  });

  // 1. relative_rank: uden divisionManagerCount → pinned awaiting_data (0.6).
  //    Med → holdet er #2 og slår 6-2=4 managere ≥ target 2 → ahead.
  const driftedRank = drifted.goalEvaluations.find((g) => g.type === "relative_rank");
  const fullRank = full.goalEvaluations.find((g) => g.type === "relative_rank");
  assert.equal(driftedRank.status, "awaiting_data");
  assert.equal(driftedRank.score, 0.6);
  assert.equal(fullRank.status, "ahead");

  // 2. Results-gulvet: uden divisionTeamCount kollapser det til 0 — med tæller
  //    en #2-placering af 12 som konkurrencedygtighed selv uden etapesejre.
  assert.equal(full.scoreBreakdown.categories.results.competitiveness_floored, true);
  assert.notEqual(drifted.scoreBreakdown.categories.results.competitiveness_floored, true);

  // 3. isFinalSeason: gældfrihed i planens sidste sæson scorer 1.05, ikke 1.0.
  const driftedDebt = drifted.goalEvaluations.find((g) => g.type === "no_outstanding_debt");
  const fullDebt = full.goalEvaluations.find((g) => g.type === "no_outstanding_debt");
  assert.equal(driftedDebt.score, 1.0);
  assert.equal(fullDebt.score, 1.05);

  // Netto: scoren der afgør accept/afvisning var reelt forskellig.
  assert.ok(
    full.adjustedOverallScore > drifted.adjustedOverallScore,
    `fuld context skal score højere her (fuld=${full.adjustedOverallScore}, drifted=${drifted.adjustedOverallScore})`
  );
});

// ── Forward-guards (source-scan, mønster fra boardBankGuard.routes.test.js) ──
// Låser at alle live-stier faktisk kalder den delte bygger — en fremtidig
// femte sti der håndbygger sin context igen, fanges her.

const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const weekendSource = readFileSync(resolve(__dirname, "./boardWeekendFinalization.js"), "utf8");
const economySource = readFileSync(resolve(__dirname, "./economyEngine.js"), "utf8");

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} skal findes`);
  const end = endMarker ? source.indexOf(endMarker, start) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

test("#2469 forward-guard: /board/request bygger context via buildBoardEvalContext + loadGoalContextForBoard", () => {
  const block = sliceBetween(apiSource, 'router.post("/board/request"', 'router.post("/board/renew"');
  assert.match(block, /buildBoardEvalContext\(/, "/board/request skal bruge den delte context-bygger");
  assert.match(block, /loadGoalContextForBoard\(/, "/board/request skal loade goal-context (divisionManagerCount m.fl.)");
});

test("#2469 forward-guard: /board/status bygger context via buildBoardEvalContext", () => {
  const block = sliceBetween(apiSource, 'router.get("/board/status"', 'router.post("/board/');
  assert.match(block, /buildBoardEvalContext\(/);
});

test("#2469 forward-guard: weekend-finalization bygger context via buildBoardEvalContext", () => {
  assert.match(weekendSource, /buildBoardEvalContext\(/);
});

test("#2469 forward-guard: season-end + season-end-preview bygger context via buildBoardEvalContext", () => {
  const previewBlock = sliceBetween(economySource, "export function buildSeasonEndPreviewRows", "async function processTeamSeasonEnd");
  assert.match(previewBlock, /buildBoardEvalContext\(/, "admin-preview (5. sti) skal dele byggeren");
  const seasonEndBlock = sliceBetween(economySource, "async function processTeamSeasonEnd", "export async function updateRiderValues");
  assert.match(seasonEndBlock, /buildBoardEvalContext\(/, "season-end skal dele byggeren");
});

// ── #2592: mid-cycle-guard skal bruge samme sæson-indeks som visningen ──────
// /board/status's requestOptions-liste (buildBoardRequestOptions) og den
// faktiske POST /board/request-håndhævelse (resolveBoardRequest) kalder begge
// den samme getBoardRequestAvailability/F6-mid-cycle-guard i boardRequests.js.
// POST-stien fodrer guarden via buildBoardEvalContext (arbejds-sæson-indeks =
// seasons_completed+1, cappet — se testen ovenfor "kanoniske felter"). Før
// #2592-fixet fodrede /board/status's options-liste guarden med det RÅ
// board.seasons_completed i stedet — samme tærskel, to forskellige indekser,
// så UI'ets "disabled: for tidligt i forløbet"-visning kunne afvige fra hvad
// en reel POST ville afgøre for nøjagtig samme board-tilstand.
test("#2592 forward-guard: /board/status's requestOptions bruger weekendEvalContext.seasonsCompleted (arbejdsindeks), ikke den rå lokale seasonsCompleted", () => {
  const block = sliceBetween(apiSource, 'router.get("/board/status"', 'router.post("/board/');
  assert.match(
    block,
    /buildBoardRequestOptions\(\{[\s\S]*?seasonsCompleted:\s*weekendEvalContext\.seasonsCompleted/,
    "/board/status skal fodre mid-cycle-guarden med samme arbejds-sæson-indeks som POST /board/request bruger (weekendEvalContext.seasonsCompleted), ikke den rå board.seasons_completed-variabel der kun er til seasons_completed-DISPLAY-feltet"
  );
});
