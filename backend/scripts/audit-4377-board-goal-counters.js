#!/usr/bin/env node
// #4377 · Post-fix audit (READ-ONLY by default): bestyrelsens flerårsmål-tællere
// (trøjer, sponsor-indkomst, sejre) blev rapporteret af to spillere 28/8 som
// "ignorerer historik" (trøjer 0/2, sponsor-mål 0/8 -> 0/12). Rod-årsagen var
// tredelt og er allerede rettet i tre tidligere PR'er:
//   - Trøjer (jersey_wins): PR #4549 (kode) + database/2026-09-01-4377-jersey-
//     wins-cumulative-repair.sql (data, applied 1/9 ~17:05, post-verify OK).
//   - Sponsor-indkomst (sponsor_growth): PR #4550 (re-pointet til ægte
//     sponsor_contracts-udbetalinger i stedet for det døde teams.sponsor_income).
//   - Sejre (stage_wins, endagssejr talte ikke): allerede dækket separat af
//     #3948, rettet i PR #4046 (21/8) — ikke rørt her.
//
// Denne fil er IKKE fix'et — den er et forward-guard-bevis: kør den mod prod
// for at bekræfte at ingen aktive planer stadig bærer den gamle, defekte
// tilstand. Skriver INTET til DB i default (dry-run) tilstand.
//
// Usage:
//   node backend/scripts/audit-4377-board-goal-counters.js
//   node backend/scripts/audit-4377-board-goal-counters.js --json
//   node backend/scripts/audit-4377-board-goal-counters.js --apply --owner-go
//     (kun relevant hvis check A finder resterende stale rækker — se dryRun-
//     rapportens "staleJerseyGoals" — ellers er --apply et no-op)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, læse-only default)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

export function isStaleJerseyGoal(goal) {
  return goal?.type === "jersey_wins"
    && goal?.source === "club_dna"
    && (goal?.cumulative === undefined || goal?.cumulative === false);
}

async function run() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const asJson = process.argv.includes("--json");
  const apply = process.argv.includes("--apply") && process.argv.includes("--owner-go");

  // Rigtige managere: is_ai=false. Vi behøver ikke team-detaljer her, kun
  // hvilke team_id'er der er AI, for at ekskludere dem fra rapporten.
  const teams = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, is_ai")
    .order("id"));
  const humanTeamIds = new Set((teams || []).filter((t) => !t.is_ai).map((t) => t.id));

  const profiles = await fetchAllRows(() => supabase
    .from("board_profiles")
    .select("id, team_id, plan_type, negotiation_status, is_baseline, current_goals")
    .order("id"));

  const activeHumanProfiles = (profiles || []).filter((p) =>
    humanTeamIds.has(p.team_id) && !p.is_baseline && p.negotiation_status === "completed"
  );

  const staleJerseyGoals = [];
  let sponsorGrowthGoalCount = 0;
  let jerseyGoalCount = 0;
  let stageWinsGoalCount = 0;

  for (const profile of activeHumanProfiles) {
    const goals = Array.isArray(profile.current_goals) ? profile.current_goals : [];
    for (const goal of goals) {
      if (goal?.type === "jersey_wins") {
        jerseyGoalCount += 1;
        if (isStaleJerseyGoal(goal)) {
          staleJerseyGoals.push({ boardProfileId: profile.id, planType: profile.plan_type });
        }
      }
      if (goal?.type === "sponsor_growth") sponsorGrowthGoalCount += 1;
      if (goal?.type === "stage_wins") stageWinsGoalCount += 1;
    }
  }

  const report = {
    scannedProfiles: activeHumanProfiles.length,
    jerseyGoalCount,
    staleJerseyGoalCount: staleJerseyGoals.length,
    staleJerseyGoals,
    sponsorGrowthGoalCount,
    stageWinsGoalCount,
    note: "sponsor_growth og stage_wins-tal er informative optællinger (hvor mange aktive planer bærer måltypen) — "
      + "begge typers evaluering er allerede fikset i kode (PR #4550 hhv. #4046/#3948); der er ikke et data-repair-behov "
      + "for dem svarende til jersey_wins' persisterede cumulative-flag, så der er intet 'wrong'-prædikat at tælle for dem her.",
  };

  if (apply && staleJerseyGoals.length > 0) {
    for (const stale of staleJerseyGoals) {
      const profile = activeHumanProfiles.find((p) => p.id === stale.boardProfileId);
      const patchedGoals = profile.current_goals.map((goal) =>
        isStaleJerseyGoal(goal) ? { ...goal, cumulative: true } : goal
      );
      const { error } = await supabase
        .from("board_profiles")
        .update({ current_goals: patchedGoals })
        .eq("id", profile.id);
      if (error) {
        console.error(`Fejl ved patch af ${profile.id}:`, error.message);
      }
    }
    report.applied = staleJerseyGoals.length;
  } else if (staleJerseyGoals.length > 0) {
    report.applied = 0;
    report.hint = "Kør med --apply --owner-go for at sætte cumulative:true på de fundne rækker (samme idempotente "
      + "operation som database/2026-09-01-4377-jersey-wins-cumulative-repair.sql).";
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`#4377 audit — ${report.scannedProfiles} aktive human board-planer scannet`);
    console.log(`  jersey_wins-mål: ${report.jerseyGoalCount} (${report.staleJerseyGoalCount} stale/unflagged)`);
    console.log(`  sponsor_growth-mål: ${report.sponsorGrowthGoalCount} (informativ optælling, ikke et fejl-tal)`);
    console.log(`  stage_wins-mål: ${report.stageWinsGoalCount} (informativ optælling, ikke et fejl-tal)`);
    if (report.staleJerseyGoalCount > 0) {
      console.log(`  ${report.hint || `Patched ${report.applied} rows.`}`);
    }
  }
}

// #4377 · Guard mod at et almindeligt `import` af denne fil fra dens
// tilhørende test-fil (som kun vil bruge den rene isStaleJerseyGoal-funktion)
// stille rammer prod. Samme main-guard-mønster som
// audit-league-size-invariant.js: kør kun run() når filen selv er entry-point'et.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
