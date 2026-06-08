import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinanceForecast, computeMultiSeasonForecast, FORECAST_THRESHOLDS } from "./financeForecast.js";

// 4 manager-arketyper fra spec'en (07g · verification path).
const ARCHETYPES = {
  // Sund: stabil sponsor, lille gæld, præmie-tjenende roster.
  healthy: {
    team: { id: "t1", division: 2, balance: 850_000, sponsor_income: 240_000 },
    boardModifier: 1.0,
    riders: Array.from({ length: 18 }, () => ({
      salary: 8_000,
      prize_earnings_bonus: 6_000,
    })),
    activeLoans: [],
    inboundLoanAgreements: [],
    outboundLoanAgreements: [],
    totalDebt: 0,
    debtCeiling: 900_000,
    currentSeasonNumber: 1,
  },
  // Marginal: forecast-net ligger i gul-zone, gæld halv-vejs.
  marginal: {
    team: { id: "t2", division: 3, balance: 100_000, sponsor_income: 240_000 },
    boardModifier: 0.9,
    riders: Array.from({ length: 14 }, () => ({
      salary: 16_000,
      prize_earnings_bonus: 1_500,
    })),
    activeLoans: [{ amount_remaining: 200_000, interest_rate: 0.10 }],
    inboundLoanAgreements: [],
    outboundLoanAgreements: [],
    totalDebt: 350_000,
    debtCeiling: 600_000,
    currentSeasonNumber: 1,
  },
  // Gæld-stor: tæt på ceiling, men net stadig positiv.
  debtHeavy: {
    team: { id: "t3", division: 1, balance: 50_000, sponsor_income: 240_000 },
    boardModifier: 1.0,
    riders: Array.from({ length: 22 }, () => ({
      salary: 8_500,
      prize_earnings_bonus: 7_000,
    })),
    activeLoans: [{ amount_remaining: 1_000_000, interest_rate: 0.10 }],
    inboundLoanAgreements: [],
    outboundLoanAgreements: [],
    totalDebt: 1_050_000,
    debtCeiling: 1_200_000,
    currentSeasonNumber: 1,
  },
  // Konkurs-tæt: net stærkt negativ, gæld næsten på loftet.
  nearBankrupt: {
    team: { id: "t4", division: 3, balance: -80_000, sponsor_income: 240_000 },
    boardModifier: 0.8,
    riders: Array.from({ length: 12 }, () => ({
      salary: 22_000,
      prize_earnings_bonus: 800,
    })),
    activeLoans: [{ amount_remaining: 500_000, interest_rate: 0.10 }],
    inboundLoanAgreements: [
      { loan_fee: 25_000, start_season: 1, end_season: 3, status: "active" },
    ],
    outboundLoanAgreements: [],
    totalDebt: 550_000,
    debtCeiling: 600_000,
    currentSeasonNumber: 1,
  },
};

test("computeFinanceForecast: sund manager → grøn", () => {
  const result = computeFinanceForecast(ARCHETYPES.healthy);
  assert.equal(result.risk_tier, "green");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.projected_sponsor, 240_000);
  assert.equal(result.projected_prize, 18 * 6_000);
  assert.equal(result.projected_salary, -(18 * 8_000));
  assert.equal(result.projected_loan_interest, 0);
  // net = 240_000 + 108_000 - 144_000 = 204_000 → ≥ 50K og debt 0/900K=0 → grøn.
  assert.equal(result.projected_net, 204_000);
  assert.ok(result.confidence_low < result.projected_net);
  assert.ok(result.confidence_high > result.projected_net);
});

test("computeFinanceForecast: marginal manager → gul", () => {
  const result = computeFinanceForecast(ARCHETYPES.marginal);
  // sponsor = 240K × 0.9 = 216K, prize = 14×1500 = 21K, salary = -224K, rente = -20K.
  // net = 216_000 + 21_000 - 224_000 - 20_000 = -7_000 → i [-50K, 50K] → gul.
  assert.equal(result.projected_net, -7_000);
  assert.equal(result.risk_tier, "yellow");
  // debt-ratio = 350K/600K = 0.583 → > 50% giver "debt_growing" warning.
  const debtWarn = result.warnings.find((w) => w.code === "debt_growing");
  assert.ok(debtWarn, "skal have debt_growing warning");
  // Negativ net giver negative_net warning.
  const negWarn = result.warnings.find((w) => w.code === "negative_net");
  assert.ok(negWarn, "skal have negative_net warning");
});

test("computeFinanceForecast: gæld-stor manager → rød (debt > 80%)", () => {
  const result = computeFinanceForecast(ARCHETYPES.debtHeavy);
  // debt 1.05M / 1.2M = 87.5% → rød uanset net.
  assert.equal(result.risk_tier, "red");
  const debtWarn = result.warnings.find((w) => w.code === "debt_near_ceiling");
  assert.ok(debtWarn, "skal have debt_near_ceiling warning");
});

test("computeFinanceForecast: konkurs-tæt manager → rød (net + trend)", () => {
  const result = computeFinanceForecast(ARCHETYPES.nearBankrupt);
  // sponsor = 240K × 0.8 = 192K, prize = 12 × 800 = 9.6K, salary = -264K,
  // rente = -50K, lejegebyr = -25K. net = 192_000 + 9_600 - 264_000 - 50_000 - 25_000 = -137_400.
  assert.equal(result.projected_net, -137_400);
  assert.equal(result.risk_tier, "red");
  // Trend: 550K + 2×137.4K = 824.8K > 600K ceiling → trend-warning aktiv.
  const trendWarn = result.warnings.find((w) => w.code === "debt_trend");
  assert.ok(trendWarn, "skal have debt_trend warning");
});

test("computeFinanceForecast: tomt input giver default grøn med 0-net", () => {
  const result = computeFinanceForecast({});
  assert.equal(result.projected_sponsor, 240_000);
  assert.equal(result.projected_prize, 0);
  assert.equal(result.projected_salary, 0);
  assert.equal(result.projected_net, 240_000);
  assert.equal(result.risk_tier, "green");
});

test("computeFinanceForecast: lejegebyr indregnes kun hvis aftalen dækker næste sæson", () => {
  const base = {
    team: { id: "x", sponsor_income: 240_000 },
    riders: [],
    activeLoans: [],
    totalDebt: 0,
    debtCeiling: 900_000,
    currentSeasonNumber: 5,
  };

  // Aftale slutter sæson 5 (= currentSeason). Næste sæson er 6 → IKKE inkluderet.
  const expired = computeFinanceForecast({
    ...base,
    inboundLoanAgreements: [
      { loan_fee: 30_000, start_season: 4, end_season: 5, status: "active" },
    ],
  });
  assert.equal(expired.projected_loan_fees, 0);

  // Aftale dækker sæson 4-7 → inkluderet for sæson 6.
  const active = computeFinanceForecast({
    ...base,
    inboundLoanAgreements: [
      { loan_fee: 30_000, start_season: 4, end_season: 7, status: "active" },
    ],
  });
  assert.equal(active.projected_loan_fees, -30_000);

  // Status != active → ignoreres.
  const cancelled = computeFinanceForecast({
    ...base,
    inboundLoanAgreements: [
      { loan_fee: 30_000, start_season: 4, end_season: 7, status: "cancelled" },
    ],
  });
  assert.equal(cancelled.projected_loan_fees, 0);
});

test("computeFinanceForecast: outbound loan_fee bidrager positivt", () => {
  const result = computeFinanceForecast({
    team: { sponsor_income: 240_000 },
    riders: [],
    outboundLoanAgreements: [
      { loan_fee: 30_000, start_season: 1, end_season: 3, status: "active" },
    ],
    debtCeiling: 900_000,
    currentSeasonNumber: 1,
  });
  assert.equal(result.projected_loan_fees_received, 30_000);
  assert.equal(result.projected_net, 240_000 + 30_000);
});

test("computeFinanceForecast: pullout-factor reducerer sponsor", () => {
  const result = computeFinanceForecast({
    team: { sponsor_income: 240_000 },
    boardModifier: 1.0,
    pulloutFactor: 0.9,
    riders: [],
    debtCeiling: 900_000,
  });
  assert.equal(result.projected_sponsor, 216_000);
});

test("computeFinanceForecast: sæson 2 forecast bruger variabel sponsor fra standings", () => {
  const result = computeFinanceForecast({
    team: { id: "team-2", sponsor_income: 240_000 },
    currentSeasonNumber: 1,
    lastSeasonStandings: [
      { team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
      { team_id: "team-2", division: 3, total_points: 120, rank_in_division: 2 },
      { team_id: "team-3", division: 3, total_points: 60, rank_in_division: 3 },
    ],
    riders: [],
    debtCeiling: 900_000,
  });

  assert.equal(result.projected_sponsor, 2_575_000);
  assert.equal(result.inputs.sponsor_mode, "variable");
  assert.equal(result.inputs.sponsor_variable, 75_000);
  assert.equal(result.inputs.sponsor_breakdown.last_season_rank, 2);
});

test("computeFinanceForecast: lønbyrde > sponsor giver advarsel", () => {
  const result = computeFinanceForecast({
    team: { sponsor_income: 240_000 },
    riders: Array.from({ length: 20 }, () => ({
      salary: 15_000,
      prize_earnings_bonus: 8_000,
    })),
    debtCeiling: 900_000,
  });
  // Salary 300K > sponsor 240K → warning.
  const warn = result.warnings.find((w) => w.code === "salary_exceeds_sponsor");
  assert.ok(warn, "skal have salary_exceeds_sponsor warning");
});

test("computeFinanceForecast: risk-tier-grænser matcher spec'en", () => {
  // Net præcis på +50K + 0% debt → grøn (≥ 50K-grænse).
  const greenEdge = computeFinanceForecast({
    team: { sponsor_income: 100_000 },
    riders: [{ salary: 50_000, prize_earnings_bonus: 0 }],
    debtCeiling: 900_000,
  });
  assert.equal(greenEdge.projected_net, 50_000);
  assert.equal(greenEdge.risk_tier, "green");

  // Net 49.999 → gul.
  const yellowEdge = computeFinanceForecast({
    team: { sponsor_income: 100_000 },
    riders: [{ salary: 50_001, prize_earnings_bonus: 0 }],
    debtCeiling: 900_000,
  });
  assert.equal(yellowEdge.projected_net, 49_999);
  assert.equal(yellowEdge.risk_tier, "yellow");

  // Debt = 80% præcist → gul (kun > 80% giver rød).
  const debt80 = computeFinanceForecast({
    team: { sponsor_income: 240_000 },
    riders: [],
    totalDebt: 720_000,
    debtCeiling: 900_000,
  });
  assert.equal(debt80.inputs.debt_ratio, 0.8);
  assert.equal(debt80.risk_tier, "yellow");

  // Debt = 80.0001% → rød.
  const debt80Plus = computeFinanceForecast({
    team: { sponsor_income: 240_000 },
    riders: [],
    totalDebt: 720_001,
    debtCeiling: 900_000,
  });
  assert.equal(debt80Plus.risk_tier, "red");
});

// ─── Multi-sæson forecast (2026-05-21) ────────────────────────────────────────

test("computeMultiSeasonForecast — seasonsAhead=1 returnerer ét forecast", () => {
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: 1 });
  assert.equal(result.forecasts.length, 1);
  assert.equal(result.forecasts[0].is_estimate, false);
  assert.equal(result.forecasts[0].estimate_basis, "actual_state");
  assert.equal(result.summary.seasons_ahead, 1);
  assert.equal(result.summary.from_season, 2);
  assert.equal(result.summary.to_season, 2);
});

test("computeMultiSeasonForecast — seasonsAhead=3 returnerer 3 forecasts, sæson 2-3 er estimater", () => {
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: 3 });
  assert.equal(result.forecasts.length, 3);
  assert.equal(result.forecasts[0].is_estimate, false);
  assert.equal(result.forecasts[1].is_estimate, true);
  assert.equal(result.forecasts[2].is_estimate, true);
  assert.equal(result.forecasts[0].season_number, 2);
  assert.equal(result.forecasts[1].season_number, 3);
  assert.equal(result.forecasts[2].season_number, 4);
});

test("computeMultiSeasonForecast — seasonsAhead clampes til 1-5", () => {
  const tooLow = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: 0 });
  assert.equal(tooLow.forecasts.length, 1);
  const tooHigh = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: 10 });
  assert.equal(tooHigh.forecasts.length, 5);
  const negative = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: -5 });
  assert.equal(negative.forecasts.length, 1);
});

test("computeMultiSeasonForecast — rolling balance ruller fra én sæson til næste", () => {
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.healthy, seasonsAhead: 3 });
  const [s1, s2, s3] = result.forecasts;
  assert.equal(s1.starting_balance, 850_000);
  assert.equal(s1.ending_balance, 850_000 + s1.projected_net);
  assert.equal(s2.starting_balance, s1.ending_balance, "sæson 2 starter hvor sæson 1 endte");
  assert.equal(s3.starting_balance, s2.ending_balance, "sæson 3 starter hvor sæson 2 endte");
  assert.equal(result.summary.starting_balance, 850_000);
  assert.equal(result.summary.ending_balance, s3.ending_balance);
});

test("computeMultiSeasonForecast — gæld-tung manager: lån decay'er over sæsoner", () => {
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.debtHeavy, seasonsAhead: 3 });
  const [s1, s2, s3] = result.forecasts;
  // Loan-interest = amount × interest_rate; med 25% decay per sæson:
  //   s1: 1.000.000 × 0.10 = -100.000
  //   s2: ~750.000 × 0.10 = ~-75.000
  //   s3: ~562.500 × 0.10 = ~-56.250
  assert.ok(s1.projected_loan_interest <= -99_000);
  assert.ok(s2.projected_loan_interest > s1.projected_loan_interest, "rente falder med decay");
  assert.ok(s3.projected_loan_interest > s2.projected_loan_interest);
});

test("computeMultiSeasonForecast — sæson 2+ bruger variabel sponsor (intro kun sæson 1)", () => {
  const result = computeMultiSeasonForecast({
    ...ARCHETYPES.healthy,
    currentSeasonNumber: 0, // target = sæson 1, 2, 3
    seasonsAhead: 3,
  });
  // Sæson 1 = intro (fast 240K), sæson 2-3 = variabel (200K base + 0-150K)
  assert.equal(result.forecasts[0].inputs.sponsor_mode, "intro");
  assert.equal(result.forecasts[1].inputs.sponsor_mode, "fallback");
  assert.equal(result.forecasts[2].inputs.sponsor_mode, "fallback");
});

test("computeMultiSeasonForecast — worst_risk_tier = max over alle sæsoner", () => {
  // Healthy starter grøn, men bliver mere usikker hvis gæld dukker op.
  // Vi bruger marginal som har gul-zone net.
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.marginal, seasonsAhead: 3 });
  const tiers = result.forecasts.map((f) => f.risk_tier);
  const tierOrder = { green: 0, yellow: 1, red: 2 };
  const expectedWorst = tiers.reduce(
    (worst, t) => (tierOrder[t] > tierOrder[worst] ? t : worst),
    "green"
  );
  assert.equal(result.summary.worst_risk_tier, expectedWorst);
});

test("computeMultiSeasonForecast — alle warnings aggregeres med sæson-stempel", () => {
  const result = computeMultiSeasonForecast({ ...ARCHETYPES.nearBankrupt, seasonsAhead: 2 });
  assert.ok(result.warnings_all.length > 0);
  for (const w of result.warnings_all) {
    assert.ok(Number.isInteger(w.season_number));
    assert.ok(typeof w.is_estimate === "boolean");
  }
});

test("FORECAST_THRESHOLDS er frosset og matcher 07g-spec", () => {
  assert.equal(FORECAST_THRESHOLDS.RISK_NET_GREEN_THRESHOLD, 50_000);
  assert.equal(FORECAST_THRESHOLDS.RISK_NET_RED_THRESHOLD, -50_000);
  assert.equal(FORECAST_THRESHOLDS.RISK_DEBT_GREEN_RATIO, 0.5);
  assert.equal(FORECAST_THRESHOLDS.RISK_DEBT_YELLOW_RATIO, 0.8);
  assert.equal(FORECAST_THRESHOLDS.CONFIDENCE_BAND_PCT, 0.2);
  assert.throws(() => {
    FORECAST_THRESHOLDS.RISK_NET_GREEN_THRESHOLD = 999;
  });
});
