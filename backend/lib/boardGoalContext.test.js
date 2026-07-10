// #54 · loadGoalContextForBoard afgrænsede ikke cumulative/u25-baseline til den
// aktuelle plan-cyklus: board_plan_snapshots akkumulerer under samme board_id
// på tværs af cyklusser (plan-fornyelse genbruger board-rowet), så uden et
// season_number >= plan_start_season_number-filter spændte cumulative
// monument/jersey/transfer + u25-baselinen over hele boardets historik.

import test from "node:test";
import assert from "node:assert/strict";

import { loadGoalContextForBoard } from "./boardGoalContext.js";
import { CLASSIC_RACE_CLASSES } from "./boardConstants.js";

// Minimal chainable Supabase-mock. Registrerer filtre pr. tabel og returnerer
// canned data. Builder er thenable (cumulative-queries awaiter direkte) OG har
// .order() der returnerer et Promise (snapshot-query slutter med .order()).
function makeSupabase(tableData, recorder) {
  return {
    from(table) {
      const result = { data: tableData[table] ?? [], error: null };
      const builder = {
        select() { return builder; },
        eq(col, val) { recorder.push(["eq", table, col, val]); return builder; },
        gte(col, val) { recorder.push(["gte", table, col, val]); return builder; },
        lte(col, val) { recorder.push(["lte", table, col, val]); return builder; },
        in(col, val) { recorder.push(["in", table, col, val]); return builder; },
        order() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
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
