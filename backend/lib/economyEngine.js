/**
 * Cycling Zone Manager — Economy Engine
 * =====================================
 * Handles all financial processing:
 *   - Season start: pay out sponsor income
 *   - Season end: deduct salaries, charge interest on debt,
 *                 evaluate board satisfaction, update divisions
 *   - Prize money distribution (called after race import)
 *   - Board satisfaction recalculation
 *   - Multi-year plan lifecycle (1yr/3yr/5yr)
 */

import {
  processLoanAgreementSeasonFees,
  processLoanInterest,
  createEmergencyLoan,
  getTotalDebt,
} from "./loanEngine.js";
import {
  BOARD_IDENTITY_RIDER_SELECT,
  computeU25StatSum,
  createInitialBoardProfile,
  evaluateBoardSeason,
  getPlanDuration,
  loadGoalContextForBoard,
  startSequentialNegotiation,
} from "./boardEngine.js";
import { processReplacementTrigger } from "./boardMembers.js";
import {
  evaluateAndApplyConsequences,
} from "./boardConsequences.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";
import { isBoardTestModeActive } from "./boardTestMode.js";
import { developRidersForSeason } from "./riderProgressionEngine.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { U25_ABILITY_KEYS } from "./boardGoals.js";
import {
  DEBT_CEILING_BY_DIVISION,
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
  FIRST_PROMOTION_RELEGATION_SEASON,
  MAX_BOARD_MODIFIER,
  MAX_DIVISION,
  MIN_DIVISION,
  INITIAL_BALANCE,
  NEGATIVE_BALANCE_INTEREST_RATE,
  POOL_TARGET_SIZE,
  SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL,
  SEASON_RIDER_PROGRESSION_ENABLED,
  SEASON_VALUE_RECALC_ENABLED,
  SPONSOR_INCOME_BASE,
  UPKEEP_BEFORE_FIRST_RACE_ENABLED,
  UPKEEP_BY_DIVISION,
} from "./economyConstants.js";
import { reconcileAiTeamsForPool } from "./aiTeamGenerator.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { closeTransferListingsForRiders } from "./marketUtils.js";
import { ACADEMY } from "./academyFlag.js";
import {
  buildSponsorStandingsContext,
  computeSponsorForSeason,
  FIRST_VARIABLE_SPONSOR_SEASON,
} from "./sponsorEngine.js";
import { getActiveContract } from "./sponsorContractsService.js";

let defaultSupabaseClientPromise;

async function getDefaultSupabaseClient() {
  if (!defaultSupabaseClientPromise) {
    defaultSupabaseClientPromise = import("@supabase/supabase-js").then(({ createClient }) => (
      createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    ));
  }

  return defaultSupabaseClientPromise;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Løn er FROSSEN ved signering (#1309: salary er en plain INTEGER, ikke længere
// GENERATED). Raten lever i economyConstants.SALARY_RATE (E2: 0.067) og bruges af
// contractSeed/marketUtils — IKKE her. Sæson-slut læser den stored rider.salary.
// #1152 binær-træ-model (ejer 2026-06-23): per pulje rykker top 2 OP til forælder-
// puljen, og bund 4 NED delt 2+2 ud i de to børne-puljer. 2 søsterpuljer × 2 op = 4
// op samlet i forælderen = 4 ned fra forælderen → balancerer eksakt. Kun ægte hold
// flyttes (AI er fyld der regenereres pr. pulje af reconcileAiTeamsForPool).
const PROMOTION_SLOTS = 2;         // Top 2 op til forælder-pulje
const RELEGATION_SLOTS = 4;        // Bund 4 ned, delt 2+2 til de to børne-puljer
// MIN_DIVISION / MAX_DIVISION lever nu i economyConstants.js (#962) — delt med
// fyld-fra-toppen i teamProfileEngine, så bounds ikke duplikeres.
const SUPABASE_PAGE_SIZE = 1000;
const RIDER_VALUE_PATCH_CONCURRENCY = 25;

// Backward-compat alias for SPONSOR_INCOME_BASE — fjernes i 07b.
// Importeres af betaResetService, boardAutoAccept og api.js.
export const DEFAULT_SPONSOR_INCOME = SPONSOR_INCOME_BASE;

const DIVISION_BONUSES = {
  1: [300_000, 200_000, 100_000, 50_000],
  2: [150_000, 100_000, 50_000, 25_000],
  3: [75_000, 50_000, 25_000],
  // #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21): tier 4 = bunden,
  // lavest sæson-slut-bonus pr. pulje-placering. Uden denne række ville div-4-hold få
  // tavst undefined → continue i payDivisionBonuses (samme tavse hul som [1,2,3]-loopet).
  4: [50_000, 25_000, 10_000],
};

function throwIfSupabaseError(error, message) {
  if (error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

export async function loadHumanSeasonEndTeams(supabaseClient) {
  const { data: teams, error: teamsError } = await supabaseClient
    .from("teams")
    .select("*")
    // #1077 · ekskludér bank-pseudo-holdet (is_ai:false, is_bank:true) fra
    // økonomi-processering — samme diskriminator som cron.js:89 og /deadline-day.
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);
  throwIfSupabaseError(teamsError, "Could not load human teams for season end");

  const teamIds = (teams || []).map(team => team.id).filter(Boolean);
  if (teamIds.length === 0) return [];

  const [ridersRes, boardsRes] = await Promise.all([
    supabaseClient
      .from("riders")
      // #1137 · join abilities så u25_development_delta måles på det motoren udvikler.
      .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}, rider_derived_abilities(${U25_ABILITY_KEYS.join(", ")})`)
      .in("team_id", teamIds),
    supabaseClient
      .from("board_profiles")
      .select("*")
      .in("team_id", teamIds),
  ]);
  throwIfSupabaseError(ridersRes.error, "Could not load riders for season end");
  throwIfSupabaseError(boardsRes.error, "Could not load board profiles for season end");

  const ridersByTeam = new Map();
  for (const rider of ridersRes.data || []) {
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const boardsByTeam = new Map();
  for (const board of boardsRes.data || []) {
    if (!board.team_id) continue;
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }

  return (teams || []).map(team => ({
    ...team,
    riders: ridersByTeam.get(team.id) || [],
    board_profiles: boardsByTeam.get(team.id) || [],
  }));
}

// ─── Season Start Processing ──────────────────────────────────────────────────

/**
 * Process season start for all active teams.
 *
 * INVARIANT (v3.78, 2026-05-21): Sponsor krediteres til ALLE hold i pass A
 * FØR runSeasonPayroll (pass B) starter. Det betyder freshTeam.balance i
 * payroll allerede inkluderer sponsor — emergency-lån udløses kun hvis
 * sponsor + start_balance < salary + renter.
 *
 * Rækkefølge per sæson-start:
 *   PASS A (loop over alle hold):
 *     1. Sponsor +  (board-modifier × pullout-faktor × intro/variabel-base)
 *     2. Loan-agreement-fees − (løbende rytter-lån)
 *     3. Ensure board-profiles (1yr/3yr/5yr) eksisterer
 *   PASS B = runSeasonPayroll (separat loop over alle hold, EFTER pass A):
 *     1. processLoanInterest − (rente på hvert aktivt lån)
 *     2. Salary − (sum af riders.salary). Emergency-lån + hvis shortfall.
 *     3. Negativ-balance-rente − (10% af |balance| hvis stadig < 0)
 *
 * Sæson-slut (processSeasonEnd) håndterer KUN board-eval + divisionsbonus +
 * op/nedrykning (gated på FIRST_PROMOTION_RELEGATION_SEASON) + rytter-recalc.
 * Payroll-trinene blev flyttet fra sæson-slut til sæson-start i v3.78 for at
 * undgå at hold starter ny sæson med utilsigtet emergency-lån — sponsor skal
 * dække løn FØR shortfall-tjek.
 */
export async function processSeasonStart(seasonId, deps = {}) {
  console.log(`\n🏁 Processing season start: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processLoanAgreementSeasonFeesFn =
    deps.processLoanAgreementSeasonFees ?? processLoanAgreementSeasonFees;

  const { data: season } = await supabaseClient
    .from("seasons")
    .select("number")
    .eq("id", seasonId)
    .single();
  const seasonNumber = season?.number ?? null;
  const sponsorStandingsContext = await loadSponsorStandingsContextForSeason(
    supabaseClient,
    seasonNumber
  );

  const { data: teams } = await supabaseClient
    .from("teams")
    .select("*, board_profiles(*)")
    // #1077 · ekskludér bank-pseudo-holdet fra sæson-start-økonomi (sponsor/payroll).
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false);

  // S-02e · Lag 5 sponsor-pullout: load aktive pullouts FØR vi expirer dem.
  // Pullout oprettes ved sæson-end af forrige sæson (expires_at_season_id = X)
  // og skal anvendes ÉN gang i den næste sæson-starts sponsor-payment.
  const { data: activePullouts, error: pulloutLoadError } = await supabaseClient
    .from("board_consequences")
    .select("team_id, severity, id")
    .eq("layer", 5)
    .eq("status", "active");
  throwIfSupabaseError(pulloutLoadError, "Could not load active sponsor-pullouts");
  const pulloutFactorByTeamId = new Map();
  for (const row of activePullouts || []) {
    pulloutFactorByTeamId.set(row.team_id, (row.severity || 1000) / 1000);
  }

  // #805 · Board test-mode: lag 1 sponsor-modifier tvinges 1.0 så board-bidraget
  // til økonomien er neutralt mens testere forhandler planer. Sikkerhedsnet hvis
  // en season-start kører mens den aktive sæsons window er i test-mode.
  const boardTestMode = await isBoardTestModeActive(supabaseClient);

  const results = [];

  for (const team of teams || []) {
    const boards = team.board_profiles || [];
    const activeBoards = boards.filter(b => b.negotiation_status === "completed");
    const baseModifier = activeBoards.length > 0
      ? activeBoards.reduce((sum, b) => sum + (b.budget_modifier ?? 1.0), 0) / activeBoards.length
      : 1.0;
    // Lag 5 stacker MULTIPLIKATIVT med lag 1 (budget_modifier).
    const pulloutFactor = pulloutFactorByTeamId.get(team.id) ?? 1.0;
    const modifier = boardTestMode ? 1.0 : baseModifier * pulloutFactor;
    const lastSeasonStanding = sponsorStandingsContext.standingByTeamId.get(team.id) || null;
    // #1663: en aktiv (forhandlet) kontrakt definerer den låste garanterede base.
    const activeContract = await getActiveContract({ supabase: supabaseClient, teamId: team.id });
    const sponsorBreakdown = computeSponsorForSeason({
      seasonNumber,
      team,
      lastSeasonStanding,
      divisionStandings: lastSeasonStanding
        ? sponsorStandingsContext.divisionStandingsByDivision.get(lastSeasonStanding.division) || []
        : [],
      activeContract,
    });
    // #1663: loft afledt af den (låste) garanterede base × maks board-modifier — capper
    // board-modifier-bypass, men ikke legitim renown-skalering.
    const ceilingBase = activeContract?.guaranteed_base ?? sponsorBreakdown.gross_sponsor;
    const ceiling = Math.round(Number(ceilingBase) * MAX_BOARD_MODIFIER);
    const sponsorPayout = Math.min(Math.round(sponsorBreakdown.gross_sponsor * modifier), ceiling);

    // #666: description holdes null for nye rows — frontend renderer fra
    // metadata via backendMessages-i18n. Legacy rows beholder DA-description
    // som fallback.
    const sponsorMetadata = buildSponsorMetadata(sponsorBreakdown, modifier, pulloutFactor < 1.0);

    // #1678 · Sæson-1-opstarts-gate: spring sponsor over for hold der ALLEREDE har
    // fået startkapital (INITIAL_BALANCE, uberørt). Ejer-direktiv: undgå dobbelt-
    // indtægt ved opstart (800k start + sponsor i samme øjeblik). Gælder KUN sæson 1
    // og kun ved uberørt balance — har holdet brugt/tjent penge er det ikke længere
    // "lige fået startkapital", og sponsor udbetales normalt. Rør IKKE sæson 2+
    // (renown-/variabel-sponsor-stien) eller scorecardens steady-state-net.
    const skipSponsor =
      SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL &&
      seasonNumber === 1 &&
      Number(team.balance) === INITIAL_BALANCE;

    // Pay sponsor income (idempotent: cron-retry må ikke double-pay)
    if (!skipSponsor) {
      await creditTeam(
        team.id,
        sponsorPayout,
        "sponsor",
        null,
        seasonId,
        supabaseClient,
        {
          idempotent: true,
          metadata: sponsorMetadata,
          audit: {
            sourcePath: "economyEngine.processSeasonStart.sponsor",
            reasonCode: FINANCE_REASON.SEASON_START_SPONSOR,
            idempotencyKey: `sponsor:${team.id}:${seasonId}`,
          },
        }
      );
    } else {
      console.log(
        `  ⏭️  ${team.name}: sæson-1-sponsor sprunget over (uberørt startkapital ${INITIAL_BALANCE})`
      );
    }

    const chargedLoanFees = await processLoanAgreementSeasonFeesFn(
      team.id,
      seasonNumber,
      seasonId,
      supabaseClient
    );

    // Ensure all three plan types exist
    const existingPlanTypes = new Set(boards.map(b => b.plan_type));
    for (const planType of ["5yr", "3yr", "1yr"]) {
      if (!existingPlanTypes.has(planType)) {
        await supabaseClient.from("board_profiles").insert(
          createInitialBoardProfile({
            teamId: team.id,
            seasonId,
            balance: team.balance ?? 0,
            sponsorIncome: team.sponsor_income ?? DEFAULT_SPONSOR_INCOME,
            focus: "balanced",
            planType,
            negotiationStatus: "pending",
          })
        );
      }
    }

    const totalLoanFees = chargedLoanFees.reduce((sum, loan) => sum + (loan.loan_fee || 0), 0);
    results.push({
      team: team.name,
      sponsor: skipSponsor ? 0 : sponsorPayout,
      sponsor_skipped: skipSponsor,
      sponsor_breakdown: sponsorBreakdown,
      recurring_loan_fees: totalLoanFees,
      pullout_applied: pulloutFactor < 1.0,
    });
    if (!skipSponsor) {
      console.log(
        `  ✅ ${team.name}: +${sponsorPayout} pts sponsor${
          pulloutFactor < 1.0 ? " (sponsor-pullout aktiv)" : ""
        }${totalLoanFees > 0 ? `, -${totalLoanFees} pts lejegebyrer` : ""}`
      );
    } else if (totalLoanFees > 0) {
      console.log(`  ${team.name}: -${totalLoanFees} pts lejegebyrer`);
    }
  }

  // S-02e · Expire alle aktive lag 5 efter sponsor-payment. Pullout har nu
  // ramt sin ene sæsons sponsor-income og frigøres til næste sæson-end.
  if ((activePullouts || []).length > 0) {
    const { error: expireError } = await supabaseClient
      .from("board_consequences")
      .update({ status: "expired", resolved_at: new Date().toISOString() })
      .eq("layer", 5)
      .eq("status", "active");
    throwIfSupabaseError(expireError, "Could not expire sponsor-pullouts");
  }

  // 2026-05-21: Sæson-payroll flyttet fra sæson-SLUT til sæson-START.
  // Rækkefølge i sæson-start er nu:
  //   1. Sponsor (kredit) — udbetalt ovenfor
  //   2. Loan-interest (debit) — årlig rente på aktive lån
  //   3. Salary (debit) — sum af riders.salary, med emergency-lån hvis shortfall
  //   4. Negative-balance interest (debit) — 10% på resterende negativ balance
  //   5. Loan-agreement fees — allerede behandlet i processLoanAgreementSeasonFees pr. hold
  // Managers ser dermed ét samlet sæson-start-cashflow i stedet for at vente
  // til sæson-slut for at få regningen.
  // Payroll injicerbar via deps.runSeasonPayroll så sponsor-fokuserede tests
  // kan stub'e den uden at skulle mocke riders/board_profiles-tabeller.
  // #1678 · seasonNumber threads videre til processTeamSeasonPayroll så upkeep-
  // deferral (ingen upkeep i sæson 1 før første løb) kan gate på sæsonen.
  const runSeasonPayrollFn = deps.runSeasonPayroll ?? defaultRunSeasonPayroll;
  const payrollOutcome = await runSeasonPayrollFn(supabaseClient, seasonId, {
    ...deps,
    seasonNumber,
  });

  // #535: Returnér struktureret { sponsor, payroll } så admin-UI og
  // transitionToNextSeason's return-log kan vise payroll-counts + totaler
  // uden manuel SQL i Supabase. Bagudkompatibilitet: results-arrayet er stadig
  // tilgængeligt via `.sponsor`. Callere der læser .length skal opdateres.
  //
  // Defensive defaults: hvis runSeasonPayroll er stubbed til at returnere
  // `undefined`/array (legacy tests), fald tilbage til tomt summary i stedet
  // for at kaste.
  const payrollSummary = (payrollOutcome && payrollOutcome.summary) || {
    teams_processed: Array.isArray(payrollOutcome) ? payrollOutcome.length : 0,
    loan_interest_count: 0,
    loan_interest_total: 0,
    salary_count: 0,
    salary_total: 0,
    emergency_loan_count: 0,
    emergency_loan_total: 0,
    negative_balance_interest_count: 0,
    negative_balance_interest_total: 0,
  };
  const payrollResults = (payrollOutcome && payrollOutcome.results) ||
    (Array.isArray(payrollOutcome) ? payrollOutcome : []);

  // #1137 · Passiv rytterudvikling: vækst mod loft / fald efter peak / semi-auto
  // retirement + base_value-recompute. Kører fra sæson 2 (sæson 1 = launch-baseline,
  // intet at udvikle fra). Idempotent via rider_development_log. Isoleret: en fejl
  // her må ikke rulle sponsor/payroll tilbage (allerede skrevet) → fang + rapportér.
  // #1155: rytterudvikling (#1137) gated bag SEASON_RIDER_PROGRESSION_ENABLED
  // (ejer-beslutning 2026-06-08 — slået fra indtil progressions-systemet er
  // færdigbygget). Tests injicerer deps.developRidersForSeason og kører kaldet
  // uafhængigt af flaget.
  const developFn = deps.developRidersForSeason ?? developRidersForSeason;
  let progression = null;
  if (
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 2 &&
    (deps.developRidersForSeason || SEASON_RIDER_PROGRESSION_ENABLED)
  ) {
    try {
      progression = await developFn({ supabase: supabaseClient, seasonId, seasonNumber });
      console.log(`  ✅ Rytterudvikling: ${progression.developed} udviklet · ${progression.grew}↑ ${progression.declined}↓ · ${progression.retired} pensioneret`);
    } catch (err) {
      console.error(`  ⚠️ Rytterudvikling fejlede (transition fuldføres; kan re-køres): ${err.message}`);
      progression = { error: err.message };
    }
  }

  return {
    sponsor: results,
    payroll: {
      results: payrollResults,
      summary: payrollSummary,
    },
    progression,
  };
}

// #535: Returnerer både per-hold results (legacy) og aggregated summary så
// processSeasonStart kan eksponere én struktureret payroll-summary til
// admin-UI uden at admin skal læse finance_transactions manuelt.
async function defaultRunSeasonPayroll(supabaseClient, seasonId, deps = {}) {
  const teamsWithRoster = await loadHumanSeasonEndTeams(supabaseClient);
  const processLoanInterestFn = deps.processLoanInterest ?? processLoanInterest;
  const createEmergencyLoanFn = deps.createEmergencyLoan ?? createEmergencyLoan;
  const results = [];
  for (const teamWithRoster of teamsWithRoster) {
    const payroll = await processTeamSeasonPayroll(teamWithRoster, seasonId, {
      supabase: supabaseClient,
      // #1678 · videre-fører seasonNumber så upkeep kan deferres i sæson 1.
      seasonNumber: deps.seasonNumber,
      processLoanInterest: processLoanInterestFn,
      createEmergencyLoan: createEmergencyLoanFn,
    });
    results.push(payroll);
  }

  // Aggregated summary: 9 felter (teams_processed + 4×count + 4×total).
  // Counts tæller kun hold/lån hvor noget faktisk blev debiteret i denne
  // kørsel — skipped (idempotent-retry) ekskluderes så tællingen matcher
  // antal finance_transactions rows skrevet i denne kørsel.
  const summary = results.reduce((acc, p) => {
    acc.loan_interest_count += p.loan_interest_count || 0;
    acc.loan_interest_total += p.loan_interest || 0;
    acc.salary_count += p.salary_count || 0;
    acc.salary_total += p.salary || 0;
    acc.emergency_loan_count += p.emergency_loan_count || 0;
    acc.emergency_loan_total += p.emergency_loan_amount || 0;
    acc.negative_balance_interest_count += p.negative_balance_interest_count || 0;
    acc.negative_balance_interest_total += p.negative_balance_interest || 0;
    acc.upkeep_total += (p.upkeep_total || 0);
    acc.upkeep_count += (p.upkeep_count || 0);
    acc.forced_sale_count += (p.forced_sale_count || 0);
    acc.forced_sale_total += (p.forced_sale_total || 0);
    return acc;
  }, {
    teams_processed: results.length,
    loan_interest_count: 0,
    loan_interest_total: 0,
    salary_count: 0,
    salary_total: 0,
    emergency_loan_count: 0,
    emergency_loan_total: 0,
    negative_balance_interest_count: 0,
    negative_balance_interest_total: 0,
    upkeep_total: 0,
    upkeep_count: 0,
    forced_sale_count: 0,
    forced_sale_total: 0,
  });

  return { results, summary };
}

/**
 * Sæson-payroll: lånerenter + lønninger (+ emergency-lån hvis shortfall) +
 * resterende negativ-balance-rente. Kører ved sæson-START efter sponsor er
 * udbetalt. Idempotent via finance_transactions partial unique-indices.
 *
 * Flyttet 2026-05-21 fra processTeamSeasonEnd. Sæson-slut beholder kun
 * board-evaluation, divisionsbonusser, op/nedrykning og rytter-værdi-recalc.
 *
 * #535: Returnerer både legacy-felter (team, total_salary, emergency_loan,
 * negative_interest) og normaliserede tal-felter til payroll-summary
 * aggregation: loan_interest, salary, emergency_loan_amount,
 * negative_balance_interest. Begge sæt er rene tal (ikke nested objekter).
 */
export async function processTeamSeasonPayroll(team, seasonId, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processLoanInterestFn = deps.processLoanInterest ?? processLoanInterest;
  const createEmergencyLoanFn = deps.createEmergencyLoan ?? createEmergencyLoan;
  const getTotalDebtFn = deps.getTotalDebt ?? getTotalDebt;
  // #1678 · sæson-nummer (threades fra processSeasonStart → defaultRunSeasonPayroll)
  // bruges til upkeep-deferral: ingen gold sink i sæson 1 før første løb.
  const seasonNumber = deps.seasonNumber ?? null;

  // 1. Lånerenter på alle aktive lån. processLoanInterest returnerer
  //    { charged: [{ loan_id, interest, skipped }] } så vi kan aggregere
  //    faktisk debiteret rente (skipped=idempotent-retry tæller ikke).
  const loanInterestResult = (await processLoanInterestFn(team.id, seasonId, supabaseClient)) || {};
  const loanInterestCharges = Array.isArray(loanInterestResult.charged)
    ? loanInterestResult.charged.filter((c) => !c.skipped)
    : [];
  const loanInterestTotal = loanInterestCharges.reduce(
    (sum, c) => sum + (c.interest || 0),
    0
  );

  // 2. Løn — sum(rider.salary). Hvis balance < salary → emergency-lån.
  const totalSalary = (team.riders || []).reduce((sum, r) => sum + (r.salary || 0), 0);
  let emergencyLoanAmount = 0;

  if (totalSalary > 0) {
    const { data: freshTeam, error: freshTeamError } = await supabaseClient
      .from("teams").select("balance").eq("id", team.id).single();
    throwIfSupabaseError(freshTeamError, `Could not load balance for ${team.name}`);
    if (!freshTeam) throw new Error(`Could not load balance for ${team.name}`);
    const shortfall = totalSalary - freshTeam.balance;
    if (shortfall > 0) {
      console.log(`  ⚠️  ${team.name}: mangler ${shortfall} pts til løn — opretter nødlån`);
      await createEmergencyLoanFn(team.id, shortfall, supabaseClient, seasonId);
      emergencyLoanAmount = shortfall;
    }
    await debitTeam(
      team.id,
      totalSalary,
      "salary",
      null,
      seasonId,
      supabaseClient,
      {
        idempotent: true,
        metadata: {
          code: "tx.salary",
          params: { count: (team.riders || []).length },
        },
        audit: {
          sourcePath: "economyEngine.processSeasonStart.salary",
          reasonCode: FINANCE_REASON.SEASON_END_SALARY,
          idempotencyKey: `salary:${team.id}:${seasonId}`,
        },
      }
    );
  }

  // 2b. B3-eskalering: debt-breach-streak + transfer-fryse + tvunget salg (#1441/#97).
  //     Kører EFTER emergency-lån (gæld er nu finaliseret for sæsonen).
  //     Bruger DEBT_CEILING_BY_DIVISION (economyConstants) som kanonisk kilde.
  //     Springer over hold med ukendt division (ingen ceiling = ingen eskalering).
  let forcedSaleCount = 0;
  let forcedSaleTotal = 0;
  const debtCeiling = DEBT_CEILING_BY_DIVISION[team.division] ?? null;
  if (debtCeiling != null) {
    const currentDebt = await getTotalDebtFn(team.id, supabaseClient);

    let breachStreak = team.debt_breach_streak || 0;
    let transferFrozen = team.transfer_frozen || false;

    if (currentDebt > debtCeiling) {
      breachStreak += 1;
      transferFrozen = true; // streak >= 1 → fryser transfer

      if (breachStreak >= 2) {
        // Tvunget salg: sælg højeste-market_value rytter(e) indtil gæld <= ceiling
        // eller ingen ryttere tilbage. Spejler squadEnforcement.executeAutoSale:
        //   1. credit market_value til holdet via incrementBalanceWithAudit
        //   2. sæt rider.team_id = rider.ai_team_id || null (disposition)
        //   3. luk åbne transfer_listings for rytteren
        const sortedRiders = [...(team.riders || [])]
          .sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
        let runningDebt = currentDebt;
        for (const rider of sortedRiders) {
          if (runningDebt <= debtCeiling) break;
          const credit = rider.market_value || 0;

          await creditTeam(
            team.id,
            credit,
            "forced_debt_sale",
            `Tvunget salg (gælds-loft): ${rider.firstname} ${rider.lastname}`,
            seasonId,
            supabaseClient,
            {
              audit: {
                sourcePath: "economyEngine.processTeamSeasonPayroll.forcedDebtSale",
                reasonCode: FINANCE_REASON.SQUAD_AUTO_SALE,
                relatedEntityType: FINANCE_RELATED_ENTITY.SEASON,
                relatedEntityId: seasonId || null,
              },
            }
          );

          const { error: riderUpdateError } = await supabaseClient
            .from("riders")
            .update({
              team_id: rider.ai_team_id || null,
              pending_team_id: null,
            })
            .eq("id", rider.id);
          throwIfSupabaseError(riderUpdateError, `Could not move rider ${rider.id} after forced debt sale`);

          // #1906 defense-in-depth: ryd den solgte rytters fremtidige race_entries (ghost-guard)
          await clearFutureRaceEntriesSafe({ supabase: supabaseClient, riderId: rider.id, label: "forcedDebtSale" });

          await closeTransferListingsForRiders(supabaseClient, [rider.id], "sold");

          forcedSaleCount += 1;
          forcedSaleTotal += credit;
          // Optimistisk: antag at credit reducerer gæld proportionelt (estimat)
          runningDebt = Math.max(0, runningDebt - credit);

          console.log(`  🔴 ${team.name}: tvunget salg af ${rider.firstname} ${rider.lastname} (${credit} pts) — gæld-brud streak ${breachStreak}`);
        }
      }
    } else {
      // Under ceiling → nulstil streak + ophæv freeze
      breachStreak = 0;
      transferFrozen = false;
    }

    const { error: breachUpdateError } = await supabaseClient
      .from("teams")
      .update({ debt_breach_streak: breachStreak, transfer_frozen: transferFrozen })
      .eq("id", team.id);
    throwIfSupabaseError(breachUpdateError, `Could not update debt_breach_streak/transfer_frozen for team ${team.id}`);

    console.log(`  📊 ${team.name}: debt_breach_streak=${breachStreak}, transfer_frozen=${transferFrozen}`);
  }

  // 3. Negativ-balance-rente (safety net hvis emergency-lån ikke dækkede)
  const { data: postSalaryTeam, error: postSalaryError } = await supabaseClient
    .from("teams").select("balance").eq("id", team.id).single();
  throwIfSupabaseError(postSalaryError, `Could not load post-salary balance for ${team.name}`);
  let negativeInterestCharged = 0;
  if (postSalaryTeam && postSalaryTeam.balance < 0) {
    negativeInterestCharged = Math.round(Math.abs(postSalaryTeam.balance) * NEGATIVE_BALANCE_INTEREST_RATE);
    await debitTeam(
      team.id,
      negativeInterestCharged,
      "interest",
      null,
      seasonId,
      supabaseClient,
      {
        idempotent: true,
        metadata: {
          code: "tx.interest",
          params: { amount: Math.abs(postSalaryTeam.balance) },
        },
        audit: {
          sourcePath: "economyEngine.processSeasonStart.negativeInterest",
          reasonCode: FINANCE_REASON.SEASON_END_NEGATIVE_INTEREST,
          idempotencyKey: `negative_interest:${team.id}:${seasonId}`,
        },
      }
    );
    console.log(`  💸 ${team.name}: -${negativeInterestCharged} pts interest on negative balance`);
  }

  // 4. Akademi-drift — pr. akademi-plads (is_academy=true) debiteres ACADEMY.DRIFT_PER_SEASON.
  //    Gated på count > 0: hold uden akademi springer over (isAcademyEnabled-flag irrelevant —
  //    ingen akademi-ryttere = ingen drift, uanset flag). Idempotent pr. sæson+hold.
  const { count: academyCount, error: academyCountError } = await supabaseClient
    .from("riders")
    .select("id", { count: "exact", head: true })
    .eq("team_id", team.id)
    .eq("is_academy", true);
  throwIfSupabaseError(academyCountError, `Could not count academy riders for ${team.name}`);
  const academyDriftCharged = (academyCount || 0) > 0
    ? (academyCount || 0) * ACADEMY.DRIFT_PER_SEASON
    : 0;
  if (academyDriftCharged > 0) {
    await debitTeam(
      team.id,
      academyDriftCharged,
      "academy_drift",
      null,
      seasonId,
      supabaseClient,
      {
        idempotent: true,
        metadata: {
          code: "tx.academyDrift",
          params: { count: academyCount || 0, drift_per_slot: ACADEMY.DRIFT_PER_SEASON },
        },
        audit: {
          sourcePath: "economyEngine.processSeasonStart.academyDrift",
          idempotencyKey: `academy_drift:${team.id}:${seasonId}`,
        },
      }
    );
    console.log(`  🎓 ${team.name}: -${academyDriftCharged} pts akademi-drift (${academyCount} pladser × ${ACADEMY.DRIFT_PER_SEASON})`);
  }

  // 5. Løbende upkeep (#1441) — division-tier-skaleret operating cost (gold sink).
  //    Flad pr. division (IKKE modifier-skaleret), idempotent pr. sæson+hold.
  // #1678 · Upkeep-deferral: ingen upkeep i sæson 1's opstart (før sæsonen reelt
  //    går i gang / første løb). Ejer-direktiv 2026-06-21. Gælder KUN sæson 1 —
  //    sæson 2+ beholder upkeep som den steady-state gold sink moneySupplyScorecard
  //    (--synthetic-only) granit-låser. Forward-guard: relaunch-populationen står i
  //    tier 4 (UPKEEP_BY_DIVISION[4]=0), så sæson-1-upkeep er allerede 0 — flaget
  //    sikrer det også holder hvis et hold ikke ligger i bund-tier. Når flaget sættes
  //    true gen-aktiveres upkeep-ved-sæson-1-start som før.
  const deferUpkeep = !UPKEEP_BEFORE_FIRST_RACE_ENABLED && seasonNumber === 1;
  const upkeepCharged = deferUpkeep ? 0 : (UPKEEP_BY_DIVISION[team.division] || 0);
  if (deferUpkeep) {
    console.log(`  ⏭️  ${team.name}: upkeep udskudt i sæson 1 (før første løb)`);
  }
  if (upkeepCharged > 0) {
    await debitTeam(
      team.id, upkeepCharged, "upkeep", null, seasonId, supabaseClient,
      {
        idempotent: true,
        metadata: { code: "tx.upkeep", params: { division: team.division } },
        audit: {
          sourcePath: "economyEngine.processSeasonStart.upkeep",
          reasonCode: FINANCE_REASON.SEASON_START_UPKEEP,
          idempotencyKey: `upkeep:${team.id}:${seasonId}`,
        },
      }
    );
    console.log(`  🏭 ${team.name}: -${upkeepCharged} pts upkeep (div ${team.division})`);
  }

  return {
    team: team.name,
    team_id: team.id,
    // Legacy field-navne bevares for kontrakt-stabilitet med eksisterende callers/tests
    total_salary: totalSalary,
    emergency_loan: emergencyLoanAmount,
    negative_interest: negativeInterestCharged,
    // #535: Per-hold payroll-summary felter (rene tal). loan_interest_count
    // er antallet af lån der faktisk fik debiteret rente i denne kørsel
    // (skipped/idempotent-retry tælles ikke).
    loan_interest: loanInterestTotal,
    loan_interest_count: loanInterestCharges.length,
    salary: totalSalary,
    salary_count: totalSalary > 0 ? 1 : 0,
    emergency_loan_amount: emergencyLoanAmount,
    emergency_loan_count: emergencyLoanAmount > 0 ? 1 : 0,
    negative_balance_interest: negativeInterestCharged,
    negative_balance_interest_count: negativeInterestCharged > 0 ? 1 : 0,
    upkeep_total: upkeepCharged,
    upkeep_count: upkeepCharged > 0 ? 1 : 0,
    // B3: tvunget salg + breach-streak-eskalering (#1441/#97)
    forced_sale_count: forcedSaleCount,
    forced_sale_total: forcedSaleTotal,
  };
}

async function loadSponsorStandingsContextForSeason(supabaseClient, seasonNumber) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < FIRST_VARIABLE_SPONSOR_SEASON) {
    return buildSponsorStandingsContext([]);
  }

  const { data: previousSeason, error: previousSeasonError } = await supabaseClient
    .from("seasons")
    .select("id")
    .eq("number", seasonNumber - 1)
    .maybeSingle();
  throwIfSupabaseError(previousSeasonError, "Could not load previous season for sponsor calculation");
  if (!previousSeason?.id) return buildSponsorStandingsContext([]);

  const { data: standings, error: standingsError } = await supabaseClient
    .from("season_standings")
    .select("team_id, division, rank_in_division, total_points")
    .eq("season_id", previousSeason.id);
  throwIfSupabaseError(standingsError, "Could not load previous standings for sponsor calculation");

  return buildSponsorStandingsContext(standings || []);
}

// #666: build metadata for season-start sponsor transaction. Each (mode, pullout)
// combination maps to a distinct i18n key — keeps the keys readable instead of
// nesting ICU select inside select.
function buildSponsorMetadata(breakdown, modifier, pulloutActive) {
  const mode = breakdown.mode || "intro";
  const params = { modifier };
  let codeKey;
  if (mode === "variable") {
    codeKey = pulloutActive ? "tx.sponsor.seasonStartVariablePullout" : "tx.sponsor.seasonStartVariable";
    params.base = breakdown.base;
    params.variable = breakdown.variable;
  } else if (mode === "fallback") {
    codeKey = pulloutActive ? "tx.sponsor.seasonStartFallbackPullout" : "tx.sponsor.seasonStartFallback";
    params.amount = breakdown.gross_sponsor;
  } else {
    codeKey = pulloutActive ? "tx.sponsor.seasonStartIntroPullout" : "tx.sponsor.seasonStartIntro";
    params.amount = breakdown.gross_sponsor;
  }
  return { code: codeKey, params };
}

// ─── Division Bonuses ────────────────────────────────────────────────────────

export async function payDivisionBonuses(standings, seasonId, supabaseClient) {
  const { data: existingRows, error: existingError } = await supabaseClient
    .from("finance_transactions")
    .select("team_id")
    .eq("season_id", seasonId)
    .eq("type", "bonus");
  throwIfSupabaseError(existingError, "Could not check existing division bonuses");

  const alreadyPaid = new Set((existingRows || []).map(r => r.team_id));

  for (const standing of standings || []) {
    if (!standing.team_id || standing.team?.is_ai) continue;
    if (alreadyPaid.has(standing.team_id)) continue;
    const bonuses = DIVISION_BONUSES[standing.division];
    if (!bonuses) continue;
    const rank = standing.rank_in_division;
    if (!rank || rank > bonuses.length) continue;
    const amount = bonuses[rank - 1];
    if (!amount) continue;
    await creditTeam(
      standing.team_id,
      amount,
      "bonus",
      null,
      seasonId,
      supabaseClient,
      {
        idempotent: true,
        metadata: {
          code: "tx.bonus",
          params: { division: standing.division, rank },
        },
        audit: {
          sourcePath: "economyEngine.payDivisionBonuses",
          reasonCode: FINANCE_REASON.SEASON_END_DIVISION_BONUS,
          idempotencyKey: `bonus:${standing.team_id}:${seasonId}`,
        },
      }
    );
  }
}

// ─── Season End Processing ────────────────────────────────────────────────────

/**
 * Full season-end processing:
 * 1. Deduct rider salaries
 * 2. Charge interest on debt
 * 3. Evaluate board satisfaction
 * 4. Update divisions (promotion/relegation)
 * 5. Update sponsor income for next season
 */
export async function processSeasonEnd(seasonId, deps = {}) {
  console.log(`\n🏆 Processing season end: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationNow = deps.now ?? new Date();

  // Get current season number
  const { data: currentSeason, error: seasonError } = await supabaseClient
    .from("seasons").select("number").eq("id", seasonId).single();
  throwIfSupabaseError(seasonError, "Could not load season for season end");
  const currentSeasonNumber = currentSeason?.number ?? 1;

  // Get final standings
  const { data: standings, error: standingsError } = await supabaseClient
    .from("season_standings")
    .select("*, team:team_id(*)")
    .eq("season_id", seasonId)
    .order("total_points", { ascending: false });
  throwIfSupabaseError(standingsError, "Could not load season standings for season end");

  if (!standings?.length) {
    console.warn("  ⚠️  No standings found for season");
    return;
  }

  // Load finance/board inputs before any writes, so relationship drift cannot
  // trigger division movement and then skip the finance loop.
  const teams = await loadHumanSeasonEndTeams(supabaseClient);

  // #805 · board test-mode hentes én gang her og videregives til hver
  // processTeamSeasonEnd så lag 4/5-konsekvenser suppress under test-perioden.
  const boardTestMode = deps.boardTestMode ?? await isBoardTestModeActive(supabaseClient);

  for (const team of teams || []) {
    await processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, {
      ...deps,
      supabase: supabaseClient,
      now: notificationNow,
      boardTestMode,
    });
  }

  // Pay division bonuses based on final standings
  await payDivisionBonuses(standings, seasonId, supabaseClient);

  // Process each division after finance/board side effects have succeeded.
  // #1608: loop MIN..MAX_DIVISION (nu 4) i stedet for hardcodet [1,2,3], så tier 4
  // ikke tavst springes over ved sæson-slut. MAX_DIVISION lever i economyConstants.
  // #1152: byg pulje-træet én gang og videregiv til hver processDivisionEnd, så
  // op/nedrykning kan route til forælder/barn-puljer (binær-træ via pool_index).
  const poolTree = await buildPoolTree(supabaseClient);

  for (let division = MIN_DIVISION; division <= MAX_DIVISION; division++) {
    const divStandings = standings.filter(s => s.division === division);
    await processDivisionEnd(divStandings, division, seasonId, currentSeasonNumber, {
      supabase: supabaseClient,
      now: notificationNow,
      poolTree,
    });
  }

  // #1152 AI-fyld-sweep efter op/nedrykning: bring hver pulje tilbage til
  // POOL_TARGET_SIZE (reconcileAiTeamsForPool trimmer/top-up'er AI, rører ALDRIG ægte
  // hold; tier 3+4-puljer uden ægte hold forbliver tomme/dormant). Erstatter den gamle
  // tier-fyld-fra-top (rebalanceDivisions) — pulje-modellen fylder med AI, ikke ved at
  // trække ægte hold op uden for sporten.
  if (currentSeasonNumber >= FIRST_PROMOTION_RELEGATION_SEASON) {
    for (const ld of poolTree.byId.values()) {
      await reconcileAiTeamsForPool({ supabase: supabaseClient, poolId: ld.id });
    }
  }

  // Mark season as completed
  const { error: completeError } = await supabaseClient.from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId);
  throwIfSupabaseError(completeError, "Could not mark season completed");

  // Recalculate rider values and salaries based on last 3 completed seasons.
  // #1155: gated bag SEASON_VALUE_RECALC_ENABLED (ejer-beslutning 2026-06-08 —
  // slået fra indtil værdimodellen giver mening ved transition). Tests injicerer
  // deps.updateRiderValues og kører kaldet uafhængigt af flaget.
  if (deps.updateRiderValues || SEASON_VALUE_RECALC_ENABLED) {
    const updateRiderValuesFn = deps.updateRiderValues ?? updateRiderValues;
    await updateRiderValuesFn(supabaseClient);
  } else {
    console.log("  ⏸  Rytter-værdi-recalc sprunget over (SEASON_VALUE_RECALC_ENABLED=false, #1155)");
  }

  // S-02a: Når sæson 1 (baseline) slutter, åbn sekventiel onboarding for sæson 2.
  // Inline frem for cron (Q-A 2026-05-05): én truth-path, ingen race conditions.
  if (currentSeasonNumber === 1) {
    const startSequentialNegotiationFn = deps.startSequentialNegotiation ?? startSequentialNegotiation;
    const seqResult = await startSequentialNegotiationFn({
      supabase: supabaseClient,
      completedSeasonId: seasonId,
    });
    console.log(
      `  📜 Sequential negotiation started: ${seqResult.baseline_rows_deleted} baseline rows deleted, window=${seqResult.window_state}`
    );
  }

  console.log("  ✅ Season end processing complete");
}

export async function repairSeasonEndFinanceAndBoard(seasonId, deps = {}) {
  console.log(`\n🛠️  Repairing season-end board side effects: ${seasonId}`);
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationNow = deps.now ?? new Date();

  const { data: currentSeason, error: seasonError } = await supabaseClient
    .from("seasons")
    .select("id, number, status")
    .eq("id", seasonId)
    .single();
  throwIfSupabaseError(seasonError, "Could not load season for season-end repair");
  if (!currentSeason) throw new Error("Season not found");

  // 2026-05-21: Salary/loan-interest/emergency-loan flyttet til sæson-start.
  // Repair-funktionen reparerer derfor nu kun board-snapshots og division-side-
  // effects, ikke finance-rows. Salary-repair (for historiske sæsoner der
  // sluttede før flytningen) håndteres separat via dedikeret script om nødvendigt.
  const { data: existingSnapshots, error: snapshotCountError } = await supabaseClient
    .from("board_plan_snapshots")
    .select("team_id, board_id")
    .eq("season_id", seasonId);
  throwIfSupabaseError(snapshotCountError, "Could not check existing board snapshots");

  const { data: standings, error: standingsError } = await supabaseClient
    .from("season_standings")
    .select("*, team:team_id(*)")
    .eq("season_id", seasonId)
    .order("total_points", { ascending: false });
  throwIfSupabaseError(standingsError, "Could not load season standings for season-end repair");
  if (!standings?.length) throw new Error("No standings found for season-end repair");

  const teams = await loadHumanSeasonEndTeams(supabaseClient);
  const existingSnapshotBoards = new Set(
    (existingSnapshots || []).map(row => row.board_id).filter(Boolean)
  );

  for (const team of teams) {
    const repairTeam = {
      ...team,
      board_profiles: (team.board_profiles || []).filter(board => !existingSnapshotBoards.has(board.id)),
    };

    await processTeamSeasonEnd(repairTeam, seasonId, standings, currentSeason.number ?? 1, {
      ...deps,
      supabase: supabaseClient,
      now: notificationNow,
    });
  }

  console.log("  ✅ Season-end board repair complete");
  return {
    teamsProcessed: teams.length,
    existingBoardSnapshots: existingSnapshots?.length || 0,
    existingBoardSnapshotBoards: existingSnapshotBoards.size,
  };
}

// 2026-05-21 (v3.78/v3.79): "Sæson-transition preview". Cashflow modelleres
// nu efter den faktiske rækkefølge i processSeasonStart →
// processTeamSeasonPayroll (sponsor + → renter − → løn − → emergency-lån
// hvis shortfall), ikke som det gamle "sæson-slut deduct salary"-flow.
// Felt-navne (salary_deduction, loan_interest, next_season_sponsor,
// balance_after, needs_emergency_loan) bevares for kontrakt-stabilitet,
// men balance_after og needs_emergency_loan reflekterer nu den samlede
// transition og inkluderer sponsor-income.
export function buildSeasonEndPreviewRows({ teams = [], standings = [], loanData = [] } = {}) {
  return teams.map((team) => {
    const standing = standings.find(s => s.team_id === team.id);
    const riders = team.riders || [];
    const totalSalary = riders.reduce((sum, rider) => sum + (rider.salary || 0), 0);
    const teamLoans = loanData.filter(loan => loan.team_id === team.id);
    const totalInterest = teamLoans.reduce(
      (sum, loan) => sum + Math.round((loan.amount_remaining || 0) * (loan.interest_rate || 0)),
      0
    );
    const board = team.board_profiles?.[0] || null;
    const currentSatisfaction = board?.satisfaction ?? 50;

    let projectedSatisfaction = currentSatisfaction;
    let sponsorModifier = board?.budget_modifier ?? 1.0;
    let goalsMet = null;
    let goalsTotal = null;

    if (board && standing) {
      const planDuration = getPlanDuration(board.plan_type);
      const seasonsCompleted = (board.seasons_completed || 0) + 1;
      // #1187: projicér fra sæson-start-ankeret når weekend-opdateringer har
      // flyttet den løbende værdi (samme regel som processTeamSeasonEnd).
      const previewAnchorValid =
        standing.season_id != null &&
        board.season_start_anchor_season_id === standing.season_id &&
        Number.isFinite(Number(board.season_start_satisfaction)) &&
        board.season_start_satisfaction !== null;
      const previewAnchor = previewAnchorValid
        ? Number(board.season_start_satisfaction)
        : currentSatisfaction;
      const projected = evaluateBoardSeason({
        board: { ...board, satisfaction: previewAnchor },
        standing,
        team: { ...team, riders },
        context: {
          isFinalSeason: seasonsCompleted >= planDuration,
          activeLoanCount: teamLoans.length,
          planStartSponsorIncome: board.plan_start_sponsor_income,
          currentSponsorIncome: team.sponsor_income,
          planDuration,
          seasonsCompleted,
          recentSnapshots: [],
          hasSeasonData: true,
          cumulativeStats: {
            stageWins: (board.cumulative_stage_wins || 0) + (standing.stage_wins || 0),
            gcWins: (board.cumulative_gc_wins || 0) + (standing.gc_wins || 0),
          },
        },
      });

      projectedSatisfaction = projected.newSatisfaction;
      sponsorModifier = projected.newModifier;
      goalsMet = projected.goalsMet;
      goalsTotal = projected.goals.length;
    }

    const divStandings = standings
      .filter(s => s.division === team.division)
      .sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
    const rank = divStandings.findIndex(s => s.team_id === team.id) + 1;
    const nextSeasonSponsor = Math.round((team.sponsor_income || 0) * sponsorModifier);
    const upkeep = UPKEEP_BY_DIVISION[team.division] || 0;
    // Følger processSeasonStart-rækkefølgen: +sponsor → −renter → −løn → −upkeep.
    const balanceAfter = (team.balance || 0) + nextSeasonSponsor - totalInterest - totalSalary - upkeep;

    return {
      team_id: team.id,
      team_name: team.name,
      division: team.division,
      current_balance: team.balance || 0,
      salary_deduction: totalSalary,
      loan_interest: totalInterest,
      upkeep,
      balance_after: balanceAfter,
      needs_emergency_loan: balanceAfter < 0,
      emergency_loan_amount: balanceAfter < 0 ? Math.abs(balanceAfter) : 0,
      current_board_satisfaction: currentSatisfaction,
      board_satisfaction: projectedSatisfaction,
      sponsor_modifier: sponsorModifier,
      next_season_sponsor: nextSeasonSponsor,
      board_goals_met: goalsMet,
      board_goals_total: goalsTotal,
      total_points: standing?.total_points || 0,
      current_rank: rank || null,
    };
  });
}

async function processTeamSeasonEnd(team, seasonId, standings, currentSeasonNumber, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const processReplacementTriggerFn = deps.processReplacementTrigger ?? processReplacementTrigger;
  const evaluateAndApplyConsequencesFn = deps.evaluateAndApplyConsequences ?? evaluateAndApplyConsequences;
  // #805 · forudhentet af processSeasonEnd (én query), fallback til egen lookup
  // hvis kaldt direkte (fx repair-stien).
  const boardTestMode = deps.boardTestMode ?? await isBoardTestModeActive(supabaseClient);
  const notificationDeps = { supabase: supabaseClient, now: deps.now };
  const teamStanding = standings.find(s => s.team_id === team.id);
  const boards = team.board_profiles || [];

  // 2026-05-21: Lånerenter, lønninger og negativ-balance-rente flyttet til
  // processSeasonStart (kører nu ved sæson-START i stedet for sæson-SLUT).
  // Sæson-slut beholder kun board-evaluation, divisionsbonusser, op/nedrykning
  // og rytter-værdi-recalc. Se processTeamSeasonPayroll.

  // Plan-aware board evaluation — evaluate all active plans
  // #1721 (ejer-beslutning 2026-06-22): sæson 1 er IKKE en observations-sæson.
  // RIGTIGE planer (5yr/3yr/1yr) — som managere signerer fra dag 1 via relaunch-
  // oplåsningen (pending_5yr) — evalueres fuldt her: satisfaction bevæger sig og
  // budget_modifier afledes med fuld effekt (anvendes i næste sæsons sponsor).
  // KUN baseline-profiler springes over: en baseline er en transient observations-
  // rest der lever før relaunch sletter den (startSequentialNegotiation) eller på en
  // sæson 0→1-transition uden oplåsning. At skippe dem bevarer sæson-0/pre-unlock-
  // adfærd uden at dæmpe en rigtig sæson-1-plan.
  for (const board of boards) {
    if (!board || !teamStanding) continue;
    if (board.is_baseline || board.plan_type === "baseline") continue;

    // #1187 · Weekend-target-tracking flytter board.satisfaction LØBENDE i
    // sæsonen (boardWeekendFinalization.js) mod præcis anker + sæson-delta.
    // Sæson-slut-evalueringen skal derfor anke på sæson-START-værdien — ellers
    // ville delta blive lagt oven i den allerede-konvergerede værdi (dobbelt-
    // anvendelse). Uden gyldigt anker (ingen weekend-opdateringer kørt i denne
    // sæson) er anchor = board.satisfaction → præcis dagens adfærd.
    const weekendAnchorValid =
      board.season_start_anchor_season_id === seasonId &&
      board.season_start_satisfaction !== null &&
      board.season_start_satisfaction !== undefined &&
      Number.isFinite(Number(board.season_start_satisfaction));
    const anchorSatisfaction = weekendAnchorValid
      ? Number(board.season_start_satisfaction)
      : (board.satisfaction ?? 50);

    const planDuration = getPlanDuration(board.plan_type);
    const seasonsCompleted = (board.seasons_completed || 0) + 1;
    const newCumulativeStageWins = (board.cumulative_stage_wins || 0) + (teamStanding.stage_wins || 0);
    const newCumulativeGcWins = (board.cumulative_gc_wins || 0) + (teamStanding.gc_wins || 0);
    const planIsComplete = seasonsCompleted >= planDuration;
    const isMidReview = !planIsComplete && seasonsCompleted === Math.floor(planDuration / 2);

    // Active loans count for no_outstanding_debt goal
    const { count: activeLoanCount, error: activeLoanCountError } = await supabaseClient.from("loans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id).eq("status", "active");
    throwIfSupabaseError(activeLoanCountError, `Could not count active loans for ${team.name}`);

    // Fresh team data for sponsor_growth evaluation
    const { data: freshTeamData, error: freshTeamDataError } = await supabaseClient.from("teams")
      .select("sponsor_income").eq("id", team.id).single();
    throwIfSupabaseError(freshTeamDataError, `Could not load sponsor income for ${team.name}`);

    const { data: recentSnapshots, error: recentSnapshotsError } = await supabaseClient
      .from("board_plan_snapshots")
      .select("goals_met, goals_total, satisfaction_delta")
      .eq("team_id", team.id)
      .order("created_at", { ascending: false })
      .limit(3);
    throwIfSupabaseError(recentSnapshotsError, `Could not load recent board snapshots for ${team.name}`);

    // S-02d · Hent cumulative + plan-start kontekst-felter for de 7 nye mål-typer.
    // Genbruger pre-loaded standings til divisionManagerCount (sparer DB-trip).
    const goalContext = await loadGoalContextForBoard({
      supabase: supabaseClient,
      teamId: team.id,
      boardId: board.id,
      currentSeasonId: seasonId,
      division: teamStanding.division,
      // #1608 · pulje-rang: divisionManagerCount tælles pr. pulje når holdet er
      // pulje-allokeret (ellers tier-bredt fallback i loadGoalContextForBoard).
      leagueDivisionId: teamStanding.league_division_id ?? null,
      standings,
      // #54 · Afgræns cumulative + u25-baseline til den aktuelle plan-cyklus.
      planStartSeasonNumber: board.plan_start_season_number,
    });

    const context = {
      isFinalSeason: planIsComplete,
      activeLoanCount: activeLoanCount || 0,
      planStartSponsorIncome: board.plan_start_sponsor_income,
      currentSponsorIncome: freshTeamData?.sponsor_income ?? team.sponsor_income,
      planDuration,
      seasonsCompleted,
      recentSnapshots: recentSnapshots || [],
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: newCumulativeStageWins,
        gcWins: newCumulativeGcWins,
      },
      ...goalContext,
    };

    const {
      goals,
      feedback,
      goalsMet,
      newModifier,
      newSatisfaction,
      scoreBreakdown,
    } = evaluateBoardSeason({
      // #1187: evaluer fra sæson-start-ankeret → newSatisfaction = anker + delta,
      // identisk med dagens resultat uanset hvor langt weekend-opdateringerne
      // allerede har flyttet den løbende værdi.
      board: { ...board, satisfaction: anchorSatisfaction },
      standing: teamStanding,
      team,
      context,
    });

    // S-02d · Snapshot U25-stat-baseline så u25_development_delta kan beregnes
    // fra plan-start-værdien i efterfølgende sæsoner.
    const u25StatSum = computeU25StatSum(team.riders);
    const u25Count = (team.riders || []).filter((r) => r.is_u25).length;

    // #30 · Upsert med onConflict: re-runs af processSeasonEnd for samme
    // (board, season) overskriver i stedet for at indsaette dubletter.
    // DB-constraint board_plan_snapshots_board_season_unique haandhaever
    // det samme paa lavere niveau (migration 2026-05-15).
    const { error: snapshotError } = await supabaseClient.from("board_plan_snapshots").upsert({
      team_id: team.id,
      board_id: board.id,
      season_id: seasonId,
      season_number: currentSeasonNumber,
      season_within_plan: seasonsCompleted,
      stage_wins: teamStanding.stage_wins || 0,
      gc_wins: teamStanding.gc_wins || 0,
      division_rank: teamStanding.rank_in_division || null,
      // #1187: delta måles fra sæson-start-ankeret (= hele sæsonens bevægelse),
      // ikke fra den løbende weekend-værdi (ville være ~0 efter konvergens).
      satisfaction_delta: newSatisfaction - anchorSatisfaction,
      goals_met: goalsMet,
      goals_total: goals.length,
      u25_stat_sum: u25StatSum,
      u25_count: u25Count,
    }, { onConflict: "board_id,season_id" });
    throwIfSupabaseError(snapshotError, `Could not upsert board snapshot for ${team.name}`);

    let replacementInfo = null;
    if (planIsComplete) {
      // Plan expired — reset for re-negotiation
      // #1236 · Rul plan-vinduet frem til den nye cyklus. Uden dette pegede
      // plan_start_season_number stadig på den udløbne plans start-sæson, så
      // /board/status' snapshot-filter (season_number >= plan_start_season_number)
      // talte forrige cyklus' sæsoner med i den nye plan. Den nye cyklus kører
      // tidligst fra næste sæson (sæson-transition er altid number+1) —
      // /board/sign og boardAutoAccept overskriver med den faktiske aktive
      // sæson ved signering. En plan der stadig KØRER (else-branchen nedenfor)
      // beholder sin oprindelige start-sæson.
      const { error: boardUpdateError } = await supabaseClient.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        negotiation_status: "pending",
        seasons_completed: 0,
        cumulative_stage_wins: 0,
        cumulative_gc_wins: 0,
        plan_start_season_number: currentSeasonNumber + 1,
        plan_end_season_number: currentSeasonNumber + planDuration,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);
      throwIfSupabaseError(boardUpdateError, `Could not update completed board plan for ${team.name}`);

      // #666: title/message er DA fallback for legacy + dedup-signatur.
      // metadata.{titleCode, messageCode, *Params} driver locale-rendering.
      // feedback.headline/summary stammer fra boardEngine.evaluateBoardSeason
      // og er stadig DA-narrative — full board-feedback-i18n er ude af #666's
      // scope (spawnes som follow-up).
      await notifyManager(
        team.id,
        "board_update",
        "Board plan expired",
        `${feedback.headline}. ${feedback.summary} Satisfaction: ${newSatisfaction}%. Negotiate a new plan with the board.`,
        notificationDeps,
        {
          titleCode: "notif.boardPlanExpired.title",
          titleParams: {},
          messageCode: "notif.boardPlanExpired.message",
          messageParams: {
            headline: feedback.headline,
            summary: feedback.summary,
            satisfaction: newSatisfaction,
          },
        }
      );

      // S-02c · Replacement-trigger: 2× plan-udløb i træk under 30% sat → ny formand.
      // Counter lever på teams.consecutive_low_satisfaction_expirations (per-team).
      try {
        replacementInfo = await processReplacementTriggerFn({
          supabase: supabaseClient,
          teamId: team.id,
          satisfaction: newSatisfaction,
          identityBasis: team.season_1_identity_basis ?? null,
          dnaKey: team.team_dna_key ?? null,
        });

        if (replacementInfo?.replaced && replacementInfo.new_chairman_label) {
          await notifyManager(
            team.id,
            "board_update",
            "The board has chosen a new chairman",
            `After two disappointing plan seasons, the board has replaced the chairman. ${replacementInfo.new_chairman_label} takes over — expect a new tone in upcoming negotiations.`,
            notificationDeps,
            {
              titleCode: "notif.boardChairmanReplaced.title",
              titleParams: {},
              messageCode: "notif.boardChairmanReplaced.message",
              messageParams: { chairmanLabel: replacementInfo.new_chairman_label },
            }
          );
        }
      } catch (error) {
        console.error(`  ⚠️  board replacement-trigger failed for ${team.name}:`, error.message);
      }
    } else {
      // Plan still running — update cumulative stats, keep goals
      const { error: boardUpdateError } = await supabaseClient.from("board_profiles").update({
        satisfaction: newSatisfaction,
        budget_modifier: newModifier,
        seasons_completed: seasonsCompleted,
        cumulative_stage_wins: newCumulativeStageWins,
        cumulative_gc_wins: newCumulativeGcWins,
        updated_at: new Date().toISOString(),
      }).eq("id", board.id);
      throwIfSupabaseError(boardUpdateError, `Could not update active board plan for ${team.name}`);

      if (isMidReview) {
        const midMessageKey = newSatisfaction >= 60
          ? "notif.boardMidMessage.good"
          : newSatisfaction >= 40
          ? "notif.boardMidMessage.moderate"
          : "notif.boardMidMessage.bad";
        const midMsg = newSatisfaction >= 60
          ? "The board is pleased with your progress."
          : newSatisfaction >= 40
          ? "The board is moderately pleased with your progress."
          : "The board is worried about your progress in the plan.";
        await notifyManager(
          team.id,
          "board_update",
          "Mid-plan review",
          `Mid-plan review: ${midMsg} ${feedback.summary} Satisfaction: ${newSatisfaction}%.`,
          notificationDeps,
          {
            titleCode: "notif.boardMidReview.title",
            titleParams: {},
            messageCode: "notif.boardMidReview.message",
            messageParams: {
              midMessageKey,
              summary: feedback.summary,
              satisfaction: newSatisfaction,
            },
          }
        );
      } else {
        const planLabelKey = planLabelKey_(board.plan_type);
        const delta = newSatisfaction - anchorSatisfaction;
        const planLabelEn = { "1yr": "1-year plan", "3yr": "3-year plan", "5yr": "5-year plan" }[board.plan_type] || "plan";
        await notifyManager(
          team.id,
          "board_update",
          "Season report",
          `Season ${seasonsCompleted}/${planDuration} of your ${planLabelEn} complete. ${feedback.summary} Satisfaction: ${newSatisfaction}% (${delta >= 0 ? "+" : ""}${delta}).`,
          notificationDeps,
          {
            titleCode: "notif.boardSeasonReport.title",
            titleParams: {},
            messageCode: delta >= 0 ? "notif.boardSeasonReport.messageGain" : "notif.boardSeasonReport.messageLoss",
            messageParams: {
              seasonsCompleted,
              planDuration,
              planLabelKey,
              summary: feedback.summary,
              satisfaction: newSatisfaction,
              delta,
            },
          }
        );
      }
    }

    // S-02e · Konsekvens-tier (lag 2-6). Lag 1 (passive sponsor-modifier) er
    // allerede skrevet via newModifier ovenfor. Hookes her efter board_profiles-
    // update + replacement-trigger så vi kender (a) endelig satisfaction,
    // (b) goalsMet/goalsTotal, (c) om en chairman-replacement netop fyrede
    // (signal til "double_plan_lapse"-trigger på lag 5).
    try {
      const triggerDoublePlanLapse = Boolean(planIsComplete && replacementInfo?.replaced);
      await evaluateAndApplyConsequencesFn({
        supabase: supabaseClient,
        team,
        board,
        newSatisfaction,
        goalsMet,
        goalsTotal: goals.length,
        planIsComplete,
        seasonId,
        consecutiveLowExpirations: triggerDoublePlanLapse ? 2 : 0,
        boardTestMode,
        notify: ({ type, title, message, metadata }) => notifyManager(team.id, type, title, message, notificationDeps, metadata ?? null),
      });
    } catch (error) {
      console.error(`  ⚠️  board consequences failed for ${team.name}:`, error.message);
    }

    console.log(
      `  📊 ${team.name}: satisfaction ${anchorSatisfaction}% → ${newSatisfaction}% `
      + `(season ${seasonsCompleted}/${planDuration}, score ${Math.round((scoreBreakdown.adjusted_overall_score || 0) * 100)}%)`
    );
  }
}

// ─── Rider Value & Salary Recalculation ──────────────────────────────────────

async function fetchAllRows(buildQuery, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

// Fixed valuation window: prize_earnings_bonus averages a rider's prize earnings
// over this many seasons, dividing by the window size even before it is full
// (owner decision 2026-06-08). See updateRiderValues JSDoc.
const VALUATION_WINDOW_SEASONS = 3;

/**
 * Recalculates prize_earnings_bonus for every rider.
 *
 * prize_earnings_bonus = the rider's total prize earnings summed over a fixed
 * 3-season window, divided by 3. Seasons not yet raced count as 0.
 *
 *   prize_earnings_bonus = round( Σ earnings_s / 3 )
 *
 * Window: the up to 3 newest seasons by `number` (the single `active` season, if
 * any, occupies the newest slot; older slots are `completed` seasons with
 * race_days_total > 0). Empty placeholder/seed seasons (race_days_total = 0) are
 * excluded so they never consume a window slot.
 *
 * The divisor is ALWAYS 3 (the window size), not the number of seasons that
 * actually have data (owner decision 2026-06-08). This deliberately dampens early
 * values and lets them build up over the first three seasons:
 *   season 1 → s1/3, season 2 → (s1+s2)/3, season 3 → (s1+s2+s3)/3.
 * From season 3 onward the window is always full, so this matches the prior
 * "mean over 3 completed seasons" behaviour; only seasons 1-2 change.
 *
 * Called both at season end (processDivisionEnd) and at prize payout
 * (paySeasonPrizesToDate) so values track the active season's prizes live (R3,
 * issue #895). See docs/slices/prize-money-audit-r3-design.md.
 *
 * salary er en GENERATED STORED column (se database/2026-06-10-value-cutover-base-value.sql)
 * — DB genberegner automatisk når base_value eller prize_earnings_bonus opdateres (#1101).
 */
export async function updateRiderValues(supabaseClient) {
  const { data: activeSeason } = await supabaseClient
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .maybeSingle();

  // Kun sæsoner der FAKTISK havde racing tæller i værdi-gennemsnittet. En tom
  // placeholder/seed-sæson (fx sæson 0: status='completed', race_days_total=0,
  // 0 løb) ville ellers indgå med vægt 1 og 0 optjening → den fortynder ALLE
  // rytter-bonusser (her ~38%). race_days_total>0 er diskriminatoren (filtreres
  // før .limit, så en placeholder ikke spiser en af de 3 pladser).
  const { data: completedSeasons } = await supabaseClient
    .from("seasons")
    .select("id, number")
    .eq("status", "completed")
    .gt("race_days_total", 0)
    .order("number", { ascending: false })
    .limit(3);

  // Rolling window: active (newest slot) + completed, newest-first, up to 3.
  const windowSeasons = [
    ...(activeSeason ? [{ id: activeSeason.id, number: activeSeason.number, isActive: true }] : []),
    ...(completedSeasons || []).map(s => ({ id: s.id, number: s.number, isActive: false })),
  ]
    .sort((a, b) => b.number - a.number)
    .slice(0, 3);

  const seasonIds = windowSeasons.map(s => s.id);

  // Build per-rider per-season prize totals from race_results
  const riderSeasonEarnings = {};

  if (seasonIds.length > 0) {
    const races = await fetchAllRows(() => (
      supabaseClient
        .from("races")
        .select("id, season_id")
        .in("season_id", seasonIds)
    ));

    const raceIds = (races || []).map(r => r.id);

    if (raceIds.length > 0) {
      const raceSeasonMap = Object.fromEntries((races || []).map(r => [r.id, r.season_id]));

      const results = await fetchAllRows(() => (
        supabaseClient
          .from("race_results")
          .select("rider_id, race_id, prize_money")
          .in("race_id", raceIds)
          .gt("prize_money", 0)
      ));

      for (const row of results || []) {
        const sid = raceSeasonMap[row.race_id];
        if (!sid || !row.rider_id) continue;
        if (!riderSeasonEarnings[row.rider_id]) riderSeasonEarnings[row.rider_id] = {};
        riderSeasonEarnings[row.rider_id][sid] =
          (riderSeasonEarnings[row.rider_id][sid] || 0) + (row.prize_money || 0);
      }
    }
  }

  const allRiders = await fetchAllRows(() => (
    supabaseClient
      .from("riders")
      .select("id")
  ));

  // Fixed 3-season window: divide by 3 regardless of how many seasons have data,
  // so not-yet-raced seasons count as 0 and early values build up (see JSDoc +
  // owner decision 2026-06-08). seasonIds still scopes the numerator below.
  const divisor = VALUATION_WINDOW_SEASONS;

  const updates = [];

  for (const rider of allRiders || []) {
    const earningsSum = seasonIds.reduce(
      (sum, sid) => sum + (riderSeasonEarnings[rider.id]?.[sid] || 0),
      0
    );
    const newBonus = Math.round(earningsSum / divisor);

    updates.push({
      id: rider.id,
      prize_earnings_bonus: newBonus,
    });
  }

  for (let i = 0; i < updates.length; i += RIDER_VALUE_PATCH_CONCURRENCY) {
    const batch = updates.slice(i, i + RIDER_VALUE_PATCH_CONCURRENCY);
    await Promise.all(batch.map(async ({ id, ...payload }) => {
      const { error } = await supabaseClient
        .from("riders")
        .update(payload)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }));
  }

  const ridersUpdated = allRiders?.length || 0;
  console.log(`  🏅 Rider values recalculated: ${ridersUpdated} ryttere opdateret`);
  return { ridersUpdated };
}

/**
 * Bygger pulje-træet (forælder/barn) fra league_divisions' pool_index. Strukturen er
 * et binært træ (1/2/4/8 puljer): forælder(T,i) = (T-1, ⌊i / ratio⌋); børn = pool_index
 * i tieren under der mapper tilbage. ratio = puljer(T) / puljer(T-1). Udledt fra data
 * (robust mod fremtidig pyramide-udvidelse) — INGEN migration nødvendig.
 */
export async function buildPoolTree(client) {
  const { data: lds, error } = await client
    .from("league_divisions")
    .select("id, tier, pool_index");
  throwIfSupabaseError(error, "Could not load league_divisions for pool tree");
  const byId = new Map();
  const byTierIdx = new Map();
  const poolsPerTier = new Map();
  for (const ld of lds || []) {
    byId.set(ld.id, ld);
    byTierIdx.set(`${ld.tier}:${ld.pool_index}`, ld.id);
    poolsPerTier.set(ld.tier, (poolsPerTier.get(ld.tier) || 0) + 1);
  }
  const parentOf = (poolId) => {
    const p = byId.get(poolId);
    if (!p || p.tier <= MIN_DIVISION) return null;
    const ratio = (poolsPerTier.get(p.tier) || 1) / (poolsPerTier.get(p.tier - 1) || 1) || 1;
    return byTierIdx.get(`${p.tier - 1}:${Math.floor(p.pool_index / ratio)}`) ?? null;
  };
  const childrenOf = (poolId) => {
    const p = byId.get(poolId);
    if (!p || p.tier >= MAX_DIVISION) return [];
    const ratio = (poolsPerTier.get(p.tier + 1) || 1) / (poolsPerTier.get(p.tier) || 1) || 1;
    const ids = [];
    for (let k = 0; k < ratio; k++) {
      const id = byTierIdx.get(`${p.tier + 1}:${p.pool_index * ratio + k}`);
      if (id != null) ids.push(id);
    }
    return ids;
  };
  return { byId, parentOf, childrenOf, poolsPerTier };
}

/**
 * Per-pulje op/nedrykning (#1152 binær-træ-model, ejer-besluttet 2026-06-23).
 *
 * For HVER pulje i denne tier (division): rykker top PROMOTION_SLOTS op til puljens
 * FORÆLDER-pulje (tieren over), og relegerer bund RELEGATION_SLOTS delt ligeligt ud i
 * puljens BØRNE-puljer (tieren under). Sætter BÅDE division (tier) OG league_division_id
 * (pulje). Kun ægte hold flyttes — AI er fyld der regenereres pr. pulje af
 * reconcileAiTeamsForPool i AI-fyld-sweepet bagefter (processSeasonEnd).
 *
 * Div4-udskydelse (ejer): en Div3-pulje relegerer KUN til sine Div4-børn når den pulje
 * udelukkende består af ægte managere (ingen AI tilbage). Indtil da er Div3 gulvet og
 * Div4-puljerne forbliver dormant. Forælder/barn udledes fra pool_index (ingen migration).
 */
export async function processDivisionEnd(standings, division, seasonId, seasonNumber, deps = {}) {
  const client = deps.supabase ?? await getDefaultSupabaseClient();
  const notificationDeps = { supabase: client, now: deps.now };
  if (seasonNumber < FIRST_PROMOTION_RELEGATION_SEASON) {
    console.log(`  ⏸  Div ${division}: op/nedrykning sprunget over (sæson ${seasonNumber} < ${FIRST_PROMOTION_RELEGATION_SEASON})`);
    return;
  }

  const tree = deps.poolTree ?? await buildPoolTree(client);

  // Gruppér tierens standings pr. pulje. rank_in_division er allerede pr. pulje, så vi
  // sorterer på den (rank 1 = bedst).
  const byPool = new Map();
  for (const s of standings) {
    if (s.league_division_id == null) continue; // pre-pulje-hold (NULL) springes over
    if (!byPool.has(s.league_division_id)) byPool.set(s.league_division_id, []);
    byPool.get(s.league_division_id).push(s);
  }

  let promoted = 0;
  let relegated = 0;
  for (const [poolId, poolStandings] of byPool) {
    poolStandings.sort((a, b) => (a.rank_in_division ?? 1e9) - (b.rank_in_division ?? 1e9));
    if (poolStandings.length < PROMOTION_SLOTS + 1) continue; // for lille pulje at flytte

    // ── OP: top PROMOTION_SLOTS → forælder-pulje ──
    if (division > MIN_DIVISION) {
      const parentPoolId = tree.parentOf(poolId);
      if (parentPoolId != null) {
        for (const s of poolStandings.slice(0, PROMOTION_SLOTS)) {
          if (s.team?.is_ai) continue; // AI er fyld — flyttes ikke
          const { error } = await client.from("teams")
            .update({ division: division - 1, league_division_id: parentPoolId })
            .eq("id", s.team_id);
          throwIfSupabaseError(error, `Could not promote team ${s.team_id}`);
          await notifyManager(
            s.team_id, "board_update", "Oprykket! 🎉",
            `Tillykke! Dit hold rykker op til Division ${division - 1}`, notificationDeps
          );
          promoted++;
        }
      }
    }

    // ── NED: bund RELEGATION_SLOTS delt ligeligt → børne-puljer ──
    if (division < MAX_DIVISION) {
      const childPoolIds = tree.childrenOf(poolId);
      // Div4-udskydelse: børn i tier < MAX_DIVISION er altid aktive; Div4-børn (tier ===
      // MAX_DIVISION) aktiveres først når DENNE pulje er all-real (ingen AI tilbage).
      const childTier = division + 1;
      const poolAllReal = poolStandings.length >= POOL_TARGET_SIZE && poolStandings.every((s) => !s.team?.is_ai);
      const childrenActive = childTier < MAX_DIVISION || poolAllReal;
      if (childrenActive && childPoolIds.length) {
        const bottom = poolStandings.slice(Math.max(PROMOTION_SLOTS, poolStandings.length - RELEGATION_SLOTS));
        let realIdx = 0;
        for (const s of bottom) {
          if (s.team?.is_ai) continue;
          const dest = childPoolIds[realIdx % childPoolIds.length];
          realIdx++;
          const { error } = await client.from("teams")
            .update({ division: division + 1, league_division_id: dest })
            .eq("id", s.team_id);
          throwIfSupabaseError(error, `Could not relegate team ${s.team_id}`);
          await notifyManager(
            s.team_id, "board_update", "Relegation",
            `Your team drops to Division ${division + 1}.`, notificationDeps,
            {
              titleCode: "notif.divisionRelegated.title",
              titleParams: {},
              messageCode: "notif.divisionRelegated.message",
              messageParams: { division: division + 1 },
            }
          );
          relegated++;
        }
      }
    }
  }

  if (promoted || relegated) {
    console.log(`  📈 Div ${division}: ${promoted} oprykket, ${relegated} relegeret (per pulje)`);
  }
}

// #1152: rebalanceDivisions (#962 tier-fyld-fra-top) er FJERNET — superseded af den
// per-pulje AI-fyld-sweep i processSeasonEnd (reconcileAiTeamsForPool pr. pulje). Den
// gamle funktion trak ægte hold op uden for sporten + satte kun division (ikke
// league_division_id); pulje-modellen fylder huller med AI i stedet.

// ─── Standing Updates ─────────────────────────────────────────────────────────

/**
 * Recalculate the full season standings from stored race results.
 * This keeps standings idempotent even when results are approved in batches.
 */
export async function updateStandings(seasonId, raceId = null, deps = {}) {
  const supabaseClient = deps.supabase ?? await getDefaultSupabaseClient();
  const [{ data: teams, error: teamsError }, { data: races, error: racesError }] = await Promise.all([
    supabaseClient.from("teams").select("id, division, league_division_id"),
    supabaseClient.from("races").select("id").eq("season_id", seasonId),
  ]);

  if (teamsError) throw new Error(teamsError.message);
  if (racesError) throw new Error(racesError.message);

  const teamStats = {};
  for (const team of teams || []) {
    teamStats[team.id] = {
      division: team.division || 3,
      // Pulje-reference (race/standings-gruppe, #1608). NULL = endnu ikke pulje-
      // allokeret → rang falder tilbage til tier (division), så pre-pulje-DB'er virker.
      league_division_id: team.league_division_id ?? null,
      points: 0,
      stage_wins: 0,
      gc_wins: 0,
      races_completed: new Set(),
    };
  }

  const raceIds = (races || []).map(race => race.id);
  if (raceIds.length > 0) {
    // race_results kan overstige PostgREST's 1000-row-loft (sæson 1 har ~2.2k
    // rækker). Et naivt .select().in() returnerer KUN de første 1000 → standings
    // underberegnes systematisk (point tabt for hold hvis rækker falder uden for
    // første side). fetchAllRows paginerer; .order("id") gør siderne stabile.
    const results = await fetchAllRows(() => (
      supabaseClient
        .from("race_results")
        .select("race_id, team_id, result_type, rank, points_earned, rider:rider_id(team_id)")
        .in("race_id", raceIds)
        .order("id", { ascending: true })
    ));

    for (const result of results || []) {
      const teamId = result.team_id || result.rider?.team_id;
      if (!teamId) continue;

      if (!teamStats[teamId]) {
        teamStats[teamId] = {
          division: 3,
          league_division_id: null,
          points: 0,
          stage_wins: 0,
          gc_wins: 0,
          races_completed: new Set(),
        };
      }

      teamStats[teamId].points += result.points_earned || 0;
      if (result.race_id) teamStats[teamId].races_completed.add(result.race_id);
      if (result.result_type === "stage" && result.rank === 1) teamStats[teamId].stage_wins++;
      if (result.result_type === "gc" && result.rank === 1) teamStats[teamId].gc_wins++;
    }
  }

  // Hent eksisterende penalty_points så ranking bruger effective points (total - penalty).
  // S-03: trupstørrelse-fradrag skal påvirke placeringen, ikke kun visningen.
  const teamIds = Object.keys(teamStats);
  const penaltyByTeamId = new Map();
  if (teamIds.length > 0) {
    const { data: penaltyRows, error: penaltyError } = await supabaseClient
      .from("season_standings")
      .select("team_id, penalty_points")
      .eq("season_id", seasonId)
      .in("team_id", teamIds);
    if (penaltyError) throw new Error(penaltyError.message);
    for (const row of penaltyRows || []) {
      penaltyByTeamId.set(row.team_id, row.penalty_points || 0);
    }
  }

  // #1608: rang beregnes INDEN FOR puljen (league_division_id), ikke på tværs af
  // hele tier'en. Pulje er den frosne race/standings-gruppe; to puljer i samme tier
  // har hver deres rang-1. Pre-pulje-hold (league_division_id = NULL) falder tilbage
  // til tier-bred rang (gruppér på "tier:<division>"), så gamle DB'er bevarer adfærd.
  const poolKeyOf = (stats) =>
    stats.league_division_id != null
      ? `pool:${stats.league_division_id}`
      : `tier:${stats.division || 3}`;

  const rankByTeamId = new Map();
  const poolKeys = [...new Set(Object.values(teamStats).map(poolKeyOf))];
  for (const poolKey of poolKeys) {
    const rankedTeams = Object.entries(teamStats)
      .filter(([, stats]) => poolKeyOf(stats) === poolKey)
      .sort(([leftId, left], [rightId, right]) => {
        const leftEffective = (left.points || 0) - (penaltyByTeamId.get(leftId) || 0);
        const rightEffective = (right.points || 0) - (penaltyByTeamId.get(rightId) || 0);
        if (rightEffective !== leftEffective) {
          return rightEffective - leftEffective;
        }
        return 0;
      });

    rankedTeams.forEach(([teamId], index) => {
      rankByTeamId.set(teamId, index + 1);
    });
  }

  const timestamp = new Date().toISOString();
  const rows = Object.entries(teamStats).map(([teamId, stats]) => ({
    season_id: seasonId,
    team_id: teamId,
    division: stats.division,
    league_division_id: stats.league_division_id,
    rank_in_division: rankByTeamId.get(teamId) || null,
    total_points: stats.points,
    stage_wins: stats.stage_wins,
    gc_wins: stats.gc_wins,
    races_completed: stats.races_completed.size,
    updated_at: timestamp,
  }));

  const { error: upsertError } = await supabaseClient
    .from("season_standings")
    .upsert(rows, { onConflict: "season_id,team_id" });
  if (upsertError) throw new Error(upsertError.message);

  console.log(`  📊 Standings recalculated for ${rows.length} teams${raceId ? ` after race ${raceId}` : ""}`);

  return {
    rowsUpdated: rows.length,
    teamsWithPoints: rows.filter(row => row.total_points > 0).length,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Slice 07c · balance + finance_transactions atomic via RPC. Når options.idempotent=true
// passerer vi `allowDuplicate: true` så hele transaktionen rulles tilbage stille hvis
// DB afviser INSERT med 23505 (fra de partial UNIQUE-indices på sponsor/salary/bonus).
// Hverken balance eller finance row ændres — perfekt cron-retry-sikkerhed.
//
// Slice 07d Fase B · audit-felter populeres fra `audit`-options:
//   { sourcePath, reasonCode, idempotencyKey?, actorType?, actorId? }.
// Defaults: actorType=cron, actorId=null, related_entity=season+seasonId.
async function creditTeam(teamId, amount, type, description, seasonId, supabaseClient = null, options = {}) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const audit = options.audit || {};

  const result = await incrementBalanceWithAudit(
    client,
    {
      teamId,
      delta: amount,
      payload: {
        type,
        amount,
        description,
        season_id: seasonId,
        actor_type: audit.actorType || FINANCE_ACTOR_TYPE.CRON,
        actor_id: audit.actorId || null,
        source_path: audit.sourcePath,
        reason_code: audit.reasonCode,
        related_entity_type: audit.relatedEntityType || FINANCE_RELATED_ENTITY.SEASON,
        related_entity_id: audit.relatedEntityId || seasonId || null,
        idempotency_key: audit.idempotencyKey,
        metadata: options.metadata ?? null,
      },
    },
    { allowDuplicate: !!options.idempotent }
  );

  if (result.skipped) {
    console.warn(
      `[economy] ${type} already credited for team ${teamId} season ${seasonId} — skip`
    );
  }
  return { skipped: result.skipped };
}

async function debitTeam(teamId, amount, type, description, seasonId, supabaseClient = null, options = {}) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const audit = options.audit || {};

  const result = await incrementBalanceWithAudit(
    client,
    {
      teamId,
      delta: -amount,
      payload: {
        type,
        amount: -amount,
        description,
        season_id: seasonId,
        actor_type: audit.actorType || FINANCE_ACTOR_TYPE.CRON,
        actor_id: audit.actorId || null,
        source_path: audit.sourcePath,
        reason_code: audit.reasonCode,
        related_entity_type: audit.relatedEntityType || FINANCE_RELATED_ENTITY.SEASON,
        related_entity_id: audit.relatedEntityId || seasonId || null,
        idempotency_key: audit.idempotencyKey,
        metadata: options.metadata ?? null,
      },
    },
    { allowDuplicate: !!options.idempotent }
  );

  if (result.skipped) {
    console.warn(
      `[economy] ${type} already debited for team ${teamId} season ${seasonId} — skip`
    );
  }
  return { skipped: result.skipped };
}

async function notifyManager(teamId, type, title, message, deps = {}, metadata = null) {
  const client = deps.supabase ?? await getDefaultSupabaseClient();
  await notifyTeamOwnerShared({
    supabase: client,
    teamId,
    type,
    title,
    message,
    metadata,
    now: deps.now,
  });
}

// #666: build per-plan-type i18n key (1yr/3yr/5yr) — used in board notifications
// where the message references "din 3-årsplan" / "your 3-year plan". Backend can't
// localise — so we emit the key and let frontend resolve via planLabel.<key>.
function planLabelKey_(planType) {
  if (planType === "1yr" || planType === "3yr" || planType === "5yr") {
    return `planLabel.${planType}`;
  }
  return "planLabel.unknown";
}
