#!/usr/bin/env node
// #1237 · Dry-run (READ-ONLY): sammenligner den GAMLE no_outstanding_debt-scoring
// (kun antal aktive lån) med den NYE nettostilling-scoring (scoreFinanceHealthGoal,
// backend/lib/boardUtils.js) for alle rigtige managere. Ejer-beslutning 4/9: bestyrelsens
// økonomi-mål skal score på nettostilling (saldo minus aktiv gæld) med en buffer mod
// lønnen, ikke på antal lån isoleret.
//
// Skriver INTET til DB — kun læser teams/loans/riders og printer/logger en rapport.
//
// Usage:
//   node backend/scripts/board-finance-goal-dry-run.js
//   node backend/scripts/board-finance-goal-dry-run.js --json
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, læse-only brug)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { scoreFinanceHealthGoal, sumActiveLoanDebt, sumRiderSalaries } from "../lib/boardUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// #1237 · Den GAMLE formel (backend/lib/boardUtils.js før denne PR), reimplementeret
// her udelukkende til sammenligning — funktionen selv er fjernet fra produktionskoden.
function oldScoreDebtGoal(activeLoanCount, isFinalSeason) {
  if (activeLoanCount === 0) return isFinalSeason ? 1.05 : 1.0;
  if (activeLoanCount === 1) return 0.65;
  if (activeLoanCount === 2) return 0.35;
  return 0.15;
}

const BUCKETS = [
  { label: "bekymret (<0.35)", min: -Infinity, max: 0.35 },
  { label: "under pres (0.35-0.65)", min: 0.35, max: 0.65 },
  { label: "OK (0.65-0.85)", min: 0.65, max: 0.85 },
  { label: "tryg (>=0.85)", min: 0.85, max: Infinity },
];

function bucketFor(score) {
  return BUCKETS.find((b) => score >= b.min && score < b.max) || BUCKETS[BUCKETS.length - 1];
}

async function run() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const asJson = process.argv.includes("--json");

  // Rigtige managere: is_ai=false, user_id sat, ikke bank/test/frosne.
  const teams = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, name, balance, user_id, is_ai, is_bank, is_test_account")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_test_account", false)
    .not("user_id", "is", null)
    .order("id", { ascending: true }));

  if (!teams?.length) {
    console.log("Ingen rigtige managere fundet.");
    return;
  }

  const teamIds = teams.map((t) => t.id);

  const [loans, riders] = await Promise.all([
    fetchAllRows(() => supabase
      .from("loans")
      .select("team_id, amount_remaining")
      .eq("status", "active")
      .in("team_id", teamIds)
      .order("id", { ascending: true })),
    fetchAllRows(() => supabase
      .from("riders")
      .select("team_id, salary")
      .in("team_id", teamIds)
      .order("id", { ascending: true })),
  ]);

  const loansByTeam = new Map();
  for (const loan of loans || []) {
    if (!loansByTeam.has(loan.team_id)) loansByTeam.set(loan.team_id, []);
    loansByTeam.get(loan.team_id).push(loan);
  }
  const ridersByTeam = new Map();
  for (const rider of riders || []) {
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const beforeCounts = new Map(BUCKETS.map((b) => [b.label, 0]));
  const afterCounts = new Map(BUCKETS.map((b) => [b.label, 0]));
  const rows = [];

  for (const team of teams) {
    const teamLoans = loansByTeam.get(team.id) || [];
    const teamRiders = ridersByTeam.get(team.id) || [];
    const activeLoanCount = teamLoans.length;
    const activeDebt = sumActiveLoanDebt(teamLoans);
    const wageBillPerSeason = sumRiderSalaries(teamRiders);
    const balance = team.balance || 0;

    // #1237 · isFinalSeason ukendt uden en dedikeret board_profiles/plan-lookup pr.
    // hold (out of scope for et read-only dry-run-overblik) — sat til false for alle,
    // så tallene er den KONSERVATIVE sammenligning (aldrig 1.05-bonussen for hverken
    // gammel eller ny formel). Se PR-beskrivelsen for begrundelsen.
    const oldScore = oldScoreDebtGoal(activeLoanCount, false);
    const newScore = scoreFinanceHealthGoal({
      balance,
      activeDebt,
      activeLoanCount,
      wageBillPerSeason,
      isFinalSeason: false,
    });

    const oldBucket = bucketFor(oldScore).label;
    const newBucket = bucketFor(newScore).label;
    beforeCounts.set(oldBucket, (beforeCounts.get(oldBucket) || 0) + 1);
    afterCounts.set(newBucket, (afterCounts.get(newBucket) || 0) + 1);

    rows.push({
      team_id: team.id,
      balance,
      activeDebt,
      activeLoanCount,
      wageBillPerSeason,
      net: balance - activeDebt,
      oldScore,
      newScore,
      delta: Math.round((newScore - oldScore) * 1000) / 1000,
    });
  }

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top10 = rows.slice(0, 10);

  const report = {
    teams_evaluated: teams.length,
    before_buckets: Object.fromEntries(beforeCounts),
    after_buckets: Object.fromEntries(afterCounts),
    top_10_changes: top10,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n#1237 · Board finance-goal dry-run — ${teams.length} rigtige managere\n`);
  console.log("Score-spænd FØR (gammel: kun antal lån) → EFTER (ny: nettostilling + buffer):\n");
  console.log("Spænd".padEnd(26), "FØR".padStart(6), "EFTER".padStart(6));
  for (const b of BUCKETS) {
    console.log(b.label.padEnd(26), String(beforeCounts.get(b.label)).padStart(6), String(afterCounts.get(b.label)).padStart(6));
  }

  console.log("\nDe 10 største ændringer (anonymt team_id):\n");
  console.log(
    "team_id".padEnd(10),
    "balance".padStart(12),
    "debt".padStart(12),
    "loans".padStart(6),
    "old→new".padStart(14)
  );
  for (const r of top10) {
    console.log(
      String(r.team_id).padEnd(10),
      String(r.balance).padStart(12),
      String(r.activeDebt).padStart(12),
      String(r.activeLoanCount).padStart(6),
      `${r.oldScore}→${r.newScore}`.padStart(14)
    );
  }
  console.log("");
}

run().catch((error) => {
  console.error("Dry-run failed:", error);
  process.exit(2);
});
