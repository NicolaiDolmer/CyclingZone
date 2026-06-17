#!/usr/bin/env node
// #1441 money-supply-scorecard — beviser anti-inflation FØR ship.
// Læser live-population read-only + en syntetisk per-division net-projektion.
// Report-pattern (ingen exit(1)) — ejer reviewer FØR relaunch.
//   node scripts/moneySupplyScorecard.js [--markdown]
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  SALARY_RATE,
  PRIZE_PER_POINT,
  INITIAL_BALANCE,
} from "../lib/economyConstants.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) =>
  n == null ? "—" : Math.round(n).toLocaleString("da-DK");
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

async function fetchAll(supabase, table, select, build = (q) => q) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(
      supabase.from(table).select(select)
    ).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  dotenv.config({
    path: path.resolve(
      SCRIPT_DIR,
      "../../.codex.local/supabase-readonly.env"
    ),
    quiet: true,
  });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_READONLY_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_READONLY_KEY (.codex.local/supabase-readonly.env)"
    );
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_READONLY_KEY
  );

  // Billable-team filter: rigtige hold = ikke AI/bank/test/frosne + har user_id
  // Read-only bypasser RLS → discriminatoren gentages eksplicit her.
  const allTeams = await fetchAll(
    supabase,
    "teams",
    "id, balance, division, is_ai, is_bank, is_test_account, is_frozen, user_id"
  );
  const teams = allTeams.filter(
    (t) =>
      t.user_id != null &&
      !t.is_ai &&
      !t.is_bank &&
      !t.is_test_account &&
      !t.is_frozen
  );

  const teamIds = teams.map((t) => t.id);

  // Hent ryttere og transaktioner kun for billable hold
  const [allRiders, tx] = await Promise.all([
    fetchAll(supabase, "riders", "team_id, salary"),
    fetchAll(
      supabase,
      "finance_transactions",
      "team_id, amount",
      (q) => q.in("team_id", teamIds)
    ),
  ]);

  const teamIdSet = new Set(teamIds);
  const riders = allRiders.filter((r) => teamIdSet.has(r.team_id));

  // ── Konserverings-check: per-team balance vs. expected ──────────────────────
  // expected = INITIAL_BALANCE + Σ(finance_transactions.amount for team)
  const sumByTeam = new Map();
  for (const r of tx) {
    sumByTeam.set(r.team_id, (sumByTeam.get(r.team_id) || 0) + (r.amount || 0));
  }

  let driftTeams = 0;
  for (const t of teams) {
    const expected = INITIAL_BALANCE + (sumByTeam.get(t.id) || 0);
    if (Math.abs(t.balance - expected) > 0) driftTeams++;
  }

  const aggregateSupply = teams.reduce((s, t) => s + (t.balance || 0), 0);

  // ── Salary-byrde pr. hold ───────────────────────────────────────────────────
  const salaryByTeam = new Map();
  for (const r of riders) {
    salaryByTeam.set(
      r.team_id,
      (salaryByTeam.get(r.team_id) || 0) + (r.salary || 0)
    );
  }

  // ── Print scorecard ─────────────────────────────────────────────────────────
  const generatedAt = new Date().toLocaleString("da-DK", {
    timeZone: "Europe/Copenhagen",
  });
  console.log(
    `=== #1441 money-supply-scorecard (live, ${teams.length} hold, ${generatedAt}) ===\n`
  );

  const driftOk = driftTeams === 0;
  console.log(
    `Aggregat pengemængde : ${fmt(aggregateSupply)} CZ$`
  );
  console.log(
    `Konserverings-drift  : ${driftTeams} hold med uventet balance ${driftOk ? "✅" : "❌ (finance_transactions ude af sync)"}`
  );
  console.log();

  // ── Per-division: median balance + syntetisk net/sæson ─────────────────────
  // Net-gate:
  //   D1: |net| ≤ sponsor × 5%  (≈break-even)
  //   D2: net ∈ [0, +30.000]
  //   D3: net ∈ [0, +30.000]
  console.log("Per-division projektion (no-engangs, median-roster):");
  console.log(
    "─────────────────────────────────────────────────────────────────────"
  );

  let allGatesPass = true;

  for (const d of [1, 2, 3]) {
    const divTeams = teams.filter((t) => t.division === d);
    if (!divTeams.length) {
      console.log(`  D${d}: ingen rigtige hold i live-populationen`);
      continue;
    }

    const balances = divTeams.map((t) => t.balance || 0);
    const salaries = divTeams.map((t) => salaryByTeam.get(t.id) || 0);

    const medBalance = median(balances);
    const medSalary = median(salaries);

    const sponsor = SPONSOR_INCOME_BY_DIVISION[d] || 0;
    const upkeep = UPKEEP_BY_DIVISION[d] || 0;

    // Net = sponsor − median-lønbyrde − upkeep
    // Præmie udelades bevidst (konservativt: prize=0 er worst-case for negativt net)
    const net = sponsor - medSalary - upkeep;

    let gateLabel;
    let gatePass;
    if (d === 1) {
      // D1: break-even ±5% af sponsor
      const tolerance = sponsor * 0.05;
      gatePass = Math.abs(net) <= tolerance;
      gateLabel = `|net| ≤ ${fmt(tolerance)} (±5% sponsor)`;
    } else {
      // D2/D3: lille overskud [0, +30k]
      gatePass = net >= 0 && net <= 30000;
      gateLabel = "net ∈ [0, +30.000]";
    }

    if (!gatePass) allGatesPass = false;

    console.log(
      `  D${d}: n=${divTeams.length}  median-balance=${fmt(medBalance)} (${(medBalance / INITIAL_BALANCE).toFixed(2)}× start)`
    );
    console.log(
      `       sponsor=${fmt(sponsor)} − løn=${fmt(medSalary)} − upkeep=${fmt(upkeep)} = net=${fmt(net)}`
    );
    console.log(
      `       Gate [${gateLabel}]: ${gatePass ? "✅ PASS" : "❌ FAIL — juster konstanter"}`
    );
    console.log();
  }

  console.log(
    "─────────────────────────────────────────────────────────────────────"
  );
  console.log(
    `Samlet gate: ${allGatesPass && driftOk ? "✅ PASS — klar til relaunch" : "❌ FAIL — se ❌ ovenfor"}`
  );
  console.log();
  console.log(
    `Note: løn-rate=${SALARY_RATE}, præmie=${fmt(PRIZE_PER_POINT)}/pt (ikke inkluderet i net — konservativt).`
  );
  console.log(
    "      Net-projektion bruger median-roster-løn pr. division fra live-populationen."
  );
  console.log("      Ejer reviewer og godkender FØR relaunch.");
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
