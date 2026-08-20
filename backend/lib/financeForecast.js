/**
 * Slice 07g · Manager finance-forecast + risk-tier
 *
 * Pure function der projicerer næste sæsons cashflow for ét hold:
 *   indtægter (sponsor + præmie)
 *   − udgifter (løn + rente + upkeep + facilitets-upkeep + staff-løn + akademi-drift)
 * Returnerer 🟢/🟡/🔴 risk-tier + warnings.
 *
 * #3236 (økonomi-audit #3198, fund #1): forecastet medregnede tidligere KUN
 * sponsor+præmie−løn−lånerente. Upkeep, facilitets-/stab-udgifter og akademi-
 * drift er alle division-/roster-skalerede og kendte på forecast-tidspunktet,
 * ligesom løn — derfor tilføjet som deterministiske udgifter her, ikke som
 * estimater. Formlerne spejler economyEngine.processTeamSeasonPayroll (upkeep,
 * academy_drift) og economyEngine.chargeFacilityCosts (facility_upkeep,
 * staff_salary) 1:1, så forecast og faktisk sæson-start-opkrævning stemmer
 * overens. `sponsor_race_day` (den løbende variable sponsor-pulje) er BEVIDST
 * ikke modelleret her — den er resultatafhængig og kan ikke forudsiges
 * deterministisk (se audit-rapportens afsnit 3).
 *
 * Inputs er rå tal/arrays — alle DB-queries lever i route-handler. Det holder
 * funktionen testbar uden Supabase-mock og giver os deterministiske unit-tests.
 */

import {
  buildSponsorStandingsContext,
  computeSponsorForSeason,
} from "./sponsorEngine.js";
import { UPKEEP_BY_DIVISION, UPKEEP_BEFORE_FIRST_RACE_ENABLED } from "./economyConstants.js";
import { getFacilityUpkeepTotal } from "./facilityEngine.js";
import { ACADEMY } from "./academyFlag.js";
// #3989 (ejer-beslutning 20/8): fra sæson 3 genberegnes ALLE lønninger ved
// cutover efter den globale produktions-sats, så prognosen for sæson 3+ skal
// vise dét tal — ikke de frosne sæson-2-kontrakter. Formlen importeres fra
// computeFrozenSalary, som er præcis den funktion spillet selv bruger ved enhver
// signering/genberegning. Prognosen kan dermed ikke drifte fra virkeligheden:
// der er kun ÉN formel. (#3899's midlertidige salaryBasis.js med
// markedsværdi-kurven er slettet sammen med denne ændring.)
import { computeFrozenSalary } from "./contractSeed.js";

const RISK_NET_GREEN_THRESHOLD = 50_000;
const RISK_NET_RED_THRESHOLD = -50_000;
const RISK_DEBT_GREEN_RATIO = 0.5;
const RISK_DEBT_YELLOW_RATIO = 0.8;
// ±20%-fallback: bruges KUN når divisionens præmie-stikprøve er for lille til
// et kvartilbånd (se computePrizeInterval).
const CONFIDENCE_BAND_PCT = 0.2;

// #3899: sæson hvorfra lønprognosen skifter til markedsværdi-kurven ("sæson 3-systemet").
export const NEW_WAGE_SYSTEM_SEASON = 3;

// #3899: mindste antal hold i divisions-stikprøven før kvartilbåndet bruges til
// præmie-intervallet. Under dette er et kvartilbånd støj, ikke et interval.
const MIN_DIVISION_PRIZE_SAMPLE = 4;

// p25/p50/p75 med lineær interpolation (samme metode som langt de fleste
// statistik-biblioteker, "type 7"/Excel-metoden — ingen game-specifik logik).
function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0];
  const rank = p * (sortedAscending.length - 1);
  const lowIndex = Math.floor(rank);
  const highIndex = Math.ceil(rank);
  if (lowIndex === highIndex) return sortedAscending[lowIndex];
  const weight = rank - lowIndex;
  return sortedAscending[lowIndex] * (1 - weight) + sortedAscending[highIndex] * weight;
}

// #3899 punkt 2 (låst design): "INTERVAL for det usikre (præmier, ud fra
// divisionens pulje)". Metode: kvartilbånd (P25-P75) af MÅLT per-hold-præmie
// blandt peers i samme division (divisionPrizeSamples — se route-handler for
// hvordan stikprøven bygges). Båndets BREDDE udtrykkes som andel af divisionens
// median og appliceres derefter RELATIVT på holdets eget punktestimat
// (projectedPrize) — det giver et interval der er centreret på holdets egen
// prognose, men hvis SPREDNING kommer fra faktisk observeret variation i
// divisionen, ikke en vilkårlig ±20%-antagelse.
//
// Fallback til ±20% (CONFIDENCE_BAND_PCT) når stikprøven er for lille
// (< MIN_DIVISION_PRIZE_SAMPLE hold) eller medianen er 0 — begge cases hvor et
// kvartilbånd ville være støj eller udefineret (division by zero).
function computePrizeInterval(projectedPrize, divisionPrizeSamples) {
  const samples = (divisionPrizeSamples || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  if (samples.length < MIN_DIVISION_PRIZE_SAMPLE) {
    const band = Math.round(Math.abs(projectedPrize) * CONFIDENCE_BAND_PCT);
    return {
      low: Math.max(0, projectedPrize - band),
      high: projectedPrize + band,
      method: "flat_pct_fallback",
      sample_size: samples.length,
    };
  }

  const p25 = percentile(samples, 0.25);
  const p50 = percentile(samples, 0.5);
  const p75 = percentile(samples, 0.75);

  if (p50 <= 0) {
    const band = Math.round(Math.abs(projectedPrize) * CONFIDENCE_BAND_PCT);
    return {
      low: Math.max(0, projectedPrize - band),
      high: projectedPrize + band,
      method: "flat_pct_fallback",
      sample_size: samples.length,
    };
  }

  const lowRatio = Math.min(1, Math.max(0, (p50 - p25) / p50));
  const highRatio = Math.max(0, (p75 - p50) / p50);

  return {
    low: Math.max(0, Math.round(projectedPrize * (1 - lowRatio))),
    high: Math.round(projectedPrize * (1 + highRatio)),
    method: "division_quartile_band",
    sample_size: samples.length,
    division_p25: Math.round(p25),
    division_median: Math.round(p50),
    division_p75: Math.round(p75),
  };
}

// #3332 (forward-guard mod tavs udeladelse, mønster fra #1464/#2957): eksplicit
// klassifikation af HVER finance_transactions.type koden rent faktisk skriver —
// enten { modeled: true, field } hvis strømmen indgår deterministisk i
// projected_net (feltet der bærer bidraget), eller { modeled: false, reason }
// hvis den BEVIDST udelades, med en kort begrundelse for hvorfor den ikke kan
// forudsiges. financeForecastTypeCoverage.test.js scanner backend-koden
// (samme extractCodeWrittenTypes som scripts/lint-finance-types.mjs) og fejler
// hvis en ny type dukker op her uklassificeret — det var PRÆCIS sådan
// upkeep/facilitets-/stab-/akademi-strømmene glemte at følge med, da
// economyEngine fik dem tilføjet over tid (postmortem
// .claude/learnings/2026-08-03-forecast-missing-expense-side.md, fixet #3236/
// #3251). Kanonisk kilde for hele type-universet: audit
// docs/audits/2026-08-03-economy-audit-3198.md afsnit 1 (29 mulige typer, 20
// observeret live 4/8 via read-only SELECT mod ghwvkxzhsbbltzfnuhhz).
//
// #2957-blind-spot (dokumenteret i scripts/lint-finance-types.mjs): 'loan_repayment'
// skrives kun via SQL-RPC'en repay_loan_atomic og fanges IKKE af den JS-kilde-
// scanner testen genbruger — testen tilføjer den manuelt til det scannede sæt.
// Reason-strings er bevidst ENGELSKE (ikke det sædvanlige danske kode-kommentar-
// sprog i denne fil) — #666/i18n-leak-guarden flagger danske string-literaler på
// linjer med `reason`-kontekst i backend/lib som en potentiel API-response-leak
// (#1053-mønstret). Disse er rene interne test-/dokumentationsdata (aldrig en del
// af computeFinanceForecast()'s return-værdi), men engelsk fjerner enhver tvivl.
export const FINANCE_FORECAST_TYPE_COVERAGE = Object.freeze({
  // ── Modelled: folds deterministically into projected_net ────────────────
  sponsor: { modeled: true, field: "projected_sponsor" },
  prize: { modeled: true, field: "projected_prize" },
  salary: { modeled: true, field: "projected_salary" },
  upkeep: { modeled: true, field: "projected_upkeep" },
  facility_upkeep: { modeled: true, field: "projected_facility_upkeep" },
  staff_salary: { modeled: true, field: "projected_staff_salary" },
  academy_drift: { modeled: true, field: "projected_academy_drift" },

  // ── Deliberately excluded: result-/event-dependent, not forecastable ────
  sponsor_race_day: { modeled: false, reason: "ongoing variable sponsor pool — result-dependent (race days not yet raced)" },
  sponsor_result_bonus: { modeled: false, reason: "sponsor bonus clause — result-dependent" },
  sponsor_objective_bonus: { modeled: false, reason: "sponsor bonus clause — season-objective-dependent" },
  sponsor_signing_bonus: { modeled: false, reason: "one-off bonus on signing a new sponsor contract — unknown until the contract is signed" },
  parachute: { modeled: false, reason: "relegation parachute — depends on the current season's not-yet-known final standing" },
  forced_debt_sale: { modeled: false, reason: "forced sale from a debt-ceiling breach — a risk symptom, not a normal cost (covered by risk-tier/warnings instead)" },
  interest: { modeled: false, reason: "negative-balance safety-net interest — contingent on the balance going negative after payroll, not a normal predictable line" },
  squad_violation_fine: { modeled: false, reason: "fine for a squad-size rule violation — avoidable, not a normal operating cost" },

  // ── Deliberately excluded: a future manager decision, not yet known ─────
  transfer_in: { modeled: false, reason: "future rider purchase — unknown until the manager chooses it" },
  transfer_out: { modeled: false, reason: "future rider sale — unknown until the manager chooses it" },
  academy_signing: { modeled: false, reason: "future academy signing — unknown until the manager chooses it" },
  facility_purchase: { modeled: false, reason: "future facility investment — unknown until the manager chooses it" },
  staff_severance: { modeled: false, reason: "future staff termination — unknown until the manager chooses it" },
  scout_travel: { modeled: false, reason: "manager-initiated scout mission — discretionary, unknown count/timing" },
  bonus: { modeled: false, reason: "board bonus offer — discretionary acceptance, unknown timing/amount" },
  loan_received: { modeled: false, reason: "future new loan — unknown until the manager takes it out" },
  loan_repayment: { modeled: false, reason: "voluntary extra principal repayment — interest is already modelled separately (projected_loan_interest); the repayment itself is a discretionary manager decision" },
  emergency_loan: { modeled: false, reason: "emergency-loan rescue — contingent on insolvency, ideally never triggered" },
  admin_adjustment: { modeled: false, reason: "manual admin correction — no game-mechanical pattern to forecast" },
  auto_squad_purchase: { modeled: false, reason: "automatic squad top-up — contingent on a future squad shortfall" },
  auto_squad_sale: { modeled: false, reason: "automatic squad trim — contingent on a future squad surplus" },
});

export function computeFinanceForecast({
  team = {},
  boardModifier = 1.0,
  pulloutFactor = 1.0,
  riders = [],
  activeLoans = [],
  totalDebt = 0,
  debtCeiling = null,
  currentSeasonNumber = null,
  targetSeasonNumber = null,
  lastSeasonStanding = null,
  lastSeasonStandings = [],
  realizedSeasonPrize = 0,
  activeContract = null,
  pendingContract = null,
  // #3236: næste sæsons kendte drift-udgifter — samme kilde-til-sandhed som
  // economyEngine's sæson-start-opkrævning. Tomme defaults ⇒ 0-bidrag, så
  // hold uden faciliteter/staff/akademi ikke ser en falsk udgift.
  facilityTracks = [],
  activeStaffSalaries = [],
  academyRiderCount = 0,
  facilitiesEnabled = true,
  // #3899: MÅLT per-hold-præmie blandt peers i samme division (indeværende/
  // seneste afsluttede sæson) — grundlaget for præmie-intervallets kvartilbånd.
  // Tom default ⇒ ±20%-fallback (computePrizeInterval), så hold uden nok peers
  // (fx en helt ny/lille division) stadig får et interval, bare et bredere et.
  divisionPrizeSamples = [],
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
  // #2948 (rodårsag bag ~20 mio.-afvigelsen i #2926): prognosen skal bruge samme
  // kontrakt-gren som den faktiske udbetaling. For target-sæsonen gælder: et
  // pending valg der starter dér vinder; ellers en aktiv kontrakt der stadig er
  // låst i target-sæsonen; ellers falder computeSponsorForSeason tilbage til
  // intro/variable som før.
  const contractForSeason =
    pendingContract && pendingContract.start_season === seasonNumber
      ? pendingContract
      : activeContract && activeContract.expires_after_season >= seasonNumber
        ? activeContract
        : null;
  const sponsorBreakdown = computeSponsorForSeason({
    seasonNumber,
    team,
    lastSeasonStanding: resolvedLastStanding,
    divisionStandings,
    activeContract: contractForSeason,
  });
  const projectedSponsor = Math.round(sponsorBreakdown.gross_sponsor * boardModifier * pulloutFactor);
  // #3899 (låst design punkt 1): "sponsor base" og "sponsor variabel/løbsdag"
  // vises som to linjer i stedet for én. Base beregnes uafhængigt (samme
  // board/pullout-justering); variabel er RESIDUALET af projectedSponsor minus
  // den justerede base — det garanterer at de to linjer summer PRÆCIST til
  // projected_sponsor uden selvstændig afrundingsdrift.
  const projectedSponsorBase = Math.round(sponsorBreakdown.base * boardModifier * pulloutFactor);
  const projectedSponsorVariable = projectedSponsor - projectedSponsorBase;

  // Præmie-estimat = sum af riders.prize_earnings_bonus, som DB allerede beregner
  // som rolling avg over sidste 1-3 afsluttede sæsoner. Roster'ets "track record"
  // er den mest robuste prognose vi har for næste sæson.
  //
  // #981: realiseret præmie+bonus i indeværende sæson er gulv for estimatet.
  // Rolling avg halter efter et roster i fremgang, og en prognose der viser
  // MINDRE end hvad samme roster allerede har tjent i år, er misvisende.
  // Friskeste evidens for roster'ets indtjeningsevne vinder.
  const rollingPrize = (riders || []).reduce(
    (sum, r) => sum + (r?.prize_earnings_bonus || 0),
    0
  );
  const realizedPrize = Math.max(0, Math.round(Number(realizedSeasonPrize) || 0));
  const projectedPrize = Math.max(rollingPrize, realizedPrize);

  // #3989 (ejer-beslutning 20/8): fra sæson 3 og frem prissættes lønnen efter
  // rytterens NUVÆRENDE leverance (current_production_value × den globale sats)
  // — UANSET hvad riders.salary står på lige nu, fordi hele populationen
  // genberegnes ved cutover. For sæson < 3 er status quo korrekt: kontrakterne
  // er frosne ved signering (#1309), så sum(rider.salary) ER det der trækkes.
  //
  // Bemærk at prognosen bevidst BRUGER spillets egen computeFrozenSalary frem
  // for en lokal kopi af formlen. #3899's forrige forsøg havde sin egen
  // markedsværdi-kurve i et separat modul, og resultatet var en prognose der
  // viste 3-5x for høje lønninger uden at nogen formel var "forkert" (#3986).
  const usesNewWageSystem = Number.isInteger(seasonNumber) && seasonNumber >= NEW_WAGE_SYSTEM_SEASON;
  const totalSalary = usesNewWageSystem
    ? (riders || []).reduce(
        (sum, r) => sum + computeFrozenSalary({ current_production_value: r?.current_production_value }),
        0
      )
    : (riders || []).reduce((sum, r) => sum + (r?.salary || 0), 0);
  const projectedSalary = -totalSalary || 0;

  // Lånerente = sum(amount_remaining × interest_rate). Forudsætter at lånet
  // stadig er aktivt næste sæson — afdrag mellem nu og sæsonstart kan reducere
  // den faktiske rente, så rente-estimatet er konservativt.
  const projectedLoanInterest = -(activeLoans || []).reduce(
    (sum, loan) =>
      sum + Math.round((loan?.amount_remaining || 0) * (loan?.interest_rate || 0)),
    0
  ) || 0;

  // #3236 · Upkeep — flad pr. division (economyEngine.processTeamSeasonPayroll).
  // #1678: udskudt i sæson 1 (før første løb) medmindre flaget slås til —
  // forecastet skal ramme samme 0 som den faktiske sæson-1-opkrævning.
  const upkeepDeferred = !UPKEEP_BEFORE_FIRST_RACE_ENABLED && seasonNumber === 1;
  const upkeepForDivision = UPKEEP_BY_DIVISION[team?.division] || 0;
  const projectedUpkeep = upkeepDeferred ? 0 : (-upkeepForDivision || 0);

  // #3236 · Facilitets-upkeep + staff-sæsonløn — samme runtime-gate
  // (facilitiesEnabled, app_config "facilities_enabled") som
  // economyEngine.chargeFacilityCosts. Caller læser flaget; default true her
  // så unit-tests uden eksplicit flag ikke bliver stille nul-gated.
  const facilityUpkeepTotal = facilitiesEnabled
    ? getFacilityUpkeepTotal(facilityTracks)
    : 0;
  const projectedFacilityUpkeep = -facilityUpkeepTotal || 0;

  const staffSalaryTotal = facilitiesEnabled
    ? (activeStaffSalaries || []).reduce((sum, s) => sum + (s?.salary || 0), 0)
    : 0;
  const projectedStaffSalary = -staffSalaryTotal || 0;

  // #3236 · Akademi-drift — pr. plads, gated på count > 0 (economyEngine
  // springer helt over ved 0 akademi-ryttere, uanset flag).
  const academyCount = Math.max(0, Math.round(Number(academyRiderCount) || 0));
  const projectedAcademyDrift = academyCount > 0
    ? -(academyCount * ACADEMY.DRIFT_PER_SEASON)
    : 0;

  // #3986: divisions-upkeep er IKKE en stabs- eller facilitetsudgift, og den
  // hørte aldrig hjemme i den linje. En D2-manager med tre ansatte så 164.910
  // hvor hans egen hovedregning gav 24.610 — differencen var præcis
  // UPKEEP_BY_DIVISION[2] = 140.000, gemt inde i en linje der hed noget andet.
  // Upkeep har nu sin egen række; denne aggregerer kun de to strømme manageren
  // rent faktisk har købt eller ansat sig til.
  const projectedStaffFacilities = projectedFacilityUpkeep + projectedStaffSalary;

  const projectedNet =
    projectedSponsor +
    projectedPrize +
    projectedSalary +
    projectedLoanInterest +
    projectedUpkeep +
    projectedFacilityUpkeep +
    projectedStaffSalary +
    projectedAcademyDrift;

  // #3899 (låst design punkt 2): usikkerheden i nettoet kommer UDELUKKENDE fra
  // præmie-linjen (sponsor/løn/upkeep er deterministiske i et givent sæson-
  // perspektiv). confidence_low/high er derfor net ± præcis den samme spredning
  // som prize_low/prize_high — ét sammenhængende interval, ikke to uafhængige.
  const prizeInterval = computePrizeInterval(projectedPrize, divisionPrizeSamples);
  const confidenceLow = projectedNet - (projectedPrize - prizeInterval.low);
  const confidenceHigh = projectedNet + (prizeInterval.high - projectedPrize);

  const debtRatio = debtCeiling && debtCeiling > 0 ? totalDebt / debtCeiling : 0;

  // #982: risk-tier skal se på realiseret state (balance), ikke kun projicerede
  // flows. Et solvent hold med stor kassebeholdning er ikke konkurs-truet af et
  // sæson-underskud det nemt kan absorbere — underskud æder positiv balance FØR
  // det bliver til ny gæld.
  const startingBalance = Number.isFinite(team?.balance) ? team.balance : 0;
  const projectedEndingBalance = startingBalance + projectedNet;
  const deficitAfterBalance2Seasons = Math.max(
    0,
    Math.abs(projectedNet) * 2 - Math.max(0, startingBalance)
  );
  const trendBreaches2Seasons =
    projectedNet < 0 &&
    debtCeiling !== null &&
    debtCeiling > 0 &&
    totalDebt + deficitAfterBalance2Seasons > debtCeiling;

  const riskTier = computeRiskTier({
    projectedNet,
    projectedEndingBalance,
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
    // #3899: sponsor-linjen opsplittet i base (kontraktligt/division-fladt) og
    // variabel (rang/point-baseret) — sum == projected_sponsor.
    projected_sponsor_base: projectedSponsorBase,
    projected_sponsor_variable: projectedSponsorVariable,
    projected_prize: projectedPrize,
    // #3899: interval i stedet for punktestimat — se computePrizeInterval.
    prize_low: prizeInterval.low,
    prize_high: prizeInterval.high,
    projected_salary: projectedSalary,
    projected_loan_interest: projectedLoanInterest,
    // #3236: de 4 tidligere fraværende udgiftsstrømme (audit #3198, fund #1).
    projected_upkeep: projectedUpkeep,
    projected_facility_upkeep: projectedFacilityUpkeep,
    projected_staff_salary: projectedStaffSalary,
    // #3986: UI-aggregatet af facilitets-upkeep + stabsløn. Divisions-upkeep
    // ligger i projected_upkeep og vises som sin egen række.
    projected_staff_facilities: projectedStaffFacilities,
    projected_academy_drift: projectedAcademyDrift,
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
      // #981/#982: transparens om realiseret state der indgår i prognosen.
      prize_rolling_avg: rollingPrize,
      realized_season_prize: realizedPrize,
      prize_basis: realizedPrize > rollingPrize ? "realized_season_floor" : "rolling_avg",
      // #3899: transparens om intervallets metode + division-stikprøve.
      prize_interval_method: prizeInterval.method,
      prize_interval_sample_size: prizeInterval.sample_size,
      team_balance: startingBalance,
      total_salary: totalSalary,
      // #3899: hvilket lønsystem der faktisk blev brugt til denne sæson-projektion.
      salary_basis: usesNewWageSystem ? "production_s3" : "status_quo",
      total_debt: totalDebt,
      debt_ceiling: debtCeiling,
      debt_ratio: debtRatio,
      rider_count: (riders || []).length,
      active_loan_count: (activeLoans || []).length,
      current_season_number: currentSeasonNumber,
      target_season_number: seasonNumber,
      // #3236: transparens om de nye udgiftsstrømmes inputs.
      upkeep_deferred: upkeepDeferred,
      division_upkeep: upkeepForDivision,
      facilities_enabled: facilitiesEnabled,
      facility_track_count: (facilityTracks || []).length,
      facility_upkeep_total: facilityUpkeepTotal,
      active_staff_count: (activeStaffSalaries || []).length,
      staff_salary_total: staffSalaryTotal,
      academy_rider_count: academyCount,
      academy_drift_per_slot: ACADEMY.DRIFT_PER_SEASON,
    },
  };
}

function computeRiskTier({
  projectedNet,
  projectedEndingBalance,
  debtRatio,
  trendBreaches2Seasons,
}) {
  // Rød: (net < -50K OG projiceret slutbalance < 0) ELLER debt > 80% af ceiling
  // ELLER trend rammer ceiling inden for 2 sæsoner.
  //
  // #982: net-triggeren kræver nu at underskuddet faktisk gør holdet insolvent
  // (slutbalance < 0). Et hold med stor kassebeholdning og et absorberbart
  // underskud lander i gul (net < 50K-reglen nedenfor), ikke rød "konkurs-risiko".
  if (
    (projectedNet < RISK_NET_RED_THRESHOLD && projectedEndingBalance < 0) ||
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

// #666: warnings emitter { code, messageKey, params } i stedet for færdig-
// formaterede DA-strings. Frontend renderer via i18next-namespace
// `backendMessages` med locale-aware tal-formattering. Legacy `code`-felt
// beholdes uændret for snapshot-tests + backwards-compat.
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
      messageKey: "forecast.warning.negativeNet",
      // value er altid negativ her — formatNumber() rammer minus-prefix natively.
      params: { value: projectedNet },
    });
  }
  if (debtCeiling && debtCeiling > 0) {
    if (debtRatio > RISK_DEBT_YELLOW_RATIO) {
      warnings.push({
        severity: "high",
        code: "debt_near_ceiling",
        messageKey: "forecast.warning.debtNearCeiling",
        params: {
          ratio: Math.round(debtRatio * 100),
          totalDebt,
          ceiling: debtCeiling,
        },
      });
    } else if (debtRatio >= RISK_DEBT_GREEN_RATIO) {
      warnings.push({
        severity: "med",
        code: "debt_growing",
        messageKey: "forecast.warning.debtGrowing",
        params: { ratio: Math.round(debtRatio * 100) },
      });
    }
  }
  if (trendBreaches2Seasons) {
    warnings.push({
      severity: "high",
      code: "debt_trend",
      messageKey: "forecast.warning.debtTrend",
      params: {},
    });
  }
  // Lønbyrde > sponsor er et klassisk varselstegn — manageren tjener mindre på
  // rolig drift end løn koster, så al likviditet skal komme fra præmier eller salg.
  if (Math.abs(projectedSalary) > projectedSponsor && projectedSponsor > 0) {
    warnings.push({
      severity: "med",
      code: "salary_exceeds_sponsor",
      messageKey: "forecast.warning.salaryExceedsSponsor",
      params: {
        salary: Math.abs(projectedSalary),
        sponsor: projectedSponsor,
      },
    });
  }
  return warnings;
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
 *   - Balance ruller frem: balance_{N+1} = balance_N + projected_net_N
 *   - #3236: facilities/staff/akademi = uændret (samme "intet ændrer sig"-
 *     status-quo-antagelse som roster/salary — vi kender ikke fremtidige
 *     facility-opgraderinger/ansættelser/akademi-optag)
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
  debtCeiling = null,
  currentSeasonNumber = null,
  lastSeasonStanding = null,
  lastSeasonStandings = [],
  realizedSeasonPrize = 0,
  seasonsAhead = 1,
  activeContract = null,
  pendingContract = null,
  // #3236: status-quo over hele horisonten, ligesom roster/salary.
  facilityTracks = [],
  activeStaffSalaries = [],
  academyRiderCount = 0,
  facilitiesEnabled = true,
  // #3899: status-quo over hele horisonten, ligesom roster/facilities —
  // samme division-stikprøve genbruges for hver fremskrevet sæson.
  divisionPrizeSamples = [],
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
      totalDebt: rollingTotalDebt,
      debtCeiling,
      currentSeasonNumber: targetSeasonNumber - 1,
      targetSeasonNumber,
      lastSeasonStanding: rollingLastStanding,
      lastSeasonStandings: rollingLastStandings,
      // #981: gulvet gælder alle sæsoner — status-quo-antagelsen er at samme
      // roster bevarer den indtjeningsevne den allerede har bevist i år.
      realizedSeasonPrize,
      activeContract,
      pendingContract,
      // #3236: uændret over hele horisonten (status-quo).
      facilityTracks,
      activeStaffSalaries,
      academyRiderCount,
      facilitiesEnabled,
      divisionPrizeSamples,
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
