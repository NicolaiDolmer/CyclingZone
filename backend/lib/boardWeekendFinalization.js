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
import { buildBoardEvalContext, loadGoalContextForBoard } from "./boardGoalContext.js";
import { U25_ABILITY_KEYS } from "./boardGoals.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { notifyTeamOwner } from "./notificationService.js";
import { fetchAllRows } from "./supabasePagination.js";

function toFiniteOr(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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
        .select("id, team_id")
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
  for (const loan of loansData || []) {
    loanCountByTeam.set(loan.team_id, (loanCountByTeam.get(loan.team_id) || 0) + 1);
  }

  // 3. Checkpoint + test-mode (én gang pr. kørsel).
  const checkpoint = resolveCrossedCheckpoint({
    previousRaceDaysCompleted,
    raceDaysCompleted: season.race_days_completed,
    raceDaysTotal: season.race_days_total,
  });
  summary.checkpoint = checkpoint;
  const boardTestMode = await isTestModeActiveFn(supabase);

  for (const team of teams) {
    const boards = boardsByTeam.get(team.id) || [];
    const standing = standingByTeam.get(team.id) || null;
    if (!boards.length || !standing) continue;
    summary.teams_checked += 1;

    const riders = ridersByTeam.get(team.id) || [];
    const teamWithRiders = { ...team, riders };

    // recentSnapshots pr. team — samme query-form som processTeamSeasonEnd.
    let recentSnapshots = [];
    try {
      const { data: snapshotRows, error: snapshotError } = await supabase
        .from("board_plan_snapshots")
        .select("goals_met, goals_total, satisfaction_delta")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (snapshotError) throw new Error(snapshotError.message);
      recentSnapshots = snapshotRows || [];
    } catch (error) {
      summary.errors += 1;
      console.error(`  ⚠️  weekend board snapshots failed for ${team.name}:`, error.message);
      if (captureExceptionFn) captureExceptionFn(error, { tags: { hook: "board-weekend" }, extra: { teamId: team.id } });
      continue;
    }

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
        });

        // #2469 · Delt context-bygger (planDuration/seasonsCompleted/isFinalSeason/
        // cumulativeStats beregnes dér) — samme som /board/status, /board/request
        // og season-end, så weekend-stien ikke kan drifte fra dem igen.
        const context = buildBoardEvalContext({
          board,
          standing,
          activeLoanCount: loanCountByTeam.get(team.id) || 0,
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
        // uændret. No-op når kill-switchen er 'off' (fail-safe inde i kaldet).
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
  }

  return summary;
}
