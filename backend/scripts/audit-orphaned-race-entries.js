#!/usr/bin/env node
// Report race_entries rows orphaned by a team deletion (#3817).
//
// ROOT CAUSE: race_entries_team_id_fkey is ON DELETE SET NULL (race_entries_rider_id_fkey
// is ON DELETE CASCADE). When a team is deleted, its riders' entries survive with
// team_id = NULL instead of being removed. They then become permanently unreachable:
// the entry generator's diff works per (race_id, team_id) unit and filters every write
// on .eq("team_id", teamId) (backend/lib/raceEntryGenerator.js, applyUnitDiff) — a row
// with team_id = NULL matches no unit, so it can never be role-updated or swept.
//
// This script is READ-ONLY by design. It does not delete or modify any row. Deciding
// whether orphaned entries should even be able to exist (and therefore whether the FK
// should become ON DELETE CASCADE) and whether the 36 historical rows should be deleted
// are owner-gated decisions — see issue #3817 "Foreslaaede naeste skridt". The
// accompanying migration (database/2026-08-18-3817-race-entries-team-fk-cascade.sql)
// changes the FK for FUTURE deletions only; it does not touch existing data either.
//
// Usage:
//   node backend/scripts/audit-orphaned-race-entries.js            # human-readable report
//   node backend/scripts/audit-orphaned-race-entries.js --json     # JSON output (for CI/logs)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required; read-only queries)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

// SELECT-only. No .delete()/.update() anywhere in this file. race_entries is
// deny-listed by the pagination guard (#3331) — PostgREST silently caps a
// naive .select() at 1000 rows, so this uses fetchAllRows even though the
// orphan count is small today (36); it must stay correct if that grows.
export async function fetchOrphanedEntries(supabase) {
  try {
    return await fetchAllRows(() =>
      supabase
        .from("race_entries")
        .select("race_id, rider_id, is_auto_filled, created_at, race_role, races(status, season_id)")
        .is("team_id", null)
        .order("created_at", { ascending: true })
    );
  } catch (error) {
    const message = formatSupabaseAuditError(
      "race_entries orphan scan",
      error,
      "Verify race_entries/races columns against database/schema-snapshot.json."
    );
    throw new Error(message, { cause: error });
  }
}

export function summarize(rows) {
  const distinctRaces = new Set(rows.map((r) => r.race_id));
  const byStatus = new Map();
  const bySeason = new Map();
  let autoFilledCount = 0;
  let earliest = null;
  let latest = null;

  for (const row of rows) {
    if (row.is_auto_filled) autoFilledCount += 1;
    const status = row.races?.status ?? "unknown";
    const season = row.races?.season_id ?? "unknown";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    bySeason.set(season, (bySeason.get(season) || 0) + 1);
    if (!earliest || row.created_at < earliest) earliest = row.created_at;
    if (!latest || row.created_at > latest) latest = row.created_at;
  }

  return {
    total: rows.length,
    distinct_races: distinctRaces.size,
    auto_filled_count: autoFilledCount,
    not_auto_filled_count: rows.length - autoFilledCount,
    by_race_status: Object.fromEntries(byStatus),
    by_season_id: Object.fromEntries(bySeason),
    earliest_created_at: earliest,
    latest_created_at: latest,
  };
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, "..", "..");
  dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

  const args = new Set(process.argv.slice(2));
  const JSON_OUT = args.has("--json");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let rows;
  try {
    rows = await fetchOrphanedEntries(supabase);
  } catch (err) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(err.message);
    }
    process.exit(1);
    return;
  }

  const summary = summarize(rows);

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log(`Orphaned race_entries (team_id IS NULL): ${summary.total}\n`);
    console.log(`  Distinct races: ${summary.distinct_races}`);
    console.log(`  is_auto_filled=true: ${summary.auto_filled_count} / is_auto_filled=false: ${summary.not_auto_filled_count}`);
    console.log(`  By race status: ${JSON.stringify(summary.by_race_status)}`);
    console.log(`  By season_id: ${JSON.stringify(summary.by_season_id)}`);
    console.log(`  Created between: ${summary.earliest_created_at ?? "-"} and ${summary.latest_created_at ?? "-"}\n`);

    if (summary.total === 0) {
      console.log("OK — no orphaned race_entries rows found.");
    } else {
      console.log("This script is read-only. It reports only — see #3817 for the owner-gated");
      console.log("decision on whether/how to repair these rows (backfill, delete, or leave as-is).");
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("audit-orphaned-race-entries.js")) {
  main();
}
