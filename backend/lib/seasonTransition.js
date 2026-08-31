/**
 * Slice 08 — Sæson-transition orchestrator
 * =========================================
 * Lukker sæson X (status='completed', end_date=transitionAt) og åbner
 * sæson X+1 (status='active', start_date=transitionAt). Idempotent per
 * fase: re-run skipper allerede-gjort arbejde via UUID-existens-tjek.
 *
 * Faser (rækkefølge er kritisk):
 *   1. Validate (fromSeason er 'active', toSeason ikke endnu eksisterende)
 *   2. Insert next season (status='active')
 *   3. Mark previous season completed
 *   4. Close prev transfer_window (status='closed')
 *   5. Insert next transfer_window (status='closed' — racing-sæson)
 *   6. Sponsor-payout via processSeasonStart(nextSeasonId)
 *   7. admin_log entry (action_type='season_transition')
 *
 * Special case sæson 0 → 1:
 *   Sæson 0 er open-beta-fase uden løb/standings/lønninger. Klassisk
 *   processSeasonEnd er irrelevant. Engine antager at processSeasonEnd
 *   ER kørt FØR (for sæson ≥ 1) — for sæson 0 springes det helt over.
 *
 * Sponsor-modifier sæson 1 (#1721, ejer-beslutning 2026-06-22):
 *   Sæson 1 er IKKE længere en observations-sæson. Ved forever-relaunch oplåses
 *   forhandling til pending_5yr fra dag 1 (relaunchOrchestrator → startSequential-
 *   Negotiation: baseline-rows slettes), så managere signerer RIGTIGE planer
 *   (5yr/3yr/1yr → negotiation_status='completed') i sæson 1. Disse evalueres fuldt
 *   ved sæson-1-slut (processTeamSeasonEnd springer kun is_baseline/plan_type=
 *   'baseline' over), satisfaction bevæger sig, og den afledte budget_modifier får
 *   FULD effekt på sæson-2-sponsoren (processSeasonStart anvender modifier for alle
 *   completed boards — ingen sæson-nummer-gate). SÆSON-1-SPONSOREN selv betales
 *   under denne transition FØR nogen plan kan signeres, så den er stadig neutral
 *   (baseline=completed/modifier=1.0 eller ingen board → 1.0); det er den efter-
 *   følgende sæson-2-sponsor der bærer sæson-1-tilfredshedens økonomiske effekt.
 *   En transient baseline (før relaunch-oplåsning, eller sæson 0→1 uden unlock)
 *   springes stadig over — det bevarer sæson-0/pre-unlock-adfærd.
 */

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";
import { notifySeasonEvent as defaultNotifySeasonEvent } from "./discordNotifier.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import {
  buildSponsorStandingsContext,
  computeBoardBaseModifier,
  computeSponsorForSeason,
  resolveSponsorPayout,
  FIRST_VARIABLE_SPONSOR_SEASON,
} from "./sponsorEngine.js";
import { isBoardTestModeActive } from "./boardTestMode.js";
import { notifyUser, emitContractExpiringNotifications } from "./notificationService.js";
import {
  expireAndRenewContracts as defaultExpireAndRenewContracts,
  evaluateSeasonObjectives as defaultEvaluateSeasonObjectives,
  resolveContractForNewSeason,
  contractRaceDayPool,
  contractSigningBonus,
} from "./sponsorContractsService.js";
import { renownTarget } from "./renownEngine.js";
import { fetchAllRows } from "./supabasePagination.js";
import { releaseExpiredContractRiders as defaultReleaseExpiredContractRiders } from "./contractExpiryRelease.js";
import { renewExpiringAiContracts as defaultRenewExpiringAiContracts } from "./aiContractAutoRenewal.js";
import { releaseRetiredRiders as defaultReleaseRetiredRiders } from "./retirementRelease.js";
import { detectAndNotifySquadsBelowMinimum as defaultDetectAndNotifySquadsBelowMinimum } from "./squadBelowMinimumCheck.js";
import { isAutoCalendarEnabled } from "./autoCalendarFlag.js";
import { captureException } from "./sentry.js";
import { isAutoEntryGeneratorEnabled } from "./autoEntryGeneratorFlag.js";
import { isSeasonEndDivisionMovementSkipped } from "./seasonEndMovementFlag.js";
import { logTransitionPhaseSafe, TRANSITION_PHASE_STATUS } from "./seasonTransitionPhaseLog.js";
import {
  loadSeasonEndedPersonalization,
  buildPersonalSeasonEndedMessage,
} from "./seasonEndedPersonalization.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { carryOverManagerSetup as defaultCarryOverManagerSetup } from "./seasonCarryOver.js";

let processSeasonStartImpl;
async function getProcessSeasonStart() {
  if (!processSeasonStartImpl) {
    processSeasonStartImpl = (await import("./economyEngine.js")).processSeasonStart;
  }
  return processSeasonStartImpl;
}

// #1704 · Lazy import (samme forsigtigheds-mønster som getProcessSeasonStart):
// tierCalendarMaterializer er den kanoniske generator (#2449 unify) — sætter game_day/
// game_day_start (kalender-synlighed) + håndhæver kaskade/GT-invarianter. Lazy for at
// undgå eager-import-bivirkninger ved kun at loade den når auto_calendar-flaget er ON.
let materializeTierCalendarsImpl;
async function getMaterializeTierCalendars() {
  if (!materializeTierCalendarsImpl) {
    materializeTierCalendarsImpl = (await import("./tierCalendarMaterializer.js")).materializeTierCalendars;
  }
  return materializeTierCalendarsImpl;
}

// #3469 (leverance 5): samme gate scripts/buildSeasonCalendar.js's CLI kører (kalender-
// invarianter, etaperækkefølge, realisme-bånd inkl. #3469's finale-gulve, sæson- OG
// pr.-tier-komposition) — ekstraheret til lib/seasonCalendarGate.js netop så
// forever-stien her kan dele den, i stedet for at springe den over (se docstringen ved
// kaldestedet nedenfor).
let gatePlanImpl;
async function getGatePlan() {
  if (!gatePlanImpl) {
    gatePlanImpl = (await import("./seasonCalendarGate.js")).gatePlan;
  }
  return gatePlanImpl;
}

// #2910 + #2911 · Lazy import (samme mønster som ovenstående) — sæsonstart-hooksene
// er flag-gatede og fail-safe OFF, så modulet loades kun når transitionen kører.
let runSeasonStartHooksImpl;
async function getRunSeasonStartHooks() {
  if (!runSeasonStartHooksImpl) {
    runSeasonStartHooksImpl = (await import("./seasonStartHooks.js")).runSeasonStartHooks;
  }
  return runSeasonStartHooksImpl;
}

let runRaceEntryGeneratorImpl;
async function getRunRaceEntryGenerator() {
  if (!runRaceEntryGeneratorImpl) {
    runRaceEntryGeneratorImpl = (await import("./raceEntryGenerator.js")).runRaceEntryGenerator;
  }
  return runRaceEntryGeneratorImpl;
}

// EN-first fallback (#1068: ingen rå dansk i backend). Locale-aware rendering
// sker via backendMessages-koderne i metadata (#666).
const SEASON_STARTED_FALLBACK_MESSAGE =
  "A new season has begun. Check your dashboard for your board's goals and your squad for the season ahead.";

// #3101 · Når det faktiske sponsorbeløb for sæsonen er kendt, medtages det i
// EN-fallback-beskeden (metadata.messageCode styrer den lokaliserede rendering,
// men den rå tekst SKAL også være informativ — se notifyUser-docstringen).
function buildSeasonStartedFallbackMessage(sponsorAmount) {
  if (typeof sponsorAmount !== "number" || !Number.isFinite(sponsorAmount)) {
    return SEASON_STARTED_FALLBACK_MESSAGE;
  }
  return `A new season has begun. Your sponsor paid out ${sponsorAmount} CZ$ for the season. Check your dashboard for your board's goals and your squad for the season ahead.`;
}

// #3101 · Bulk-hent det faktiske sponsorbeløb (finance_transactions type='sponsor',
// samme season_id) pr. hold — "sponsor" krediteres udelukkende af
// economyEngine.processSeasonStart (idempotencyKey sponsor:{team}:{season}), så
// præcis én række pr. hold pr. sæson er den forventede form. Mangler holdet en
// række (fx sæson-1-uberørt-startkapital-gaten der springer sponsoren helt over),
// udelades beløbet i stedet for at gætte.
async function loadSeasonStartedSponsorPayouts({ supabase, teamIds, seasonId }) {
  const map = new Map();
  if (!teamIds.length) return map;
  // #3331 · finance_transactions er deny-listed for et bart .select()/.in() —
  // PostgREST capper stille ved 1000 rækker. fetchAllRowsChunkedIn chunker
  // team_id-listen (#3030: lange .in()-lister kan i sig selv sprænge gateway-
  // linjebegrænsningen) OG paginerer hver chunk.
  const rows = await fetchAllRowsChunkedIn(
    teamIds,
    (chunk) =>
      supabase
        .from("finance_transactions")
        .select("team_id, amount")
        .eq("type", "sponsor")
        .eq("season_id", seasonId)
        .in("team_id", chunk)
        .order("team_id"),
  );
  for (const row of rows) {
    if (row?.team_id != null && typeof row.amount === "number") {
      map.set(row.team_id, row.amount);
    }
  }
  return map;
}

/**
 * #1357 + #3101 · Indsæt in-app season_started-notifikationer til alle
 * berettigede menneske-managers (humanTeams = is_ai=false, is_bank=false,
 * is_frozen=false, is_test_account=false), inkl. det faktiske sponsorbeløb
 * holdet fik for sæsonen når det kan findes. Idempotent: notifyUser dedup'er
 * på (type, title, message, related_id) inden for 24t, og related_id =
 * toSeason.id gør dedup per manager+sæson, så retries/genoptagne transitions
 * (eller et bevidst re-run for at efter-sende til hold der manglede
 * beskeden — #3101) ikke dublerer, fordi beløbet er deterministisk hentet fra
 * den allerede-committede finance_transactions-række hver gang. Fejl pr.
 * manager isoleres (tælles + user_id samles i failedUserIds, stopper ikke
 * resten — de kan efter-sendes ved at kalde funktionen igen med
 * `humanTeams` sat til kun de manglende hold). `notify`/`loadSponsorPayouts`
 * er injicerbare for test.
 */
export async function emitSeasonStartedNotifications({
  supabase,
  toSeason,
  humanTeams = null,
  notify = notifyUser,
  loadSponsorPayouts = loadSeasonStartedSponsorPayouts,
}) {
  const seasonNumber = toSeason.number;
  const stats = { delivered: 0, deduped: 0, failed: 0, failedUserIds: [] };
  // #2832-review (fund 4) · fulde menneske-manager-diskriminator som resten af
  // motoren (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false —
  // se fx boardWeekendFinalization.js) — den forkortede is_ai/is_frozen-udgave
  // lod test-kontiene ("Test A"/"Test B"/"Test Seller") tælle som eligible
  // (153 hold i prod mod korrekte 150).
  let managers = humanTeams;
  if (!managers) {
    const { data, error } = await supabase
      .from("teams")
      .select("id, user_id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false);
    if (error) {
      throw new Error(
        `Could not load managers for season_started notifications: ${error.message}`,
      );
    }
    managers = data;
  }
  const eligible = (managers || []).filter((team) => team.user_id);

  let sponsorPayoutByTeamId = new Map();
  if (eligible.length > 0) {
    try {
      sponsorPayoutByTeamId = await loadSponsorPayouts({
        supabase,
        teamIds: eligible.map((team) => team.id).filter((id) => id != null),
        seasonId: toSeason.id,
      });
    } catch (err) {
      // best-effort: uden beløb falder ALLE tilbage til den beløbsfrie besked —
      // selve notifikationen skal stadig ud, en fejl her må aldrig blokere den.
      console.error("season_started: sponsor payout lookup failed, falling back to the generic message for all:", err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "season_started_sponsor_lookup" }, extra: { seasonNumber } });
    }
  }

  for (const team of eligible) {
    const sponsorAmount = sponsorPayoutByTeamId.get(team.id);
    const hasSponsorAmount = typeof sponsorAmount === "number" && Number.isFinite(sponsorAmount);
    try {
      const res = await notify({
        supabase,
        userId: team.user_id,
        type: "season_started",
        title: `Season ${seasonNumber} has started`,
        message: buildSeasonStartedFallbackMessage(hasSponsorAmount ? sponsorAmount : undefined),
        relatedId: toSeason.id,
        metadata: hasSponsorAmount
          ? {
              titleCode: "notif.seasonStarted.title",
              titleParams: { number: seasonNumber },
              messageCode: "notif.seasonStarted.messageWithSponsor",
              messageParams: { number: seasonNumber, amount: sponsorAmount },
            }
          : {
              titleCode: "notif.seasonStarted.title",
              titleParams: { number: seasonNumber },
              messageCode: "notif.seasonStarted.message",
              messageParams: { number: seasonNumber },
            },
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      // #2832-review (fund 3) · var 100% stille (end ikke logget) — et systemisk
      // problem (fx dedup-query fejler for alle) kunne kun ses som faldende
      // delivered-tal, som ingen overvåger. Samme mønster som
      // emitContractExpiringNotifications i notificationService.js.
      // #3101 · failedUserIds gør det muligt at målrette et efter-sende-kald
      // (emitSeasonStartedNotifications med humanTeams=kun disse) frem for at
      // gætte på hvem der manglede.
      stats.failed += 1;
      stats.failedUserIds.push(team.user_id);
      console.error(`  ❌ season_started-notifikation fejlede (manager ${team.user_id}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "season_started" }, extra: { userId: team.user_id, seasonNumber } });
    }
  }
  return { eligible: eligible.length, ...stats };
}

// EN-first fallback (#1068: ingen rå dansk i backend). Locale-aware rendering
// sker via backendMessages-koderne i metadata (#666).
const SEASON_ENDED_FALLBACK_MESSAGE =
  "The season is over. See the recap for final standings, promotions and relegations.";

/**
 * #2745 · Indsæt in-app season_ended-notifikationer til alle berettigede
 * menneske-managers (humanTeams = is_ai=false, is_bank=false, is_frozen=false, is_test_account=false) ved sæson-slut.
 * Modstykke til emitSeasonStartedNotifications ovenfor — frontend havde fuld
 * rendering for typen (NotificationsPage TYPE_CONFIG + notif.seasonEnded-i18n),
 * men ingen backend-kode indsatte nogensinde en season_ended-row (audit 23/7,
 * `select count(*) from notifications where type='season_ended'` = 0 i prod).
 *
 * Idempotent: notifyUser dedup'er på (type, title, message, related_id) inden for
 * 24t, og related_id = endedSeason.id gør dedup per manager+sæson, så retries
 * ikke dublerer. Fejl pr. manager isoleres (tælles, stopper ikke resten).
 * `notify` er injicerbar for test.
 */
export async function emitSeasonEndedNotifications({
  supabase,
  endedSeason,
  humanTeams = null,
  notify = notifyUser,
  loadPersonalization = loadSeasonEndedPersonalization,
  isDivisionMovementSkipped = isSeasonEndDivisionMovementSkipped,
}) {
  const seasonNumber = endedSeason.number;
  const stats = { delivered: 0, deduped: 0, failed: 0, personalized: 0 };
  // #2832-review (fund 4) · fulde menneske-manager-diskriminator som resten af
  // motoren (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false —
  // se fx boardWeekendFinalization.js) — den forkortede is_ai/is_frozen-udgave
  // lod test-kontiene ("Test A"/"Test B"/"Test Seller") tælle som eligible
  // (153 hold i prod mod korrekte 150).
  let managers = humanTeams;
  if (!managers) {
    const { data, error } = await supabase
      .from("teams")
      // #2924 · id + division kom til for personaliseringen: id slår standings/
      // præmier/ryttere op, division er (efter processSeasonEnd) holdets division
      // for den KOMMENDE sæson.
      .select("id, user_id, division")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false);
    if (error) {
      throw new Error(
        `Could not load managers for season_ended notifications: ${error.message}`,
      );
    }
    managers = data;
  }
  const eligible = (managers || []).filter((team) => team.user_id);

  // #2924 · Må vi love en division for næste sæson?
  // Beskeden sendes EFTER processSeasonEnd (routes/api.js: processSeasonEnd →
  // seasons.status='completed' → emitSeasonEndedNotifications), så op/nedrykningen
  // er normalt allerede kørt og teams.division ER næste sæsons division.
  // UNDTAGELSEN er #2851-gaten: når season_end_skip_division_movement='on'
  // springer motoren flytningen over (pyramide-komprimeringen flytter i stedet,
  // og den kører FØRST bagefter) — så er teams.division stadig den AFSLUTTEDE
  // sæsons division, og en "du starter i Division X"-sætning ville være løgn.
  // Fail-safe: kan flaget ikke læses, udelader vi linjen frem for at gætte.
  let includeNextDivision = false;
  let personalization = null;
  if (eligible.length > 0) {
    try {
      includeNextDivision = !(await isDivisionMovementSkipped(supabase));
    } catch (flagErr) {
      // best-effort: uafklaret flag → udelad divisions-sætningen (den eneste
      // sikre fortolkning). Resten af beskeden er upåvirket.
      console.error("season_ended: division-movement flag unreadable, omitting next-division sentence:", flagErr?.message || flagErr);
    }

    try {
      personalization = await loadPersonalization({
        supabase,
        seasonId: endedSeason.id,
        teams: eligible,
        includeNextDivision,
      });
    } catch (loadErr) {
      // best-effort: den kanoniske loader fanger selv sine fejl, men en
      // injiceret/fremtidig variant må heller ikke kunne vælte udsendelsen.
      // Uden personalisering får alle den generiske besked — beskeden SKAL ud.
      console.error("season_ended: personalization load failed, falling back to the generic message for all:", loadErr?.message || loadErr);
      personalization = null;
    }
  }

  for (const team of eligible) {
    let personal = null;
    try {
      personal = buildPersonalSeasonEndedMessage({
        facts: personalization?.get?.(team.id),
        nextSeasonNumber: seasonNumber + 1,
      });
    } catch (personalErr) {
      // best-effort: kan beskeden ikke personaliseres for DETTE hold, får holdet
      // den generiske besked. Aldrig en grund til at springe manageren over.
      console.error(`season_ended: personalization failed (team ${team.id}), using generic message:`, personalErr?.message || personalErr);
    }
    if (personal) stats.personalized += 1;

    try {
      const res = await notify({
        supabase,
        userId: team.user_id,
        type: "season_ended",
        title: `Season ${seasonNumber} has ended`,
        message: personal?.message || SEASON_ENDED_FALLBACK_MESSAGE,
        relatedId: endedSeason.id,
        metadata: {
          titleCode: "notif.seasonEnded.title",
          titleParams: { number: seasonNumber },
          messageCode: personal?.messageCode || "notif.seasonEnded.message",
          messageParams: personal?.messageParams || { number: seasonNumber },
        },
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      // #2832-review (fund 3) · samme disciplin som season_started ovenfor —
      // per-manager fejl må logges (manager-id + Sentry), ikke kun tælles, ellers
      // er et 0-delivered-scenarie usynligt indtil nogen tæller notifications-
      // rækker manuelt.
      stats.failed += 1;
      console.error(`  ❌ season_ended-notifikation fejlede (manager ${team.user_id}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "season_ended" }, extra: { userId: team.user_id, seasonNumber } });
    }
  }
  return { eligible: eligible.length, ...stats };
}

// #805 · lazy import (betaResetService → economyEngine; samme cyklus-undgåelse
// som getProcessSeasonStart) til board-test-exit-oprydning.
let resetBetaBoardProfilesImpl;
async function getResetBetaBoardProfiles() {
  if (!resetBetaBoardProfilesImpl) {
    resetBetaBoardProfilesImpl = (await import("./betaResetService.js")).resetBetaBoardProfiles;
  }
  return resetBetaBoardProfilesImpl;
}

// ─── UUID helpers ─────────────────────────────────────────────────────────────

/**
 * Deterministisk UUID for sæson N: 00000000-0000-0000-0000-{N as 12 hex chars}.
 * Sæson 0 = ...000, sæson 1 = ...001, sæson 16 = ...010, osv.
 */
export function computeSeasonUuid(seasonNumber) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    throw new Error(`Invalid season number: ${seasonNumber}`);
  }
  const hex = seasonNumber.toString(16).padStart(12, "0");
  return `00000000-0000-0000-0000-${hex}`;
}

/**
 * Deterministisk UUID for sæson N's transfer_window:
 * 00000000-0000-0000-0000-{N as 8 hex chars}aaaa.
 */
export function computeTransferWindowUuid(seasonNumber) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    throw new Error(`Invalid season number: ${seasonNumber}`);
  }
  const hex = seasonNumber.toString(16).padStart(8, "0");
  return `00000000-0000-0000-0000-${hex}aaaa`;
}

// ─── Plan-builder (used in both dry-run + real run) ───────────────────────────

export async function buildTransitionPlan({ supabase, fromSeasonId }) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: fromSeason, error: fromError } = await supabase
    .from("seasons")
    .select("id, number, status, start_date, end_date")
    .eq("id", fromSeasonId)
    .maybeSingle();
  if (fromError) throw new Error(`Could not load season ${fromSeasonId}: ${fromError.message}`);
  if (!fromSeason) throw new Error(`Season ${fromSeasonId} not found`);

  const toSeasonNumber = fromSeason.number + 1;
  const toSeasonId = computeSeasonUuid(toSeasonNumber);
  const toWindowId = computeTransferWindowUuid(toSeasonNumber);

  const { data: existingTo, error: existingToError } = await supabase
    .from("seasons").select("id, status").eq("id", toSeasonId).maybeSingle();
  if (existingToError) throw new Error(`Could not check next season ${toSeasonId}: ${existingToError.message}`);

  // Resume-support (#578): tillad completed fromSeason når toSeason eksisterer.
  // Signatur på partial failure efter mark_previous_completed (fase 3) — fase 4-8
  // er alle idempotente og kan genoptages. Completed UDEN toSeason er en faktisk
  // fejl (sandsynligvis manuel DB-tilstand) og blokeres stadig.
  const isResumeFromPartialFailure =
    fromSeason.status === "completed" && Boolean(existingTo);
  if (fromSeason.status !== "active" && !isResumeFromPartialFailure) {
    throw new Error(
      `Cannot transition from season ${fromSeason.number}: status='${fromSeason.status}' (must be 'active' or 'completed' with existing next season for resume)`
    );
  }

  // #2926: samme menneske-hold-diskriminator som processSeasonStart og
  // expireAndRenewContracts (is_bank=false manglede → previewet kunne tælle
  // bank-pseudo-holdet med selvom udbetalingen aldrig rammer det).
  // #2852 · udvidet med is_test_account og flyttet ind i den fælles helper: den
  // forkortede udgave lod også de 3 test-konti ("Test A"/"Test B"/"Test Seller")
  // tælle med i teams_affected og sponsor_base_total — 159 hold i prod-preview
  // 25/7 mod korrekte 156. Diskriminatoren bor nu ét sted (humanTeamFilter.js),
  // så den ikke kan drive fra notifikations-/board-stierne igen.
  // #2753 · board_profiles embeddes med (samme join som processSeasonStart), fordi
  // previewet nu regner den FAKTISKE payout - ikke bare den garanterede base.
  const { data: humanTeams, error: teamsError } = await applyHumanTeamFilter(
    supabase
      .from("teams")
      .select("id, name, sponsor_income, division, board_profiles(budget_modifier, negotiation_status)")
  );
  if (teamsError) throw new Error(`Could not load teams: ${teamsError.message}`);
  const sponsorStandingsContext = await loadSponsorPreviewStandings({
    supabase,
    fromSeasonId: fromSeason.id,
    toSeasonNumber,
  });
  const contractsByTeamId = await loadSponsorContractStock({ supabase });
  const pulloutFactorByTeamId = await loadSponsorPulloutFactors({ supabase });
  const boardTestMode = await isBoardTestModeActive(supabase);

  // #2926 · sponsor_base er den GARANTEREDE base: præcis den kontrakt-base
  // processSeasonStart regner på efter at expireAndRenewContracts har gjort én
  // kontrakt aktiv pr. hold.
  // #2753 · sponsor_payout er det der FAKTISK krediteres: base × board-modifier
  // × pullout, cappet af kontraktloftet - samme regnestykke som udbetalingen
  // (resolveSponsorPayout). Det er payout-tallet ejeren planlægger skiftet på.
  const sponsorPreview = (humanTeams || []).map((team) => ({
    team_id: team.id,
    team_name: team.name,
    division: team.division,
    ...buildSponsorPreviewRow(
      team,
      toSeasonNumber,
      sponsorStandingsContext,
      contractsByTeamId.get(team.id) || {},
      {
        pulloutFactor: pulloutFactorByTeamId.get(team.id) ?? 1.0,
        boardTestMode,
      }
    ),
  }));

  const sponsorContractSources = { locked: 0, pending: 0, default: 0 };
  for (const row of sponsorPreview) {
    sponsorContractSources[row.sponsor_contract_source] += 1;
  }

  return {
    from_season: {
      id: fromSeason.id,
      number: fromSeason.number,
      start_date: fromSeason.start_date,
    },
    to_season: {
      id: toSeasonId,
      number: toSeasonNumber,
      transfer_window_id: toWindowId,
    },
    already_transitioned: Boolean(existingTo),
    teams_affected: sponsorPreview.length,
    // Kontrakternes garanterede base, FØR board-modifier/pullout. Reference-tal -
    // ikke det der rammer holdenes balance.
    sponsor_base_total: sponsorPreview.reduce((s, p) => s + p.sponsor_base, 0),
    // #2753 · det faktiske sponsor-cashflow ved skiftet (modifier × pullout × loft).
    // Dette er tallet admin-UI'et og dry-run-scripts skal vise.
    sponsor_payout_total: sponsorPreview.reduce((s, p) => s + p.sponsor_payout, 0),
    sponsor_board_test_mode: boardTestMode,
    // Udbetales ÉN gang ved aktivering af et pending valg (loyal-arketypen, #2948).
    sponsor_signing_bonus_total: sponsorPreview.reduce((s, p) => s + p.sponsor_signing_bonus, 0),
    // IKKE en udbetaling ved skiftet: den variable puljes samlede størrelse, som
    // holdene optjener pr. etape hen over sæsonen ved fuld deltagelse.
    sponsor_race_day_pool_total: sponsorPreview.reduce((s, p) => s + p.sponsor_race_day_pool, 0),
    sponsor_contract_sources: sponsorContractSources,
    sponsor_breakdown: sponsorPreview,
  };
}

/**
 * #2926 · Kontraktbestanden i to bulk-queries (ikke N+1 pr. hold). De delvise
 * UNIQUE-indekser på sponsor_contracts garanterer højst én 'active' og én
 * 'pending' pr. hold, så et Map pr. status er en fuldstændig repræsentation.
 */
async function loadSponsorContractStock({ supabase }) {
  const byTeamId = new Map();
  for (const status of ["active", "pending"]) {
    // Pagineret (#2951-klassen): ét hold = én kontrakt pr. status, så rækketallet
    // vokser 1:1 med populationen og ville stille blive kappet ved 1000.
    const data = await fetchAllRows(() =>
      supabase.from("sponsor_contracts").select("*").eq("status", status).order("id")
    );
    for (const row of data || []) {
      if (!row?.team_id) continue;
      const entry = byTeamId.get(row.team_id) || {};
      entry[status === "active" ? "activeContract" : "pendingContract"] = row;
      byTeamId.set(row.team_id, entry);
    }
  }
  return byTeamId;
}

/**
 * #2753 · Lag 5 sponsor-pullout, samme kilde som processSeasonStart læser lige
 * før udbetalingen: aktive board_consequences på lag 5. Pullouten er oprettet ved
 * forrige sæsons slut og rammer PRÆCIS den kommende sæsons sponsor-payment, så
 * previewet skal regne med den.
 */
async function loadSponsorPulloutFactors({ supabase }) {
  const { data, error } = await supabase
    .from("board_consequences")
    .select("team_id, severity, id")
    .eq("layer", 5)
    .eq("status", "active");
  if (error) throw new Error(`Could not load active sponsor-pullouts: ${error.message}`);
  const byTeamId = new Map();
  for (const row of data || []) {
    if (!row?.team_id) continue;
    byTeamId.set(row.team_id, (row.severity || 1000) / 1000);
  }
  return byTeamId;
}

async function loadSponsorPreviewStandings({ supabase, fromSeasonId, toSeasonNumber }) {
  if (toSeasonNumber < FIRST_VARIABLE_SPONSOR_SEASON) {
    return buildSponsorStandingsContext([]);
  }
  const { data, error } = await supabase
    .from("season_standings")
    .select("team_id, division, rank_in_division, total_points")
    .eq("season_id", fromSeasonId);
  if (error) throw new Error(`Could not load sponsor preview standings: ${error.message}`);
  return buildSponsorStandingsContext(data || []);
}

/**
 * #2926 · Previewet modellerede tidligere en KONTRAKTFRI tilstand (division-base
 * + variabel pulje) — men udbetalingen sker EFTER fase 5b (expireAndRenewContracts),
 * hvor hvert menneskehold har præcis én aktiv kontrakt, og processSeasonStart
 * udbetaler dens (typisk lavere) guaranteed_base. Preview'et overvurderede derfor
 * sæsonstartens pengeinjektion markant. Her resolves den kontrakt der FAKTISK vil
 * være aktiv, via samme rene regel som fornyelsen bruger.
 */
function buildSponsorPreviewRow(
  team,
  toSeasonNumber,
  sponsorStandingsContext,
  contracts = {},
  modifierContext = {}
) {
  const lastSeasonStanding = sponsorStandingsContext.standingByTeamId.get(team.id) || null;
  const divisionStandings = lastSeasonStanding
    ? sponsorStandingsContext.divisionStandingsByDivision.get(lastSeasonStanding.division) || []
    : [];

  // Samme input som sponsorContractsService.loadRenownTargetValue henter i drift:
  // holdets NUVÆRENDE division + forrige sæsons standing/divisionsfelt.
  const renownTargetValue = renownTarget({
    division: team.division ?? lastSeasonStanding?.division ?? null,
    lastSeasonStanding,
    divisionStandings,
  });
  const { source, contract } = resolveContractForNewSeason({
    teamId: team.id,
    newSeasonNumber: toSeasonNumber,
    activeContract: contracts.activeContract ?? null,
    pendingContract: contracts.pendingContract ?? null,
    renownTargetValue,
  });

  const breakdown = computeSponsorForSeason({
    seasonNumber: toSeasonNumber,
    team,
    lastSeasonStanding,
    divisionStandings,
    activeContract: contract,
  });

  // #2753 · samme regnestykke som processSeasonStart udbetaler på.
  const payout = resolveSponsorPayout({
    grossSponsor: breakdown.gross_sponsor,
    activeContract: contract,
    baseModifier: computeBoardBaseModifier(team.board_profiles || []),
    pulloutFactor: modifierContext.pulloutFactor ?? 1.0,
    boardTestMode: Boolean(modifierContext.boardTestMode),
  });

  return {
    sponsor_base: breakdown.gross_sponsor,
    // Det beløb der faktisk krediteres holdet ved sæson-start.
    sponsor_payout: payout.payout,
    sponsor_modifier: payout.modifier,
    sponsor_board_modifier: payout.base_modifier,
    sponsor_pullout_factor: payout.pullout_factor,
    sponsor_payout_ceiling: payout.ceiling,
    sponsor_payout_capped: payout.capped_by_ceiling,
    sponsor_mode: breakdown.mode,
    sponsor_variable: breakdown.variable,
    sponsor_formula_base: breakdown.base,
    sponsor_breakdown: breakdown,
    // Kontrakt-kontekst (#2926) så dry-run-rapporten kan vise HVORFOR tallet er
    // som det er — låst aftale, managerens valg, eller auto-default.
    sponsor_contract_source: source,
    sponsor_contract_variant: contract.variant ?? null,
    sponsor_name: contract.sponsor_name ?? null,
    sponsor_signing_bonus: source === "pending" ? contractSigningBonus(contract) : 0,
    sponsor_race_day_pool: contractRaceDayPool(contract),
    sponsor_renown_target: renownTargetValue,
  };
}

// ─── Kildesæson-resolver (endpoint-helper) ────────────────────────────────────

/**
 * #1166 · Find kildesæsonen for season-transition-endpoints (preview + udfør).
 *
 * Korrekt operationel rækkefølge er season-end (sætter status='completed') →
 * transition. Efter season-end findes der derfor INGEN 'active' sæson (næste
 * er typisk 'upcoming'), og et rent `status='active'`-lookup giver 404 selvom
 * engine'ns resume-sti (#578) sagtens kan gennemføre skiftet.
 *
 * Strategi:
 *   1. Nyeste 'active' sæson (normal kørsel).
 *   2. Fallback: nyeste 'completed' sæson. Vi er kun her når ingen 'active'
 *      sæson findes, så ingen completed sæson kan have en aktiv efterfølger.
 *      buildTransitionPlan's resume-guard validerer bagefter at næste sæson
 *      faktisk eksisterer — completed UDEN efterfølger blokeres stadig med
 *      en beskrivende fejl.
 *
 * @returns {Promise<{id: string, number: number, status: string, start_date: string|null}|null>}
 *          null hvis hverken active eller completed sæson findes.
 */
export async function resolveTransitionSourceSeason({ supabase }) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: activeSeason, error: activeError } = await supabase
    .from("seasons")
    .select("id, number, status, start_date")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(`Could not load active season: ${activeError.message}`);
  if (activeSeason) return activeSeason;

  const { data: completedSeason, error: completedError } = await supabase
    .from("seasons")
    .select("id, number, status, start_date")
    .eq("status", "completed")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (completedError) throw new Error(`Could not load completed season: ${completedError.message}`);
  return completedSeason ?? null;
}

// ─── Idempotent fase-helpers ──────────────────────────────────────────────────

async function insertSeasonIfMissing(supabase, seasonId, seasonNumber, transitionAtIso) {
  const { data: existing, error: existingError } = await supabase
    .from("seasons").select("id, status, start_date").eq("id", seasonId).maybeSingle();
  if (existingError) throw new Error(`Could not check season ${seasonNumber}: ${existingError.message}`);

  if (existing) {
    // Legacy /admin/seasons-endpoint kan have pre-created rowen med status='upcoming'
    // (typisk 0→1 hvor sæson 1 er admin-oprettet før engine'n bruges). Engine'ns
    // kontrakt siger sæson X+1 skal være 'active' efter transition — promotér her
    // så confirm-dialogen ikke lyver og processSeasonStart kører mod en faktisk
    // aktiv sæson. Andre statusser ('active', 'completed') skipper som før.
    if (existing.status === "upcoming") {
      const { error } = await supabase
        .from("seasons")
        .update({ status: "active", start_date: existing.start_date || transitionAtIso })
        .eq("id", seasonId);
      if (error) throw new Error(`Could not activate season ${seasonNumber}: ${error.message}`);
      return { updated: true, reason: "promoted upcoming → active", season_id: seasonId, season_number: seasonNumber };
    }
    return { skipped: true, reason: `season ${seasonNumber} already exists`, status: existing.status };
  }

  const { error } = await supabase
    .from("seasons")
    .insert({
      id: seasonId,
      number: seasonNumber,
      status: "active",
      start_date: transitionAtIso,
      end_date: null,
    });
  if (error) throw new Error(`Could not insert season ${seasonNumber}: ${error.message}`);

  return { inserted: true, season_id: seasonId, season_number: seasonNumber };
}

async function markSeasonCompleted(supabase, seasonId, transitionAtIso) {
  const { data: current, error: currentError } = await supabase
    .from("seasons").select("status, end_date").eq("id", seasonId).maybeSingle();
  if (currentError) throw new Error(`Could not load season ${seasonId}: ${currentError.message}`);

  if (!current) throw new Error(`Season ${seasonId} disappeared mid-transition`);
  if (current.status === "completed") {
    return { skipped: true, reason: "already completed", end_date: current.end_date };
  }

  const { error } = await supabase
    .from("seasons")
    .update({ status: "completed", end_date: transitionAtIso })
    .eq("id", seasonId);
  if (error) throw new Error(`Could not mark season completed: ${error.message}`);

  return { updated: true };
}

/**
 * Lukker tidligere sæsons transfer_window (status='closed', closed_at sat).
 * Idempotent: skipper hvis intet vindue eller allerede lukket.
 *
 * Eksporteret i #532 så manuel admin-flow (`POST /admin/seasons/:id/start`)
 * kan konvergere med engine — manual flow åbnede ikke nye windows.
 */
export async function closePrevTransferWindow(supabase, fromSeasonId, transitionAtIso) {
  // #2897: `error` SKAL destruktureres. Uden den returnerede en fejlet select
  // `window === null` → funktionen rapporterede "no transfer_window for prev
  // season" og skiftet fortsatte MED VINDUET ÅBENT, uden spor nogen steder.
  const { data: window, error: windowError } = await supabase
    .from("transfer_windows")
    .select("id, status")
    .eq("season_id", fromSeasonId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (windowError) throw new Error(`Could not load prev transfer_window: ${windowError.message}`);

  if (!window) {
    return { skipped: true, reason: "no transfer_window for prev season" };
  }
  if (window.status === "closed") {
    return { skipped: true, reason: "already closed", window_id: window.id };
  }

  const { error } = await supabase
    .from("transfer_windows")
    .update({ status: "closed", closed_at: transitionAtIso })
    .eq("id", window.id);
  if (error) throw new Error(`Could not close prev transfer_window: ${error.message}`);

  return { updated: true, window_id: window.id };
}

/**
 * Indsætter nyt transfer_window for kommende sæson hvis ikke allerede tilstede.
 * Status='closed' fordi racing-sæsoner starter med lukket transfer-window
 * (åbnes manuelt/cron senere ved deadline-day-flow).
 *
 * Eksporteret i #532 så manuel admin-flow (`POST /admin/seasons/:id/start`)
 * kan oprette deterministisk UUID-window matching engine's pattern.
 */
export async function insertTransferWindowIfMissing(supabase, windowId, seasonId, transitionAtIso) {
  const { data: existing, error: existingError } = await supabase
    .from("transfer_windows").select("id, status").eq("id", windowId).maybeSingle();
  if (existingError) throw new Error(`Could not check transfer_window ${windowId}: ${existingError.message}`);

  if (existing) {
    return { skipped: true, reason: "window already exists", status: existing.status };
  }

  const { error } = await supabase
    .from("transfer_windows")
    .insert({
      id: windowId,
      season_id: seasonId,
      status: "closed",
      created_at: transitionAtIso,
    });
  if (error) throw new Error(`Could not insert next transfer_window: ${error.message}`);

  return { inserted: true, window_id: windowId };
}

async function writeAdminLog(supabase, payload) {
  const { fromSeasonId, toSeasonId, fromNumber, toNumber, transitionAtIso, adminUserId, plan } = payload;

  // Idempotency: tjek om vi allerede har logget denne transition.
  // Vi bruger metadata.from_season_id + metadata.to_season_id for at matche eksisterende rows.
  const { data: existing, error: existingError } = await supabase
    .from("admin_log")
    .select("id")
    .eq("action_type", ADMIN_ACTION_TYPE.SEASON_TRANSITION)
    .contains("meta", { from_season_id: fromSeasonId, to_season_id: toSeasonId })
    .maybeSingle();
  if (existingError) throw new Error(`Could not check admin_log idempotency: ${existingError.message}`);

  if (existing) {
    return { skipped: true, reason: "admin_log entry already exists", id: existing.id };
  }

  // description er NOT NULL i admin_log. Cron-runs har adminUserId=null — kræver
  // at admin_log.admin_user_id er gjort nullable (migration 2026-05-21 efter
  // sæson-loop-incidenten). Uden description-feltet eller med null admin_user_id
  // fejlede tidligere INSERT silently → 0 season_transition-rows i logs trods
  // 4 reelle transitions kørte (incident 2026-05-21 21:15–21:45 UTC).
  const { data, error } = await supabase
    .from("admin_log")
    .insert({
      action_type: ADMIN_ACTION_TYPE.SEASON_TRANSITION,
      admin_user_id: adminUserId,
      description: adminUserId
        ? `Sæson-transition: ${fromNumber} → ${toNumber} (manuel via admin)`
        : `Sæson-transition: ${fromNumber} → ${toNumber} (auto via cron)`,
      target_team_id: null,
      meta: {
        from_season_id: fromSeasonId,
        from_season_number: fromNumber,
        to_season_id: toSeasonId,
        to_season_number: toNumber,
        transition_at: transitionAtIso,
        teams_affected: plan.teams_affected,
        sponsor_base_total: plan.sponsor_base_total,
        // #2753 · den faktiske udbetaling (modifier × pullout × loft) logges ved
        // siden af den garanterede base, så admin-loggen kan revideres bagefter.
        sponsor_payout_total: plan.sponsor_payout_total,
      },
      created_at: transitionAtIso,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not write admin_log: ${error.message}`);

  return { inserted: true, id: data.id };
}

// ─── Hovedfunktion ────────────────────────────────────────────────────────────

/**
 * Udfør sæson-transition. Idempotent — re-run efter delvis fejl er sikker.
 *
 * Re-run accepteres når enten:
 *   - fromSeason.status='active' (normal kørsel), eller
 *   - fromSeason.status='completed' OG toSeason eksisterer (resume efter
 *     partial failure efter mark_previous_completed; alle remaining faser er
 *     idempotente). Se #578.
 *
 * @param {object} args
 * @param {object} args.supabase                — Supabase service-role client
 * @param {string} args.fromSeasonId            — UUID på sæsonen der lukkes (active eller completed-med-resume)
 * @param {Date|string} [args.transitionAt]     — tidspunkt for transition (default: nu)
 * @param {boolean} [args.dryRun]               — hvis true: ingen writes, returnér plan
 * @param {string|null} [args.adminUserId]      — auth.uid for admin-loggen
 * @param {object} [args.deps]                  — dependency-injection for tests
 * @returns {Promise<{ ok: true, dryRun: boolean, plan: object, log?: Array }>}
 */
export async function transitionToNextSeason({
  supabase,
  fromSeasonId,
  transitionAt = new Date(),
  dryRun = false,
  adminUserId = null,
  deps = {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const transitionAtIso = transitionAt instanceof Date ? transitionAt.toISOString() : transitionAt;

  const plan = await buildTransitionPlan({ supabase, fromSeasonId });

  if (dryRun) {
    // #2916 · vis carry-over-tallene i preview'et, så man kan se HVOR MANGE
    // træningsplaner der bæres over FØR man trykker på knappen. Rent læsende
    // (dryRun=true) og best-effort — et preview må aldrig fejle på den her konto.
    let carryOverPreview = null;
    try {
      const carryOverFn = deps.carryOverManagerSetup ?? defaultCarryOverManagerSetup;
      carryOverPreview = await carryOverFn({
        supabase,
        fromSeasonId,
        toSeasonId: plan.to_season.id,
        dryRun: true,
      });
    } catch (err) {
      // Previewet må aldrig fejle på carry-over-probens konto — men fejlen må
      // heller ikke være usynlig: præcis denne kode kører for alvor få minutter
      // senere, og ejeren bruger tallet som go/no-go-gate før cutoveren. Derfor
      // både i svaret (så det ses i dialogen), i loggen og i Sentry.
      carryOverPreview = { error: err.message };
      console.error("season-transition preview: carry-over-probe fejlede:", err?.message || err);
      captureException(err, {
        tags: { phase: "manager_setup_carry_over", stage: "preview" },
        extra: { fromSeasonId, toSeasonId: plan.to_season.id },
      });
    }
    return { ok: true, dryRun: true, plan, carryOverPreview };
  }

  if (plan.already_transitioned) {
    // Kan stadig være halvfærdig — fortsæt fase 2-6 (alle er idempotente).
  }

  const log = [];

  // #2921 · START-anker FØR første write. Uden det er en transition der dør
  // halvvejs (fejl, proces-død, Railway-restart) maskinelt usynlig: admin_log
  // fik tidligere først en række NÅR alt var færdigt. Best-effort — kaster aldrig.
  await logTransitionPhaseSafe({
    supabase,
    status: TRANSITION_PHASE_STATUS.STARTED,
    fromSeasonId,
    toSeasonId: plan.to_season.id,
    fromNumber: plan.from_season.number,
    toNumber: plan.to_season.number,
    adminUserId,
    transitionAtIso,
  });

  log.push({
    phase: "insert_next_season",
    ...(await insertSeasonIfMissing(
      supabase, plan.to_season.id, plan.to_season.number, transitionAtIso
    )),
  });

  log.push({
    phase: "mark_previous_completed",
    ...(await markSeasonCompleted(supabase, fromSeasonId, transitionAtIso)),
  });

  // Phase 3b (#2453 Global Rank): halvér alle bankede point + tilføj den netop
  // afsluttede sæsons point (apply_global_rank_season_rollover-RPC, se
  // database/2026-07-17-global-rank.sql). Additivt + isoleret: en fejl her må
  // ALDRIG vælte resten af sæson-transitionen (samme disciplin som de øvrige
  // additive faser, fx contract_expiring_notifications). RPC'en er IKKE
  // automatisk retry-sikker ved delvis fejl (en halvering der delvist er kørt og
  // køres igen ville halvere for meget) — en fejlet fase her kræver manuel
  // undersøgelse, ikke blind retry af hele transitionToNextSeason.
  const applyGlobalRankRolloverFn = deps.applyGlobalRankSeasonRollover ?? (async (sid) => {
    const { error } = await supabase.rpc("apply_global_rank_season_rollover", {
      p_completed_season_id: sid,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
  try {
    log.push({
      phase: "global_rank_decay",
      ...(await applyGlobalRankRolloverFn(fromSeasonId)),
    });
  } catch (err) {
    log.push({ phase: "global_rank_decay", error: err.message });
    captureException(err, {
      tags: { phase: "global_rank_decay" },
      extra: { fromSeasonId, note: "kræver manuel undersøgelse — RPC ikke blind-retry-sikker (dobbelt halvering)" },
    });
  }

  log.push({
    phase: "close_prev_transfer_window",
    ...(await closePrevTransferWindow(supabase, fromSeasonId, transitionAtIso)),
  });

  log.push({
    phase: "insert_next_transfer_window",
    ...(await insertTransferWindowIfMissing(
      supabase, plan.to_season.transfer_window_id, plan.to_season.id, transitionAtIso
    )),
  });

  // #805 · Board-test-exit: hvis den afgående sæson kørte board_test_mode, nulstil
  // board-data så test-perioden ikke bærer økonomisk spor (modificerede
  // budget_modifiers / consequences) ind i den nye sæson. Det nye window har
  // board_test_mode=false (default fra insertTransferWindowIfMissing) → bestyrelsen
  // tæller rigtigt fra sæson 2. Kører FØR processSeasonStart så de genskabte
  // baseline-rows (modifier 1.0) anvendes i sponsor-payout. Sæson 2 er allerede
  // 'active' efter insert_next_season, så resetBetaBoardProfiles rammer den rigtigt.
  const { data: prevWindow, error: prevWindowError } = await supabase
    .from("transfer_windows")
    .select("board_test_mode")
    .eq("season_id", fromSeasonId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevWindowError) {
    // best-effort: board-test-reset er additiv-isoleret som søsterfaserne nedenfor
    // og må ikke vælte selve skiftet — men den skal være SYNLIG (#2897). Uden
    // error-destrukturering blev prevWindow bare null og resetten sprang tavst over,
    // så sæson 2 arvede beta-bestyrelsens budget_modifiers uden spor nogen steder.
    log.push({ phase: "reset_board_test_data", error: prevWindowError.message });
    captureException(new Error(`Could not read prev transfer_window board_test_mode: ${prevWindowError.message}`), {
      tags: { phase: "reset_board_test_data" },
      extra: { fromSeasonId },
    });
  }
  if (prevWindow?.board_test_mode === true) {
    const resetBetaBoardProfilesFn = deps.resetBetaBoardProfiles ?? (await getResetBetaBoardProfiles());
    log.push({
      phase: "reset_board_test_data",
      ...(await resetBetaBoardProfilesFn(supabase)),
    });
  }

  // Phase 5a-2 (#2948): sæsonmåls-bonusser for den NETOP AFSLUTTEDE sæson —
  // SKAL køre FØR expireAndRenewContracts flipper kontrakt-status (klausulen
  // sidder på den stadig-aktive kontrakt). Idempotent pr. (kontrakt, sæson).
  // Additiv-isoleret: en fejl her må ikke vælte skiftet.
  const evaluateSeasonObjectivesFn =
    deps.evaluateSeasonObjectives ?? defaultEvaluateSeasonObjectives;
  try {
    log.push({
      phase: "sponsor_season_objectives",
      ...(await evaluateSeasonObjectivesFn({
        supabase,
        finishedSeasonNumber: plan.from_season.number,
      })),
    });
  } catch (err) {
    // best-effort: fasen er additiv-isoleret (#2948) og må aldrig vælte skiftet,
    // men den udbetaler RIGTIGE penge (sæsonmåls-bonus). En tavs fejl = managere
    // der lydløst mister deres bonus, og det opdages først hvis nogen tæller
    // finance_transactions manuelt. Samme Sentry-disciplin som søsterfaserne
    // global_rank_decay og contract_expiry_release ovenfor.
    log.push({ phase: "sponsor_season_objectives", error: err.message });
    captureException(err, {
      tags: { phase: "sponsor_season_objectives" },
      extra: { finishedSeasonNumber: plan.from_season.number },
    });
  }

  // Phase 5b (#1663, Økonomi Fase 2): udløb + forny sponsor-kontrakter FØR
  // sponsor-payout. For hvert menneske-hold beholdes en stadig-låst kontrakt
  // (expires_after_season >= ny sæson) — ellers udløbes den gamle og default-
  // varianten ("safe", 1 sæson — #2914) for den nye sæson auto-tildeles. Garanterer at hvert
  // hold har en aktiv kontrakt hvis guaranteed_base processSeasonStart betaler.
  // Samme menneske-hold-diskriminator som processSeasonStart (#1077), nu via den
  // fælles helper og INKLUSIV is_test_account (#2852) — ellers ville test-kontiene
  // få tildelt rigtige sponsorkontrakter som processSeasonStart bagefter nægter at
  // betale, altså en ny form for drift mellem de to faser.
  // expireAndRenewContracts er injicerbar via deps for test.
  const expireAndRenewContractsFn =
    deps.expireAndRenewContracts ?? defaultExpireAndRenewContracts;
  const { data: renewTeams, error: renewTeamsError } = await applyHumanTeamFilter(
    supabase.from("teams").select("id")
  );
  if (renewTeamsError) {
    throw new Error(`Could not load teams for contract renewal: ${renewTeamsError.message}`);
  }
  await expireAndRenewContractsFn({
    supabase,
    newSeasonNumber: plan.to_season.number,
    teamIds: (renewTeams || []).map((t) => t.id),
  });
  log.push({
    phase: "sponsor_contracts_renewal",
    teams: (renewTeams || []).length,
  });

  // Phase 5b-2 (#1150, 5/8): AI-hold auto-fornyer udløbende senior-kontrakter FØR
  // Phase 5c frigiver dem. AI-hold har ingen manager til at trykke "forlæng"
  // (#1720) — uden denne fase ville contract_expiry_release nedenfor gutte
  // AI-truppen blindt (dry-run 5/8 mod prod: flere AI-hold falder fra 8-12 til
  // 3-5 ryttere, under MIN_RIDERS_FOR_RACE=8). Kører FØR Phase 5c, så en fornyet
  // AI-rytters contract_end_season allerede er > plan.from_season.number når
  // release-forespørgslens <=-gate rammer den — ingen ændring af
  // contractExpiryRelease.js er nødvendig. Additivt + isoleret (samme disciplin
  // som nabo-faserne): en fejl her må ALDRIG vælte resten af transitionen.
  const renewExpiringAiContractsFn =
    deps.renewExpiringAiContracts ?? defaultRenewExpiringAiContracts;
  try {
    log.push({
      phase: "ai_contract_auto_renewal",
      ...(await renewExpiringAiContractsFn({
        supabase,
        seasonNumber: plan.from_season.number,
      })),
    });
  } catch (err) {
    log.push({ phase: "ai_contract_auto_renewal", error: err.message, ...(err.partialStats || {}) });
    captureException(err, {
      tags: { phase: "ai_contract_auto_renewal" },
      extra: { fromSeasonId, fromSeasonNumber: plan.from_season.number, partialStats: err.partialStats ?? null },
    });
  }

  // Phase 5c (#2744-B, ejer-beslutning 23/7 valg B): rytterkontrakt-udløb → fri-
  // agent. Ryttere hvis contract_end_season <= den NETOP AFSLUTTEDE sæson
  // (plan.from_season.number) frigives til fri-agent-poolen (team_id=null).
  // FØRSTE gang mekanikken kører (S1 → S2, 196 ryttere i prod 23/7). Additivt +
  // isoleret: en fejl her må ALDRIG vælte resten af sæson-transitionen (samme
  // disciplin som contract_expiring_notifications/global_rank_decay).
  const releaseExpiredContractRidersFn =
    deps.releaseExpiredContractRiders ?? defaultReleaseExpiredContractRiders;
  try {
    log.push({
      phase: "contract_expiry_release",
      ...(await releaseExpiredContractRidersFn({
        supabase,
        seasonNumber: plan.from_season.number,
      })),
    });
  } catch (err) {
    // Partial-failure-observability: releaseExpiredContractRiders hænger sine
    // hidtil-akkumulerede stats på err.partialStats FØR den kaster (se dens egen
    // JSDoc) — uden dette ville operatøren kun se fejlbeskeden, ikke hvor langt
    // frigivelsen nåede (kritisk 27/7, hvor dette er 196 rækker i ét kørsel).
    log.push({ phase: "contract_expiry_release", error: err.message, ...(err.partialStats || {}) });
    captureException(err, {
      tags: { phase: "contract_expiry_release" },
      extra: { fromSeasonId, fromSeasonNumber: plan.from_season.number, partialStats: err.partialStats ?? null },
    });
  }

  // Phase 6: sponsor-payout + payroll (idempotent via partial UNIQUE-indices
  // på sponsor:team:season + salary/negative_interest:team:season +
  // uniq_loan_interest_per_loan_season).
  //
  // #535: processSeasonStart returnerer nu { sponsor: [...], payroll: { results, summary } }
  // i stedet for ren sponsor-array. Bagudkompatibilitet: ældre stubs (tests
  // der returnerer et array eller intet payroll-felt) håndteres som "ingen
  // payroll-data" i return-log.
  const processSeasonStartFn = deps.processSeasonStart ?? (await getProcessSeasonStart());
  const seasonStartResult = await processSeasonStartFn(plan.to_season.id, { supabase });

  const sponsorList = Array.isArray(seasonStartResult)
    ? seasonStartResult
    : (seasonStartResult?.sponsor || []);
  log.push({
    phase: "sponsor_payout",
    count: sponsorList.length,
  });

  // Phase 6b: season_payroll — aggregeret summary af payroll-trinene
  // (loan_interest, salary, emergency_loan, negative_balance_interest).
  // Tidligere skete dette inde i processSeasonStart uden at counts/totaler
  // blev returneret. Admin måtte køre manuel SQL i Supabase for at
  // verificere at de forventede rows blev skrevet (audit 2026-05-21).
  if (seasonStartResult && typeof seasonStartResult === "object" && seasonStartResult.payroll) {
    log.push({
      phase: "season_payroll",
      ...seasonStartResult.payroll.summary,
    });
  } else {
    // Legacy stub (test der returnerer en array) — log tom payroll-summary
    // så fase-count er stabil, men markér eksplicit at data ikke kunne
    // udledes så UI'en ikke viser misvisende 0-tællinger som "korrekt".
    log.push({
      phase: "season_payroll",
      skipped: true,
      reason: "processSeasonStart returnerede ikke payroll-summary",
    });
  }

  // #1980 · Nedrykningsfaldskærm — { count, total } summary (mirror season_payroll
  // ovenfor). Legacy stubs uden .parachute-felt logges som skipped, samme mønster
  // som season_payroll's fallback.
  if (seasonStartResult && typeof seasonStartResult === "object" && seasonStartResult.parachute) {
    log.push({
      phase: "season_parachute",
      ...seasonStartResult.parachute,
    });
  } else {
    log.push({
      phase: "season_parachute",
      skipped: true,
      reason: "processSeasonStart returnerede ikke parachute-summary",
    });
  }

  // #1137 · Passiv rytterudvikling (kun sæson ≥ 2). processSeasonStart kører den
  // isoleret; her surfacer vi summary i transition-loggen så admin ser udvikling/
  // pensioneringer pr. transition.
  if (seasonStartResult && typeof seasonStartResult === "object" && seasonStartResult.progression) {
    log.push({ phase: "rider_progression", ...seasonStartResult.progression });
  }

  // Phase 6e (#2748, ejer-beslutning 23/7): pension → fri trup-plads. Ryttere som
  // rytterudviklingen netop har sat is_retired på beholdt indtil nu deres team_id og
  // ville optage en plads af MAX_SQUAD_SIZE for evigt uden nogensinde at kunne køre
  // et løb. Kører EFTER rider_progression (som er der pensioneringen sættes) og er
  // tilstands-baseret/selv-helende, ikke sæson-baseret — se retirementRelease.js.
  // Additivt + isoleret: en fejl her må ALDRIG vælte resten af sæson-transitionen
  // (samme disciplin som contract_expiry_release).
  const releaseRetiredRidersFn =
    deps.releaseRetiredRiders ?? defaultReleaseRetiredRiders;
  try {
    log.push({
      phase: "retirement_release",
      ...(await releaseRetiredRidersFn({ supabase })),
    });
  } catch (err) {
    log.push({ phase: "retirement_release", error: err.message, ...(err.partialStats || {}) });
    captureException(err, {
      tags: { phase: "retirement_release" },
      extra: { fromSeasonId, toSeasonNumber: plan.to_season.number },
    });
  }

  // Phase 6f (#3043): detektér + varsl hold der er under MIN_RIDERS_FOR_RACE (8)
  // EFTER de to frigivelses-faser ovenfor (kontraktudløb + pension er nu endelige
  // for denne transition). #2748/#2834's squad-spærre (squadRiskGuard.js) gater
  // kun FRIVILLIGE handlinger (salg/frigivelse/auktion) — den rører aldrig selve
  // de automatiske faser, og intet tjekkede hidtil EFTER dem om et hold rent
  // faktisk endte under minimum. Ejerens egen worst-case-måling (23/7, #2748)
  // viser 0 hold under 8 i dagens bestand, så fasen forventes en no-op i praksis —
  // den er sikkerhedsnettet for når den antagelse ændrer sig. Additivt + isoleret:
  // REN detekt+varsl, intet auto-køb/auto-fill (ejer-beslutning 23/7: "ingen
  // automatisk erstatning denne gang"), og en fejl her må ALDRIG vælte
  // sæson-transitionen (samme disciplin som de to nabo-faser).
  const detectSquadsBelowMinimumFn =
    deps.detectAndNotifySquadsBelowMinimum ?? defaultDetectAndNotifySquadsBelowMinimum;
  try {
    log.push({
      phase: "squad_below_minimum_check",
      ...(await detectSquadsBelowMinimumFn({ supabase })),
    });
  } catch (err) {
    log.push({ phase: "squad_below_minimum_check", error: err.message, ...(err.partialStats || {}) });
    captureException(err, {
      tags: { phase: "squad_below_minimum_check" },
      extra: { fromSeasonId, toSeasonNumber: plan.to_season.number },
    });
  }

  // ─── #2910 + #2911 · SÆSONSTART-HOOKS (ENESTE KALDEPUNKT) ──────────────────
  // To flag-gatede mekanikker der begge er fail-safe OFF (= nuværende adfærd):
  //   season_fatigue_reset_enabled   → sæsonskifte-restitution (#2910)
  //   season_academy_intake_enabled  → sæson-optagelse til akademiet (#2911)
  // Al logik bor i backend/lib/seasonStartHooks.js + de to nye moduler; her står
  // KUN kaldet, så filen kan rebases uden konflikt. Kører EFTER retirement_release
  // (progression + akademi-graduering er afsluttet, så optagelsen ser den rigtige
  // bestand) og FØR kalender/entry-generatoren. Kaster aldrig.
  const runSeasonStartHooksFn = deps.runSeasonStartHooks ?? (await getRunSeasonStartHooks());
  log.push(...(await runSeasonStartHooksFn({
    supabase,
    now: transitionAt instanceof Date ? transitionAt : new Date(transitionAtIso),
    toSeasonNumber: plan.to_season.number,
    // #4482: den netop afsluttede saesons id - bonustilbud scopet til DEN
    // saeson udloeber her. Se board_bonus_offer_expiry i seasonStartHooks.js.
    fromSeasonId,
  })));
  // ─── slut #2910 + #2911 ────────────────────────────────────────────────────

  // #1704 · Per-division-kalender (forever). Gated bag auto_calendar_enabled (fail-safe OFF):
  // uden flaget sker INTET, så en buggy auto-kalender aldrig spammer en live sæson
  // (2026-05-21-incident-disciplin). Betinget fase (mønster som reset_board_test_data:
  // logges kun når aktiv). Kører EFTER season-start (puljerne/standings er sat) og FØR
  // admin_log, så hver ny sæson åbner med friske per-division-kalendre uden manuel
  // race-selection. Materializeren er idempotent + skriver kun til LIVE puljer.
  //
  // #3469 (leverance 5, ejer-fund: denne sti sprang gatePlan HELT over): FØR planlagde
  // denne fase direkte med writes (dryRun:false) — kalender-invarianter, etaperækkefølge
  // (#3326), realisme-bånd (#2755/#2769/#3347/#3469) og komposition (#3295/#3469) blev
  // ALDRIG tjekket, kun scripts/buildSeasonCalendar.js's manuelle CLI-sti kørte gaten.
  // Fasen kører nu FØRST en dry-run-plan, gate'r den (SAMME gatePlan som CLI'en, ingen
  // ny mekanisme), og nægter kun at APPLY'e ved BLOKERENDE brud — allowTierCompositionDrift
  // står bevidst på default (false): en automatisk transition må ALDRIG selv acceptere en
  // afvigelse en menneske-kørt CLI-session skulle tage aktivt stilling til.
  //
  // FAIL-SAFE (læst af #2642/postmortem-mønsteret i denne fils øvrige faser): en nægtet
  // kalender er BEDRE end en dårlig — fasen logger nægtelsen (med de konkrete brud) og
  // fanges af Sentry, men VÆLTER ALDRIG resten af transitionen (samme disciplin som
  // retirement_release/squad_below_minimum_check ovenfor). Spillerne får ingen ny
  // kalender den transition, men resten af sæsonskiftet (sponsor/payroll/puljer/
  // notifikationer) gennemføres uændret, og fasen er idempotent — en efterfølgende
  // manuel `buildSeasonCalendar.js`-kørsel (eller en rettet katalog-tilstand + en
  // re-kørt transition) kan lukke hullet uden at noget andet skal rulles tilbage.
  const isAutoCalendarEnabledFn = deps.isAutoCalendarEnabled ?? isAutoCalendarEnabled;
  if (await isAutoCalendarEnabledFn(supabase)) {
    const materializeFn = deps.materializeTierCalendars ?? (await getMaterializeTierCalendars());
    const gatePlanFn = deps.gatePlan ?? (await getGatePlan());
    let calendarApplied = false;
    try {
      const dryPlan = await materializeFn({
        supabase,
        seasonId: plan.to_season.id,
        seasonStartDate: transitionAtIso,
        from: transitionAt instanceof Date ? transitionAt : new Date(transitionAtIso),
        dryRun: true,
      });
      const { blocking, compositionDrift, tierCompositionDrift } = gatePlanFn(dryPlan);

      if (blocking.length) {
        log.push({
          phase: "season_calendar", skipped: true, reason: "gate_blocked",
          blocking, compositionDrift, tierCompositionDrift,
        });
        captureException(new Error(`auto-calendar (phase 17) refused by gatePlan: ${blocking.join(" · ")}`), {
          tags: { phase: "season_calendar" },
          extra: { toSeasonId: plan.to_season.id, blocking, compositionDrift, tierCompositionDrift },
        });
      } else {
        const applied = await materializeFn({
          supabase,
          seasonId: plan.to_season.id,
          seasonStartDate: transitionAtIso,
          from: transitionAt instanceof Date ? transitionAt : new Date(transitionAtIso),
          dryRun: false,
        });
        log.push({ phase: "season_calendar", ...applied, compositionDrift, tierCompositionDrift });
        calendarApplied = true;
      }
    } catch (err) {
      log.push({ phase: "season_calendar", error: err.message });
      captureException(err, {
        tags: { phase: "season_calendar" },
        extra: { toSeasonId: plan.to_season.id },
      });
    }

    // Fase 0b: proaktiv entry-generator — fyld de friske kalender-løb med assistent-
    // udtagne hold (binding-bevidst, idempotent). Additivt + bag eget flag (fail-safe
    // OFF); en fejl må ALDRIG vælte sæson-transitionen (samme disciplin som de øvrige
    // additive trin). Kører efter materialiseringen, så løbene findes — og KUN hvis
    // kalenderen faktisk blev anvendt (gaten kan have nægtet den ovenfor).
    if (calendarApplied) {
      const isAutoEntryGeneratorEnabledFn = deps.isAutoEntryGeneratorEnabled ?? isAutoEntryGeneratorEnabled;
      if (await isAutoEntryGeneratorEnabledFn(supabase)) {
        try {
          const runGeneratorFn = deps.runRaceEntryGenerator ?? (await getRunRaceEntryGenerator());
          log.push({
            phase: "season_entry_generator",
            ...(await runGeneratorFn({ supabase, seasonId: plan.to_season.id, dryRun: false })),
          });
        } catch (err) {
          log.push({ phase: "season_entry_generator", error: err.message });
        }
      }
    }
  }

  // Phase 6f (#2916) · Carry-over af managerens egen opsætning.
  //
  // Placeringen er bevidst SENT: først her er den nye sæsons trup og kalender
  // endelige (contract_expiry_release + rider_progression + retirement_release
  // har frigivet ryttere, og auto-kalenderen er materialiseret). Kopierer vi
  // tidligere, bærer vi planer over for ryttere der er på vej ud, og
  // peak/udtagelses-valideringen ville køre mod en kalender der ikke findes endnu.
  //
  // Additivt + isoleret: fasen skriver KUN nye training_plans-rækker til den nye
  // sæson og TÆLLER resten. En fejl her må aldrig vælte sæsonskiftet — samme
  // disciplin som contract_expiry_release/retirement_release ovenfor.
  const carryOverFn = deps.carryOverManagerSetup ?? defaultCarryOverManagerSetup;
  try {
    const carry = await carryOverFn({
      supabase,
      fromSeasonId,
      toSeasonId: plan.to_season.id,
      dryRun: false,
    });
    log.push({ phase: "manager_setup_carry_over", ...carry });
  } catch (err) {
    log.push({
      phase: "manager_setup_carry_over",
      error: err.message,
      ...(err.partialStats || {}),
    });
    captureException(err, {
      tags: { phase: "manager_setup_carry_over" },
      extra: {
        fromSeasonId,
        toSeasonId: plan.to_season.id,
        partialStats: err.partialStats ?? null,
        note: "managerens træningsplaner blev IKKE båret over — ryttere falder tilbage på auto-programmer indtil fasen køres igen (den er idempotent)",
      },
    });
  }

  log.push({
    phase: "admin_log",
    ...(await writeAdminLog(supabase, {
      fromSeasonId,
      toSeasonId: plan.to_season.id,
      fromNumber: plan.from_season.number,
      toNumber: plan.to_season.number,
      transitionAtIso,
      adminUserId,
      plan,
    })),
  });

  // Phase 7: Discord-broadcast (fire-and-forget). Pre-incident 2026-05-21 var
  // cron-fyrede transitions silent — bruger spotted først loopen efter 30 min.
  // Kaldet placeres her så både cron + /admin/season-transition broadcaster ens
  // (legacy /admin/seasons/:id/start og /end bruger separate kald).
  const notifyFn = deps.notifySeasonEvent ?? defaultNotifySeasonEvent;
  try {
    await notifyFn({ type: "season_started", seasonNumber: plan.to_season.number });
    log.push({ phase: "discord_broadcast", sent: true });
  } catch (err) {
    log.push({ phase: "discord_broadcast", sent: false, error: err.message });
  }

  // Phase 7b: in-app season_started-notifikationer til menneske-managers (#1357,
  // #3101). Tidligere fik managers KUN en Discord-broadcast; transition-motoren
  // indsatte ingen notification-rows, så in-app-inboxen var tom ved sæsonstart.
  // #3101 · try/catch her (samme disciplin som contract_expiring_notifications
  // nedenfor) — en total svigt i emitSeasonStarted (fx managers-query fejler)
  // må ikke vælte resten af transitionen/completion-loggen; isolerede pr.-
  // manager-fejl fanges allerede INDE i funktionen (stats.failed/failedUserIds).
  const emitSeasonStarted =
    deps.emitSeasonStartedNotifications ?? emitSeasonStartedNotifications;
  try {
    log.push({
      phase: "season_started_notifications",
      ...(await emitSeasonStarted({
        supabase,
        toSeason: plan.to_season,
      })),
    });
  } catch (err) {
    log.push({ phase: "season_started_notifications", error: err.message });
    captureException(err, {
      tags: { flow: "notifications", stage: "season_started_notifications" },
      extra: { toSeasonId: plan.to_season.id, seasonNumber: plan.to_season.number },
    });
  }

  // Phase 7c: #1836 · kontraktudløb-notifikationer. For hver ejet rytter hvis
  // contract_end_season = den KOMMENDE sæson får ejeren en advarsel om at
  // kontrakten udløber ved sæsonens udgang. Additivt + isoleret: en fejl her
  // må aldrig vælte transitionen (samme disciplin som de øvrige notif-trin).
  const emitContractExpiring =
    deps.emitContractExpiringNotifications ?? emitContractExpiringNotifications;
  try {
    log.push({
      phase: "contract_expiring_notifications",
      ...(await emitContractExpiring({
        supabase,
        seasonNumber: plan.to_season.number,
      })),
    });
  } catch (err) {
    log.push({ phase: "contract_expiring_notifications", error: err.message });
  }

  // #2921 · SLUT-anker med hele fase-listen (inkl. de fejl som de isolerede
  // faser selv fangede og lagde i loggen). Sammen med START-ankeret ovenfor
  // giver det: kørslen begyndte kl. X, nåede disse faser, sluttede kl. Y.
  // Mangler denne række mens START findes → transitionen kom aldrig igennem.
  await logTransitionPhaseSafe({
    supabase,
    status: TRANSITION_PHASE_STATUS.COMPLETED,
    fromSeasonId,
    toSeasonId: plan.to_season.id,
    fromNumber: plan.from_season.number,
    toNumber: plan.to_season.number,
    adminUserId,
    transitionAtIso,
    log,
  });

  return { ok: true, dryRun: false, plan, log };
}
