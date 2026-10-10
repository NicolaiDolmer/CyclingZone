// S-02b · Auto-accept-cron + tier-styrede reminders.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (S-02b leverer-listen)
// Q-bekræftelser 2026-05-05: B=b (default-focus afledes fra identity_basis),
//                            C   (T-3/T-1/auto-accept-tærskler — se #2463 for
//                                 den aktuelle enhed de måles i).
//
// #2463 · Tærsklerne var oprindeligt kalibreret mod seasons.race_days_completed
// (Q-C 2026-05-05) under antagelsen ~1 race-day pr. kalenderdag ⇒ et ~5-dages
// forhandlingsvindue. Men race_days_completed er SUM(stages) over ALLE
// completede løb i sæsonen på tværs af divisioner (seasonRaceDays.js) — vokser
// ~20+/dag. Prod-evidens 16/7: race_days_completed=524 (race_days_total=60!),
// 218 auto-accepts (bulk 54 stk. dagen efter sæsonstart), kun 25 T-3-reminders
// (ét kort vindue), 0 T-1-reminders NOGENSINDE. Fixet: kalenderdags-ur PR PLAN
// via resolveNegotiationOpenedAt() — anker = hvornår netop DENNE plan blev
// åbnet til forhandling, ikke et globalt sæson-race-day-ur. Samme underliggende
// enheds-bug rammer getBoardRenegotiationLock (boardRequests.js) + boardMidSeason
// midpoint + seasonRaceDays.js selv — fixes i separat issue, ikke her.
//
// Daglig cron-job — idempotent via notification-dedup (24h vindue) + status-check
// (skipper teams der allerede har en signed plan for nuværende plan_type).
//
// #3502 · Der er BEVIDST ingen global transfer_windows.board_negotiation_state-
// gate her længere (var her tidligere: skip hele cronen medmindre window var
// 'pending_5yr'/'pending_3yr'/'pending_1yr'). Feltet skrives kun ét sted i hele
// koden (boardSequentialNegotiation.js — kun til 'pending_5yr', kun ved
// sæson-1-slut) og falder aldrig videre. Hver efterfølgende sæsonskifte
// opretter desuden et NYT window uden feltet (seasonTransition.js
// insertTransferWindowIfMissing), som falder tilbage til DB-default 'locked'.
// Med den gate var cronen reelt død fra 26/7 (ingen T-3/T-1-reminders, ingen
// auto-accept). Erstattet af et per-hold signal i processTeamAutoAccept
// (hasStartedNegotiation) hentet direkte fra board_profiles/teams-domænet,
// som ikke kan drifte samme vej.
//
// Skalerings-præmis (CLAUDE.md): ingen kode-loops over fast manager-antal —
// vi loader kun human teams fra DB og itererer dem dynamisk.

import {
  BOARD_IDENTITY_RIDER_SELECT,
  ONBOARDING_PLAN_SEQUENCE,
} from "./boardConstants.js";
import {
  buildBoardProposal,
  finalizeBoardGoals,
  getPlanDuration,
  preserveExternalGoals,
} from "./boardGoals.js";
import { computeDnaSuggestions } from "./boardClubDna.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { deriveDefaultFocusFromIdentity } from "./boardIdentity.js";
import { regenerateBoardMembersForTeam } from "./boardMembers.js";
import { ensureMandateForTeamFormation } from "./boardMandateEngine.js";
import { readReputationStage, isReputationReadEnabled } from "./reputationFlag.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";
import { DEFAULT_SPONSOR_INCOME } from "./economyEngine.js";

// #4557 · Tærskel-konstanterne + resolveThresholds flyttet til
// boardNegotiationThresholds.js så den nye Mandat-årsmøde-cron
// (boardMandateAutoAccept.js) kan bruge SAMME regel uden at duplikere den.
// Re-exporteret her for bagudkompatibilitet — ingen kaldested ændrer sig.
import {
  DAY_MS,
  AUTO_ACCEPT_THRESHOLDS,
  ACTIVE_PLAYER_THRESHOLDS,
  ACTIVE_PLAYER_LAST_SEEN_DAYS,
  resolveThresholds,
} from "./boardNegotiationThresholds.js";

export {
  AUTO_ACCEPT_THRESHOLDS,
  ACTIVE_PLAYER_THRESHOLDS,
  ACTIVE_PLAYER_LAST_SEEN_DAYS,
  resolveThresholds,
};

// #3502 · Backfill-dæmpning ved deploy. Cronen var reelt død fra 26/7 (global
// window-gate, se filens toppe-kommentar) — prod-verifikation 7/8 viser 161
// pending real board-rækker for humane hold, hvoraf 149 allerede har et anker
// >= 5 dage gammelt. UDEN denne dæmpning ville det FØRSTE cron-tick efter
// merge bulk-auto-acceptere alle 149 på én gang (samme skadesmønster som
// #2463's "218 auto-accepts dagen efter sæsonstart" — se
// .claude/learnings/2026-07-16-board-auto-accept-unit-mismatch.md).
//
// Løsning uden nogen DB-skrivning (kode-fix-only-mandat, #3502): en floor der
// klapper enhver reelt ældre anker OP til selve floor-datoen, så hvert
// backloggede hold får en frisk, fuld T-3/T-1/auto-accept-cyklus fra deploy
// af i stedet for at blive dømt på det outage-akkumulerede efterslæb. Ren
// nedre grænse — påvirker ALDRIG et anker der reelt ligger efter floor'en
// (dvs. enhver forhandling der åbner normalt efter deploy er helt uberørt).
// Selv-udløbende: når "nu" passerer floor + 5 dage, er clampen et permanent
// no-op for al fremtidig drift. Sat til ejer-review-vinduet efter denne PR
// (~1 uge margin fra 7/8) — juster datoen op hvis merge trækker ud.
export const AUTO_ACCEPT_ROLLOUT_FLOOR = new Date("2026-08-15T00:00:00Z");

// #2469 · Kolonnerne autoAcceptPendingPlan viderefører fra en EKSISTERENDE
// board-række. Enhver kolonne der læses som `existingBoard?.x ?? <default>` i
// upserten SKAL stå her — mangler den, læses den som undefined og defaulten
// overskriver spillerens optjente værdi i stedet for at bevare den.
// Forward-guard: boardAutoAccept.test.js låser dette mod upsert-payloaden.
// #2463 · created_at/updated_at tilføjet — de bærer anker-datoen som
// resolveNegotiationOpenedAt() læser (updated_at = hvornår DENNE rækkes
// forhandling blev åbnet; created_at = fallback når raden mangler helt).
export const BOARD_AUTO_ACCEPT_SELECT =
  // #4865 · `current_goals` SKAL med: autoAcceptPendingPlan bygger et friskt
  // goals-array og bevarer fremmede mål (bonus_offer) fra den eksisterende
  // række via preserveExternalGoals. Uden kolonnen her ville existingBoard
  // være `undefined` på feltet, og hvert auto-accept ville tabe bonus-målet
  // præcis som /board/sign gjorde for de 11 hold i #4865.
  // #5946 · `negotiated_at` SKAL med: 1yr-spejlingen af et underskrevet mandat
  // (autoAcceptPendingPlan) bevarer rækkens eksisterende stempel.
  "id, plan_type, focus, negotiation_status, is_baseline, satisfaction, budget_modifier, tradeoff_payload, current_goals, negotiated_at, created_at, updated_at";

/**
 * #2463 · Find hvornår en pending plan blev "åbnet til forhandling" — ankeret
 * kalenderdags-uret måler fra. Kalenderdags-uret er PR PLAN, ikke pr. sæson.
 *
 * 1. Pending-board-rækken findes → dens updated_at. Verificeret stabil:
 *    boardWeekendFinalization.js skipper ikke-completed boards (rører aldrig
 *    en pending rækkes updated_at), sæson-slut-flippet (economyEngine.js) og
 *    POST /board/renew (routes/api.js) sætter begge updated_at eksplicit ved
 *    åbning, og formations-boardet får updated_at=NOW() ved insert (schema.sql
 *    board_profiles.updated_at DEFAULT NOW()).
 * 2. Plan-rækken MANGLER (sekventiel onboarding — fx 5yr signeret, 3yr-rækken
 *    findes endnu ikke) → max(created_at) over holdets completede
 *    ikke-baseline board-rækker, dvs. da forrige plan blev signeret eller
 *    auto-accepteret. created_at røres aldrig af senere updates.
 * 3. Fallback: team.created_at (helt nyt hold, ingen board-historik endnu).
 * 4. Alt ugyldigt/manglende → null. Kaldestedet skipper holdet uden exception.
 *
 * @param {object} args
 * @param {object} [args.team]
 * @param {object|null} [args.pendingBoard]
 * @param {object[]} [args.realBoards] — alle ikke-baseline board-rækker for holdet
 * @returns {Date|null}
 */
export function resolveNegotiationOpenedAt({ team, pendingBoard, realBoards }) {
  if (pendingBoard?.updated_at) {
    const fromBoard = new Date(pendingBoard.updated_at);
    if (!Number.isNaN(fromBoard.getTime())) return fromBoard;
  }

  if (!pendingBoard) {
    const completedCreatedMs = (realBoards || [])
      .filter((b) => b.negotiation_status === "completed" && b.created_at)
      .map((b) => new Date(b.created_at).getTime())
      .filter((ms) => !Number.isNaN(ms));
    if (completedCreatedMs.length > 0) {
      return new Date(Math.max(...completedCreatedMs));
    }
  }

  if (team?.created_at) {
    const fromTeam = new Date(team.created_at);
    if (!Number.isNaN(fromTeam.getTime())) return fromTeam;
  }

  return null;
}

/**
 * Cron-entry: tjek alle human teams for pending board-planer og send
 * reminders / auto-accept baseret på kalenderdage siden planen blev åbnet
 * til forhandling (#2463 — se resolveNegotiationOpenedAt).
 *
 * @param {object} args
 * @param {object} args.supabase             — Supabase client
 * @param {Function} args.notifyUser         — fra notificationService.js
 * @param {Date} [args.now]                  — for tests
 * @returns {Promise<{ teams_checked: number, reminders_sent: number, auto_accepted: number, errors: number }>}
 */
export async function processBoardAutoAcceptCron({
  supabase,
  notifyUser,
  now = new Date(),
  captureExceptionFn,
  // #3502 · Injicerbar for tests (se AUTO_ACCEPT_ROLLOUT_FLOOR ovenfor). Den
  // rigtige cron (backend/cron.js) sender ALDRIG denne — den bruger altid
  // default-floor'en.
  rolloutFloor = AUTO_ACCEPT_ROLLOUT_FLOOR,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (typeof notifyUser !== "function") throw new Error("notifyUser is required");

  const summary = {
    teams_checked: 0,
    reminders_sent: 0,
    auto_accepted: 0,
    errors: 0,
  };

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, race_days_completed, race_days_total")
    .eq("status", "active")
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!activeSeason) return summary;

  const { data: humanTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, balance, sponsor_income, division, season_1_identity_basis, team_dna_key, created_at")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsError) throw teamsError;

  // #3579 · last_seen pr. manager afgør hvilket tærskelsæt holdet får
  // (resolveThresholds). Bevidst en SEPARAT query frem for et embedded
  // `user:user_id(last_seen)`-join på selecten ovenfor: teams-queryen er
  // cronens kritiske sti, og en fejlende relations-udledning dér ville kaste
  // og dræbe HELE kørslen — altså præcis den tilstand #3502/#3572 lige har
  // rettet. Her er konsekvensen af en fejl afgrænset: opslaget degraderer til
  // et tomt map, og alle hold falder tilbage til det korte (nuværende) sæt.
  const lastSeenByUserId = await loadLastSeenByUserId({
    supabase,
    userIds: (humanTeams || []).map((t) => t.user_id).filter(Boolean),
  });

  // #6184 · Ét batch-opslag af board_profiles for alle hold i stedet for ét
  // opslag pr. hold (prod 5/10: flere hundrede enkelt-GETs pr. kørsel, alle i
  // samme sekund-vindue). null = batch-opslaget fejlede → hvert hold henter
  // selv som før, så en fejl stadig kun rammer det enkelte hold.
  const boardsByTeamId = await loadBoardsByTeamId({
    supabase,
    teamIds: (humanTeams || []).map((t) => t.id).filter(Boolean),
    captureExceptionFn,
  });
  // #6122 · Med mandat-modellen 'on' ser ALLE managere Boardroom/årsmødet
  // (BoardroomRoute.jsx), og den gamle plan-forhandling findes ikke længere som
  // handling. Prod 5/10: plan-påmindelserne ("The board is waiting for your
  // 3-year plan") fyrede stadig parallelt med mandat-påmindelserne, også efter
  // at manageren havde underskrevet sit mandat. LÆSE-gaten (ingen opts) er
  // bevidst: i 'beta' ser almindelige managere stadig den gamle side og skal
  // stadig have påmindelserne. Auto-accept kører fortsat, bare uden besked.
  const silent = await isBoardMandateModelEnabled(supabase);
  // #5946 · Under 'on' er mandatet sandheden: et hold med et UNDERSKREVET
  // mandat i den aktive sæson må ikke få sin 1yr-række genskrevet med
  // standardmål (se autoAcceptPendingPlan). null = batch-opslaget fejlede →
  // hvert hold slår selv op (samme degradering som boardsByTeamId).
  const signedMandatesByTeamId = silent
    ? await loadSignedMandatesByTeamId({
      supabase,
      teamIds: (humanTeams || []).map((t) => t.id).filter(Boolean),
      seasonNumber: activeSeason.number,
      captureExceptionFn,
    })
    : new Map();

  for (const team of humanTeams || []) {
    summary.teams_checked += 1;
    try {
      const result = await processTeamAutoAccept({
        supabase,
        team,
        activeSeason,
        notifyUser,
        now,
        rolloutFloor,
        lastSeenByUserId,
        preloadedBoards: boardsByTeamId ? (boardsByTeamId.get(team.id) || []) : undefined,
        silent,
        preloadedSignedMandate: signedMandatesByTeamId ? (signedMandatesByTeamId.get(team.id) ?? null) : undefined,
      });
      if (result.reminder_sent) summary.reminders_sent += 1;
      if (result.auto_accepted) summary.auto_accepted += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`  ❌ board auto-accept failed for team ${team.id}:`, error.message);
      if (captureExceptionFn) {
        captureExceptionFn(error, {
          tags: { cron: "board-auto-accept" },
          extra: { teamId: team.id, seasonId: activeSeason?.id },
        });
      }
    }
  }

  return summary;
}

/**
 * #3579 · Slår last_seen op for de managere cronen skal vurdere.
 *
 * Fejler opslaget, returneres et tomt map i stedet for at kaste: uden
 * last_seen falder alle hold tilbage til det korte tærskelsæt, hvilket er
 * nøjagtig adfærden før denne ændring. En degradering er langt at foretrække
 * frem for at vælte cronen for alle hold.
 *
 * @returns {Promise<Map<string, string|null>>} user_id → last_seen
 */
async function loadLastSeenByUserId({ supabase, userIds }) {
  const map = new Map();
  if (!userIds?.length) return map;

  const { data, error } = await supabase
    .from("users")
    .select("id, last_seen")
    .in("id", userIds);

  if (error) {
    console.error("  ⚠️  board auto-accept: kunne ikke hente last_seen — alle hold falder tilbage til det korte vindue:", error.message);
    return map;
  }
  for (const row of data || []) map.set(row.id, row.last_seen ?? null);
  return map;
}

/**
 * #6184 · Henter board_profiles for alle hold i chunks (pagineret) og grupperer
 * pr. team_id. Returnerer null ved fejl, så kalderen falder tilbage til det
 * gamle per-hold-opslag i stedet for at vælte hele kørslen.
 *
 * @returns {Promise<Map<string, object[]>|null>}
 */
async function loadBoardsByTeamId({ supabase, teamIds, captureExceptionFn }) {
  const map = new Map();
  if (!teamIds?.length) return map;
  try {
    const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
      supabase
        .from("board_profiles")
        .select(`team_id, ${BOARD_AUTO_ACCEPT_SELECT}`)
        .in("team_id", chunk)
        .order("id")
    );
    for (const row of rows) {
      if (!map.has(row.team_id)) map.set(row.team_id, []);
      map.get(row.team_id).push(row);
    }
    return map;
  } catch (error) {
    // best-effort: batchet er kun en optimering — fallback'en er det gamle,
    // fuldt funktionelle per-hold-opslag. Fejlen rapporteres, ikke skjult.
    console.error("  ⚠️  board auto-accept: batch-opslag af board_profiles fejlede — falder tilbage til per-hold-opslag:", error?.message || error);
    if (captureExceptionFn) {
      captureExceptionFn(error, { tags: { cron: "board-auto-accept", stage: "board-batch-load" } });
    }
    return null;
  }
}

// #5946 · Kolonnerne 1yr-spejlingen bruger fra et underskrevet mandat.
const SIGNED_MANDATE_SELECT = "team_id, season_number, focus, goals, signed_at";

/**
 * #5946 · Underskrevne, aktive mandater for den aktive sæson, pr. team_id.
 * Returnerer null ved fejl (kalderen falder tilbage til per-hold-opslag).
 *
 * @returns {Promise<Map<string, object>|null>}
 */
async function loadSignedMandatesByTeamId({ supabase, teamIds, seasonNumber, captureExceptionFn }) {
  const map = new Map();
  if (!teamIds?.length || seasonNumber == null) return map;
  try {
    const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
      supabase
        .from("board_mandates")
        .select(SIGNED_MANDATE_SELECT)
        .in("team_id", chunk)
        .eq("status", "active")
        .eq("season_number", seasonNumber)
        .order("team_id")
    );
    // signed_at tjekkes her, ikke i queryen: status 'active' sættes kun af
    // signMandate sammen med signed_at, så det er et værn, ikke et filter.
    for (const row of rows) if (row.signed_at) map.set(row.team_id, row);
    return map;
  } catch (error) {
    console.error("  ⚠️  board auto-accept: batch-opslag af board_mandates fejlede — falder tilbage til per-hold-opslag:", error?.message || error);
    if (captureExceptionFn) {
      captureExceptionFn(error, { tags: { cron: "board-auto-accept", stage: "mandate-batch-load" } });
    }
    return null;
  }
}

async function loadSignedMandateForTeam({ supabase, teamId, seasonNumber }) {
  if (seasonNumber == null) return null;
  const { data, error } = await supabase
    .from("board_mandates")
    .select(SIGNED_MANDATE_SELECT)
    .eq("team_id", teamId)
    .eq("status", "active")
    .eq("season_number", seasonNumber)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.signed_at ? data : null;
}

async function processTeamAutoAccept({
  supabase,
  team,
  activeSeason,
  notifyUser,
  now,
  rolloutFloor = AUTO_ACCEPT_ROLLOUT_FLOOR,
  lastSeenByUserId = new Map(),
  preloadedBoards,
  silent = false,
  preloadedSignedMandate,
}) {
  const result = { reminder_sent: false, auto_accepted: false };
  // #6122 · silent = mandat-modellen er 'on': ingen plan-beskeder (se cron-entry).
  const notify = silent ? async () => ({ delivered: false, reason: "mandate_model_on" }) : notifyUser;

  // Find første pending plan_type i 5yr→3yr→1yr-orden.
  //
  // #2469 · Denne select SKAL bære hvert felt autoAcceptPendingPlan viderefører
  // fra den eksisterende række. Den hentede kun 5 kolonner, så `existingBoard`
  // manglede satisfaction/budget_modifier/tradeoff_payload — og fordi upserten
  // skriver `existingBoard?.satisfaction ?? 50`, blev `undefined ?? 50` til en
  // NULSTILLING af optjent tilfredshed og sponsor-modifier. /board/sign har
  // aldrig haft fejlen: den henter board-rækken via loadBoardPlanningContext
  // (routes/api.js) med .select("*"). Samme upsert-kode, modsat udfald — hele
  // divergensen lå i denne select. Udvid den, ikke kaldestedet.
  let boards = preloadedBoards;
  if (boards === undefined) {
    const { data, error: boardsError } = await supabase
      .from("board_profiles")
      .select(BOARD_AUTO_ACCEPT_SELECT)
      .eq("team_id", team.id);
    if (boardsError) throw boardsError;
    boards = data;
  }

  const realBoards = (boards || []).filter((b) => !b.is_baseline && b.plan_type !== "baseline");

  // #3502 · Erstatter den tidligere globale transfer_windows.board_negotiation_state-
  // gate (skrevet ÉN gang, kun til 'pending_5yr', af boardSequentialNegotiation.js —
  // faldt aldrig videre, og enhver senere sæsonskifte-insertTransferWindowIfMissing
  // (seasonTransition.js) skabte et nyt window UDEN feltet, som dermed defaultede
  // til 'locked'). Det gjorde cronen reelt død fra 26/7. Sandheden om "har DETTE
  // hold overhovedet startet forhandling" ligger i board_profiles-domænet, ikke i
  // et globalt vindues-felt: enten er team.season_1_identity_basis sat (skrives
  // synkront som trin 1 i startSequentialNegotiation for S1-kohorten, og af
  // ensureSeasonIdentityBasis ved holddannelse for S2+-nykommere, teamProfileEngine.js)
  // eller også findes der allerede en rigtig (ikke-baseline) board-række. Et hold der
  // stadig sidder i sæson-1-baseline-observation har hverken.
  const hasStartedNegotiation = Boolean(team.season_1_identity_basis) || realBoards.length > 0;
  if (!hasStartedNegotiation) return result;

  const pendingPlanType = findPendingPlanType(realBoards);
  if (!pendingPlanType) return result;

  const pendingBoard = realBoards.find((b) => b.plan_type === pendingPlanType) || null;

  // #2463 · Kalenderdags-ur pr. plan i stedet for det globale race_days_completed-ur.
  const openedAt = resolveNegotiationOpenedAt({ team, pendingBoard, realBoards });
  if (!openedAt) return result; // Alt ugyldigt/manglende → skip holdet, ingen exception.

  // #3502 · Backfill-dæmpning — se AUTO_ACCEPT_ROLLOUT_FLOOR ovenfor. Klapper
  // kun ankre der ligger FØR floor'en op til den; ankre efter floor'en (al
  // normal fremtidig drift) er uberørte.
  const effectiveOpenedAt = openedAt < rolloutFloor ? rolloutFloor : openedAt;
  const daysSinceOpen = (now.getTime() - effectiveOpenedAt.getTime()) / DAY_MS;

  // #3579 · Aktive spillere kører på det lange vindue, forladte konti på det korte.
  const thresholds = resolveThresholds(
    { last_seen: lastSeenByUserId.get(team.user_id) ?? null },
    now
  );

  if (daysSinceOpen >= thresholds.AUTO_ACCEPT) {
    // #5946 · Kun 1yr-rækken er mandatets dual-write-kopi, og kun under 'on'
    // (silent) er mandatet sandheden — i 'beta'/'off' er alt uændret.
    let signedMandate = null;
    if (silent && pendingPlanType === "1yr") {
      signedMandate = preloadedSignedMandate !== undefined
        ? preloadedSignedMandate
        : await loadSignedMandateForTeam({ supabase, teamId: team.id, seasonNumber: activeSeason?.number ?? null });
    }
    const accepted = await autoAcceptPendingPlan({
      supabase,
      team,
      activeSeason,
      planType: pendingPlanType,
      existingBoard: pendingBoard,
      notifyUser: notify,
      now,
      signedMandate,
    });
    result.auto_accepted = accepted;
    return result;
  }

  if (daysSinceOpen >= thresholds.T_MINUS_1) {
    const sent = await sendT1CriticalReminder({
      team,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser: notify,
      now,
      daysSinceOpen,
      thresholds,
    });
    result.reminder_sent = sent;
    return result;
  }

  if (daysSinceOpen >= thresholds.T_MINUS_3) {
    const sent = await sendT3InfoReminder({
      team,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser: notify,
      now,
      daysSinceOpen,
      thresholds,
    });
    result.reminder_sent = sent;
    return result;
  }

  // #3579 · Åbnings-varsel: kun i planens FØRSTE døgn. Beskeden bærer ingen
  // nedtælling, så 24h-dedup'en i notifyUser ville ellers sende den igen hvert
  // døgn indtil T-3 (5 dage i træk for aktive spillere). Vinduet [0,1) giver
  // præcis én levering — cronen tikker hvert 30. minut, så den rammes altid.
  if (daysSinceOpen >= thresholds.NOTICE && daysSinceOpen < 1) {
    const sent = await sendOpeningNotice({
      team,
      planType: pendingPlanType,
      pendingBoard,
      notifyUser: notify,
      now,
    });
    result.reminder_sent = sent;
  }

  return result;
}

// Sequential onboarding-orden 5yr→3yr→1yr (ONBOARDING_PLAN_SEQUENCE).
// Returnér første plan_type der enten mangler eller har status='pending'.
// Eksporteret så GET /board/status (routes/api.js) kan genbruge samme logik
// til auto_accept.pending_plan_type i stedet for at duplikere den.
export function findPendingPlanType(realBoards) {
  for (const planType of ONBOARDING_PLAN_SEQUENCE) {
    const board = (realBoards || []).find((b) => b.plan_type === planType);
    if (!board) return planType;
    if (board.negotiation_status === "pending") return planType;
  }
  return null;
}

// #3579 · Neutralt åbnings-varsel. Ingen nedtælling, ingen "hvis du ikke gør
// noget"-trussel — kun at planen ligger klar, og at der kommer en påmindelse
// inden bestyrelsen selv beslutter. Dette er den besked der skal være spillerens
// FØRSTE kontakt om en pending plan.
async function sendOpeningNotice({
  team, planType, pendingBoard, notifyUser, now,
}) {
  if (!team.user_id) return false;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_update",
    title: `Your board is ready to discuss your ${planLabelEn}`,
    message: `Your ${planLabelEn} is waiting to be negotiated. Take the time you need. You'll get a reminder before the board decides on its own.`,
    relatedId: pendingBoard?.id ?? null,
    metadata: {
      titleCode: "notif.boardPlanOpened.title",
      titleParams: { planLabelKey },
      messageCode: "notif.boardPlanOpened.message",
      messageParams: { planLabelKey },
    },
    now,
  });
  return Boolean(result?.delivered);
}

async function sendT3InfoReminder({
  team, planType, pendingBoard, notifyUser, now, daysSinceOpen,
  thresholds = AUTO_ACCEPT_THRESHOLDS,
}) {
  if (!team.user_id) return false;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  const daysLeft = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_update",
    title: `The board is waiting for your ${planLabelEn}`,
    message: `You have ${daysLeft} days left to negotiate your ${planLabelEn}. If you don't act, the board will decide.`,
    relatedId: pendingBoard?.id ?? null,
    metadata: {
      titleCode: "notif.boardT3Reminder.title",
      titleParams: { planLabelKey },
      messageCode: "notif.boardT3Reminder.message",
      messageParams: { daysLeft, planLabelKey },
    },
    now,
  });
  return Boolean(result?.delivered);
}

async function sendT1CriticalReminder({
  team, planType, pendingBoard, notifyUser, now, daysSinceOpen,
  thresholds = AUTO_ACCEPT_THRESHOLDS,
}) {
  if (!team.user_id) return false;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  const daysLeft = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
  const isSingle = daysLeft === 1;
  const result = await notifyUser({
    userId: team.user_id,
    type: "board_critical",
    title: `Last chance: ${planLabelEn}`,
    message: `The board takes over in ${daysLeft} day${isSingle ? "" : "s"}. Open the Board page and negotiate your ${planLabelEn} now.`,
    relatedId: pendingBoard?.id ?? null,
    metadata: {
      titleCode: "notif.boardT1Reminder.title",
      titleParams: { planLabelKey },
      messageCode: isSingle ? "notif.boardT1Reminder.messageSingle" : "notif.boardT1Reminder.messageMulti",
      messageParams: { daysLeft, planLabelKey },
    },
    now,
  });
  return Boolean(result?.delivered);
}

/**
 * #5946 · Mål + fokus for en 1yr-række der spejler et underskrevet mandat.
 * Ren funktion (eksporteret til test). `null` = intet at spejle (intet mandat,
 * anden plan_type eller tom målliste) → den normale standardmål-sti.
 */
export function buildMandateMirrorForOneYear({ planType, signedMandate } = {}) {
  if (planType !== "1yr" || !signedMandate?.signed_at) return null;
  // Rå mål ordret (som writeLegacyOneYearBoard) — parseBoardGoals ville
  // berige dem med metadata, og det må ikke persisteres.
  let goals = signedMandate.goals;
  if (typeof goals === "string") {
    try {
      goals = JSON.parse(goals);
    } catch {
      // best-effort: en ulæselig målliste = intet at spejle → den normale
      // standardmål-sti (samme udfald som før #5946), ingen ny fejlflade.
      goals = null;
    }
  }
  if (!Array.isArray(goals)) return null;
  goals = goals.filter((goal) => goal && typeof goal === "object");
  if (!goals.length) return null;
  return { goals, focus: signedMandate.focus || null };
}

async function autoAcceptPendingPlan({
  supabase, team, activeSeason, planType, existingBoard, notifyUser, now, signedMandate = null,
}) {
  // #5946 · Rodårsag: sæsonslut sætter 1yr-rækken til 'pending'
  // (economyEngine.processTeamSeasonEnd) — også når manageren allerede har
  // underskrevet næste sæsons mandat på årsmødet. Denne cron skrev så friske
  // STANDARDMÅL ind med negotiation_status='completed' og negotiated_at=null,
  // og #5751-reconciliationen lod den række overskrive mandatets forhandlede
  // target i Boardroom (spillerrapport: genforhandlet til top 7, viste top 5),
  // mens onboarding-fluebenet (negotiated_at) forsvandt. Med et underskrevet
  // mandat i den aktive sæson (kun under 'on', se processTeamAutoAccept)
  // spejles mandatets mål + fokus i stedet (samme indhold som årsmødets
  // dual-write, writeLegacyOneYearBoard), og rækkens negotiated_at røres ikke.
  const mandateMirror = buildMandateMirrorForOneYear({ planType, signedMandate });

  // Default focus afledes fra identity_basis (B=b 2026-05-05) — fallback til
  // existing focus (renewal-case) eller "balanced".
  const identityBasis = team.season_1_identity_basis || null;
  const focus = mandateMirror?.focus || existingBoard?.focus || deriveDefaultFocusFromIdentity(identityBasis);
  let dnaKey = team.team_dna_key || null;

  if (identityBasis && !dnaKey) {
    const suggestedDna = computeDnaSuggestions(identityBasis)[0] || null;
    dnaKey = suggestedDna?.key || null;

    if (dnaKey) {
      const { error: dnaUpdateError } = await supabase
        .from("teams")
        .update({
          team_dna_key: dnaKey,
          team_dna_chosen_at: now.toISOString(),
        })
        .eq("id", team.id);
      if (dnaUpdateError) throw dnaUpdateError;

      // Atomicitet (#878): rul team_dna_key/team_dna_chosen_at tilbage hvis member-
      // regenereringen kaster efter team-UPDATE er committet. Ellers efterlades teamet
      // dna-sat-men-boardless, og 409-guarden i POST /board/dna-choose ville låse
      // manageren ude. Samme mønster som chooseDnaForTeam (boardMembers.js).
      try {
        await regenerateBoardMembersForTeam({
          supabase,
          teamId: team.id,
          identityBasis,
          dnaKey,
        });
      } catch (regenError) {
        await supabase
          .from("teams")
          .update({ team_dna_key: null, team_dna_chosen_at: null })
          .eq("id", team.id);
        throw regenError;
      }

      // #4837 · Samme holddannelses-øjeblik som chooseDnaForTeam: cron'en har
      // netop valgt DNA og tildelt de 5 medlemmer for et hold der aldrig selv
      // svarede. Uden dette kald ville præcis de hold fødes uden relation og
      // mandat. Kaster aldrig, idempotent.
      await ensureMandateForTeamFormation(supabase, {
        teamId: team.id,
        seasonNumber: activeSeason?.number ?? null,
        now,
      });
    }
  }

  const rebuiltGoals = mandateMirror
    ? mandateMirror.goals
    : await buildDefaultAutoAcceptGoals({ supabase, team, planType, focus, identityBasis, dnaKey, existingBoard });

  const planDuration = getPlanDuration(planType);
  const startSeasonNumber = activeSeason?.number ?? 1;
  const endSeasonNumber = startSeasonNumber + planDuration - 1;

  // #4865 · Rebuild'en ejer kun de mål motoren selv genererer. Fremmede mål på
  // den eksisterende række (i dag et accepteret bonustilbuds ekstra-mål,
  // `source: "bonus_offer"`) bæres med over — pengene er allerede udbetalt,
  // så kravet må ikke forsvinde når planen fornys.
  const finalGoals = preserveExternalGoals({
    rebuiltGoals,
    previousGoals: existingBoard?.current_goals ?? [],
  });

  const upsertData = {
    team_id: team.id,
    focus,
    plan_type: planType,
    current_goals: finalGoals,
    // #2469 · Bevar optjent tilfredshed + sponsor-modifier. Ved sæson-slut
    // skriver economyEngine.processTeamSeasonEnd den netop optjente værdi ind
    // OG sætter negotiation_status='pending' (economyEngine.js) — så når
    // auto-accept-cron'en overtager planen, ER der en optjent værdi at bevare.
    // ?? 50 / ?? 1.0 gælder derfor kun den ægte nye-plan-case, hvor
    // findPendingPlanType returnerede en plan_type uden række (existingBoard=null).
    satisfaction: existingBoard?.satisfaction ?? 50,
    budget_modifier: existingBoard?.budget_modifier ?? 1.0,
    negotiation_status: "completed",
    // #5103 · negotiation_status='completed' alene måler IKKE en spillerhandling
    // — auto-accept sætter den præcis som et rigtigt /board/sign. onboarding-
    // trin 4 (board_plan_set) skelner derfor på negotiated_at i stedet
    // (routes/api.js /me/onboarding-progress): sat af /board/sign +
    // signMandate(signedVia='manager'), ALTID null her. Eksplicit null (ikke
    // udeladt) er bevidst — upsert-conflict-grenen opdaterer kun de kolonner
    // der er med i payloaden, så et tidligere spiller-signeret negotiated_at
    // ville ellers overleve stående ind i denne auto-accepterede cyklus (fx
    // efter /board/renew nulstiller status til 'pending' uden at røre feltet).
    // #5946 · Undtagelse: en spejling af et underskrevet mandat er ikke en ny
    // auto-accepteret cyklus — mandatets underskrift ER cyklussen, og den
    // skrev selv negotiated_at (manager) hhv. null (auto) via dual-writen.
    // Stemplet bevares derfor uændret.
    negotiated_at: mandateMirror ? (existingBoard?.negotiated_at ?? null) : null,
    plan_start_season_number: startSeasonNumber,
    plan_end_season_number: endSeasonNumber,
    plan_start_balance: team.balance ?? 0,
    plan_start_sponsor_income: team.sponsor_income ?? DEFAULT_SPONSOR_INCOME,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
    season_id: activeSeason?.id ?? null,
    is_baseline: false,
    // S-02g/#2469 · Plan-renewal nulstiller tradeoff (stramningen er netop bagt
    // ind i finalGoals via buildBoardProposal ovenfor) + MAJOR-pivot cool-down.
    // Identisk med /board/sign — ellers ville stramningen blive anvendt igen
    // ved næste renewal og stable oven på sig selv.
    tradeoff_active_until_season_id: null,
    tradeoff_payload: null,
    major_pivot_used_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("board_profiles")
    .upsert(upsertData, { onConflict: "team_id,plan_type" });
  if (upsertError) throw upsertError;

  const planLabelEn = formatPlanLabelEn(planType);
  const planLabelKey = planLabelI18nKey(planType);
  if (team.user_id) {
    await notifyUser({
      userId: team.user_id,
      type: "board_update",
      title: `The board chose ${planLabelEn} for you`,
      message: `You didn't negotiate your ${planLabelEn} in time — the board picked focus "${focus}" and default goals. You can still request changes once the plan is running.`,
      relatedId: null,
      metadata: {
        titleCode: "notif.boardAutoAccepted.title",
        titleParams: { planLabelKey },
        messageCode: "notif.boardAutoAccepted.message",
        messageParams: { planLabelKey, focus },
      },
      now,
    });
  }

  return true;
}

// #5946 · Den normale auto-accept-sti: friske standardmål fra buildBoardProposal.
async function buildDefaultAutoAcceptGoals({ supabase, team, planType, focus, identityBasis, dnaKey, existingBoard }) {
  // Load riders + standing til mål-generering.
  const [ridersRes, standingRes] = await Promise.all([
    supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", team.id),
    supabase.from("season_standings").select("*").eq("team_id", team.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (ridersRes.error) throw ridersRes.error;
  if (standingRes.error) throw standingRes.error;

  const proposal = buildBoardProposal({
    focus,
    planType,
    reputationEnabled: isReputationReadEnabled(await readReputationStage(supabase)),
    team,
    riders: ridersRes.data || [],
    standing: standingRes.data || null,
    identityBasis,
    dnaKey,
    // S-02g/#2469 · Anvend deferred tradeoff-stramning fra forrige sæsons
    // approved request — præcis som /board/sign og /board/proposal gør.
    // Uden den her gav samme plan to udfald: signerede du selv, blev din
    // tradeoff anvendt; lod du planen udløbe, forsvandt den.
    // (buildBoardProposal har ingen `board`-parameter — kun tradeoffPayload
    // er kausal. api.js' `board:`-argument er en død prop, ryddet separat.)
    tradeoffPayload: existingBoard?.tradeoff_payload ?? null,
  });

  return finalizeBoardGoals({
    goals: proposal.goals,
    negotiationIndexes: [], // ingen forhandlinger ved auto-accept — status quo
  });
}

// #666: EN fallback brugt i title/message — i18n-key driver fuld locale.
function formatPlanLabelEn(planType) {
  if (planType === "5yr") return "5-year plan";
  if (planType === "3yr") return "3-year plan";
  if (planType === "1yr") return "1-year plan";
  return planType;
}

function planLabelI18nKey(planType) {
  if (planType === "1yr" || planType === "3yr" || planType === "5yr") {
    return `planLabel.${planType}`;
  }
  return "planLabel.unknown";
}
