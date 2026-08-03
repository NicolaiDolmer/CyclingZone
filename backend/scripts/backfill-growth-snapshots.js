// Backfill-script (#3196, ejer-direktiv 31/7 — samlet vækst-dashboard).
//
// Kalder den idempotente SQL-funktion public.compute_daily_growth_snapshot(date)
// (database/2026-08-03-growth-snapshots-3196.sql) for hver dag fra --from til
// --to (default: fra ældste auth.users.created_at til I GÅR — IKKE i dag, da
// cron'en (backend/cron.js runGrowthSnapshotCron) allerede dækker dagens dato
// dagligt fremadrettet).
//
// KØR ALDRIG mod prod uden ejer-godkendelse/orkestrator-mandat (SQL/migrations
// #2642-rammer: Claude applier selv POST-MERGE, idempotent + post-verify).
// --dry-run (default) printer kun planen (antal dage) uden at kalde RPC'en;
// --live udfører de faktiske kald, dag for dag, sekventielt (undgår at
// overbelaste DB'en med parallelle heavy aggregat-queries).
//
// BACKFILL-BEGRÆNSNING: se fil-header i database/2026-08-03-growth-snapshots-3196.sql
// — historiske DAU/WAU/MAU/retention-tal er et KONSERVATIVT UNDERTAL for
// brugere der kun har presence (last_seen, intet analytics-samtykke), fordi
// last_seen ikke er historiseret. player_events (tidsstemplet) er præcis for
// alle datoer.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

async function findEarliestSignupDate(supabase) {
  // auth.users er ikke direkte PostgREST-eksponeret; public.users.created_at
  // (sat ved signup-bootstrap) er en pålidelig proxy — matcher konventionen i
  // get_sprint_metrics-kommentaren ("auth.users er kilde-til-sandhed; public.users
  // mangler indtil signup-bootstrap kører", men public.users.created_at er sat
  // FOR ALLE users der har gennemført bootstrap, hvilket dækker hele den
  // periode der er relevant at backfille).
  const { data, error } = await supabase
    .from("users")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`users: ${error.message}`);
  return data?.created_at ? isoDate(new Date(data.created_at)) : isoDate(new Date());
}

export function buildDateRange(fromDate, toDate) {
  const dates = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export async function runBackfill({ supabase, from, to, dryRun = true, log = console.log }) {
  const toDate = to || addDays(isoDate(new Date()), -1); // default: i går (cron dækker i dag)
  const fromDate = from || await findEarliestSignupDate(supabase);
  const dates = buildDateRange(fromDate, toDate);

  log(`Vækst-snapshot-backfill: ${dates.length} dage (${fromDate} -> ${toDate}).`);

  if (dryRun) {
    log("DRY-RUN — ingen RPC-kald. Kør med --live for at anvende.");
    return { dryRun: true, days: dates.length, from: fromDate, to: toDate };
  }

  let ok = 0;
  const failures = [];
  for (const date of dates) {
    const { error } = await supabase.rpc("compute_daily_growth_snapshot", { p_snapshot_date: date });
    if (error) {
      failures.push({ date, error: error.message });
      log(`  ❌ ${date}: ${error.message}`);
    } else {
      ok++;
    }
  }
  log(`LIVE — ${ok}/${dates.length} snapshots skrevet.${failures.length ? ` ${failures.length} fejlede.` : ""}`);
  return { dryRun: false, days: dates.length, ok, failures, from: fromDate, to: toDate };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("backfill-growth-snapshots.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const fromArg = process.argv.find(a => a.startsWith("--from="))?.split("=")[1];
  const toArg = process.argv.find(a => a.startsWith("--to="))?.split("=")[1];
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  runBackfill({ supabase, from: fromArg, to: toArg, dryRun })
    .then(r => { console.log("OK:", JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error("FEJL:", err.message); process.exit(1); });
}
