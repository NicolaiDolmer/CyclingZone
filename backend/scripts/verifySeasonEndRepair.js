import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.resolve(SCRIPT_DIR, "../.env");
const DEFAULT_SEASON_NUMBER = 6;

function parseArgs(argv) {
  const args = {
    envPath: DEFAULT_ENV,
    format: "json",
    seasonId: null,
    seasonNumber: DEFAULT_SEASON_NUMBER,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env" && argv[i + 1]) {
      args.envPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--season-id" && argv[i + 1]) {
      args.seasonId = argv[i + 1];
      i += 1;
    } else if (arg === "--season-number" && argv[i + 1]) {
      args.seasonNumber = Number.parseInt(argv[i + 1], 10);
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

function sum(rows, key = "amount") {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return grouped;
}

function countUnique(rows, key) {
  return new Set(rows.map(row => row[key]).filter(Boolean)).size;
}

function status(ok, details = {}) {
  return { ok, ...details };
}

function byTypeSummary(financeRows) {
  return [...groupBy(financeRows, "type").entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, rows]) => ({
      type,
      rows: rows.length,
      teams: countUnique(rows, "team_id"),
      amount: sum(rows),
    }));
}

function duplicateKeys(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

function buildMarkdown(report) {
  const lines = [
    `# Season ${report.season.number} Repair Verification (${report.generatedAt.slice(0, 10)})`,
    "",
    `Season: \`${report.season.id}\` · status \`${report.season.status}\` · end date \`${report.season.end_date || ""}\``,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "|---|---:|---|",
  ];

  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`| ${name} | ${check.ok ? "OK" : "FAIL"} | ${check.detail || ""} |`);
  }

  lines.push("", "## Finance By Type", "");
  lines.push("| Type | Rows | Teams | Amount |");
  lines.push("|---|---:|---:|---:|");
  for (const row of report.finance.byType) {
    lines.push(`| ${row.type} | ${row.rows} | ${row.teams} | ${row.amount} |`);
  }

  lines.push("", "## Balance Side Effects", "");
  lines.push(`Tracked net amount from season-end repair types: \`${report.finance.trackedNetAmount}\`.`);
  lines.push("No pre-repair balance snapshot exists in repo/live docs, so this script reports the service-visible net effect instead of pretending to prove exact before/after balances.");

  if (report.warnings.length) {
    lines.push("", "## Warnings", "");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: args.envPath, quiet: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const seasonQuery = supabase
    .from("seasons")
    .select("id, number, status, start_date, end_date")
    .limit(1);
  const { data: seasons, error: seasonError } = args.seasonId
    ? await seasonQuery.eq("id", args.seasonId)
    : await seasonQuery.eq("number", args.seasonNumber);
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);

  const season = seasons?.[0];
  if (!season) throw new Error("Season not found");

  const [
    teams,
    riders,
    financeRows,
    allEmergencyLoanRows,
    snapshots,
    boardProfiles,
    standings,
    loans,
    notifications,
  ] = await Promise.all([
    fetchAll(supabase, "teams", "id, name, division, balance, sponsor_income, is_ai, is_frozen, is_bank"),
    fetchAll(supabase, "riders", "id, team_id, salary"),
    fetchAll(
      supabase,
      "finance_transactions",
      "id, team_id, type, amount, description, season_id, created_at",
      query => query.eq("season_id", season.id)
    ),
    fetchAll(
      supabase,
      "finance_transactions",
      "id, team_id, type, amount, description, season_id, created_at",
      query => query.eq("type", "emergency_loan")
    ),
    fetchAll(
      supabase,
      "board_plan_snapshots",
      "id, team_id, board_id, season_id, season_number, season_within_plan, created_at",
      query => query.eq("season_id", season.id)
    ),
    fetchAll(supabase, "board_profiles", "id, team_id"),
    fetchAll(supabase, "season_standings", "id, season_id, team_id, division, rank_in_division", query => query.eq("season_id", season.id)),
    fetchAll(supabase, "loans", "id, team_id, loan_type, amount_remaining, interest_rate, status, seasons_remaining, updated_at"),
    fetchAll(supabase, "notifications", "id, type, title, related_id, created_at"),
  ]);

  const humanTeams = teams.filter(team => !team.is_ai && !team.is_frozen);
  const ridersByTeam = groupBy(riders.filter(rider => rider.team_id), "team_id");
  const teamsWithRiders = humanTeams.filter(team => (ridersByTeam.get(team.id) || []).length > 0);
  const financeByType = groupBy(financeRows, "type");
  const salaryRows = financeByType.get("salary") || [];
  const loanInterestRows = financeByType.get("loan_interest") || [];
  const legacyInterestRows = financeByType.get("interest") || [];
  const emergencyLoanRows = financeByType.get("emergency_loan") || [];
  const unseasonedEmergencyLoanRows = allEmergencyLoanRows.filter(row => !row.season_id);
  const trackedFinanceRows = [
    ...salaryRows,
    ...loanInterestRows,
    ...legacyInterestRows,
    ...emergencyLoanRows,
  ];

  const snapshotDuplicateBoards = duplicateKeys(snapshots, row => row.board_id);
  const snapshotDuplicateTeamBoards = duplicateKeys(snapshots, row => `${row.team_id}:${row.board_id}`);
  const expectedBoardProfiles = boardProfiles.filter(board =>
    humanTeams.some(team => team.id === board.team_id)
  );
  const standingTeams = new Set(standings.map(row => row.team_id));

  const loanInterestByTeam = groupBy(loanInterestRows, "team_id");
  const activeLoans = loans.filter(loan => loan.status === "active");
  const teamsWithActiveLoans = new Set(activeLoans.map(loan => loan.team_id));
  const teamsWithLoanInterestRows = new Set(loanInterestRows.map(row => row.team_id));
  const activeNonEmergencyLoanTeams = new Set(
    activeLoans
      .filter(loan => loan.loan_type !== "emergency")
      .map(loan => loan.team_id)
  );
  const nonEmergencyLoanTeamsWithoutInterest = [...activeNonEmergencyLoanTeams]
    .filter(teamId => !teamsWithLoanInterestRows.has(teamId));

  const knownPromoted = ["Ankuva CT", "Liams geder"].map(name => {
    const team = teams.find(candidate => candidate.name === name);
    return {
      name,
      division: team?.division ?? null,
      ok: team?.division === 2,
    };
  });

  const notificationTypes = new Set(notifications.map(notification => notification.type));
  const relevantNotifications = {
    emergency_loan: notificationTypes.has("emergency_loan"),
    salary_paid: notificationTypes.has("salary_paid"),
    board_update: notificationTypes.has("board_update"),
  };

  const checks = {
    season_completed: status(season.status === "completed", {
      detail: `status=${season.status}, end_date=${season.end_date || ""}`,
    }),
    human_team_count: status(humanTeams.length === 24, {
      detail: `${humanTeams.length} human non-frozen teams`,
    }),
    standings_cover_human_teams: status(humanTeams.every(team => standingTeams.has(team.id)), {
      detail: `${standingTeams.size} standings teams for ${humanTeams.length} human teams`,
    }),
    salary_rows_cover_current_rostered_human_teams: status(
      countUnique(salaryRows, "team_id") === teamsWithRiders.length,
      { detail: `${countUnique(salaryRows, "team_id")} salary teams for ${teamsWithRiders.length} currently rostered human teams` }
    ),
    finance_repair_types_visible: status(trackedFinanceRows.length > 0, {
      detail: `${trackedFinanceRows.length} service-visible salary/interest/emergency rows`,
    }),
    loan_interest_visible_for_active_non_emergency_loan_teams: status(nonEmergencyLoanTeamsWithoutInterest.length === 0, {
      detail: `${teamsWithLoanInterestRows.size} teams with loan_interest rows; ${nonEmergencyLoanTeamsWithoutInterest.length} active non-emergency loan teams missing rows`,
    }),
    emergency_loan_rows_match_active_emergency_loan_teams: status(
      countUnique(emergencyLoanRows, "team_id") === countUnique(activeLoans.filter(loan => loan.loan_type === "emergency"), "team_id"),
      { detail: `${countUnique(emergencyLoanRows, "team_id")} season-tagged emergency_loan finance teams; ${countUnique(activeLoans.filter(loan => loan.loan_type === "emergency"), "team_id")} active emergency-loan teams; ${unseasonedEmergencyLoanRows.length} unseasoned emergency_loan rows visible` }
    ),
    board_snapshots_cover_boards: status(snapshots.length === expectedBoardProfiles.length, {
      detail: `${snapshots.length} snapshots for ${expectedBoardProfiles.length} human board profiles`,
    }),
    board_snapshots_not_duplicated: status(snapshotDuplicateBoards.length === 0 && snapshotDuplicateTeamBoards.length === 0, {
      detail: `${snapshotDuplicateBoards.length} duplicate board ids; ${snapshotDuplicateTeamBoards.length} duplicate team-board pairs`,
    }),
    known_promotions_still_division_2: status(knownPromoted.every(team => team.ok), {
      detail: knownPromoted.map(team => `${team.name}=D${team.division || "?"}`).join(", "),
    }),
  };

  const warnings = [];
  if (!relevantNotifications.salary_paid) {
    warnings.push("No salary_paid notifications were found globally. Runtime currently records salary finance rows but does not appear to notify salary payments.");
  }
  if (emergencyLoanRows.length > 0 && !relevantNotifications.emergency_loan) {
    warnings.push("Emergency-loan finance rows exist, but no emergency_loan notifications were found globally.");
  }
  if (unseasonedEmergencyLoanRows.length > 0) {
    warnings.push(`${unseasonedEmergencyLoanRows.length} emergency_loan finance rows are visible without season_id. Backfill these instead of rerunning repair.`);
  }
  if (teamsWithActiveLoans.size > 0 && loanInterestRows.length === 0) {
    warnings.push("Active finance-loans exist, but no season loan_interest rows were found.");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    season,
    checks,
    teams: {
      human: humanTeams.length,
      currentRosteredHuman: teamsWithRiders.length,
      withActiveLoans: teamsWithActiveLoans.size,
    },
    finance: {
      byType: byTypeSummary(financeRows),
      trackedNetAmount: sum(trackedFinanceRows),
      salaryTeams: countUnique(salaryRows, "team_id"),
      loanInterestTeams: loanInterestByTeam.size,
      emergencyLoanTeams: countUnique(emergencyLoanRows, "team_id"),
      unseasonedEmergencyLoanRows: unseasonedEmergencyLoanRows.length,
    },
    board: {
      snapshots: snapshots.length,
      expectedBoardProfiles: expectedBoardProfiles.length,
      duplicateBoardIds: snapshotDuplicateBoards,
      duplicateTeamBoards: snapshotDuplicateTeamBoards,
    },
    loans: {
      active: activeLoans.length,
      activeTeams: teamsWithActiveLoans.size,
      activeNonEmergencyLoanTeams: activeNonEmergencyLoanTeams.size,
      nonEmergencyLoanTeamsWithoutInterest,
    },
    promotions: knownPromoted,
    notifications: relevantNotifications,
    warnings,
  };

  if (args.format === "markdown") {
    console.log(buildMarkdown(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  const failed = Object.values(checks).filter(check => !check.ok);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
