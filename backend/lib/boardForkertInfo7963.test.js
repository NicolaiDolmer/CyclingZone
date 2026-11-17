// #7963 + #8116 + #8118 · Bestyrelsen viste forkert info tre steder.
//
//   #7963: økonomi-kategorien stod med ét tal på dashboardet (live) og et andet
//          i Boardroom (øjebliksbillede fra seneste løbsweekend).
//   #8116: halvsæson-beskeden pegede på en "board request", som ikke findes i
//          det nye bestyrelseslokale.
//   #8118: bestyrelsen var utilfreds, selvom alle synlige mål var nået: et
//          bonusmål fra en tidligere sæson blev båret med ind i den nye sæsons
//          plan, usynligt for spilleren, men stadig talt med.
import test from "node:test";
import assert from "node:assert/strict";

import { buildBoardOutlook, evaluateBoardSeason } from "./boardEvaluation.js";
import { buildBoardEvalContext } from "./boardGoalContext.js";
import { buildCategoryScores } from "./boardMandate.js";
import { deriveLiveCategoryScores } from "./boardRoom.js";
import { isExpiredSeasonBoundGoal, preserveExternalGoals } from "./boardGoals.js";
import { buildBonusExtraGoal, applyAcceptedBonusGoal } from "./boardBonusGoal.js";
import { buildMidSeasonNotification, MID_SEASON_TITLE_PREFIX } from "./boardMidSeason.js";
import { translate } from "./i18nServer.js";

const SEASON = 5;

function riders(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `r${index}`, is_u25: false, popularity: 10 }));
}

function oneYearBoard(goals) {
  return {
    id: "board-1",
    plan_type: "1yr",
    focus: "balanced",
    satisfaction: 50,
    seasons_completed: 0,
    plan_start_season_number: SEASON,
    current_goals: goals,
  };
}

function context(board, { balance, wageBillPerSeason = 1_000_000 } = {}) {
  return buildBoardEvalContext({
    board,
    standing: STANDING,
    balance,
    wageBillPerSeason,
    seasonNumber: SEASON,
  });
}

const STANDING = { rank_in_division: 2, division: 3, stage_wins: 2, gc_wins: 0 };

// ── #7963 ───────────────────────────────────────────────────────────────────

test("#7963: Boardroom-kategorien regnes af samme funktion som dashboardet og giver samme tal", () => {
  const board = oneYearBoard([
    { type: "top_n_finish", target: 6 },
    { type: "no_outstanding_debt", target: 0 },
    { type: "min_riders", target: 9 },
  ]);
  const team = { division: 3, riders: riders(12) };
  const now = context(board, { balance: 450_000 });

  const dashboard = buildBoardOutlook({ board, standing: STANDING, team, context: now });
  const dashboardEconomy = Math.min(100, dashboard.score_breakdown.categories.economy.score_pct);

  const room = deriveLiveCategoryScores({ board, standing: STANDING, team, context: now });
  const roomEconomy = room.find((c) => c.key === "economy")?.score;

  assert.equal(roomEconomy, dashboardEconomy, "samme mål, samme øjeblik, samme tal");
  for (const category of room) {
    assert.equal(category.score, Math.min(100, dashboard.score_breakdown.categories[category.key].score_pct));
  }
});

test("#7963: det gemte weekend-billede kan afvige fra dashboardet, så det må ikke være Boardroom-kilden", () => {
  const board = oneYearBoard([{ type: "no_outstanding_debt", target: 0 }]);
  const team = { division: 3, riders: riders(12) };

  // Weekenden regnede med saldoen dengang; dashboardet regner med saldoen nu.
  const weekend = evaluateBoardSeason({ board, standing: STANDING, team, context: context(board, { balance: 280_000 }) });
  const persisted = buildCategoryScores(weekend.scoreBreakdown.categories).economy;

  const now = context(board, { balance: 310_000 });
  const dashboardEconomy = Math.min(100, buildBoardOutlook({ board, standing: STANDING, team, context: now })
    .score_breakdown.categories.economy.score_pct);
  const roomEconomy = deriveLiveCategoryScores({ board, standing: STANDING, team, context: now })
    .find((c) => c.key === "economy").score;

  assert.notEqual(persisted, dashboardEconomy, "genskaber fejlen: to kilder, to tal");
  assert.equal(roomEconomy, dashboardEconomy, "rettelsen: Boardroom følger dashboardet");
});

test("#7963: en kategori med flere mål afrundes som dashboardet (intet point i forskel)", () => {
  const board = oneYearBoard([
    { type: "stage_wins", target: 1 },
    { type: "gc_wins", target: 10 },
  ]);
  const standing = { rank_in_division: 9, division: 3, stage_wins: 0, gc_wins: 1 };
  const team = { division: 3, riders: riders(12) };
  const ctx = buildBoardEvalContext({ board, standing, balance: 0, seasonNumber: SEASON });
  const dashboard = buildBoardOutlook({ board, standing, team, context: ctx }).score_breakdown.categories.results.score_pct;
  const room = deriveLiveCategoryScores({ board, standing, team, context: ctx }).find((c) => c.key === "results").score;
  assert.equal(room, Math.min(100, dashboard));
});

test("#7963: intet 1yr-board giver tom liste, så kalderen beholder det gemte billede", () => {
  assert.deepEqual(deriveLiveCategoryScores({ board: null }), []);
});

// ── #8118 ───────────────────────────────────────────────────────────────────

const VISIBLE_GOALS = [
  { type: "top_n_finish", target: 6 },
  { type: "min_riders", target: 9 },
];

test("#8118: et bonusmål fra sidste sæson trækker ikke bestyrelsen ned, når alle synlige mål er nået", () => {
  const staleBonus = buildBonusExtraGoal({
    extraGoal: { type: "signature_rider", target: 1, label: "Sign 1 new high-renown rider" },
    baseline: 0,
    offerId: "offer-s4",
    seasonNumber: SEASON - 1,
  });
  const team = { division: 3, riders: riders(12) };

  // Før rettelsen: samme mål, men uden sæson-stempel = det gamle bonusmål tæller.
  const unstamped = { ...staleBonus };
  delete unstamped.season_number;
  const before = evaluateBoardSeason({
    board: oneYearBoard([...VISIBLE_GOALS, unstamped]),
    standing: STANDING,
    team,
    context: context(oneYearBoard([]), { balance: 0 }),
  });
  assert.ok(before.goalsMet < before.goals.length, "genskaber fejlen: et usynligt mål er ikke nået");
  assert.ok(buildCategoryScores(before.scoreBreakdown.categories).identity < 60, "identitet trækkes ned");

  const after = evaluateBoardSeason({
    board: oneYearBoard([...VISIBLE_GOALS, staleBonus]),
    standing: STANDING,
    team,
    context: context(oneYearBoard([]), { balance: 0 }),
  });
  assert.equal(after.goals.length, VISIBLE_GOALS.length, "sidste sæsons bonusmål er ude af evalueringen");
  assert.equal(after.goalsMet, after.goals.length, "alle mål nået = alle mål nået");
  assert.equal(buildCategoryScores(after.scoreBreakdown.categories).identity, 100);
  assert.ok(after.newSatisfaction > before.newSatisfaction);
});

test("#8118: et bonusmål fra DENNE sæson tæller stadig med", () => {
  const currentBonus = buildBonusExtraGoal({
    extraGoal: { type: "signature_rider", target: 1 },
    baseline: 0,
    offerId: "offer-s5",
    seasonNumber: SEASON,
  });
  const result = evaluateBoardSeason({
    board: oneYearBoard([...VISIBLE_GOALS, currentBonus]),
    standing: STANDING,
    team: { division: 3, riders: riders(12) },
    context: context(oneYearBoard([]), { balance: 0 }),
  });
  assert.equal(result.goals.length, VISIBLE_GOALS.length + 1);
});

test("#8118: årsmødet bærer ikke sidste sæsons bonusmål ind i den nye plan", () => {
  const stale = { type: "signature_rider", target: 1, source: "bonus_offer", bonus_offer_id: "a", season_number: 4 };
  const current = { type: "monument_podium", target: 1, source: "bonus_offer", bonus_offer_id: "b", season_number: 5 };
  const legacyUnstamped = { type: "signature_rider", target: 1, source: "bonus_offer", bonus_offer_id: "c" };

  const goals = preserveExternalGoals({
    rebuiltGoals: VISIBLE_GOALS,
    previousGoals: [...VISIBLE_GOALS, stale, current, legacyUnstamped],
    seasonNumber: 5,
  });
  const offerIds = goals.map((g) => g.bonus_offer_id).filter(Boolean);
  assert.deepEqual(offerIds, ["b", "c"]);

  // Uden sæsonnummer (fx kalibreringen af et nyt hold) er adfærden som før.
  const unchanged = preserveExternalGoals({ rebuiltGoals: [], previousGoals: [stale, current] });
  assert.equal(unchanged.length, 2);
});

test("#8118: kun stemplede bonusmål fra en tidligere sæson er udløbne", () => {
  assert.equal(isExpiredSeasonBoundGoal({ source: "bonus_offer", season_number: 4 }, 5), true);
  assert.equal(isExpiredSeasonBoundGoal({ source: "bonus_offer", season_number: 5 }, 5), false);
  assert.equal(isExpiredSeasonBoundGoal({ source: "bonus_offer" }, 5), false);
  assert.equal(isExpiredSeasonBoundGoal({ source: "club_dna", season_number: 1 }, 5), false);
  assert.equal(isExpiredSeasonBoundGoal({ source: "bonus_offer", season_number: 4 }, null), false);
});

test("#8118: et accepteret bonustilbud stemples med den aktive sæson", async () => {
  const writes = [];
  const supabase = {
    from(table) {
      const query = {
        _table: table,
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle: async () => (table === "board_profiles"
          ? { data: { id: "board-1", current_goals: [], plan_type: "1yr", plan_start_season_number: 5 }, error: null }
          : { data: null, error: null }),
        update(payload) { writes.push({ table, payload }); return { eq: async () => ({ error: null }) }; },
        then: undefined,
      };
      if (table === "riders") query.eq = async () => ({ data: [], error: null });
      if (table === "app_config") query.maybeSingle = async () => ({ data: null, error: null });
      return query;
    },
  };
  const { goal } = await applyAcceptedBonusGoal({
    supabase,
    teamId: "team-1",
    offerId: "offer-1",
    extraGoal: { type: "signature_rider", target: 1 },
    isMandateModelEnabled: async () => false,
    loadSeasonNumber: async () => 5,
  });
  assert.equal(goal.season_number, 5);
  assert.equal(goal.source, "bonus_offer");
});

// ── #8116 ───────────────────────────────────────────────────────────────────

test("#8116: halvsæson-beskeden peger kun på det, der findes, og kan oversættes", () => {
  for (const reason of ["low_satisfaction", "many_behind"]) {
    const keyed = buildMidSeasonNotification({ reason, satisfaction: 41.6, seasonNumber: SEASON });
    assert.doesNotMatch(keyed.message, /board request/i, "ingen henvisning til en funktion der ikke findes");
    assert.match(keyed.message, /Board page/);
    assert.match(keyed.message, /Finance page/);
    assert.ok(keyed.metadata.messageCode.startsWith("notif.boardMidSeason."));
    // Titlen er gentagelsesværnets nøgle og må ikke ændre sig.
    assert.equal(keyed.title, `${MID_SEASON_TITLE_PREFIX} (season ${SEASON})`);

    const da = translate(keyed.metadata.messageCode, keyed.metadata.messageParams, { language: "da" });
    assert.match(da, /Bestyrelse-siden/);
    assert.match(da, /Økonomi-siden/);
    assert.notEqual(da, keyed.metadata.messageCode);
  }
  const low = buildMidSeasonNotification({ reason: "low_satisfaction", satisfaction: 41.6, seasonNumber: SEASON });
  assert.match(low.message, /down to 42\./);
});
