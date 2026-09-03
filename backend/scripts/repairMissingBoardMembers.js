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
// Brug:
//   node backend/scripts/repairMissingBoardMembers.js            (dry-run, default)
//   node backend/scripts/repairMissingBoardMembers.js --apply    (skriver, ejer-GO + #2642-rammer)

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assignBoardMembersForTeam, TEAM_BOARD_MEMBERS_COUNT } from "../lib/boardMembers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const supabase = createClient(supabaseUrl, serviceKey);

async function findHumanTeamsMissingBoardMembers() {
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, season_1_identity_basis, team_dna_key, is_ai, is_test_account")
    .eq("is_ai", false);
  if (teamsError) throw teamsError;

  const { data: members, error: membersError } = await supabase
    .from("team_board_members")
    .select("team_id");
  if (membersError) throw membersError;

  const countByTeam = new Map();
  for (const row of members || []) {
    countByTeam.set(row.team_id, (countByTeam.get(row.team_id) || 0) + 1);
  }

  return (teams || []).filter((t) => (countByTeam.get(t.id) || 0) < TEAM_BOARD_MEMBERS_COUNT);
}

async function main() {
  const missing = await findHumanTeamsMissingBoardMembers();

  const eligible = missing.filter((t) => !t.is_test_account);
  const skippedTestAccounts = missing.filter((t) => t.is_test_account);

  console.log(`Menneskehold uden fuldt board (${TEAM_BOARD_MEMBERS_COUNT} medlemmer): ${missing.length}`);
  console.log(`  heraf test-konti (springes over): ${skippedTestAccounts.length}`);
  console.log(`  eligible til reparation: ${eligible.length}`);
  console.log("");

  const summary = { checked: eligible.length, repaired: 0, skipped_no_identity_basis: 0, failed: 0 };

  for (const team of eligible) {
    if (!team.season_1_identity_basis) {
      console.log(`SKIP  ${team.name} (${team.id}) — season_1_identity_basis mangler, ikke klar til bestyrelse`);
      summary.skipped_no_identity_basis += 1;
      continue;
    }

    const dnaLabel = team.team_dna_key || "(ingen DNA valgt endnu)";

    if (!APPLY) {
      console.log(`DRY-RUN ${team.name} (${team.id}) — identity_basis=SET, dna=${dnaLabel} -> ville tildele ${TEAM_BOARD_MEMBERS_COUNT} medlemmer`);
      continue;
    }

    try {
      const result = await assignBoardMembersForTeam({
        supabase,
        teamId: team.id,
        identityBasis: team.season_1_identity_basis,
        dnaKey: team.team_dna_key || null,
      });
      if (result.skipped) {
        console.log(`SKIP  ${team.name} (${team.id}) — allerede ${TEAM_BOARD_MEMBERS_COUNT} medlemmer (idempotent, ingen dobbelt-tildeling)`);
      } else {
        console.log(`APPLY ${team.name} (${team.id}) — dna=${dnaLabel} -> ${result.assigned} medlemmer tildelt`);
        summary.repaired += 1;
      }
    } catch (error) {
      console.error(`FAIL  ${team.name} (${team.id}):`, error.message);
      summary.failed += 1;
    }
  }

  console.log("");
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY) {
    const stillMissing = await findHumanTeamsMissingBoardMembers();
    const stillMissingNonTest = stillMissing.filter((t) => !t.is_test_account);
    console.log("");
    console.log(`POST-VERIFY: menneskehold (ekskl. test-konti) stadig uden fuldt board: ${stillMissingNonTest.length}`);
    for (const t of stillMissingNonTest) {
      console.log(`  - ${t.name} (${t.id}) dna=${t.team_dna_key || "(ingen)"} identity_basis=${t.season_1_identity_basis ? "SET" : "NULL"}`);
    }
  } else {
    console.log("");
    console.log("Dry-run — ingen skrivninger foretaget. Kør med --apply for at anvende (orkestrator + ejer-GO, #2642-rammer).");
  }
}

await main();
