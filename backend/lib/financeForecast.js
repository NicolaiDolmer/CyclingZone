/**
 * Slice 07g · Manager finance-forecast + risk-tier
 *
 * Pure function der projicerer næste sæsons cashflow for ét hold:
 *   indtægter (sponsor + præmie) − udgifter (løn + rente + lejegebyr)
 * Returnerer 🟢/🟡/🔴 risk-tier + warnings.
 *
 * Inputs er rå tal/arrays — alle DB-queries lever i route-handler. Det holder
 * funktionen testbar uden Supabase-mock og giver os deterministiske unit-tests.
 */

import {
  buildSponsorStandingsContext,
  computeSponsorForSeason,
} from "./sponsorEngine.js";

const RISK_NET_GREEN_THRESHOLD = 50_000;
const RISK_NET_RED_THRESHOLD = -50_000;
const RISK_DEBT_GREEN_RATIO = 0.5;
const RISK_DEBT_YELLOW_RATIO = 0.8;
const CONFIDENCE_BAND_PCT = 0.2; // ±20% på prize-estimatet

export function computeFinanceForecast({
  team = {},
  boardModifier = 1.0,
  pulloutFactor = 1.0,
  riders = [],
  activeLoans = [],
  inboundLoanAgreements = [],
  outboundLoanAgreements = [],
  totalDebt = 0,
  debtCeiling = null,
  currentSeasonNumber = null,
  targetSeasonNumber = null,
  lastSeasonStanding = null,
  lastSeasonStandings = [],
} = {}) {
  const seasonNumber = Number.isInteger(targetSeasonNumber)
    ? targetSeasonNumber
    : Number.isInteger(currentSeasonNumber)
      ? currentSeasonNumber + 1
      : null;
  const sponsorContext = buildSponsorStandingsContext(lastSeasonStandings);
  const resolvedLastStanding = lastSeasonStanding
    ?? (team?.id ? sponsorContext.standingByTeamId.get(team.id) : null)
    ?? null;
  const divisionStandings = resolvedLastStanding
    ? sponsorContext.divisionStandingsByDivision.get(resolvedLastStanding.division) || []
    : [];
  const sponsorBreakdown = computeSponsorForSeason({
    seasonNumber,
    team,
    lastSeasonStanding: resolvedLastStanding,
    divisionStandings,
  });
  const projectedSponsor = Math.round(sponsorBreakdown.gross_sponsor * boardModifier * pulloutFactor);

  // Præmie-estimat = sum af riders.prize_earnings_bonus, som DB allerede beregner
  // som rolling avg over sidste 1-3 afsluttede sæsoner. Roster'ets "track record"
  // er den mest robuste prognose vi har for næste sæson.
  const projectedPrize = (riders || []).reduce(
    (sum, r) => sum + (r?.prize_earnings_bonus || 0),
    0
  );

  // Løn = sum(rider.salary). DB-GENERATED column, holdt i sync med value+prize_bonus.
  const totalSalary = (riders || []).reduce((sum, r) => sum + (r?.salary || 0), 0);
  const projectedSalary = -totalSalary || 0;

  // Lånerente = sum(amount_remaining × interest_rate). Forudsætter at lånet
  // stadig er aktivt næste sæson — afdrag mellem nu og sæsonstart kan reducere
  // den faktiske rente, så rente-estimatet er konservativt.
  const projectedLoanInterest = -(activeLoans || []).reduce(
    (sum, loan) =>
      sum + Math.round((loan?.amount_remaining || 0) * (loan?.interest_rate || 0)),
    0
  ) || 0;

  // Lejegebyr for lejede ryttere (vi betaler) — kun aftaler der stadig dækker
  // næste sæson. shouldChargeLoanAgreementSeasonFee i loanEngine: charge når
  // seasonNumber > start_season AND seasonNumber <= end_season.
  const nextSeason = Number.isInteger(currentSeasonNumber)
    ? currentSeasonNumber + 1
    : null;
  // Normaliser -0 → 0 så strict-equality-tests og JSON-output forbliver rene.
  const projectedLoanFees = -sumLoanFees(inboundLoanAgreements, nextSeason) || 0;
  const projectedLoanFeesReceived = sumLoanFees(outboundLoanAgreements, nextSeason);

  const projectedNet =
    projectedSponsor +
    projectedPrize +
    projectedSalary +
    projectedLoanInterest +
    projectedLoanFees +
    projectedLoanFeesReceived;

  // ±20% på prize, der er mest variable input. Sponsor/løn/rente er deterministiske
  // i et givent sæson-perspektiv — usikkerheden bor i hvor meget holdet faktisk
  // tjener i præmiepenge.
  const band = Math.round(Math.abs(projectedPrize) * CONFIDENCE_BAND_PCT);
  const confidenceLow = projectedNet - band;
  const confidenceHigh = projectedNet + band;

  const debtRatio = debtCeiling && debtCeiling > 0 ? totalDebt / debtCeiling : 0;
  const trendBreaches2Seasons =
    projectedNet < 0 &&
    debtCeiling !== null &&
    debtCeiling > 0 &&
    totalDebt + Math.abs(projectedNet) * 2 > debtCeiling;

  const riskTier = computeRiskTier({
    projectedNet,
    debtRatio,
    trendBreaches2Seasons,
  });

  const warnings = buildWarnings({
    projectedNet,
    totalDebt,
    debtCeiling,
    debtRatio,
    trendBreaches2Seasons,
    projectedSalary,
    projectedSponsor,
  });

  return {
    projected_sponsor: projectedSponsor,
    projected_prize: projectedPrize,
    projected_salary: projectedSalary,
    projected_loan_interest: projectedLoanInterest,
    projected_loan_fees: projectedLoanFees,
    projected_loan_fees_received: projectedLoanFeesReceived,
    projected_net: projectedNet,
    confidence_low: confidenceLow,
    confidence_high: confidenceHigh,
    risk_tier: riskTier,
    warnings,
    inputs: {
      sponsor_base: sponsorBreakdown.base,
      sponsor_variable: sponsorBreakdown.variable,
      sponsor_mode: sponsorBreakdown.mode,
      sponsor_gross: sponsorBreakdown.gross_sponsor,
      sponsor_breakdown: sponsorBreakdown,
      board_modifier: boardModifier,
      pullout_factor: pulloutFactor,
      total_salary: totalSalary,
      total_debt: totalDebt,
      debt_ceiling: debtCeiling,
      debt_ratio: debtRatio,
      rider_count: (riders || []).length,
      active_loan_count: (activeLoans || []).length,
      inbound_agreement_count: (inboundLoanAgreements || []).length,
      outbound_agreement_count: (outboundLoanAgreements || []).length,
      current_season_number: currentSeasonNumber,
      target_season_number: seasonNumber,
    },
  };
}

function sumLoanFees(agreements, nextSeason) {
  if (!Array.isArray(agreements) || agreements.length === 0) return 0;
  return agreements.reduce((sum, agr) => {
    const fee = agr?.loan_fee || 0;
    if (fee <= 0) return sum;
    if (agr?.status && agr.status !== "active") return sum;
    if (nextSeason !== null) {
      const start = agr?.start_season;
      const end = agr?.end_season;
      // Charge sker når seasonNumber > start_season AND seasonNumber <= end_season.
      // Replikerer shouldChargeLoanAgreementSeasonFee i loanEngine.js.
      if (Number.isInteger(start) && nextSeason <= start) return sum;
      if (Number.isInteger(end) && nextSeason > end) return sum;
    }
    return sum + fee;
  }, 0);
}

function computeRiskTier({ projectedNet, debtRatio, trendBreaches2Seasons }) {
  // Rød: net < -50K ELLER debt > 80% af ceiling ELLER trend rammer ceiling
  // inden for 2 sæsoner.
  if (
    projectedNet < RISK_NET_RED_THRESHOLD ||
    debtRatio > RISK_DEBT_YELLOW_RATIO ||
    trendBreaches2Seasons
  ) {
    return "red";
  }
  // Gul: net ∈ [-50K, 50K] ELLER debt ∈ [50%, 80%] af ceiling.
  if (
    projectedNet < RISK_NET_GREEN_THRESHOLD ||
    debtRatio >= RISK_DEBT_GREEN_RATIO
  ) {
    return "yellow";
  }
  // Grøn: net ≥ 50K AND debt < 50% af ceiling.
  return "green";
}

function buildWarnings({
  projectedNet,
  totalDebt,
  debtCeiling,
  debtRatio,
  trendBreaches2Seasons,
  projectedSalary,
  projectedSponsor,
}) {
  const warnings = [];
  if (projectedNet < 0) {
    warnings.push({
      severity: "high",
      code: "negative_net",
      message: `Forventet underskud: ${formatSigned(projectedNet)} CZ$ næste sæson — sælg en rytter, reducér aktive lån eller forhandl bedre sponsor.`,
    });
  }
  if (debtCeiling && debtCeiling > 0) {
    if (debtRatio > RISK_DEBT_YELLOW_RATIO) {
      warnings.push({
        severity: "high",
        code: "debt_near_ceiling",
        message: `Gæld er ${Math.round(debtRatio * 100)}% af loftet (${totalDebt.toLocaleString("da-DK")} / ${debtCeiling.toLocaleString("da-DK")} CZ$) — bestyrelsen er bekymret.`,
      });
    } else if (debtRatio >= RISK_DEBT_GREEN_RATIO) {
      warnings.push({
        severity: "med",
        code: "debt_growing",
        message: `Gæld er ${Math.round(debtRatio * 100)}% af loftet — hold øje med rente-byrden.`,
      });
    }
  }
  if (trendBreaches2Seasons) {
    warnings.push({
      severity: "high",
      code: "debt_trend",
      message:
        "Med det nuværende underskud rammer du gældsloftet inden for 2 sæsoner — handl nu.",
    });
  }
  // Lønbyrde > sponsor er et klassisk varselstegn — manageren tjener mindre på
  // rolig drift end løn koster, så al likviditet skal komme fra præmier eller salg.
  if (Math.abs(projectedSalary) > projectedSponsor && projectedSponsor > 0) {
    warnings.push({
      severity: "med",
      code: "salary_exceeds_sponsor",
      message: `Løn (${Math.abs(projectedSalary).toLocaleString("da-DK")} CZ$) overstiger sponsor (${projectedSponsor.toLocaleString("da-DK")} CZ$) — rolig drift dækker ikke længere lønnen.`,
    });
  }
  return warnings;
}

function formatSigned(value) {
  return (value >= 0 ? "+" : "") + value.toLocaleString("da-DK");
}

export const FORECAST_THRESHOLDS = Object.freeze({
  RISK_NET_GREEN_THRESHOLD,
  RISK_NET_RED_THRESHOLD,
  RISK_DEBT_GREEN_RATIO,
  RISK_DEBT_YELLOW_RATIO,
  CONFIDENCE_BAND_PCT,
});

/**
 * Multi-sæson forecast (2026-05-21). Iterativ rolling-forward fra nuværende
 * state. Sæson +1 er præcis (faktisk roster + standings); sæson +2 til +N er
 * estimater baseret på "intet ændrer sig"-antagelse:
 *   - Roster = uændret (vi ved ikke fremtidige transfers)
 *   - Sponsor = variabel-formel hvis sæson ≥ 2 (med forrige standings); ellers intro 240K
 *   - Salary = sum(riders.salary) — uændret (rytter-værdier justeres dog
 *     i live ved updateRiderValues, men det modellerer vi ikke her)
 *   - Loan-interest = decay: amount_remaining × 0.75 per sæson som proxy for
 *     gradvis afdrag (manager kan også optage nye lån — ikke modelleret)
 *   - Loan-agreements = match start_season ≤ N ≤ end_season per aftale
 *   - Lejegebyrer ind/ud = uændret hvis aftalen stadig dækker N
 *   - Balance ruller frem: balance_{N+1} = balance_N + projected_net_N
 *
 * Sæson 0 (open-beta): forecast giver kun mening fra sæson 1+. Hvis target
 * er sæson 0 returneres tomt array.
 *
 * @param {object} args
 * @param {number} [args.seasonsAhead=1] — 1-5, clamped.
 */
const MAX_SEASONS_AHEAD = 5;
const LOAN_DECAY_FACTOR = 0.75; // proxy for gradvis afdrag

export function computeMultiSeasonForecast({
  team = {},
  boardModifier = 1.0,
  pulloutFactor = 1.0,
  riders = [],
  activeLoans = [],
  inboundLoanAgreements = [],
  outboundLoanAgreements = [],
  totalDebt = 0,
  debtCeiling = null,
  currentSeasonNumber = null,
  lastSeasonStanding = null,
  lastSeasonStandings = [],
  seasonsAhead = 1,
} = {}) {
  const clamped = Math.max(1, Math.min(MAX_SEASONS_AHEAD, Math.round(Number(seasonsAhead) || 1)));
  const forecasts = [];

  let rollingBalance = team?.balance ?? 0;
  let rollingActiveLoans = (activeLoans || []).map((loan) => ({ ...loan }));
  let rollingLastStanding = lastSeasonStanding;
  let rollingLastStandings = lastSeasonStandings;

  for (let i = 0; i < clamped; i++) {
    const targetSeasonNumber = (Number.isInteger(currentSeasonNumber) ? currentSeasonNumber : 0) + 1 + i;
    const isPrecise = i === 0;

    const rollingTotalDebt = rollingActiveLoans.reduce(
      (sum, loan) => sum + (loan?.amount_remaining || 0),
      0
    );

    const forecast = computeFinanceForecast({
      team: { ...team, balance: rollingBalance },
      boardModifier,
      pulloutFactor,
      riders,
      activeLoans: rollingActiveLoans,
      inboundLoanAgreements,
      outboundLoanAgreements,
      totalDebt: rollingTotalDebt,
      debtCeiling,
      currentSeasonNumber: targetSeasonNumber - 1,
      targetSeasonNumber,
      lastSeasonStanding: rollingLastStanding,
      lastSeasonStandings: rollingLastStandings,
    });

    const endingBalance = rollingBalance + forecast.projected_net;

    forecasts.push({
      ...forecast,
      season_number: targetSeasonNumber,
      is_estimate: !isPrecise,
      estimate_basis: isPrecise ? "actual_state" : "rolling_status_quo",
      starting_balance: rollingBalance,
      ending_balance: endingBalance,
    });

    // Roll state forward for næste iteration
    rollingBalance = endingBalance;
    rollingActiveLoans = rollingActiveLoans
      .map((loan) => ({
        ...loan,
        amount_remaining: Math.max(0, Math.round((loan.amount_remaining || 0) * LOAN_DECAY_FACTOR)),
      }))
      .filter((loan) => loan.amount_remaining > 0);
    // Sæson +1's "rank" som proxy for sæson +2's lastSeasonStanding kender
    // vi ikke uden simulation; behold rollingLastStanding uændret (= "samme
    // placering som hidtil"). Hvis vi senere vil have bedre estimat, kan vi
    // bruge median/p50 fra forrige standings — men "status quo" er ærlig.
  }

  const totalNet = forecasts.reduce((sum, f) => sum + f.projected_net, 0);
  const startingBalance = team?.balance ?? 0;
  const endingBalance = forecasts.length > 0
    ? forecasts[forecasts.length - 1].ending_balance
    : startingBalance;
  const tierOrder = { green: 0, yellow: 1, red: 2 };
  const worstRiskTier = forecasts.reduce(
    (worst, f) => (tierOrder[f.risk_tier] > tierOrder[worst] ? f.risk_tier : worst),
    "green"
  );
  const allWarnings = forecasts.flatMap((f, idx) =>
    (f.warnings || []).map((w) => ({ ...w, season_number: f.season_number, is_estimate: idx > 0 }))
  );

  return {
    forecasts,
    summary: {
      seasons_ahead: clamped,
      starting_balance: startingBalance,
      ending_balance: endingBalance,
      total_net: totalNet,
      worst_risk_tier: worstRiskTier,
      from_season: Number.isInteger(currentSeasonNumber) ? currentSeasonNumber + 1 : null,
      to_season: Number.isInteger(currentSeasonNumber) ? currentSeasonNumber + clamped : null,
    },
    warnings_all: allWarnings,
  };
}
