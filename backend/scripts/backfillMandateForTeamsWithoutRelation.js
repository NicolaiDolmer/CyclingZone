// #4837 · Backfill for menneskehold uden board_relations-række.
//
// Rod-årsag (se docs/BOARD_RULES.md §6): `proposeMandateForNewTeam` og
// `ensureRelationForTeam` (boardMandateEngine.js) var skrevet, testet og
// eksporteret, men INGEN produktionssti kaldte dem. Alle 237 relationer og
// mandater i prod stammer fra engangs-scriptet `mandateShadowRebuild3514.mjs`
// (1/9). Hold oprettet EFTER den kørsel fik deres 5 bestyrelsesmedlemmer og
// deres board_profile som normalt, men 0 relation, 0 mandat og 0 milepæle —
// og `boardRoom.js` læser kun mandater med status 'active'/'proposed', så
// mandatkortet ville stå tomt for dem for altid.
//
// Fixet i samme PR (boardMembers.js::chooseDnaForTeam +
// boardAutoAccept.js::autoAcceptPendingPlan → `ensureMandateForTeamFormation`)
// lukker hullet FREMAD: nye hold får relation + mandat i selve holddannelsen.
// Dette script reparerer de hold der ALLEREDE er født uden.
//
// Bruger PRÆCIS `ensureMandateForTeamFormation` — samme funktion som
// holddannelsen selv nu kalder. Ingen ny relations- eller mandat-logik lever
// her, så backfill og runtime kan ikke divergere (samme disciplin som
// repairMissingBoardMembers.js, #4715).
//
// Idempotent i tre lag: kandidat-predikatet springer hold MED relation over,
// `ensureRelationForTeam` rører aldrig en eksisterende række, og
// `proposeNextMandate` returnerer `already_exists` for et hold der allerede
// har et mandat for sæsonen. En gentagen kørsel er derfor en no-op.
//
// Afgrænsning (samme "menneskehold"-definition som resten af bestyrelses-
// koden): is_ai, is_bank, is_frozen og is_test_account springes over. Hold
// uden `season_1_identity_basis` er endnu ikke klar til en bestyrelse og
// rapporteres separat i stedet for at blive talt som en fejl.
//
// Brug:
//   node --env-file=backend/.env backend/scripts/backfillMandateForTeamsWithoutRelation.js
//       (dry-run, default — skriver intet)
//   node --env-file=backend/.env backend/scripts/backfillMandateForTeamsWithoutRelation.js --apply --owner-go
//       (skriver; kræver BEGGE flag, ejer-GO + #2642-rammer)

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureMandateForTeamFormation } from "../lib/boardMandateEngine.js";
import { loadSingleActiveSeason } from "../lib/activeSeasonLookup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEAM_COLUMNS = "id, name, is_ai, is_bank, is_frozen, is_test_account, season_1_identity_basis, created_at";

/**
 * DET ENE PREDIKAT for "er dette hold en backfill-kandidat". Bruges ens af
 * rapport-tællingen og apply-loopet, så de to tal ikke kan divergere inden for
 * samme kørsel (#4715-lærdommen fra repairMissingBoardMembers.js).
 *
 * @param {{is_ai?:boolean, is_bank?:boolean, is_frozen?:boolean, is_test_account?:boolean}} team
 * @param {Set<string>} teamIdsWithRelation
 * @returns {boolean}
 */
export function isBackfillEligible(team, teamIdsWithRelation) {
  if (!team) return false;
  if (team.is_ai || team.is_bank || team.is_frozen || team.is_test_account) return false;
  return !teamIdsWithRelation.has(team.id);
}

/**
 * ÉT snapshot af hold + eksisterende relationer pr. kørsel.
 *
 * @param {object} supabase
 */
export async function fetchBackfillSnapshot(supabase) {
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select(TEAM_COLUMNS);
  if (teamsError) throw teamsError;

  const { data: relations, error: relationsError } = await supabase
    .from("board_relations")
    .select("team_id");
  if (relationsError) throw relationsError;

  return {
    teams: teams || [],
    teamIdsWithRelation: new Set((relations || []).map((r) => r.team_id)),
  };
}

/**
 * Kernen: dry-run eller apply over ÉT snapshot. REN nok til test — ingen
 * console.log, ingen process.env, ingen top-level await.
 *
 * @param {{supabase: object, apply?: boolean, seasonNumber?: number|null, now?: Date}} args
 */
export async function runBackfillMandateForTeamsWithoutRelation({
  supabase,
  apply = false,
  seasonNumber = null,
  now = new Date(),
} = {}) {
  const { teams, teamIdsWithRelation } = await fetchBackfillSnapshot(supabase);
  const humanTeams = teams.filter((t) => !t.is_ai && !t.is_bank && !t.is_frozen);
  const eligible = teams.filter((t) => isBackfillEligible(t, teamIdsWithRelation));

  const result = {
    teamCount: teams.length,
    humanTeamCount: humanTeams.length,
    withRelationCount: teamIdsWithRelation.size,
    eligibleCount: eligible.length,
    notReadyTeamIds: [], // eligible, men season_1_identity_basis mangler endnu
    backfillCandidateIds: [], // dry-run: hold der VILLE få relation + mandat
    backfilledTeamIds: [], // apply: mandat oprettet
    skippedTeamIds: [], // apply: motoren sprang over (flag off, already_exists, ...)
    failedTeamIds: [],
    details: [],
  };

  for (const team of eligible) {
    if (!team.season_1_identity_basis) {
      result.notReadyTeamIds.push(team.id);
      result.details.push({ teamId: team.id, name: team.name, status: "skip_no_identity_basis" });
      continue;
    }

    result.backfillCandidateIds.push(team.id);

    if (!apply) {
      result.details.push({ teamId: team.id, name: team.name, status: "dry_run_would_backfill", createdAt: team.created_at });
      continue;
    }

    // ensureMandateForTeamFormation kaster ALDRIG — den returnerer
    // `{ skipped: "error", reason }`. Vi klassificerer derfor på svaret, ikke
    // på en exception.
    const outcome = await ensureMandateForTeamFormation(supabase, {
      teamId: team.id,
      seasonNumber,
      now,
    });

    if (outcome?.mandate_id) {
      result.backfilledTeamIds.push(team.id);
      result.details.push({
        teamId: team.id,
        name: team.name,
        status: "backfilled",
        mandateId: outcome.mandate_id,
        seasonNumber: outcome.season_number,
        goalCount: outcome.goal_count,
      });
    } else if (outcome?.skipped === "error") {
      result.failedTeamIds.push(team.id);
      result.details.push({ teamId: team.id, name: team.name, status: "failed", error: outcome.reason });
    } else {
      result.skippedTeamIds.push(team.id);
      result.details.push({
        teamId: team.id,
        name: team.name,
        status: "skipped",
        reason: outcome === null ? "flag_off" : (outcome?.skipped ?? "unknown"),
      });
    }
  }

  return result;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  config({ path: path.join(__dirname, "..", ".env") });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  // Dobbelt gate: --apply alene skriver IKKE. Skrivninger mod prod kræver at
  // ejeren eksplicit har sagt go for netop denne kørsel (#2642-rammer).
  const wantsApply = process.argv.includes("--apply");
  const hasOwnerGo = process.argv.includes("--owner-go");
  if (wantsApply && !hasOwnerGo) {
    console.error("--apply kræver ogsaa --owner-go (eksplicit ejer-GO pr. prod-skridt). Afbryder.");
    process.exit(1);
  }
  const APPLY = wantsApply && hasOwnerGo;

  const supabase = createClient(supabaseUrl, serviceKey);

  const activeSeason = await loadSingleActiveSeason(supabase, {
    select: "id, number",
    tag: "mandate-backfill-4837",
  });
  const seasonNumber = Number(activeSeason?.number);
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    console.error("Ingen aktiv saeson fundet — mandatet kan ikke bindes til en saeson. Afbryder.");
    process.exit(1);
  }
  console.log(`Aktiv saeson: ${seasonNumber}`);
  console.log("");

  const res = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: APPLY, seasonNumber });

  console.log(`Hold i alt: ${res.teamCount}`);
  console.log(`  heraf menneskehold (ekskl. ai/bank/frozen): ${res.humanTeamCount}`);
  console.log(`  hold med board_relations: ${res.withRelationCount}`);
  console.log(`  eligible til backfill (menneskehold uden relation, ekskl. test-konti): ${res.eligibleCount}`);
  console.log("");

  for (const d of res.details) {
    if (d.status === "skip_no_identity_basis") {
      console.log(`SKIP    ${d.name} (${d.teamId}) — season_1_identity_basis mangler, ikke klar til bestyrelse`);
    } else if (d.status === "dry_run_would_backfill") {
      console.log(`DRY-RUN ${d.name} (${d.teamId}, oprettet ${d.createdAt}) -> ville faa relation (confidence 50) + mandat for saeson ${seasonNumber}`);
    } else if (d.status === "backfilled") {
      console.log(`APPLY   ${d.name} (${d.teamId}) -> mandat ${d.mandateId} for saeson ${d.seasonNumber}, ${d.goalCount} maal`);
    } else if (d.status === "skipped") {
      console.log(`SKIP    ${d.name} (${d.teamId}) — motoren sprang over: ${d.reason}`);
    } else if (d.status === "failed") {
      console.error(`FAIL    ${d.name} (${d.teamId}):`, d.error);
    }
  }

  const summary = {
    human_teams: res.humanTeamCount,
    with_relation: res.withRelationCount,
    eligible: res.eligibleCount,
    would_backfill: res.backfillCandidateIds.length,
    backfilled: res.backfilledTeamIds.length,
    skipped_no_identity_basis: res.notReadyTeamIds.length,
    skipped_by_engine: res.skippedTeamIds.length,
    failed: res.failedTeamIds.length,
  };
  console.log("");
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY) {
    const post = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: false, seasonNumber });
    console.log("");
    console.log(`POST-VERIFY: menneskehold uden board_relations: ${post.eligibleCount}`);
    for (const d of post.details) {
      console.log(`  - ${d.name} (${d.teamId})`);
    }
  } else {
    console.log("");
    console.log("Dry-run — ingen skrivninger foretaget. Koer med --apply --owner-go for at anvende (ejer-GO, #2642-rammer).");
  }
}

if (isMain()) {
  await main();
}
