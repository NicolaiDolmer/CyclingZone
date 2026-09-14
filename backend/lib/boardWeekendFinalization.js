// #1187 · Live-wiring af løbende bestyrelses-tilfredshed (weekend-finalization).
// =============================================================================
// Kobler den rene weekend-mekanik (boardWeekendUpdate.js, PR #1265 — scorecard
// ejer-godkendt 11/6) på de eksisterende weekend-finalization-stier:
//   - pcmResultsImport.importPcmResults   (PCM-upload, nød-fallback efter relaunch)
//   - raceRunner.simulateRace             (egen race-motor, #1102 — relaunch 20/6)
//   (raceResultsSheetSync var tredje sti indtil Sheets-importen blev fjernet
//    2026-06-12, #1180 pkt 3 / #1179.)
// Begge kalder processBoardWeekendFinalization efter recomputeSeasonRaceDays,
// dvs. én opdatering pr. finaliserings-event (typisk = én løbsweekend).
//
// Ejer-beslutninger 11/6 (issue #1187):
//   1. Trigger pr. løbsweekend (her), ingen ny cron.
//   2. Clamp ±5/weekend (WEEKEND_SATISFACTION_CLAMP i boardWeekendUpdate.js).
//   3. Hårde konsekvens-lag (2-5) KUN ved checkpoints: mid-season (her, via
//      race-days-krydsning af midpoint = floor(total/2), samme formel som
//      boardMidSeason.js) + sæson-slut (uændret i processTeamSeasonEnd).
//      Blød genforhandlings-trigger (<50, boardMidSeason-cron) er uændret.
//   4. Budget-modifier følger LIVE (satisfactionToModifier persiseres pr. weekend;
//      processSeasonStart + finance-forecast læser den aktuelle DB-værdi).
//   5. board_test_mode (#805): satisfaction/modifier må bevæge sig synligt, men
//      økonomi-effekten neutraliseres dér hvor udbetalinger sker
//      (processSeasonStart tvinger 1.0; lag 4/5 suppress i evaluateAndApply-
//      Consequences via boardTestMode-flaget vi sender med her).
//
// Anker (target-tracking): target = sæson-start-satisfaction + sæson-delta.
// Sæson-start-værdien persisteres på board_profiles (season_start_satisfaction +
// season_start_anchor_season_id, migration 2026-06-11) ved første weekend i
// sæsonen og genbruges resten af sæsonen. processTeamSeasonEnd læser samme
// anker, så sæson-slut-evalueringen lander på anker+delta (= præcis dagens
// resultat) i stedet for at dobbelt-anvende deltaet oven i den konvergerede
// løbende værdi.
//
// Idempotens/re-import: recomputeSeasonRaceDays er idempotent, så et re-import
// af samme løb ændrer ikke race_days → ingen ny mid-checkpoint-krydsning. Selve
// satisfaction-opdateringen er target-trackende og konvergerende: et ekstra
// kald flytter højst tallet ÉT clamp-skridt nærmere det (stabile) target —
// aldrig forbi det.
//
// Population: SAMME diskriminator som UI/boardMidSeason (match-UI-filter-reglen):
// rigtige hold = is_ai=false, is_bank=false, is_frozen=false, is_test_account=false.
// Planer: negotiation_status='completed' — inkl. is_baseline=true fra og med #2521
// (se nedenfor), is_baseline=false uændret (samme som sæson-slut).
//
// #2521 · Baseline-bestyrelsen lever. Sæson 1/baseline-boards (createBaselineProfile,
// boardGoals.js) sprang tidligere denne opdatering helt over (satisfaction låst på
// 50). Fra og med #2521 deltager de OGSÅ i weekend-opdateringen, men mod et
// syntetisk target (computeBaselineWeekendUpdate, boardWeekendUpdate.js) i stedet
// for forhandlede mål — se funktionens kommentar for vægte/kalibrering. Klampet til
// [30,75] (ejer-valgt løsning A: bestyrelsen "observerer", bliver hverken ekstatisk
// eller fyrings-vred). budget_modifier RØRES IKKE for baseline (forbliver 1.0), og
// de hårde konsekvens-lag (mid-season-checkpointet nedenfor) springes eksplicit
// over for baseline-boards — season-end-evalueringen (economyEngine.js) fortsætter
// uændret med at skippe is_baseline=true.

import {
  computeWeekendSatisfactionUpdate,
  computeBaselineWeekendUpdate,
  resolveReasonCategory,
  CHECKPOINT_KINDS,
} from "./boardWeekendUpdate.js";
import { evaluateAndApplyConsequences as evaluateAndApplyConsequencesShared } from "./boardConsequences.js";
import { applyWeekendSync as applyMandateWeekendSyncShared } from "./boardMandateEngine.js";
import { isBoardTestModeActive } from "./boardTestMode.js";
import {
  buildBoardEvalContext,
  loadGoalContextForBoard,
  prefetchGoalContextSources,
  selectGoalContextSourcesForTeam,
} from "./boardGoalContext.js";
import { U25_ABILITY_KEYS } from "./boardGoals.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
// #1237 · sumRiderSalaries = wageBillPerSeason-input til no_outstanding_debt
// (scoreFinanceHealthGoal, boardUtils.js).
import { sumRiderSalaries } from "./boardUtils.js";
import { notifyTeamOwner } from "./notificationService.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";

function toFiniteOr(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// #5182 · Hvor mange hold der behandles SAMTIDIG (design-sessionens mulighed B,
// docs/drafts/5182-board-flaskehals-designsession.md §5.B). Arbejdet pr. hold er
// ren netværks-ventetid (~80 ms pr. Supabase-kald), så serveren sad stille i
// 8½ minut pr. løb. 8 er bevidst lavt: nok til at skjule latenstiden, langt
// under connection-pool-loftet, og en fejl rammer stadig kun ét holds boards
// (try/catch pr. board er uændret).
//
// Sikkerheden hviler på at to hold ALDRIG skriver den samme række — se
// `runTeamBatches` nedenfor for beviset og for hvorfor mid-season-checkpointet
// bevidst holdes sekventielt.
export const BOARD_FINALIZATION_TEAM_BATCH_SIZE = 8;

// Postgres-paritet for `ORDER BY created_at DESC` (default NULLS FIRST).
/**
 * @param {{ created_at?: string|null }} a
 * @param {{ created_at?: string|null }} b
 * @returns {number}
 */
function byCreatedAtDesc(a, b) {
  const left = a?.created_at ?? null;
  const right = b?.created_at ?? null;
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

// Projektion til PRÆCIS de kolonner den gamle pr.-hold-query bad om, så
// context.recentSnapshots har samme form som før (fake'en og PostgREST
// projicerer begge outputtet ned til select()-listen).
/**
 * @param {{ goals_met?: number|null, goals_total?: number|null, satisfaction_delta?: number|null }} row
 */
function toRecentSnapshotRow(row) {
  return {
    goals_met: row?.goals_met,
    goals_total: row?.goals_total,
    satisfaction_delta: row?.satisfaction_delta,
  };
}

// #3144 · Denne finalization kører for ALLE rigtige hold på tværs af ALLE
// divisioner/puljer hver gang ÉT løb finaliserer (satisfaction-target-
// tracking er tilsigtet globalt — se header). Men det race-mærkede
// board_satisfaction_events-row (vist i BoardSatisfactionTimeline som
// "bestyrelsen reagerede på <race_name>") må KUN skrives for hold der
// faktisk er i det løbs pulje — ellers ser en Division 2-manager bestyrelsen
// "reagere begejstret" på et Division 3-løb holdet aldrig kørte.
// Ukendt pulje på enten løb eller standing (legacy/test-data) → ingen
// filtrering (bagudkompatibelt, matcher adfærden før #3144).
function raceMatchesTeamPool(race, standing) {
  if (race?.league_division_id == null) return true;
  if (standing?.league_division_id == null) return true;
  return standing.league_division_id === race.league_division_id;
}

/**
 * Afgør om DENNE finalization krydsede mid-season-checkpointet.
 * Mid-point = floor(race_days_total / 2) — samme formel som boardMidSeason.js.
 * Sæson-slut (done >= total) håndteres IKKE her: de hårde lag ved sæson-slut
 * kører uændret i processTeamSeasonEnd.
 */
export function resolveCrossedCheckpoint({
  previousRaceDaysCompleted,
  raceDaysCompleted,
  raceDaysTotal,
} = {}) {
  const prev = previousRaceDaysCompleted === null || previousRaceDaysCompleted === undefined
    ? null
    : toFiniteOr(previousRaceDaysCompleted, null);
  if (prev === null) return null; // ukendt udgangspunkt → aldrig hårde lag uden evidens
  const done = toFiniteOr(raceDaysCompleted, 0);
  const total = Math.max(1, toFiniteOr(raceDaysTotal, 0));
  const midpoint = Math.floor(total / 2);
  if (midpoint <= 0) return null;
  if (prev < midpoint && done >= midpoint && done < total) return CHECKPOINT_KINDS.MID_SEASON;
  return null;
}

/**
 * Hoved-entry: opdater satisfaction + budget_modifier for alle aktive planer på
 * rigtige human-hold efter en finaliseret løbsweekend, og kør de hårde
 * konsekvens-lag hvis mid-season-checkpointet netop blev krydset.
 *
 * @param {object} args
 * @param {object} args.supabase  — Supabase client (service role)
 * @param {object} args.season    — { id, number, status, race_days_total } +
 *                                  race_days_completed = NY værdi (efter recompute)
 * @param {number|null} args.previousRaceDaysCompleted — race_days_completed FØR
 *                                  denne finalization (til checkpoint-krydsning)
 * @param {Date}   [args.now]
 * @param {object} [args.deps]    — test-injektion: { isBoardTestModeActive,
 *                                  evaluateAndApplyConsequences, loadGoalContext,
 *                                  notifyTeamOwner }
 * @returns {Promise<object>} summary
 */
export async function processBoardWeekendFinalization({
  supabase,
  season,
  previousRaceDaysCompleted = null,
  race = null,
  now = new Date(),
  captureExceptionFn = null,
  deps = {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");

  const summary = {
    season_id: season?.id ?? null,
    teams_checked: 0,
    boards_updated: 0,
    baseline_boards_updated: 0, // #2521
    checkpoint: null,
    consequences_applied: 0,
    events_written: 0,
    errors: 0,
    skipped_reason: null,
    // #3514 fase 1-rest: kun >0 når kill-switchen er 'on' — 0 er den korrekte
    // værdi for hele populationen indtil flip.
    mandate_relations_synced: 0,
  };

  if (!season?.id) {
    summary.skipped_reason = "no_season";
    return summary;
  }
  // Kun den aktive sæson har en levende bestyrelse — historiske re-imports
  // (fx Sheets-sync af gamle sæsoner) må ikke flytte satisfaction.
  if (season.status !== "active") {
    summary.skipped_reason = "season_not_active";
    return summary;
  }

  const isTestModeActiveFn = deps.isBoardTestModeActive ?? isBoardTestModeActive;
  const evaluateAndApplyConsequencesFn =
    deps.evaluateAndApplyConsequences ?? evaluateAndApplyConsequencesShared;
  const loadGoalContextFn = deps.loadGoalContext ?? loadGoalContextForBoard;
  const notifyTeamOwnerFn = deps.notifyTeamOwner ?? notifyTeamOwner;
  const computeWeekendUpdateFn = deps.computeWeekendUpdate ?? computeWeekendSatisfactionUpdate;
  const computeBaselineUpdateFn = deps.computeBaselineWeekendUpdate ?? computeBaselineWeekendUpdate;
  // #3514 fase 1-rest: skyggemodellens weekend-sync. Flag-gated INDENI
  // funktionen selv (returnerer null øjeblikkeligt når kill-switchen er off) —
  // dette kald ændrer derfor intet ved flag off, og ingen anden kode i denne
  // fil skal tjekke flaget.
  const applyMandateWeekendSyncFn = deps.applyMandateWeekendSync ?? applyMandateWeekendSyncShared;

  // #2951: teams-hentningen (153 rækker 25/7, samme diskriminator som andre
  // steder i filen) pagineret via fetchAllRows — samme klasse som riders/
  // board_profiles/loans nedenfor, blot en langsommere driver (team-count).
  const withPaginationErrorLabel = (promise, label) =>
    promise.catch((error) => {
      throw new Error(`Could not load ${label} for weekend board update: ${error.message}`);
    });

  // 1. Rigtige human-hold (match-UI-filter: ikke-AI/bank/test/frosne).
  const teams = await withPaginationErrorLabel(
    fetchAllRows(() => supabase
      .from("teams")
      // #2521 · `balance` er tilføjet til selectet: baseline-boards' økonomi-signal
      // (positiv saldo, ingen nødlån) i computeBaselineWeekendUpdate.
      .select("id, user_id, name, division, sponsor_income, balance, season_1_identity_basis, team_dna_key, created_at")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .order("id", { ascending: true })),
    "teams"
  );
  if (!teams?.length) {
    summary.skipped_reason = "no_human_teams";
    return summary;
  }
  const teamIds = teams.map((t) => t.id);

  // 2. Aktive planer + standings + riders + lån (batch).
  // #2932 P0: board_profiles/riders/loans pagineres nu via fetchAllRows (stabil
  // .order("id")) — samme 1000-rows-PostgREST-loft-bug som #2907
  // (loadHumanSeasonEndTeams, fixet i PR #2931). Denne funktion kører efter HVER
  // løbsweekend hele sæsonen (ikke kun ved sæson-slut), så et upagineret
  // .in()-load her lod weekend-board-evalueringer køre stille på et delvist
  // rytterfelt uge efter uge for hold hvis rækker faldt uden for side 1 — ikke en
  // fejl, ikke en tom række, bare fravær (prod 25/7: 2.652 ryttere på 156
  // menneskehold, langt over loftet). #2951: season_standings (367/1000 25/7,
  // samme team-count-driver) er nu OGSÅ pagineret — denne query har ingen
  // total_points-sortering, så .order("id") alene er nok som stabilt tiebreak.
  const [standings, boardsData, ridersData, loansData] = await Promise.all([
    withPaginationErrorLabel(
      fetchAllRows(() => supabase
        .from("season_standings")
        // #2521 · is_bank/is_frozen/is_test_account tilføjet: computeRealPoolPercentile
        // (baseline-target) skal filtrere puljen med SAMME diskriminator som resten af
        // filen, ikke kun is_ai (ellers tæller bank/test/frosne hold med i percentilen).
        .select("*, team:team_id(is_ai, is_bank, is_frozen, is_test_account)")
        .eq("season_id", season.id)
        .order("id", { ascending: true })),
      "season_standings"
    ),
    withPaginationErrorLabel(
      fetchAllRows(() => supabase
        .from("board_profiles")
        .select("*")
        .in("team_id", teamIds)
        .order("id", { ascending: true })),
      "board_profiles"
    ),
    withPaginationErrorLabel(
      fetchAllRows(() => supabase
        .from("riders")
        // Paritet med loadHumanSeasonEndTeams: identity-felter + U25-abilities,
        // så weekend-targettet evaluerer mod SAMME mål-kontekst som sæson-slut.
        .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}, rider_derived_abilities(${U25_ABILITY_KEYS.join(", ")})`)
        .in("team_id", teamIds)
        .order("id", { ascending: true })),
      "riders"
    ),
    withPaginationErrorLabel(
      fetchAllRows(() => supabase
        .from("loans")
        // #1237 · amount_remaining tilføjet: nettostilling-input til
        // no_outstanding_debt (scoreFinanceHealthGoal, boardUtils.js).
        .select("id, team_id, amount_remaining")
        .eq("status", "active")
        .in("team_id", teamIds)
        .order("id", { ascending: true })),
      "loans"
    ),
  ]);

  const standingByTeam = new Map((standings || []).map((s) => [s.team_id, s]));

  const boardsByTeam = new Map();
  for (const board of boardsData || []) {
    // #2521 · Baseline-boards deltager nu også (se header-kommentaren) —
    // negotiation_status='completed' holder stadig pending 1yr/3yr/5yr-forhandlinger ude.
    if (board.negotiation_status !== "completed") continue;
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }

  const ridersByTeam = new Map();
  for (const rider of ridersData || []) {
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const loanCountByTeam = new Map();
  // #1237 · sum af amount_remaining pr. hold — activeDebt-input til nettostillingen.
  const debtByTeam = new Map();
  for (const loan of loansData || []) {
    loanCountByTeam.set(loan.team_id, (loanCountByTeam.get(loan.team_id) || 0) + 1);
    debtByTeam.set(loan.team_id, (debtByTeam.get(loan.team_id) || 0) + (loan.amount_remaining || 0));
  }

  // 2b. #5182 · board_plan_snapshots ÉN gang for hele populationen.
  // ---------------------------------------------------------------------------
  // Rækkerne blev tidligere læst TO gange pr. hold: én gang her i løkken
  // (recentSnapshots, filtreret på team_id) og én gang inde i
  // loadGoalContextForBoard (plan-cyklussen, filtreret på board_id). Begge
  // delmængder ligger i det samme team_id-scope, så ét pagineret opslag dækker
  // dem begge; filtrene anvendes i JS nedenfor med samme prædikater som før.
  //
  // Fejl-paritet: den gamle pr.-hold-query talte en fejl i summary.errors og
  // SPRANG HOLDET OVER. Fejler prefetchen, ville nøjagtig samme query fejle for
  // hvert hold — derfor bæres fejlen med ind i løkken og håndteres pr. hold på
  // præcis samme måde (samme tælling, samme log-linje, samme Sentry-tag).
  let snapshotRowsByTeam = /** @type {Map<string, any[]>} */ (new Map());
  let snapshotRowsByBoard = /** @type {Map<string, any[]>} */ (new Map());
  let snapshotPrefetchError = /** @type {Error|null} */ (null);
  try {
    const snapshotRows = await fetchAllRowsChunkedIn(teamIds, (/** @type {string[]} */ chunk) => supabase
      .from("board_plan_snapshots")
      .select("id, team_id, board_id, season_id, season_number, season_within_plan, created_at, goals_met, goals_total, satisfaction_delta")
      .in("team_id", chunk)
      .order("id", { ascending: true }));
    for (const row of snapshotRows) {
      if (row?.team_id != null) {
        let forTeam = snapshotRowsByTeam.get(row.team_id);
        if (!forTeam) { forTeam = []; snapshotRowsByTeam.set(row.team_id, forTeam); }
        forTeam.push(row);
      }
      if (row?.board_id != null) {
        let forBoard = snapshotRowsByBoard.get(row.board_id);
        if (!forBoard) { forBoard = []; snapshotRowsByBoard.set(row.board_id, forBoard); }
        forBoard.push(row);
      }
    }
  } catch (error) {
    // best-effort: fejlen sluges IKKE — den bæres med ind i hold-løkken og
    // rapporteres dér PR. HOLD (summary.errors + console.error +
    // captureExceptionFn), præcis som den gamle pr.-hold-query gjorde. Ville vi
    // capture her i stedet, ville ÉN prefetch-fejl give ét Sentry-event i
    // stedet for den pr.-hold-rapportering stien har i dag.
    snapshotPrefetchError = /** @type {Error} */ (error);
    snapshotRowsByTeam = new Map();
    snapshotRowsByBoard = new Map();
  }

  // 2c. #5182 · De sæson-brede mål-kilder (race_results/finance_transactions)
  // ÉN gang for hele populationen i stedet for 5 opslag pr. board.
  // Sæson-vinduet pr. board er en delmængde af unionen herunder (et boards
  // planSeasonIds = dets egne snapshots' season_id + den aktuelle sæson), så
  // prefetchen kan ikke mangle en række et board ville have set.
  // `season.id` er allerede valideret ovenfor (tom → skipped_reason "no_season").
  const currentSeasonId = /** @type {{ id: string }} */ (season).id;
  const goalContextSeasonIds = [
    ...new Set([
      ...[...snapshotRowsByBoard.values()].flat().map((row) => row?.season_id).filter(Boolean),
      currentSeasonId,
    ]),
  ];
  const goalContextPrefetch = await prefetchGoalContextSources({
    supabase,
    teamIds,
    seasonIds: goalContextSeasonIds,
  });

  // 3. Checkpoint + test-mode (én gang pr. kørsel).
  const checkpoint = resolveCrossedCheckpoint({
    previousRaceDaysCompleted,
    raceDaysCompleted: season.race_days_completed,
    raceDaysTotal: season.race_days_total,
  });
  summary.checkpoint = checkpoint;
  const boardTestMode = await isTestModeActiveFn(supabase);

  const teamGoalContextSources = /** @type {Map<string, any>} */ (new Map());

  /** @param {any} team */
  const processTeam = async (team) => {
    const boards = boardsByTeam.get(team.id) || [];
    const standing = standingByTeam.get(team.id) || null;
    if (!boards.length || !standing) return;
    summary.teams_checked += 1;

    const riders = ridersByTeam.get(team.id) || [];
    const teamWithRiders = { ...team, riders };

    // recentSnapshots pr. team — samme udsnit som den tidligere pr.-hold-query
    // (`ORDER BY created_at DESC LIMIT 3`), nu skåret ud af 2b-prefetchen.
    if (snapshotPrefetchError) {
      summary.errors += 1;
      console.error(`  ⚠️  weekend board snapshots failed for ${team.name}:`, snapshotPrefetchError.message);
      if (captureExceptionFn) captureExceptionFn(snapshotPrefetchError, { tags: { hook: "board-weekend" }, extra: { teamId: team.id } });
      return;
    }
    let recentSnapshots = [];
    recentSnapshots = /** @type {any} */ ([...(snapshotRowsByTeam.get(team.id) || [])]
      .sort(byCreatedAtDesc)
      .slice(0, 3)
      .map(toRecentSnapshotRow));

    if (!teamGoalContextSources.has(team.id)) {
      teamGoalContextSources.set(team.id, selectGoalContextSourcesForTeam(goalContextPrefetch, team.id));
    }
    const goalContextSources = teamGoalContextSources.get(team.id);

    for (const board of boards) {
      try {
        // #2521 · Baseline-boards (sæson 1, ingen forhandlede mål) tager en
        // helt separat, letvægts-sti: intet goalContext/evaluateBoardSeason-kald
        // (kræver goals, som baseline ikke har), ingen budget_modifier-ændring,
        // og ALDRIG hårde konsekvens-lag — uanset om denne finalization krydser
        // mid-season-checkpointet. Se computeBaselineWeekendUpdate for vægte.
        if (board.is_baseline || board.plan_type === "baseline") {
          const baselineUpdate = computeBaselineUpdateFn({
            board,
            teamId: team.id,
            standing,
            standings,
            balance: team.balance,
            activeLoanCount: loanCountByTeam.get(team.id) || 0,
          });
          if (!baselineUpdate) continue;

          const { error: baselineUpdateError } = await supabase
            .from("board_profiles")
            .update({
              satisfaction: baselineUpdate.newSatisfaction,
              updated_at: now.toISOString(),
            })
            .eq("id", board.id);
          if (baselineUpdateError) throw new Error(baselineUpdateError.message);
          summary.boards_updated += 1;
          summary.baseline_boards_updated = (summary.baseline_boards_updated || 0) + 1;

          // #1451-mønster genbrugt til baseline: goals_met/goals_total er NOT
          // NULL i skemaet → 0/0 (baseline har ingen mål), reason_category null.
          // #3144 · kun skriv event når løbet faktisk er i holdets pulje.
          if (race?.id && raceMatchesTeamPool(race, standing)) {
            const { error: baselineEventError } = await supabase
              .from("board_satisfaction_events")
              .upsert({
                board_id: board.id,
                team_id: team.id,
                season_id: season.id,
                race_id: race.id,
                race_name: race.name ?? null,
                race_days_completed: season.race_days_completed ?? null,
                satisfaction_before: baselineUpdate.previousSatisfaction,
                satisfaction_after: baselineUpdate.newSatisfaction,
                satisfaction_delta: baselineUpdate.appliedDelta,
                goals_met: 0,
                goals_total: 0,
                reason_category: null,
              }, { onConflict: "board_id,race_id" });
            if (baselineEventError) {
              summary.errors += 1;
              console.error(`  ⚠️  baseline board satisfaction event failed for ${team.name}:`, baselineEventError.message);
            } else {
              summary.events_written += 1;
            }
          }

          continue;
        }

        const goalContext = await loadGoalContextFn({
          supabase,
          teamId: team.id,
          boardId: board.id,
          currentSeasonId: season.id,
          division: standing.division,
          // #2308 · Pulje-id skal med, ellers falder divisionManagerCount tilbage
          // til tier-bred tælling mens /board/status + season-end er pulje-baseret
          // (#1608) → relative_rank-målet konvergerer mod et target season-end
          // ikke reproducerer.
          leagueDivisionId: standing.league_division_id ?? null,
          standings,
          planStartSeasonNumber: board.plan_start_season_number,
          // #5182 · Kilderne er allerede hentet (2b/2c) — loaderen anvender
          // stadig selv plan-cyklus- og sæson-vinduet, så resultatet er
          // identisk med et friskt opslag.
          prefetched: {
            snapshots: snapshotRowsByBoard.get(board.id) || [],
            sources: goalContextSources,
          },
        });

        // #2469 · Delt context-bygger (planDuration/seasonsCompleted/isFinalSeason/
        // cumulativeStats beregnes dér) — samme som /board/status, /board/request
        // og season-end, så weekend-stien ikke kan drifte fra dem igen.
        const context = buildBoardEvalContext({
          board,
          standing,
          activeLoanCount: loanCountByTeam.get(team.id) || 0,
          // #1237 · nettostilling til no_outstanding_debt (scoreFinanceHealthGoal).
          balance: team.balance || 0,
          activeDebt: debtByTeam.get(team.id) || 0,
          wageBillPerSeason: sumRiderSalaries(riders),
          currentSponsorIncome: team.sponsor_income,
          recentSnapshots,
          goalContext,
        });

        // Anker: sæson-start-satisfaction. Selv-healende ved sæson-skift —
        // første weekend i en ny sæson ser anchor-season-mismatch og re-ankrer
        // på den (endnu uberørte) løbende værdi.
        const hasValidAnchor =
          board.season_start_anchor_season_id === season.id &&
          Number.isFinite(Number(board.season_start_satisfaction)) &&
          board.season_start_satisfaction !== null;
        const anchor = hasValidAnchor
          ? Number(board.season_start_satisfaction)
          : toFiniteOr(board.satisfaction, 50);

        const update = computeWeekendUpdateFn({
          board,
          standing,
          team: teamWithRiders,
          context,
          seasonStartSatisfaction: anchor,
        });
        if (!update) continue;

        const { error: updateError } = await supabase
          .from("board_profiles")
          .update({
            satisfaction: update.newSatisfaction,
            budget_modifier: update.newModifier,
            season_start_satisfaction: anchor,
            season_start_anchor_season_id: season.id,
            updated_at: now.toISOString(),
          })
          .eq("id", board.id);
        if (updateError) throw new Error(updateError.message);
        summary.boards_updated += 1;

        // #3514 fase 1-rest: skyggemodellens weekend-sync for 1yr-boardet.
        // Genbruger den EVALUERING flag-off-stien allerede regnede ovenfor
        // (update.evaluation = evaluateBoardSeason-resultatet) i stedet for at
        // regne noget nyt — spec §3.1: "eksisterende evalueringsmotor genbruges".
        // Skriver KUN til board_relations/board_satisfaction_events (skygge-
        // tabeller); board_profiles-opdateringen ovenfor er allerede skrevet
        // uændret. No-op når kill-switchen er 'off' (fail-safe inde i kaldet);
        // #4839: i 'beta' skriver den for ALLE hold (motor-skrivning, ingen
        // viewer — `engineWrite` inde i applyWeekendSync), mens Boardroom
        // stadig kun vises for beta-testere/admin.
        if (board.plan_type === "1yr") {
          try {
            const mandateSync = await applyMandateWeekendSyncFn(supabase, {
              teamId: team.id,
              seasonId: season.id,
              evaluation: update.evaluation,
              raceId: race?.id && raceMatchesTeamPool(race, standing) ? race.id : null,
              raceName: race?.id && raceMatchesTeamPool(race, standing) ? (race.name ?? null) : null,
            });
            if (mandateSync && !mandateSync.skipped) summary.mandate_relations_synced += 1;
          } catch (error) {
            // Skyggedata må ALDRIG vælte den spillervendte weekend-opdatering,
            // som allerede er persisteret ovenfor.
            summary.errors += 1;
            console.error(`  ⚠️  mandate shadow weekend-sync failed for ${team.name}:`, error.message);
            if (captureExceptionFn) {
              captureExceptionFn(error, {
                tags: { hook: "board-weekend", stage: "mandate-shadow" },
                extra: { teamId: team.id, boardId: board.id, seasonId: season.id },
              });
            }
          }
        }

        // #1451 · Løb-for-løb event-log (visnings-only). Idempotent pr.
        // (board_id, race_id) via onConflict-upsert → re-import overskriver
        // i stedet for at duplikere. Fejl her må ALDRIG vælte satisfaction-
        // opdateringen (mekanikken er allerede persisteret ovenfor).
        // #3144 · kun skriv event når løbet faktisk er i holdets pulje —
        // ellers ser en manager bestyrelsen "reagere" på et løb fra en
        // anden division/pulje holdet aldrig deltog i.
        if (race?.id && raceMatchesTeamPool(race, standing)) {
          const { error: eventError } = await supabase
            .from("board_satisfaction_events")
            .upsert({
              board_id: board.id,
              team_id: team.id,
              season_id: season.id,
              race_id: race.id,
              race_name: race.name ?? null,
              race_days_completed: season.race_days_completed ?? null,
              satisfaction_before: update.previousSatisfaction,
              satisfaction_after: update.newSatisfaction,
              satisfaction_delta: update.appliedDelta,
              goals_met: update.goalsMet,
              goals_total: update.goalsTotal,
              reason_category: resolveReasonCategory({
                evaluation: update.evaluation,
                satisfactionDelta: update.appliedDelta,
              }),
            }, { onConflict: "board_id,race_id" });
          if (eventError) {
            // Bevidst console-only (ingen captureExceptionFn til Sentry): før
            // migrationen er anvendt i prod fejler upsert'en for HVERT board ved
            // HVER finalisering — det ville spamme Sentry. Loggen er nok til at se det.
            summary.errors += 1;
            console.error(`  ⚠️  board satisfaction event failed for ${team.name}:`, eventError.message);
          } else {
            summary.events_written += 1;
          }
        }

        // Hårde konsekvens-lag KUN ved mid-season-checkpoint (beslutning 3).
        // Sæson-slut-checkpointet kører uændret i processTeamSeasonEnd.
        if (checkpoint === CHECKPOINT_KINDS.MID_SEASON) {
          const result = await evaluateAndApplyConsequencesFn({
            supabase,
            team: teamWithRiders,
            board,
            newSatisfaction: update.newSatisfaction,
            previousSatisfaction: update.previousSatisfaction,
            goalsMet: update.goalsMet,
            goalsTotal: update.goalsTotal,
            planIsComplete: false,
            seasonId: season.id,
            consecutiveLowExpirations: 0,
            boardTestMode,
            now,
            notify: ({ type, title, message, metadata }) => notifyTeamOwnerFn({
              supabase,
              teamId: team.id,
              type,
              title,
              message,
              metadata: metadata ?? null,
              now,
            }),
          });
          summary.consequences_applied += (result?.applied || []).length;
        }
      } catch (error) {
        summary.errors += 1;
        console.error(`  ⚠️  weekend board update failed for ${team.name} (${board.plan_type}):`, error.message);
        if (captureExceptionFn) {
          captureExceptionFn(error, {
            tags: { hook: "board-weekend" },
            extra: { teamId: team.id, boardId: board.id, seasonId: season.id },
          });
        }
      }
    }
  };

  // #5182 · Hold behandles i batches (mulighed B). Beviset for at det er
  // sikkert — ingen to hold rører den samme række:
  //   · `board_profiles`-opdateringen rammer `.eq("id", board.id)`, og boards
  //     kommer fra `boardsByTeam`, der er grupperet på `team_id`. Et board-row
  //     hører til præcis ét hold, så to hold kan ikke ramme samme id.
  //   · `board_satisfaction_events`-upsert'en har konflikt-nøglen
  //     (`board_id`, `race_id`) — samme argument: `board_id` er holdets eget.
  //   · `applyMandateWeekendSync` skriver kun på holdets egen `board_relations`-
  //     række (`fetchRelationRow(supabase, teamId)`) + en kvittering med det
  //     relations-id.
  //   · Boards INDEN for ét hold kører fortsat sekventielt, så rækkefølgen pr.
  //     hold er bit-for-bit som før.
  // Mid-season-checkpointet er den ene kørsel pr. sæson hvor de hårde
  // konsekvens-lag kører (`evaluateAndApplyConsequences`): de skriver i
  // `board_consequences`, `transfer_listings` og notifikationer og har
  // pulje-/markeds-bivirkninger der IKKE er bevist hold-lokale. Den kørsel
  // holdes derfor bevidst sekventiel — den er sjælden, og gevinsten ligger i
  // alle de andre finaliseringer.
  const batchSize = checkpoint === CHECKPOINT_KINDS.MID_SEASON
    ? 1
    : BOARD_FINALIZATION_TEAM_BATCH_SIZE;
  for (let i = 0; i < teams.length; i += batchSize) {
    await Promise.all(teams.slice(i, i + batchSize).map((/** @type {any} */ team) => processTeam(team)));
  }

  return summary;
}
