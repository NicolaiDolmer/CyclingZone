// #54 · loadGoalContextForBoard afgrænsede ikke cumulative/u25-baseline til den
// aktuelle plan-cyklus: board_plan_snapshots akkumulerer under samme board_id
// på tværs af cyklusser (plan-fornyelse genbruger board-rowet), så uden et
// season_number >= plan_start_season_number-filter spændte cumulative
// monument/jersey/transfer + u25-baselinen over hele boardets historik.

import test from "node:test";
import assert from "node:assert/strict";

import { buildBoardEvalContext, loadGoalContextForBoard } from "./boardGoalContext.js";
import { CLASSIC_RACE_CLASSES } from "./boardConstants.js";
import { createRecorderSupabase, createFakeSupabase } from "./testUtils/fakeSupabase.js";

// #2598 · Tynd wrapper om den delte, projektion-aware recorder-fake
// (backend/lib/testUtils/fakeSupabase.js) — "canned" data pr. tabel (ingen
// reel server-side filtrering), men registrerer filter-kald til assertions
// OG projicerer output ned til de kolonner koden rent faktisk select()'ede.
function makeSupabase(tableData, recorder) {
  return createRecorderSupabase(tableData, recorder);
}

test("#54 · snapshot-query afgrænses til aktuel plan-cyklus + u25-baseline derfra", async () => {
  const recorder = [];
  const currentCycleSnapshot = {
    season_id: "s-new-1", u25_stat_sum: 120, u25_count: 6,
    season_within_plan: 1, season_number: 5,
  };
  const supabase = makeSupabase({
    board_plan_snapshots: [currentCycleSnapshot],
    race_results: [],
    finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    planStartSeasonNumber: 5,
  });

  const gteCall = recorder.find(
    ([op, tbl, col]) => op === "gte" && tbl === "board_plan_snapshots" && col === "season_number"
  );
  assert.ok(gteCall, "snapshot-query skal filtrere season_number >= plan_start_season_number");
  assert.equal(gteCall[3], 5);
  // u25-baselinen kommer fra det cyklus-afgrænsede snapshot (ikke en gammel cyklus).
  assert.equal(ctx.planStartU25StatSum, 120);
  assert.equal(ctx.planStartU25Count, 6);
});

test("#54 · uden planStartSeasonNumber anvendes intet cyklus-filter (bagudkompatibelt)", async () => {
  const recorder = [];
  const supabase = makeSupabase({
    board_plan_snapshots: [],
    race_results: [],
    finance_transactions: [],
  }, recorder);

  await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
  });

  const gteCall = recorder.find(
    ([op, tbl, col]) => op === "gte" && tbl === "board_plan_snapshots" && col === "season_number"
  );
  assert.equal(gteCall, undefined, "intet gte-filter når planStartSeasonNumber er null");
});

test("#1608 · divisionManagerCount tæller PR. PULJE (league_division_id), ikke pr. tier", async () => {
  // Efter form-frysen er rank_in_division pulje-rang (updateStandings ranger pr.
  // league_division_id). divisionManagerCount SKAL derfor også tælle managere i
  // SAMME pulje — ellers sammenligner relative_rank-målet en pulje-rang (1..N i
  // puljen) mod en tier-bred manager-tælling (managere på tværs af alle puljer i
  // tier'en), og "slå N managere"-målet bliver trivielt opfyldeligt.
  const recorder = [];
  // To puljer i tier 4: pulje 11 (2 managere + 1 AI), pulje 12 (3 managere).
  const standings = [
    { division: 4, league_division_id: 11, team: { is_ai: false } },
    { division: 4, league_division_id: 11, team: { is_ai: false } },
    { division: 4, league_division_id: 11, team: { is_ai: true } },
    { division: 4, league_division_id: 12, team: { is_ai: false } },
    { division: 4, league_division_id: 12, team: { is_ai: false } },
    { division: 4, league_division_id: 12, team: { is_ai: false } },
  ];
  const supabase = makeSupabase({
    board_plan_snapshots: [], race_results: [], finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    division: 4, leagueDivisionId: 11, standings,
  });

  // Tier 4 har 5 managere i alt, men pulje 11 har kun 2 (AI ekskluderet).
  assert.equal(ctx.divisionManagerCount, 2,
    "skal tælle managere i pulje 11, ikke alle 5 i tier 4");
});

test("#1608 · divisionManagerCount falder tilbage til tier-tælling når pulje mangler (bagudkompatibelt)", async () => {
  // Pre-pulje-DB'er (league_division_id = NULL) + kald uden leagueDivisionId skal
  // bevare den gamle tier-brede adfærd, så eksisterende sæsoner ikke knækker.
  const recorder = [];
  const standings = [
    { division: 3, league_division_id: null, team: { is_ai: false } },
    { division: 3, league_division_id: null, team: { is_ai: false } },
    { division: 3, league_division_id: null, team: { is_ai: false } },
  ];
  const supabase = makeSupabase({
    board_plan_snapshots: [], race_results: [], finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    division: 3, standings, // ingen leagueDivisionId → tier-bred tælling
  });

  assert.equal(ctx.divisionManagerCount, 3, "tier-bred tælling bevaret uden pulje");
});

test("#2308 · divisionTeamCount tæller FULD pulje (inkl. AI), divisionManagerCount ekskluderer AI", async () => {
  // computeResultsCompetitivenessFloor (boardEvaluation.js) normaliserer
  // rank_in_division (rangerer inkl. AI) mod divisionTeamCount — skal derfor
  // matche den fulde population, ikke den human-only divisionManagerCount.
  const recorder = [];
  const standings = [
    { division: 4, league_division_id: 11, team: { is_ai: false } },
    { division: 4, league_division_id: 11, team: { is_ai: false } },
    { division: 4, league_division_id: 11, team: { is_ai: true } },
    { division: 4, league_division_id: 12, team: { is_ai: false } },
  ];
  const supabase = makeSupabase({
    board_plan_snapshots: [], race_results: [], finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    division: 4, leagueDivisionId: 11, standings,
  });

  assert.equal(ctx.divisionTeamCount, 3, "pulje 11 har 3 hold i alt (2 human + 1 AI)");
  assert.equal(ctx.divisionManagerCount, 2, "divisionManagerCount ekskluderer stadig AI");
});

test("#2308 · divisionTeamCount fra DB-fallback (uden pre-loaded standings)", async () => {
  const recorder = [];
  const supabase = makeSupabase({
    board_plan_snapshots: [], race_results: [], finance_transactions: [],
    season_standings: [
      { team: { is_ai: false } },
      { team: { is_ai: false } },
      { team: { is_ai: true } },
    ],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    leagueDivisionId: 11,
  });

  assert.equal(ctx.divisionTeamCount, 3);
  assert.equal(ctx.divisionManagerCount, 2);
});

test("#1238 · podie-query bruger kanonisk klassiker-liste og splitter monument/klassiker-optælling", async () => {
  const recorder = [];
  const supabase = makeSupabase({
    board_plan_snapshots: [],
    // NB: mocken returnerer samme rows til både podie- og trøje-queryen
    // (ingen server-side filtrering) — assert derfor kun på podie-felterne.
    race_results: [
      // Monument-podie → tæller i BÅDE monument- og klassiker-optælling
      { rank: 1, races: { race_class: "Monuments", race_type: "single", season_id: "s-cur" } },
      // WT-endagsløb → tæller kun i klassiker-optællingen
      { rank: 3, races: { race_class: "OtherWorldTourB", race_type: "single", season_id: "s-cur" } },
      // WT-etapeløb (GC top-3) → tæller i INGEN af dem (ikke et endagsløb)
      { rank: 2, races: { race_class: "OtherWorldTourB", race_type: "stage_race", season_id: "s-cur" } },
    ],
    finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
  });

  assert.equal(ctx.cumulativeMonumentPodiums, 1);
  assert.equal(ctx.cumulativeClassicPodiums, 2);

  // Queryen skal filtrere på den kanoniske klasse-liste (én mapping, #1238)
  const inCall = recorder.find(
    ([op, tbl, col]) => op === "in" && tbl === "race_results" && col === "races.race_class"
  );
  assert.ok(inCall, "podie-queryen skal filtrere races.race_class via .in()");
  assert.deepEqual(inCall[3], CLASSIC_RACE_CLASSES);
});

// #4034 · Spiller-rapport 20/8: en endagssejr registreres i DB som en 'gc'-række
// (race_type='single'), ikke en 'stage'-række, og talte derfor aldrig med i
// stage_wins-bestyrelsesmålet. loadGoalContextForBoard skal nu tælle dem
// separat (cumulativeOneDayWins/seasonOneDayWins), så boardGoals.js kan lægge
// dem oveni standing.stage_wins.
test("#4034 · endagssejre (race_type='single', result_type='gc', rank=1) tælles separat fra etapesejre", async () => {
  const recorder = [];
  // NB (samme forbehold som #1238-testen ovenfor): mocken har INGEN reel
  // server-side filtrering — den returnerer alle race_results-rækker til alle
  // fire queries. Fixturen indeholder derfor KUN rækker en ægte query allerede
  // ville have filtreret frem (rank=1, result_type='gc', races.race_type='single'),
  // så optællingen tester sæson-splittet, ikke selve filtreringen. Filtreringen
  // verificeres separat nedenfor via recorder-kaldene.
  const supabase = makeSupabase({
    board_plan_snapshots: [
      { season_id: "s-prev", u25_stat_sum: null, u25_count: null, season_within_plan: 1 },
    ],
    race_results: [
      // Endagssejr i en TIDLIGERE sæson i planen → tæller kun kumulativt.
      { rank: 1, result_type: "gc", races: { race_type: "single", season_id: "s-prev" } },
      // Endagssejr i INDEVÆRENDE sæson → tæller i begge.
      { rank: 1, result_type: "gc", races: { race_type: "single", season_id: "s-cur" } },
    ],
    finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
  });

  assert.equal(ctx.cumulativeOneDayWins, 2, "s-prev + s-cur endagssejre tæller kumulativt");
  assert.equal(ctx.seasonOneDayWins, 1, "kun s-cur's endagssejr tæller for indeværende sæson");

  // Selve filtreringen: queryen skal afgrænse til rank=1, result_type='gc' og
  // races.race_type='single' — ellers ville en etapesejr eller en samlet
  // GC-sejr i et rigtigt etapeløb lække ind i endagssejr-optællingen i prod.
  const eqCalls = recorder.filter(([op, tbl]) => op === "eq" && tbl === "race_results");
  assert.ok(
    eqCalls.some(([, , col, val]) => col === "races.race_type" && val === "single"),
    "endagssejr-queryen skal filtrere races.race_type='single'"
  );
  assert.ok(
    eqCalls.some(([, , col, val]) => col === "result_type" && val === "gc"),
    "endagssejr-queryen skal filtrere result_type='gc'"
  );
  assert.ok(
    eqCalls.some(([, , col, val]) => col === "rank" && val === 1),
    "endagssejr-queryen skal filtrere rank=1"
  );
});

// #4377 · Reproducerer spiller-rapporten direkte på query-laget: trøjer vundet
// i en TIDLIGERE sæson af samme plan-cyklus (s-prev, stadig inden for
// plan_start_season_number-vinduet) skal tælle kumulativt, selvom indeværende
// sæson (s-cur) ikke selv har nogen trøjesejre. cumulativeJerseyWins er det
// felt boardGoals.js's jersey_wins-cumulative-gren læser (evaluateGoal:812-814);
// symptomet ("0/2 selvom trøjer blev vundet sidste sæson") var IKKE denne
// query — den har altid summeret rigtigt — men den manglende cumulative:true på
// DNA-tradition-målet (boardClubDna.js), der fik evalueringen til at læse
// seasonJerseyWins (kun s-cur) i stedet. Testen her låser at query-laget under
// den fix fortsat leverer den fulde plan-periode-sum.
test("#4377 · cumulativeJerseyWins summerer troejesejre over hele plan-vinduet, ikke kun indevaerende saeson", async () => {
  const recorder = [];
  const supabase = makeSupabase({
    board_plan_snapshots: [
      { season_id: "s-prev", u25_stat_sum: null, u25_count: null, season_within_plan: 1 },
    ],
    race_results: [
      // 2 troejer vundet i FORRIGE saeson af planen (matcher spiller-rapportens
      // "trøjer vundet sidste sæson").
      { rank: 1, races: { season_id: "s-prev" } },
      { rank: 1, races: { season_id: "s-prev" } },
      // Ingen troejer i indevaerende saeson.
    ],
    finance_transactions: [],
  }, recorder);

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
  });

  assert.equal(ctx.cumulativeJerseyWins, 2, "sidste sæsons 2 trøjer skal tælle kumulativt i indeværende sæson");
  assert.equal(ctx.seasonJerseyWins, 0, "indeværende sæson har selv 0 trøjer — bekræfter at kun cumulative fanger historikken");
});

// #4377 · Regression for spiller-rapportens tredje symptom ("kun 1 af 2 sejre —
// S1 + S2 — tæller i 3/5-årsplanen"). Punktet er allerede dækket separat af
// #3948 (endagssejr registreres som en 'gc'-række og manglede i stage_wins),
// men verificeres her på tværs af to sæsoner for #4377's "flerårs-tællere skal
// måle hele planperioden"-krav: en almindelig etapesejr persisteret fra sæson 1
// (board.cumulative_stage_wins) plus en endagssejr i sæson 2 (indeværende
// sæson, standing.stage_wins tæller den ikke — kun goalContext.cumulativeOneDayWins
// gør, jf. #4034) skal begge tælle med i den kumulative stage_wins-sum.
test("#4377/#3948 · cumulative stage_wins summerer en etapesejr fra sæson 1 + en endagssejr i sæson 2", () => {
  // Sæson 1: 1 almindelig etapesejr, persisteret på boardet ved sæson-slut
  // (economyEngine.js's newCumulativeStageWins-formel).
  const board = {
    plan_type: "3yr",
    cumulative_stage_wins: 1,
    cumulative_gc_wins: 0,
    seasons_completed: 1,
  };
  // Sæson 2 (indeværende): ingen ny ETAPEsejr i season_standings, men 1
  // endagssejr (tælles separat af loadGoalContextForBoard, #4034).
  const standing = { stage_wins: 0, gc_wins: 0 };
  const goalContext = { cumulativeOneDayWins: 1 };

  const context = buildBoardEvalContext({ board, standing, goalContext });

  assert.equal(
    context.cumulativeStats.stageWins, 2,
    "sæson 1's etapesejr + sæson 2's endagssejr skal summere til 2 på tværs af planperioden"
  );
});

// #3494 · sponsor_growth re-pointet fra det døde teams.sponsor_income-felt
// (altid SPONSOR_INCOME_BASE for alle hold) til ægte sponsor_contracts-
// udbetalinger. Disse tests bruger den FULDT FILTRERENDE fake (createFakeSupabase,
// modsat canned-recorderen ovenfor), fordi de skal bevise at .in("reason_code", …)
// + team/season-scoping rent faktisk ekskluderer engangsbonusser og andre holds
// transaktioner — en canned fake uden reel filtrering kunne ikke afsløre det.
test("#3494 · sponsorGrowthBaselineIncome/CurrentIncome summerer kun kontrakt-base + løbsdags-indtægt, pr. sæson", async () => {
  const supabase = createFakeSupabase({
    board_plan_snapshots: [
      { board_id: "b1", season_id: "s-prev", season_within_plan: 1, season_number: 5, u25_stat_sum: null, u25_count: null },
    ],
    finance_transactions: [
      // Plan-start-sæson (s-prev) — baseline: 300.000 base + 20.000 løbsdag = 320.000.
      { team_id: "t1", season_id: "s-prev", reason_code: "season_start_sponsor", amount: 300000 },
      { team_id: "t1", season_id: "s-prev", reason_code: "sponsor_race_day", amount: 20000 },
      // Decoy: engangsbonus i SAMME sæson må IKKE tælle med (ikke tilbagevendende
      // kontrakt-"vækst" — se SPONSOR_GROWTH_REASON_CODES-kommentaren).
      { team_id: "t1", season_id: "s-prev", reason_code: "sponsor_signing_bonus", amount: 999999 },
      // Indeværende sæson (s-cur) — actual: 400.000 base + 60.000 løbsdag = 460.000.
      { team_id: "t1", season_id: "s-cur", reason_code: "season_start_sponsor", amount: 400000 },
      { team_id: "t1", season_id: "s-cur", reason_code: "sponsor_race_day", amount: 60000 },
      // Decoy: et ANDET holds udbetaling i samme sæson må ikke lække ind.
      { team_id: "other-team", season_id: "s-cur", reason_code: "season_start_sponsor", amount: 999999 },
    ],
    race_results: [],
  });

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    planStartSeasonNumber: 5,
  });

  assert.equal(ctx.sponsorGrowthBaselineIncome, 320000, "baseline = base + løbsdag i plan-start-sæsonen, uden bonus");
  assert.equal(ctx.sponsorGrowthCurrentIncome, 460000, "actual = base + løbsdag i indeværende sæson, uden andet holds beløb");
});

test("#3494 · ingen tidligere plan-snapshot (plan-sæson 1) → baseline null, current stadig målt", async () => {
  const supabase = createFakeSupabase({
    board_plan_snapshots: [],
    finance_transactions: [
      { team_id: "t1", season_id: "s-cur", reason_code: "season_start_sponsor", amount: 250000 },
    ],
    race_results: [],
  });

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    planStartSeasonNumber: 1,
  });

  assert.equal(ctx.sponsorGrowthBaselineIncome, null,
    "ingen afsluttet sæson i planen endnu → intet ægte grundlag, evaluator skal returnere awaiting_data");
  assert.equal(ctx.sponsorGrowthCurrentIncome, 250000, "indeværende sæsons udbetaling måles uafhængigt af baseline");
});

// #3494 (CodeRabbit-fund, PR #4550) · error=null men data IKKE et array (teoretisk
// malformet svar) må ALDRIG stille sig tilfreds med et tavst 0 — det ville se ud
// som "holdet tjente reelt 0 denne sæson" i stedet for "vi ved det ikke", og kunne
// producere en falsk -100 %-vækst mod en ellers gyldig baseline. Bygger en minimal
// wrapper om den fuldt filtrerende fake der KUN forstyrrer sponsor-queryen
// ("amount, season_id") — alle andre queries (inkl. transfer-balance-queryen på
// samme tabel) går uændret gennem den ægte fake.
test("#3494 · malformet svar (error null, data ikke et array) på sponsor-queryen giver null, ikke et tavst 0", async () => {
  const baseSupabase = createFakeSupabase({
    board_plan_snapshots: [
      { board_id: "b1", season_id: "s-prev", season_within_plan: 1, season_number: 1, u25_stat_sum: null, u25_count: null },
    ],
    finance_transactions: [],
    race_results: [],
  });
  const supabase = {
    from(table) {
      const real = baseSupabase.from(table);
      if (table !== "finance_transactions") return real;
      return {
        select(columns) {
          if (columns !== "amount, season_id") return real.select(columns);
          // Simulerer et malformet PostgREST-svar: intet error, men data er
          // ikke et array (ude af den ægte Supabase-klients normale kontrakt).
          const stub = {
            eq() { return stub; },
            in() { return stub; },
            then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
          };
          return stub;
        },
      };
    },
  };

  const ctx = await loadGoalContextForBoard({
    supabase, teamId: "t1", boardId: "b1", currentSeasonId: "s-cur",
    planStartSeasonNumber: 1,
  });

  assert.equal(ctx.sponsorGrowthCurrentIncome, null,
    "malformet data må ALDRIG blive til et stille 0 — skal forblive 'ukendt' (null)");
  assert.equal(ctx.sponsorGrowthBaselineIncome, null,
    "samme malformet-data-guard gælder baseline");
});
