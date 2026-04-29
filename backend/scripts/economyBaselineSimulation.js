import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildSeasonEndPreviewRows } from "../lib/economyEngine.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_READONLY_ENV = path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env");

const TARGET_SCENARIOS = [
  {
    name: "local_competent_current_rules",
    description: "Competent active managers with sensible rosters under current economy rules. Prize columns are placeholders until real CZ$ prize money is designed.",
    salaryMultiplier: 1,
    prizeMultiplier: 1,
    sponsorByDivision: { 1: 240000, 2: 240000, 3: 240000 },
  },
  {
    name: "local_competent_strict_fair_v1",
    description: "Candidate tuning target for strict but survivable competent play. This must be rerun after real CZ$ prize money exists.",
    salaryMultiplier: 0.67,
    prizeMultiplier: 1,
    sponsorByDivision: { 1: 600000, 2: 400000, 3: 260000 },
    suggestedDebtCeilingByDivision: { 1: 1200000, 2: 900000, 3: 600000 },
  },
];

const LOCAL_COMPETENT_TEAMS = [
  {
    division: 1,
    teams: 8,
    riders: 22,
    salary: 1150000,
    prizes: 160000,
    loanInterest: 0,
    startingBalance: 800000,
  },
  {
    division: 2,
    teams: 8,
    riders: 15,
    salary: 650000,
    prizes: 70000,
    loanInterest: 0,
    startingBalance: 800000,
  },
  {
    division: 3,
    teams: 8,
    riders: 9,
    salary: 310000,
    prizes: 25000,
    loanInterest: 0,
    startingBalance: 800000,
  },
];

function parseArgs(argv) {
  const args = {
    envPath: DEFAULT_READONLY_ENV,
    format: "json",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env" && argv[i + 1]) {
      args.envPath = argv[i + 1];
      i += 1;
    } else if (arg === "--markdown") {
      args.format = "markdown";
    }
  }

  return args;
}

async function fetchAll(supabase, table, select, build = query => query) {
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

function sum(rows, key) {
  return rows.reduce((total, row) => total + (row[key] || 0), 0);
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[index];
}

function summarizeDivisionRows(rows) {
  const nets = rows.map(row => row.netBeforeEmergency);

  return {
    teams: rows.length,
    avgRiders: rows.length ? Math.round((sum(rows, "riders") / rows.length) * 10) / 10 : 0,
    sponsorIncome: sum(rows, "sponsorIncome"),
    salaries: sum(rows, "salaries"),
    prizes: sum(rows, "prizes"),
    loanInterest: sum(rows, "loanInterest"),
    emergencyLoans: sum(rows, "emergencyLoanAmount"),
    activeDebt: sum(rows, "activeDebt"),
    netBeforeEmergency: sum(rows, "netBeforeEmergency"),
    medianNet: percentile(nets, 0.5),
    p25Net: percentile(nets, 0.25),
    teamsNeedingEmergency: rows.filter(row => row.emergencyLoanAmount > 0).length,
    worstTeams: [...rows]
      .sort((left, right) => left.balanceAfterFullCycle - right.balanceAfterFullCycle)
      .slice(0, 3)
      .map(row => ({
        team: row.team,
        riders: row.riders,
        balance: row.balance,
        salaries: row.salaries,
        loanInterest: row.loanInterest,
        netBeforeEmergency: row.netBeforeEmergency,
        balanceAfterFullCycle: row.balanceAfterFullCycle,
        emergencyLoanAmount: row.emergencyLoanAmount,
        activeDebt: row.activeDebt,
      })),
  };
}

function groupByDivision(rows, extra = {}) {
  const divisions = new Map();

  for (const row of rows) {
    if (!divisions.has(row.division)) divisions.set(row.division, []);
    divisions.get(row.division).push(row);
  }

  return [...divisions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([division, divisionRows]) => ({
      division,
      ...summarizeDivisionRows(divisionRows),
      ...(extra[division] || {}),
    }));
}

function buildLocalScenarioRows(scenario) {
  const rows = [];

  for (const template of LOCAL_COMPETENT_TEAMS) {
    for (let index = 1; index <= template.teams; index += 1) {
      const sponsorIncome = scenario.sponsorByDivision[template.division] || 240000;
      const salaries = Math.round(template.salary * scenario.salaryMultiplier);
      const prizes = Math.round(template.prizes * scenario.prizeMultiplier);
      const loanInterest = Math.round(template.loanInterest * scenario.salaryMultiplier);
      const netBeforeEmergency = sponsorIncome + prizes - salaries - loanInterest;
      const balanceAfterFullCycle = template.startingBalance + netBeforeEmergency;

      rows.push({
        team: `D${template.division} competent ${index}`,
        division: template.division,
        riders: template.riders,
        balance: template.startingBalance,
        sponsorIncome,
        salaries,
        prizes,
        loanInterest,
        netBeforeEmergency,
        balanceAfterFullCycle,
        emergencyLoanAmount: Math.max(0, -balanceAfterFullCycle),
        activeDebt: 0,
      });
    }
  }

  return rows;
}

function buildMarkdown(report) {
  const lines = [
    `# Economy Baseline Simulation (${report.generatedAt.slice(0, 10)})`,
    "",
    `Live data source: season ${report.live.sourceSeason.number} for results, season ${report.live.activeSeason.number} for current teams/loans.`,
    "",
    "Note: Cycling Zone currently has result points, not a finished CZ$ prize-money economy. The `Prizes` column is placeholder/import data and larger economy tuning should wait until real prize payouts are implemented.",
    "",
    "## Live Current Rules",
    "",
    "| Division | Teams | Avg riders | Sponsor | Salaries | Prizes | Loan interest | Net | Emergency teams | Emergency amount | Active debt |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of report.live.currentRulesByDivision) {
    lines.push(
      `| ${row.division} | ${row.teams} | ${row.avgRiders} | ${row.sponsorIncome} | ${row.salaries} | ${row.prizes} | ${row.loanInterest} | ${row.netBeforeEmergency} | ${row.teamsNeedingEmergency} | ${row.emergencyLoans} | ${row.activeDebt} |`
    );
  }

  lines.push("", "## Local Scenarios", "");

  for (const scenario of report.localScenarios) {
    lines.push(`### ${scenario.name}`, "", scenario.description, "");
    lines.push("| Division | Teams | Sponsor | Salaries | Prizes | Net | Emergency teams | Emergency amount | Suggested debt ceiling |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const row of scenario.byDivision) {
      lines.push(
        `| ${row.division} | ${row.teams} | ${row.sponsorIncome} | ${row.salaries} | ${row.prizes} | ${row.netBeforeEmergency} | ${row.teamsNeedingEmergency} | ${row.emergencyLoans} | ${row.suggestedDebtCeiling || ""} |`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: args.envPath, quiet: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_READONLY_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_READONLY_KEY");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const seasons = await fetchAll(supabase, "seasons", "id, number, status, start_date, end_date");
  const activeSeason = [...seasons].sort((a, b) => b.number - a.number)[0];
  const sourceSeason = [...seasons]
    .filter(season => season.status === "completed")
    .sort((a, b) => b.number - a.number)[0] || activeSeason;

  const [
    teams,
    riders,
    boardProfiles,
    standings,
    loans,
    loanConfig,
    sourceRaces,
  ] = await Promise.all([
    fetchAll(supabase, "teams", "id, name, division, balance, sponsor_income, is_ai, is_frozen"),
    fetchAll(supabase, "riders", "id, team_id, salary, uci_points, prize_earnings_bonus, stat_bj, stat_sp, stat_tt, stat_fl, is_u25, nationality_code"),
    fetchAll(supabase, "board_profiles", "*"),
    fetchAll(supabase, "season_standings", "*", query => query.eq("season_id", sourceSeason.id)),
    fetchAll(supabase, "loans", "id, team_id, loan_type, amount_remaining, interest_rate, status"),
    fetchAll(supabase, "loan_config", "*"),
    fetchAll(supabase, "races", "id, season_id", query => query.eq("season_id", sourceSeason.id)),
  ]);

  const raceIds = sourceRaces.map(race => race.id);
  const raceResults = [];
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    if (!chunk.length) continue;
    raceResults.push(
      ...await fetchAll(
        supabase,
        "race_results",
        "rider_id, team_id, race_id, prize_money, points_earned",
        query => query.in("race_id", chunk)
      )
    );
  }

  const ridersByTeam = new Map();
  const riderTeamById = new Map();
  for (const rider of riders) {
    riderTeamById.set(rider.id, rider.team_id);
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }

  const boardsByTeam = new Map();
  for (const board of boardProfiles) {
    if (!board.team_id) continue;
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }

  const prizeByTeam = new Map();
  for (const result of raceResults) {
    const teamId = result.team_id || riderTeamById.get(result.rider_id);
    if (!teamId) continue;
    prizeByTeam.set(teamId, (prizeByTeam.get(teamId) || 0) + (result.prize_money || 0));
  }

  const humanTeams = teams
    .filter(team => !team.is_ai && !team.is_frozen)
    .map(team => ({
      ...team,
      riders: ridersByTeam.get(team.id) || [],
      board_profiles: boardsByTeam.get(team.id) || [],
    }));
  const activeLoans = loans.filter(loan => loan.status === "active");
  const previewRows = buildSeasonEndPreviewRows({
    teams: humanTeams,
    standings,
    loanData: activeLoans,
  });

  const liveRows = previewRows.map(row => {
    const team = humanTeams.find(candidate => candidate.id === row.team_id);
    const activeTeamLoans = activeLoans.filter(loan => loan.team_id === row.team_id);
    const sponsorIncome = Math.round((team?.sponsor_income || 0) * (row.sponsor_modifier || 1));
    const prizes = prizeByTeam.get(row.team_id) || 0;
    const salaries = row.salary_deduction || 0;
    const loanInterest = row.loan_interest || 0;
    const netBeforeEmergency = sponsorIncome + prizes - salaries - loanInterest;
    const balanceAfterFullCycle = (team?.balance || 0) + netBeforeEmergency;

    return {
      team: row.team_name,
      division: row.division,
      riders: team?.riders?.length || 0,
      balance: team?.balance || 0,
      sponsorIncome,
      salaries,
      prizes,
      loanInterest,
      netBeforeEmergency,
      balanceAfterFullCycle,
      emergencyLoanAmount: Math.max(0, -balanceAfterFullCycle),
      activeDebt: activeTeamLoans.reduce((total, loan) => total + (loan.amount_remaining || 0), 0),
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    live: {
      activeSeason,
      sourceSeason,
      counts: {
        teams: teams.length,
        humanTeams: humanTeams.length,
        riders: riders.length,
        visibleBoardProfiles: boardProfiles.length,
        standings: standings.length,
        activeLoans: activeLoans.length,
        sourceRaces: sourceRaces.length,
        sourceRaceResults: raceResults.length,
      },
      loanConfig: loanConfig
        .sort((left, right) => (
          left.division - right.division
          || String(left.loan_type).localeCompare(String(right.loan_type))
        )),
      currentRulesByDivision: groupByDivision(liveRows),
    },
    localScenarios: TARGET_SCENARIOS.map(scenario => ({
      name: scenario.name,
      description: scenario.description,
      byDivision: groupByDivision(
        buildLocalScenarioRows(scenario),
        Object.fromEntries(Object.entries(scenario.suggestedDebtCeilingByDivision || {})
          .map(([division, suggestedDebtCeiling]) => [Number(division), { suggestedDebtCeiling }]))
      ),
    })),
  };

  if (args.format === "markdown") {
    process.stdout.write(buildMarkdown(report));
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
