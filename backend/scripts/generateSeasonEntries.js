#!/usr/bin/env node
// #2361/#2742 · Manuel entry-generering for en sæson — cutover-drejebogens
// skridt efter transitionen (se docs/SEASON_TRANSITION_CHECKLIST.md).
//
// Hvorfor dette script findes: auto_calendar_enabled er OFF i prod, så
// transitionToNextSeason springer HELE season_calendar/season_entry_generator-
// blokken over. Den timelige sweep (cron, 60 min) fylder kun den AKTIVE sæson —
// dette script lukker vinduet deterministisk i stedet for at vente på et tick.
// POST /admin/seasons/:id/generate-entries gør det samme, men har ingen UI-knap.
//
// Generatoren (runRaceEntryGenerator) er idempotent + diff-baseret og rører
// ALDRIG manuelle entries (is_auto_filled=false) — se raceEntryGenerator.js.
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel.
//   railway run --service CyclingZone -- node scripts/generateSeasonEntries.js [--season=<uuid>] [--execute]
//
// Default --season = sæson 2 (00000000-0000-0000-0000-000000000002).

import { createClient } from "@supabase/supabase-js";
import { runRaceEntryGenerator } from "../lib/raceEntryGenerator.js";

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const SEASON = arg("season", "00000000-0000-0000-0000-000000000002");
const EXECUTE = !!arg("execute", false);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(url, key);

const { data: season } = await supabase
  .from("seasons").select("id, number, status").eq("id", SEASON).maybeSingle();
if (!season) {
  console.error(`❌ Sæson ${SEASON} findes ikke.`);
  process.exit(1);
}

console.log(`\n${"═".repeat(72)}`);
console.log(`ENTRY-GENERERING ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log(`${"═".repeat(72)}`);
console.log(`Sæson: #${season.number} (id ${season.id}, status='${season.status}')`);

const result = await runRaceEntryGenerator({ supabase, seasonId: SEASON, dryRun: !EXECUTE });

console.log(`\n  Løb i sæsonen:       ${result.races}`);
console.log(`  Hold behandlet:      ${result.teams}`);
console.log(`  Genereret (enheder): ${result.generated}   ·   skipped: ${result.skipped}`);
if (result.inserted !== undefined) {
  console.log(`  Rækker: +${result.inserted} indsat · -${result.removed} fjernet · ${result.role_updated} rolle-opdateret`);
}
if (result.failed_units) {
  console.log(`  ⚠️  ${result.failed_units} (løb, hold)-enheder fejlede:`);
  for (const e of (result.errors || []).slice(0, 10)) console.log(`     - ${e}`);
}

console.log(`\n${"═".repeat(72)}`);
console.log(EXECUTE ? "Entry-generering UDFØRT." : "Dry-run færdig — ingen writes. Tilføj --execute for rigtig kørsel.");
console.log("");
