// Reparation #4865 — gen-indsæt de accepterede bonustilbuds ekstra-mål der
// forsvandt da spillerne signerede deres sæson-3-plan.
//
// HVAD DER SKETE (bevis, målt read-only mod prod 6/9)
//   `backup_board_profiles_3514_20260823` (649 rækker, 23/8): 11 hold bar et mål
//   med `source: "bonus_offer"` i `board_profiles.current_goals`.
//   `backup_board_profiles_3514_rebuild_20260901` (684 rækker, 1/9 ~17:12): 0.
//   Live i dag: 0 i både `board_profiles.current_goals` og `board_mandates.goals`.
//   Pengene (200.000 CZ$ pr. tilbud) er udbetalt; kravet er væk.
//
//   Skrivestien: `POST /board/sign` (routes/api.js) byggede `current_goals` som
//   et FRISKT array fra buildBoardProposal + finalizeBoardGoals og upsertede det
//   oven i rækken. Alt en anden sti havde lagt i arrayet forsvandt. Beviset for
//   netop signerings-stien (og ikke auto-accept-cronen): alle 11 live-rækker
//   bærer mindst ét mål med `negotiated: true`, og det flag kan KUN komme fra
//   buildNegotiatedGoal via et ikke-tomt `negotiationIndexes` —
//   autoAcceptPendingPlan sender altid `[]`. Ingen af de 11 brugere har
//   nogensinde fået en `notif.boardAutoAccepted.title`-notifikation i vinduet.
//   Rettet ved kilden i samme PR (preserveExternalGoals, boardGoals.js).
//
// HVAD DETTE SCRIPT GØR
//   For hvert hold i backup-tabellen med et `bonus_offer`-mål:
//     1. Finder holdets `completed` 1yr-board (samme opslag som accept-ruten
//        bruger: loadCompletedOneYearBoard, boardBonusGoal.js).
//     2. Springer holdet over hvis dets sæson-3-plan IKKE længere er aktiv
//        (plan-vinduet skal dække den aktive sæson) — vi må ikke hænge et krav
//        på en plan spilleren ikke kører længere.
//     3. Tilføjer målet BAGEST i `current_goals` hvis det mangler (idempotent,
//        samme dedup-regel som hasBonusGoalForOffer: bonus_offer_id når det
//        findes, ellers type+target+source).
//     4. Tilføjer SAMME mål til holdets aktive mandat via
//        `appendBonusGoalToActiveMandate` (#4856/PR #4863) — det er den række
//        Boardroom faktisk læser (`isBonus: goal.source === "bonus_offer"`).
//
//   Målene skrives ORDRET som de stod i backuppen (inkl. `label` og manglende
//   `baseline`/`bonus_offer_id` — rækkerne er fra før #4856). Vi opfinder ikke
//   en ny baseline: en beholdnings-baseline beregnet I DAG ville flytte
//   målstregen i forhold til det spilleren accepterede.
//
//   `current_goals` skrives som et rigtigt jsonb-ARRAY. Accept-ruten skrev
//   historisk `JSON.stringify(...)` ind i jsonb-kolonnen (præcis de 11 ramte
//   rækker stod som jsonb-`string`, alle andre som `array`); læsestien tåler
//   begge (parseBoardGoals), men reparationen efterlader ikke ny dobbelt-
//   encoding.
//
// KØR ALDRIG MOD PROD UDEN EJER-GO:
//   node backend/scripts/repair-4865-restore-bonus-goals.js
//       → DRY-RUN (default). Read-only. Rapport pr. hold.
//   node backend/scripts/repair-4865-restore-bonus-goals.js --apply --owner-go
//       → RIGTIG kørsel. Begge flag kræves. Post-verify køres til sidst.
//
// Refs #4865 #4856 #4863

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  appendBonusGoalToActiveMandate,
  hasBonusGoalForOffer,
  loadCompletedOneYearBoard,
} from "../lib/boardBonusGoal.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

export const BACKUP_TABLE = "backup_board_profiles_3514_20260823";

// ─── Rene funktioner (testbare uden DB) ─────────────────────────────────────

/**
 * `current_goals` kan komme tilbage som array (jsonb array) ELLER som streng
 * (jsonb string — accept-rutens JSON.stringify). Tolerér begge, kast aldrig.
 */
export function parseGoalsColumn(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Alle `bonus_offer`-mål i en backup-række. */
export function bonusGoalsIn(raw) {
  return parseGoalsColumn(raw).filter((goal) => goal?.source === "bonus_offer");
}

/**
 * Kører holdets plan stadig i den aktive sæson? Plan-vinduet
 * [plan_start_season_number, plan_end_season_number] skal dække sæsonnummeret,
 * og planen skal være signeret (`completed`). Mangler vinduets tal, falder vi
 * tilbage til at kræve `season_id === activeSeasonId`.
 */
export function isPlanActiveForSeason(board, { seasonNumber, activeSeasonId } = {}) {
  if (!board) return false;
  if (board.negotiation_status !== "completed") return false;
  const start = Number(board.plan_start_season_number);
  const end = Number(board.plan_end_season_number);
  if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(Number(seasonNumber))) {
    return Number(seasonNumber) >= start && Number(seasonNumber) <= end;
  }
  return Boolean(activeSeasonId) && board.season_id === activeSeasonId;
}

// ─── Kørslen ────────────────────────────────────────────────────────────────

export async function runRepair({ supabase, dryRun = true, log = console.log } = {}) {
  const report = {
    dryRun,
    backupTable: BACKUP_TABLE,
    activeSeasonNumber: null,
    teamsWithBonusGoalInBackup: 0,
    bonusGoalsInBackup: 0,
    profileWrites: 0,
    mandateWrites: 0,
    skipped: 0,
    teams: [],
    postVerify: null,
  };

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);
  if (!activeSeason?.id) throw new Error("Ingen aktiv sæson — afbryder.");
  report.activeSeasonNumber = activeSeason.number;
  log(`Aktiv sæson: ${activeSeason.number} (${activeSeason.id})`);

  const backupRows = await fetchAllRows(() => supabase
    .from(BACKUP_TABLE)
    .select("id, team_id, plan_type, current_goals")
    .order("id", { ascending: true }));

  const candidates = [];
  for (const row of backupRows || []) {
    const goals = bonusGoalsIn(row.current_goals);
    if (goals.length) candidates.push({ backupBoardId: row.id, teamId: row.team_id, goals });
  }
  report.teamsWithBonusGoalInBackup = candidates.length;
  report.bonusGoalsInBackup = candidates.reduce((sum, c) => sum + c.goals.length, 0);
  log(`Backup: ${report.teamsWithBonusGoalInBackup} hold, ${report.bonusGoalsInBackup} bonus-mål.`);

  const teamIds = candidates.map((c) => c.teamId);
  const teamNameById = new Map();
  if (teamIds.length) {
    const { data: teams, error: teamsError } = await supabase
      .from("teams").select("id, name").in("id", teamIds);
    if (teamsError) throw new Error(`teams: ${teamsError.message}`);
    for (const team of teams || []) teamNameById.set(team.id, team.name);
  }

  for (const candidate of candidates) {
    const teamName = teamNameById.get(candidate.teamId) ?? "(ukendt hold)";
    const entry = { team: teamName, teamId: candidate.teamId, goals: [] };
    report.teams.push(entry);

    const board = await loadBoardForRepair(supabase, candidate.teamId);
    const planActive = isPlanActiveForSeason(board, {
      seasonNumber: activeSeason.number,
      activeSeasonId: activeSeason.id,
    });

    entry.boardId = board?.id ?? null;
    entry.planWindow = board ? `S${board.plan_start_season_number}-S${board.plan_end_season_number}` : null;
    entry.planActive = planActive;

    if (!board) {
      entry.action = "skip";
      entry.reason = "intet completed 1yr-board";
      report.skipped += 1;
      log(`  ${teamName}: SPRINGES OVER — intet completed 1yr-board.`);
      continue;
    }
    if (!planActive) {
      entry.action = "skip";
      entry.reason = `sæson-${activeSeason.number}-planen kører ikke længere (${entry.planWindow}, ${board.negotiation_status})`;
      report.skipped += 1;
      log(`  ${teamName}: SPRINGES OVER — ${entry.reason}.`);
      continue;
    }

    const mandate = await loadActiveMandate(supabase, candidate.teamId);
    entry.mandateId = mandate?.id ?? null;

    let profileGoals = parseGoalsColumn(board.current_goals);
    const mandateGoals = parseGoalsColumn(mandate?.goals);

    for (const goal of candidate.goals) {
      const offerId = goal?.bonus_offer_id ?? null;
      const missingInProfile = !hasBonusGoalForOffer(profileGoals, { offerId, extraGoal: goal });
      const missingInMandate = Boolean(mandate)
        && !hasBonusGoalForOffer(mandateGoals, { offerId, extraGoal: goal });

      const goalEntry = {
        type: goal?.type ?? null,
        target: goal?.target ?? null,
        label: goal?.label ?? null,
        bonus_offer_id: offerId,
        missingInProfile,
        missingInMandate: mandate ? missingInMandate : null,
        wouldWrite: {
          board_profiles: missingInProfile ? goal : null,
          board_mandates: mandate && missingInMandate ? goal : null,
        },
      };
      entry.goals.push(goalEntry);

      const parts = [
        `${goal?.type}${goal?.target != null ? ` (target ${goal.target})` : ""}`,
        `profil: ${missingInProfile ? "MANGLER" : "allerede der"}`,
        mandate ? `mandat: ${missingInMandate ? "MANGLER" : "allerede der"}` : "mandat: intet aktivt mandat",
      ];
      log(`  ${teamName}: ${parts.join(" · ")}`);
      if (missingInProfile || (mandate && missingInMandate)) {
        log(`      ${dryRun ? "VILLE SKRIVE" : "SKRIVER"}: ${JSON.stringify(goal)}`);
      }

      if (missingInProfile) {
        report.profileWrites += 1;
        profileGoals = [...profileGoals, goal];
        if (!dryRun) {
          const { error } = await supabase
            .from("board_profiles")
            .update({ current_goals: profileGoals, updated_at: new Date().toISOString() })
            .eq("id", board.id);
          if (error) throw new Error(`board_profiles update (${teamName}): ${error.message}`);
        }
      }

      if (mandate && missingInMandate) {
        report.mandateWrites += 1;
        mandateGoals.push(goal);
        if (!dryRun) {
          const result = await appendBonusGoalToActiveMandate({
            supabase, teamId: candidate.teamId, goal, offerId,
          });
          if (!result?.written && result?.reason !== "already_present") {
            throw new Error(`board_mandates update (${teamName}): ${result?.reason ?? "ukendt"}`);
          }
        }
      }
    }
  }

  log(
    `${dryRun ? "DRY-RUN" : "APPLY"}: ${report.profileWrites} profil-skrivninger, `
    + `${report.mandateWrites} mandat-skrivninger, ${report.skipped} hold sprunget over.`
  );

  if (!dryRun) {
    report.postVerify = await postVerify(supabase, candidates.map((c) => c.teamId));
    log(`Post-verify: ${report.postVerify.profilesWithBonusGoal} profiler og `
      + `${report.postVerify.mandatesWithBonusGoal} mandater bærer nu et bonus-mål.`);
  }

  return report;
}

async function loadBoardForRepair(supabase, teamId) {
  // Samme række som accept-ruten skriver til (loadCompletedOneYearBoard), men vi
  // skal også bruge plan-vinduet — hent det i ét ekstra, målrettet opslag.
  const base = await loadCompletedOneYearBoard({ supabase, teamId });
  if (!base) return null;
  const { data, error } = await supabase
    .from("board_profiles")
    .select("id, current_goals, plan_type, negotiation_status, season_id, plan_start_season_number, plan_end_season_number")
    .eq("id", base.id)
    .maybeSingle();
  if (error) throw new Error(`board_profiles lookup (${teamId}): ${error.message}`);
  return data ?? null;
}

async function loadActiveMandate(supabase, teamId) {
  // Præcis samme filter+sortering som appendBonusGoalToActiveMandate og
  // boardRoom.js — dry-run må kun rapportere om den række apply ville ramme.
  const { data, error } = await supabase
    .from("board_mandates")
    .select("id, goals, season_number, status")
    .eq("team_id", teamId)
    .eq("status", "active")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board_mandates lookup (${teamId}): ${error.message}`);
  return data ?? null;
}

async function postVerify(supabase, teamIds) {
  const result = { profilesWithBonusGoal: 0, mandatesWithBonusGoal: 0, teamsMissing: [] };
  for (const teamId of teamIds) {
    const board = await loadCompletedOneYearBoard({ supabase, teamId });
    const hasProfile = bonusGoalsIn(board?.current_goals).length > 0;
    const mandate = await loadActiveMandate(supabase, teamId);
    const hasMandate = bonusGoalsIn(mandate?.goals).length > 0;
    if (hasProfile) result.profilesWithBonusGoal += 1;
    if (hasMandate) result.mandatesWithBonusGoal += 1;
    if (!hasProfile || !hasMandate) result.teamsMissing.push({ teamId, hasProfile, hasMandate });
  }
  return result;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("repair-4865-restore-bonus-goals.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const APPLY = process.argv.includes("--apply");
  const OWNER_GO = process.argv.includes("--owner-go");
  if (APPLY && !OWNER_GO) {
    console.error("FEJL: --apply kraever OGSAA --owner-go. Ingen writes udfoert.");
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (infisical run --env=prod -- node backend/scripts/repair-4865-restore-bonus-goals.js)");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #4865 gen-indsaet accepterede bonus-maal — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  runRepair({ supabase, dryRun })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.dryRun && report.postVerify?.teamsMissing?.length) process.exitCode = 1;
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
