// #4664 · Backfill for menneskehold uden bestyrelsesmedlemmer.
//
// Rod-årsag (se docs/BOARD_RULES.md §8 + .claude/learnings/2026-09-03-new-teams-without-board-members.md):
// regenerateBoardMembersForTeam (boardMembers.js) sletter et holds
// team_board_members-rækker FØR den indsætter det nye sæt. DELETE og INSERT
// er to separate, ikke-transaktionelle Supabase-kald — fejler INSERT'et efter
// DELETE'et er committet (transient netværksfejl, en samtidig dobbelt-
// indsendelse mod /board/dna-choose, eller et deploy der dræber processen
// midtvejs), stod holdet tilbage med 0 medlemmer PERMANENT: DNA er allerede
// sat, så `requiresBoardDnaChoice` (routes/api.js) er false, og DNA-vælgeren
// (den eneste sti der før kaldte assignBoardMembersForTeam) vises aldrig
// igen. Fixet i denne PR (boardMembers.js): regenerateBoardMembersForTeam
// gemmer nu de gamle rækker FØR delete og gendanner dem best-effort hvis
// re-insert fejler, så fremtidige forsøg ikke kan gentage denne klasse. Dette
// script reparerer de hold der ALLEREDE sidder fast i den tomme tilstand.
//
// For hold der aldrig har valgt Klub-DNA endnu (team_dna_key er NULL, men
// season_1_identity_basis er sat): assignBoardMembersForTeam understøtter
// dnaKey=null (ingen DNA-bias i arketype-scoringen) — samme funktion som
// holddannelsen selv ville brugt før DNA-valg. Vælger spilleren DNA senere,
// overskriver chooseDnaForTeam's førstegangs-valg-gren automatisk dette sæt
// med et DNA-biased sæt (uændret adfærd, ingen konflikt).
//
// Idempotent: springer hold med allerede 5 medlemmer over. Springer is_ai og
// is_test_account over (samme guard som repairBoardMembersAfterDna). Bruger
// PRÆCIS assignBoardMembersForTeam — samme funktion som holddannelsen selv
// kalder — ingen ny tildelings-logik.
//
// #4715 (rapport-taelling overtalte kandidater): dry-run-rapporten talte
// "eligible" ud fra ÉT snapshot taget ved script-START, mens en efterfoelgende
// --apply-koersel (dage senere, 3/9) fandt at 24 af de 37 rapporterede
// allerede havde faaet deres 5 medlemmer i mellemtiden (normal spilflow,
// 27/8-2/9). Rapportens taelling og apply-loopets faktiske kandidatliste
// bruger nu PRAECIS samme delte predikat (selectRepairCandidates /
// isRepairEligible), bygget paa ÉT fælles snapshot pr. koersel — saa de to
// tal aldrig kan divergere PGA. kode-drift inden for samme koersel. Drift
// mellem to SEPARATE koersler (som 3/9-hændelsen) er stadig muligt og
// forventet; det er derfor apply's egen assignBoardMembersForTeam-genkontrol
// (allerede korrekt, se boardMembers.js) forbliver den endelige garanti.
//
// Brug:
//   node backend/scripts/repairMissingBoardMembers.js            (dry-run, default)
//   node backend/scripts/repairMissingBoardMembers.js --apply    (skriver, ejer-GO + #2642-rammer)

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assignBoardMembersForTeam, TEAM_BOARD_MEMBERS_COUNT } from "../lib/boardMembers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tæller bestyrelsesmedlemmer pr. hold.
 *
 * @param {Array<{team_id: string}>} members
 * @returns {Map<string, number>}
 */
export function countMembersByTeam(members) {
  const countByTeam = new Map();
  for (const row of members || []) {
    countByTeam.set(row.team_id, (countByTeam.get(row.team_id) || 0) + 1);
  }
  return countByTeam;
}

/**
 * DET ENE PREDIKAT for "er dette hold en reparations-kandidat". Bruges
 * PRÆCIS ens af rapport-taellingen (dry-run) og apply-loopet — se filhovedets
 * #4715-note. Matcher apply-guardens (assignBoardMembersForTeam) skip-check
 * (`existing.length >= TEAM_BOARD_MEMBERS_COUNT`), plus de to guards
 * repair-scriptet selv altid har haft (is_ai, is_test_account).
 *
 * @param {{is_ai?: boolean, is_test_account?: boolean}} team
 * @param {number} memberCount
 * @returns {boolean}
 */
export function isRepairEligible(team, memberCount) {
  if (!team) return false;
  if (team.is_ai) return false;
  if (team.is_test_account) return false;
  return (memberCount || 0) < TEAM_BOARD_MEMBERS_COUNT;
}

/**
 * Henter ÉT snapshot af teams + board-medlemmer. Kaldes ÉN gang pr. koersel
 * (dry-run og apply deler samme snapshot inden for én proces) — se
 * #4715-noten for hvorfor to separate koersler stadig kan divergere.
 *
 * @param {object} supabase
 */
export async function fetchRepairSnapshot(supabase) {
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, season_1_identity_basis, team_dna_key, is_ai, is_test_account");
  if (teamsError) throw teamsError;

  const { data: members, error: membersError } = await supabase
    .from("team_board_members")
    .select("team_id");
  if (membersError) throw membersError;

  return { teams: teams || [], countByTeam: countMembersByTeam(members) };
}

/**
 * Anvender isRepairEligible på et snapshot og opdeler i:
 *   missing  — alle menneskehold (ikke is_ai) med under fuldt board, INKL. test-konti
 *              (rapport-linjen "Menneskehold uden fuldt board: N")
 *   eligible — samme, MINUS test-konti (de faktiske reparations-kandidater)
 *
 * @param {Array<{id:string, is_ai?:boolean, is_test_account?:boolean}>} teams
 * @param {Map<string, number>} countByTeam
 */
export function selectRepairCandidates(teams, countByTeam) {
  const missing = teams.filter((t) => !t.is_ai && (countByTeam.get(t.id) || 0) < TEAM_BOARD_MEMBERS_COUNT);
  const eligible = teams.filter((t) => isRepairEligible(t, countByTeam.get(t.id) || 0));
  return { missing, eligible };
}

/**
 * Kernen: kører reparationen (dry-run eller apply) over ÉT snapshot.
 * REN nok til test — ingen console.log, ingen process.env, ingen top-level
 * await. Returnerer team-id-lister så dry-run- og apply-kandidatlisten kan
 * sammenlignes direkte i en test (#4715's leverance).
 *
 * @param {{supabase: object, apply?: boolean}} args
 */
export async function runRepairMissingBoardMembers({ supabase, apply = false } = {}) {
  const { teams, countByTeam } = await fetchRepairSnapshot(supabase);
  const { missing, eligible } = selectRepairCandidates(teams, countByTeam);
  const skippedTestAccounts = missing.length - eligible.length;

  const result = {
    missingCount: missing.length,
    eligibleCount: eligible.length,
    skippedTestAccounts,
    notReadyTeamIds: [], // eligible, men season_1_identity_basis mangler endnu
    repairCandidateIds: [], // dry-run-listen: teams der VILLE blive repareret
    repairedTeamIds: [], // apply: faktisk tildelt (assignBoardMembersForTeam skipped=false)
    alreadyAssignedTeamIds: [], // apply: assignBoardMembersForTeam fandt allerede 5 medlemmer (divergens-signal)
    failedTeamIds: [],
    details: [],
  };

  for (const team of eligible) {
    if (!team.season_1_identity_basis) {
      result.notReadyTeamIds.push(team.id);
      result.details.push({ teamId: team.id, name: team.name, status: "skip_no_identity_basis" });
      continue;
    }

    result.repairCandidateIds.push(team.id);

    if (!apply) {
      result.details.push({ teamId: team.id, name: team.name, status: "dry_run_would_assign" });
      continue;
    }

    try {
      const assignResult = await assignBoardMembersForTeam({
        supabase,
        teamId: team.id,
        identityBasis: team.season_1_identity_basis,
        dnaKey: team.team_dna_key || null,
      });
      if (assignResult.skipped) {
        result.alreadyAssignedTeamIds.push(team.id);
        result.details.push({ teamId: team.id, name: team.name, status: "already_assigned" });
      } else {
        result.repairedTeamIds.push(team.id);
        result.details.push({ teamId: team.id, name: team.name, status: "repaired", assigned: assignResult.assigned });
      }
    } catch (error) {
      result.failedTeamIds.push(team.id);
      result.details.push({ teamId: team.id, name: team.name, status: "failed", error: error.message });
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

  const APPLY = process.argv.includes("--apply");
  const supabase = createClient(supabaseUrl, serviceKey);

  const res = await runRepairMissingBoardMembers({ supabase, apply: APPLY });

  console.log(`Menneskehold uden fuldt board (${TEAM_BOARD_MEMBERS_COUNT} medlemmer): ${res.missingCount}`);
  console.log(`  heraf test-konti (springes over): ${res.skippedTestAccounts}`);
  console.log(`  eligible til reparation: ${res.eligibleCount}`);
  console.log("");

  for (const d of res.details) {
    if (d.status === "skip_no_identity_basis") {
      console.log(`SKIP  ${d.name} (${d.teamId}) — season_1_identity_basis mangler, ikke klar til bestyrelse`);
    } else if (d.status === "dry_run_would_assign") {
      console.log(`DRY-RUN ${d.name} (${d.teamId}) -> ville tildele ${TEAM_BOARD_MEMBERS_COUNT} medlemmer`);
    } else if (d.status === "already_assigned") {
      console.log(`SKIP  ${d.name} (${d.teamId}) — allerede ${TEAM_BOARD_MEMBERS_COUNT} medlemmer (idempotent, ingen dobbelt-tildeling)`);
    } else if (d.status === "repaired") {
      console.log(`APPLY ${d.name} (${d.teamId}) -> ${d.assigned} medlemmer tildelt`);
    } else if (d.status === "failed") {
      console.error(`FAIL  ${d.name} (${d.teamId}):`, d.error);
    }
  }

  const summary = {
    checked: res.eligibleCount,
    repaired: res.repairedTeamIds.length,
    skipped_no_identity_basis: res.notReadyTeamIds.length,
    failed: res.failedTeamIds.length,
  };
  console.log("");
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY) {
    const post = await runRepairMissingBoardMembers({ supabase, apply: false });
    console.log("");
    console.log(`POST-VERIFY: menneskehold (ekskl. test-konti) stadig uden fuldt board: ${post.eligibleCount}`);
    for (const d of post.details) {
      console.log(`  - ${d.name} (${d.teamId})`);
    }
  } else {
    console.log("");
    console.log("Dry-run — ingen skrivninger foretaget. Kør med --apply for at anvende (orkestrator + ejer-GO, #2642-rammer).");
  }
}

if (isMain()) {
  await main();
}
