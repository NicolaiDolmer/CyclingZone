#!/usr/bin/env node
// #2022 fase 2 · Backfill: kalibrér de EKSISTERENDE pending formations-boards' mål.
// =============================================================================
// Dannelses-fixet (ensureBoardGoalsCalibrated) gælder kun NYE hold fremadrettet.
// De 15 ægte hold der allerede har et pending formations-board med STATISKE mål
// (min_riders 15 mod 12-19-rytters trupper) skal recalibreres én gang, ellers
// straffes de ved næste sæson-evaluering. Beregner de kalibrerede mål via SAMME
// generateBoardGoals med trup-kontekst som dannelses-stien — ingen ny logik.
//
//   node scripts/boardFormationGoalsBackfill.js              # DRY-RUN (default, skriver intet)
//   node scripts/boardFormationGoalsBackfill.js --apply      # skriver til prod
//   node scripts/boardFormationGoalsBackfill.js --env <sti>  # alt. .env-sti
//
// Sikkerhed: backup-snapshot ligger i tabellen backup_boardgoals_formation_20260630
// (oprettet før apply). Idempotent (kalibrering er deterministisk). Additivt +
// reversibelt: UPDATE board_profiles SET current_goals = <backup> ruller tilbage.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateBoardGoals } from "../lib/boardGoals.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "../lib/boardConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : fallback;
}

async function getClient() {
  const dotenv = (await import("dotenv")).default;
  const { createClient } = await import("@supabase/supabase-js");
  dotenv.config({ path: argValue("--env", join(__dirname, "../.env")), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (prøv --env <sti>)");
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function minRidersTarget(goals) {
  const g = (goals || []).find((x) => x.type === "min_riders");
  return g ? g.target : null;
}

async function main() {
  const supabase = await getClient();

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, division, sponsor_income, balance")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  if (teamsError) throw new Error(`teams: ${teamsError.message}`);
  const teamById = new Map((teams || []).map((t) => [t.id, t]));
  const teamIds = (teams || []).map((t) => t.id);

  const [boardsRes, ridersRes] = await Promise.all([
    supabase.from("board_profiles")
      .select("id, team_id, plan_type, focus, current_goals")
      .in("team_id", teamIds).eq("is_baseline", false).eq("negotiation_status", "pending"),
    supabase.from("riders").select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`).in("team_id", teamIds),
  ]);
  if (boardsRes.error) throw new Error(`board_profiles: ${boardsRes.error.message}`);
  if (ridersRes.error) throw new Error(`riders: ${ridersRes.error.message}`);

  const ridersByTeam = new Map();
  for (const r of ridersRes.data || []) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    const { team_id: _o, ...fields } = r;
    ridersByTeam.get(r.team_id).push(fields);
  }

  console.log(`${APPLY ? "🔴 APPLY" : "🟡 DRY-RUN"} · ${(boardsRes.data || []).length} pending formations-boards\n`);
  let changed = 0;
  let applied = 0;

  for (const board of boardsRes.data || []) {
    const team = teamById.get(board.team_id);
    const riders = ridersByTeam.get(board.team_id) || [];
    if (!riders.length) {
      console.log(`  ⏭️  ${team?.name}: tom trup → springes over (defensivt)`);
      continue;
    }
    const calibrated = generateBoardGoals({
      focus: board.focus, planType: board.plan_type,
      team: { division: team.division, sponsor_income: team.sponsor_income, balance: team.balance, riders },
      riders, standing: null,
    });
    const beforeMin = minRidersTarget(board.current_goals);
    const afterMin = minRidersTarget(calibrated);
    const willChange = JSON.stringify(board.current_goals) !== JSON.stringify(calibrated);
    if (!willChange) {
      console.log(`  =  ${team?.name} (div ${team.division}, ${riders.length} ryt.): allerede kalibreret`);
      continue;
    }
    changed += 1;
    console.log(`  Δ  ${team?.name} (div ${team.division}, ${riders.length} ryt.): min_riders ${beforeMin}→${afterMin}`);

    if (APPLY) {
      const { error: upErr } = await supabase
        .from("board_profiles").update({ current_goals: calibrated }).eq("id", board.id);
      if (upErr) throw new Error(`update ${board.id}: ${upErr.message}`);
      applied += 1;
    }
  }

  console.log(`\n${APPLY ? `✅ Skrev ${applied} boards.` : `🟡 ${changed} boards ville ændres. Kør med --apply for at skrive.`}`);
  console.log(`   Backup: tabel backup_boardgoals_formation_20260630 (rollback: UPDATE board_profiles bp SET current_goals = b.old_goals FROM backup_boardgoals_formation_20260630 b WHERE bp.id = b.board_id;)`);
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
