#!/usr/bin/env node
// #4700 — dump af de rytter-par riderDoubleBookingWatch (CYCLINGZONE-44) alarmerer på:
// samme rytter comitteret til to løb hvis in-game binding-vinduer overlapper (#1823/#3185/#4217).
//
// HVORFOR EN SEPARAT SCRIPT NÅR VAGTEN ALLEREDE FINDES (riderDoubleBookingWatch.js).
// Vagten er READ-ONLY og alarmerer korrekt, men dens Sentry-capture er hårdt begrænset
// til SAMPLE_LIMIT=25 par og rapporterer kun tælletal (count/actionable/historical) —
// den bærer ALDRIG den fulde liste nogen steder en ejer kan læse den. #4700 (evidens
// 2/9 kl. 12:49) målte 48 par; et menneske der skal beslutte en oprydning har brug for
// hele listen (rytter, hold, begge løb, game_day-vindue, is_auto_filled, created_at),
// ikke et sample på 25.
//
// GENBRUG, IKKE EN NY KOPI AF SELVE OVERLAP-LOGIKKEN (roden til #4700's egen klasse af
// bugs er netop at overlap-reglen har ligget flere steder). Denne fil importerer de
// SAMME rene funktioner som vagten selv bruger (findDoubleBookedRiders, splitLiveConflicts
// fra riderDoubleBookingWatch.js; raceBindingWindow/windowsOverlap fra raceBinding.js;
// filterEligibleEntries fra riderEligibility.js) — kun I/O-laget (hvilke rækker der
// hentes) er skrevet igen, spejlet 1:1 efter runRiderDoubleBookingWatch, fordi den
// funktion ikke selv eksporterer den fulde par-liste (kun tælletal + et 25-par-sample).
//
// READ-ONLY. Ingen --apply, ingen delete/update — se #4700's krav om at en evt. oprydning
// af eksisterende par er ejer-gated og hører til i en separat, senere godkendt handling.
//
// Usage:
//   node backend/scripts/audit-4700-double-booked-riders.js            # menneskelæsbar rapport
//   node backend/scripts/audit-4700-double-booked-riders.js --json     # JSON (CI/logs)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, kun SELECT-forespørgsler)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";
import { fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { raceBindingWindow } from "../lib/raceBinding.js";
import { filterEligibleEntries } from "../lib/riderEligibility.js";
import { findDoubleBookedRiders, splitLiveConflicts } from "../lib/riderDoubleBookingWatch.js";

// Samme I/O-form som runRiderDoubleBookingWatch (backend/lib/riderDoubleBookingWatch.js),
// men returnerer den FULDE par-liste (med begge entries' created_at/is_auto_filled) i
// stedet for kun tælletal — det er hele formålet med denne fil, se modul-kommentaren.
export async function findAllDoubleBookedPairs(supabase) {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) return { seasonId: null, pairs: [] };

  const { data: races, error: raceErr } = await supabase
    .from("races").select("id, name, stages_completed, status").eq("season_id", season.id);
  if (raceErr) throw new Error(`races: ${raceErr.message}`);
  const raceIds = (races || []).map((r) => r.id);
  const raceById = new Map((races || []).map((r) => [r.id, r]));
  if (!raceIds.length) return { seasonId: season.id, pairs: [] };

  const schedRows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_stage_schedule").select("race_id, scheduled_at, game_day")
      .in("race_id", chunk).order("race_id").order("stage_number"));
  const schedByRace = new Map();
  for (const row of schedRows) {
    if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
    schedByRace.get(row.race_id).push(row);
  }
  const windowByRace = new Map();
  for (const id of raceIds) {
    const w = raceBindingWindow(schedByRace.get(id));
    if (w) windowByRace.set(id, w);
  }

  const wRows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_withdrawals").select("race_id, team_id").in("race_id", chunk).order("race_id").order("team_id"));
  const withdrawnKeys = new Set(wRows.map((w) => `${w.race_id}|${w.team_id}`));

  const rawEntries = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_entries").select("race_id, team_id, rider_id, is_auto_filled, created_at")
      .in("race_id", chunk).order("race_id").order("rider_id"));

  // Ghost-filter (#3185): kryds mod rytterens NUVÆRENDE hold/tilstand — samme predikat
  // som vagten og guards bruger (filterEligibleEntries).
  const riderIds = [...new Set(rawEntries.map((e) => e.rider_id))];
  const riderRows = riderIds.length
    ? await fetchAllRowsChunkedIn(riderIds, (chunk) =>
        supabase.from("riders").select("id, team_id, is_academy, is_retired, firstname, lastname").in("id", chunk).order("id"))
    : [];
  const ridersById = new Map(riderRows.map((r) => [r.id, r]));
  const entries = filterEligibleEntries({ entries: rawEntries, ridersById });

  // entriesByKey: (race_id, rider_id) -> fuld entry-række, til at berige parrene med
  // created_at/is_auto_filled uden at findDoubleBookedRiders skal ændres.
  const entryByKey = new Map(entries.map((e) => [`${e.race_id}|${e.rider_id}`, e]));

  const conflicts = findDoubleBookedRiders({ entries, windowByRace, withdrawnKeys });
  const { live, historical } = splitLiveConflicts({ conflicts, raceById });
  const actionable = live.filter(
    (c) => (raceById.get(c.raceA)?.stages_completed ?? 0) === 0 || (raceById.get(c.raceB)?.stages_completed ?? 0) === 0
  );

  const describe = (c) => {
    const rider = ridersById.get(c.rider_id);
    const entryA = entryByKey.get(`${c.raceA}|${c.rider_id}`);
    const entryB = entryByKey.get(`${c.raceB}|${c.rider_id}`);
    return {
      rider_id: c.rider_id,
      rider_name: rider ? `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim() : null,
      team_id: c.team_id,
      race_a: { id: c.raceA, name: raceById.get(c.raceA)?.name ?? c.raceA, status: raceById.get(c.raceA)?.status ?? null, window: windowByRace.get(c.raceA), created_at: entryA?.created_at ?? null, is_auto_filled: entryA?.is_auto_filled ?? null },
      race_b: { id: c.raceB, name: raceById.get(c.raceB)?.name ?? c.raceB, status: raceById.get(c.raceB)?.status ?? null, window: windowByRace.get(c.raceB), created_at: entryB?.created_at ?? null, is_auto_filled: entryB?.is_auto_filled ?? null },
    };
  };

  return {
    seasonId: season.id,
    seasonNumber: season.number,
    entriesScanned: rawEntries.length,
    ghostExcluded: rawEntries.length - entries.length,
    pairs: {
      live: live.map(describe),
      historical: historical.map(describe),
      actionable: actionable.map(describe),
    },
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  let result;
  try {
    result = await findAllDoubleBookedPairs(supabase);
  } catch (err) {
    const message = formatSupabaseAuditError(
      "rider double-booking scan (#4700)", err,
      "Verify race_entries/race_stage_schedule/race_withdrawals/riders columns against database/schema-snapshot.json."
    );
    if (JSON_OUT) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(message);
    process.exit(1);
    return;
  }

  if (!result.seasonId) {
    if (JSON_OUT) console.log(JSON.stringify({ skipped: "no_active_season" }, null, 2));
    else console.log("Ingen aktiv sæson — intet at måle.");
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { live, historical, actionable } = result.pairs;
  console.log(`#4700 — rytter-dobbeltbookinger, sæson ${result.seasonNumber} (${result.seasonId})\n`);
  console.log(`  Entries scannet: ${result.entriesScanned} (${result.ghostExcluded} ghost-filtreret fra, #3185)`);
  console.log(`  Levende par: ${live.length}  ·  heraf actionable (kan stadig nås): ${actionable.length}  ·  historiske (begge løb afviklet): ${historical.length}\n`);

  if (!live.length) {
    console.log("OK — 0 levende par lige nu. (Bemærk: churn — se riderDoubleBookingWatch.js's egen");
    console.log("modul-kommentar om #3415-oscillationen. Et 0-øjebliksbillede er ikke et bevis for");
    console.log("at rod-årsagen er lukket — kør igen efter en sweep-cyklus eller ved næste Sentry-alarm.)");
  } else {
    for (const p of live) {
      const flag = actionable.includes(p) ? "ACTIONABLE" : "historical-blocked";
      console.log(`  [${flag}] ${p.rider_name || p.rider_id} (hold ${p.team_id})`);
      console.log(`      A: ${p.race_a.name} [${p.race_a.status}] window=${JSON.stringify(p.race_a.window)} auto=${p.race_a.is_auto_filled} created=${p.race_a.created_at}`);
      console.log(`      B: ${p.race_b.name} [${p.race_b.status}] window=${JSON.stringify(p.race_b.window)} auto=${p.race_b.is_auto_filled} created=${p.race_b.created_at}`);
    }
  }
  console.log("\nDenne script er READ-ONLY. Ingen --apply-tilstand findes — en evt. oprydning af");
  console.log("eksisterende par er ejer-gated og hører til i en separat, eksplicit godkendt handling.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("audit-4700-double-booked-riders.js")) {
  main();
}
