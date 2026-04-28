import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const envPath = path.join(repoRoot, ".codex.local", "supabase-readonly.env");

const COMMANDS = new Set(["status", "schema", "season-flow", "import-health", "views", "all"]);

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadLocalEnv() {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${path.relative(repoRoot, envPath)}. Copy the template and add read-only credentials.`);
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const pair = parseEnvLine(line);
    if (!pair) continue;
    const [key, value] = pair;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function getSupabaseClient() {
  loadLocalEnv();

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_READONLY_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY;

  if (!url) throw new Error("SUPABASE_URL is missing in .codex.local/supabase-readonly.env");
  if (!key) {
    throw new Error(
      "SUPABASE_READONLY_KEY is missing in .codex.local/supabase-readonly.env. Do not use SUPABASE_SERVICE_KEY for routine AI probes."
    );
  }

  if (process.env.SUPABASE_SERVICE_KEY && !process.env.ALLOW_SUPABASE_SERVICE_KEY_FOR_AI_PROBES) {
    throw new Error(
      "SUPABASE_SERVICE_KEY is present. Use SUPABASE_READONLY_KEY instead, or set ALLOW_SUPABASE_SERVICE_KEY_FOR_AI_PROBES=1 only for a deliberate one-off local inspection."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function compactError(error) {
  if (!error) return null;
  return {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  };
}

async function countRows(supabase, table, queryBuilder = null) {
  const builder = queryBuilder || supabase.from(table).select("id", { count: "exact", head: true });
  const { count, error } = await builder;
  return error ? { ok: false, error: compactError(error) } : { ok: true, count: count ?? 0 };
}

async function selectRows(builder, limit = 20) {
  const { data, error } = await builder.limit(limit);
  return error ? { ok: false, error: compactError(error) } : { ok: true, rows: data ?? [] };
}

async function maybeSingle(builder) {
  const { data, error } = await builder.maybeSingle();
  return error ? { ok: false, error: compactError(error) } : { ok: true, row: data ?? null };
}

async function statusProbe(supabase) {
  const activeSeason = await maybeSingle(
    supabase
      .from("seasons")
      .select("id, number, status, start_date, end_date, race_days_total, race_days_completed, created_at")
      .eq("status", "active")
      .order("number", { ascending: false })
      .limit(1)
  );

  const counts = {};
  for (const table of [
    "seasons",
    "races",
    "race_results",
    "season_standings",
    "teams",
    "riders",
    "auctions",
    "transfer_offers",
    "swap_offers",
    "loan_agreements",
    "import_log",
  ]) {
    counts[table] = await countRows(supabase, table);
  }

  const recentImports = await selectRows(
    supabase
      .from("import_log")
      .select("id, import_type, rows_processed, rows_updated, rows_inserted, errors, created_at")
      .order("created_at", { ascending: false }),
    5
  );

  return {
    activeSeason,
    counts,
    recentImports,
    generatedAt: new Date().toISOString(),
  };
}

async function schemaProbe(supabase) {
  const contracts = {
    seasons: "id, number, status, start_date, end_date, race_days_completed",
    races: "id, season_id, name, race_type, stages, start_date, status, prize_pool",
    race_results:
      "id, race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, points_earned, prize_money, imported_at",
    season_standings:
      "id, season_id, team_id, division, rank_in_division, total_points, races_completed, stage_wins, gc_wins, updated_at",
    finance_transactions: "id, team_id, type, amount, description, season_id, race_id, created_at",
    import_log: "id, import_type, rows_processed, rows_updated, rows_inserted, errors, imported_by, created_at",
    teams: "id, user_id, name, is_ai, division, balance, sponsor_income, is_bank, manager_name",
    riders: "id, pcm_id, firstname, lastname, team_id, uci_points, price, salary",
  };

  const result = {};
  for (const [table, columns] of Object.entries(contracts)) {
    const { data, error } = await supabase.from(table).select(columns).limit(1);
    result[table] = error
      ? { ok: false, columns, error: compactError(error) }
      : { ok: true, columns, sampleRows: data?.length ?? 0 };
  }
  return result;
}

async function seasonFlowProbe(supabase) {
  const activeSeason = await maybeSingle(
    supabase
      .from("seasons")
      .select("id, number, status, race_days_total, race_days_completed")
      .eq("status", "active")
      .order("number", { ascending: false })
      .limit(1)
  );

  if (!activeSeason.ok || !activeSeason.row) {
    return { activeSeason, note: "No active season found; season-flow probe stops before season-scoped checks." };
  }

  const seasonId = activeSeason.row.id;
  const raceRows = await selectRows(
    supabase
      .from("races")
      .select("id, name, status, start_date, race_type, stages")
      .eq("season_id", seasonId)
      .order("start_date", { ascending: true }),
    500
  );

  const races = raceRows.ok ? raceRows.rows : [];
  const raceIds = races.map((race) => race.id);

  const counts = {
    races: await countRows(
      supabase,
      "races",
      supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", seasonId)
    ),
    standings: await countRows(
      supabase,
      "season_standings",
      supabase.from("season_standings").select("id", { count: "exact", head: true }).eq("season_id", seasonId)
    ),
    financePrizes: await countRows(
      supabase,
      "finance_transactions",
      supabase
        .from("finance_transactions")
        .select("id", { count: "exact", head: true })
        .eq("season_id", seasonId)
        .eq("type", "prize")
    ),
  };

  if (raceIds.length) {
    counts.raceResults = await countRows(
      supabase,
      "race_results",
      supabase.from("race_results").select("id", { count: "exact", head: true }).in("race_id", raceIds)
    );
  } else {
    counts.raceResults = { ok: true, count: 0 };
  }

  const sampleRaces = races.slice(0, 20);
  const statusBreakdown = races.reduce((acc, race) => {
    acc[race.status] = (acc[race.status] || 0) + 1;
    return acc;
  }, {});

  return {
    activeSeason,
    counts,
    statusBreakdown,
    sampleRaces,
    warnings: [
      counts.races.ok && counts.races.count === 0 ? "Active season has no races; xlsx/sheets import cannot match results." : null,
      counts.standings.ok && counts.standings.count === 0 ? "Active season has no standings rows." : null,
      raceIds.length > 500 ? "Race-result count only checked against the first 500 races returned by PostgREST." : null,
    ].filter(Boolean),
  };
}

async function importHealthProbe(supabase) {
  const recent = await selectRows(
    supabase
      .from("import_log")
      .select("id, import_type, rows_processed, rows_updated, rows_inserted, errors, created_at")
      .order("created_at", { ascending: false }),
    10
  );

  const latestRaceResultSheets = await maybeSingle(
    supabase
      .from("import_log")
      .select("id, import_type, rows_processed, rows_updated, rows_inserted, errors, created_at")
      .eq("import_type", "race_results_sheets")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  let skippedSample = [];
  const errors = latestRaceResultSheets.row?.errors;
  if (Array.isArray(errors)) skippedSample = errors.slice(0, 20);

  return {
    recent,
    latestRaceResultSheets,
    skippedSample,
    warnings: [
      latestRaceResultSheets.row &&
      latestRaceResultSheets.row.rows_processed > 0 &&
      latestRaceResultSheets.row.rows_inserted === 0
        ? "Latest race_results_sheets import processed rows but inserted 0; likely unmatched races."
        : null,
    ].filter(Boolean),
  };
}

async function viewsProbe(supabase) {
  const views = {
    ai_active_season_status:
      "season_id, season_number, status, race_days_total, race_days_completed, race_count, race_result_count, standings_count, prize_transaction_count",
    ai_recent_import_health:
      "id, import_type, rows_processed, rows_updated, rows_inserted, error_count, created_at",
    ai_race_import_blockers:
      "import_log_id, created_at, rows_processed, rows_updated, rows_inserted, status, errors",
  };

  const result = {};
  for (const [view, columns] of Object.entries(views)) {
    const { data, error } = await supabase.from(view).select(columns).limit(10);
    result[view] = error
      ? {
          ok: false,
          installed: false,
          error: compactError(error),
          installHint: "Run database/ai_readonly_views.sql in Supabase SQL Editor.",
        }
      : { ok: true, installed: true, rows: data ?? [] };
  }
  return result;
}

async function run() {
  const command = process.argv[2] || "status";
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command "${command}". Use one of: ${Array.from(COMMANDS).join(", ")}`);
  }

  const supabase = getSupabaseClient();
  const output = {};

  if (command === "status" || command === "all") output.status = await statusProbe(supabase);
  if (command === "schema" || command === "all") output.schema = await schemaProbe(supabase);
  if (command === "season-flow" || command === "all") output.seasonFlow = await seasonFlowProbe(supabase);
  if (command === "import-health" || command === "all") output.importHealth = await importHealthProbe(supabase);
  if (command === "views" || command === "all") output.views = await viewsProbe(supabase);

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
