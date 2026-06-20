// Backfill-script (WS1 Fase 3, Beslutning C-A): retrofit den live beta-sæson så
// stage-by-stage-scheduleren kan overtage afviklingen. Fordeler alle scheduled løb
// i den aktive sæson over kommende dage (ét løb/dag fra i morgen, sorteret på name
// for determinisme) og skriver:
//   - races.scheduled_for  = løbets startdag
//   - race_stage_schedule  = ét synligt CET-tidspunkt pr. etape
//
// Plan: docs/superpowers/plans/2026-06-20-ws1-fase3-stage-by-stage-race.md (Task 3.2).
//
// KØR ALDRIG mod prod uden ejer-godkendelse. --dry-run printer planen uden writes.
// Aktiveringssekvens (ejer/ops): dry-run → verificér → live → flip flag.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Faste danske etape-slots (CET/CEST wall-clock). Flere etaper end slots på samme
// dag ruller IKKE — vi kører i stedet én etape pr. dag (matcher ejer-direktivet
// "én etape ad gangen"); slot-listen styrer KUN klokkeslættet for dagens etape.
// Listen er bevidst > 1 så en fremtidig "flere etaper/dag"-variant kan genbruge den.
export const STAGE_SLOTS_CET = Object.freeze(["12:30", "15:00", "18:00", "21:00"]);

// Copenhagen-offset (minutter, +) for en given UTC-instant. Bruger Intl så DST
// håndteres korrekt uden tz-bibliotek.
function copenhagenOffsetMinutes(utcDate) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(utcDate).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - utcDate.getTime()) / 60000;
}

// Byg den UTC-instant der svarer til et Copenhagen wall-clock-tidspunkt (YYYY-MM-DD + HH:MM).
// To-trins DST-robust: gæt med fast offset, korrigér med den faktiske offset på gættet.
function copenhagenWallClockToUTC(dateStr, hhmm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset = copenhagenOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60000);
}

// Copenhagen-dato (YYYY-MM-DD) n hele dage efter en UTC-instant, ankret på lokal kalender.
function copenhagenDatePlusDays(fromUTC, days) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const base = fmt.format(fromUTC); // YYYY-MM-DD i dansk tid
  const [y, mo, d] = base.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  return fmt.format(shifted);
}

/**
 * REN planlægning (ingen DB). Fordeler løb ét pr. dag fra i morgen, sorteret på name.
 * Hver etape får et fast CET-slot, én etape pr. dag (etape k → startdag + k).
 *
 * @param {{ races: Array<{id,name,stages}>, from?: Date, slots?: string[] }} args
 * @returns {{ raceUpdates: Array<{id, scheduled_for}>, stageRows: Array<{race_id, stage_number, scheduled_at}> }}
 */
export function planRaceSchedules({ races = [], from = new Date(), slots = STAGE_SLOTS_CET }) {
  const sorted = [...races].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "en") || String(a.id).localeCompare(String(b.id)),
  );
  const raceUpdates = [];
  const stageRows = [];
  sorted.forEach((race, raceIdx) => {
    const startDay = copenhagenDatePlusDays(from, raceIdx + 1); // +1 = i morgen for første løb
    const stageCount = Math.max(1, Number(race.stages) || 1);
    // Startdagens slot = første slot; løbets scheduled_for = startdagens etape-1-tid.
    const firstStageAt = copenhagenWallClockToUTC(startDay, slots[0]);
    raceUpdates.push({ id: race.id, scheduled_for: firstStageAt.toISOString() });
    for (let s = 0; s < stageCount; s++) {
      const dayStr = copenhagenDatePlusDays(from, raceIdx + 1 + s); // én etape pr. dag
      const slot = slots[s % slots.length];
      stageRows.push({
        race_id: race.id,
        stage_number: s + 1,
        scheduled_at: copenhagenWallClockToUTC(dayStr, slot).toISOString(),
      });
    }
  });
  return { raceUpdates, stageRows };
}

// ── I/O: hent scheduled løb i aktiv sæson, skriv planen (eller dry-run) ────────

async function loadScheduledRaces(supabase) {
  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) throw new Error("ingen aktiv sæson — intet at backfille");

  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, name, stages, status")
    .eq("season_id", season.id)
    .eq("status", "scheduled")
    .order("name");
  if (rErr) throw new Error(`races: ${rErr.message}`);
  return { season, races: races || [] };
}

export async function runBackfill({ supabase, from = new Date(), dryRun = true, log = console.log }) {
  const { season, races } = await loadScheduledRaces(supabase);
  const { raceUpdates, stageRows } = planRaceSchedules({ races, from });

  log(`Sæson ${season.number}: ${races.length} scheduled løb → ${stageRows.length} etape-tider.`);
  for (const ru of raceUpdates) {
    const race = races.find((r) => r.id === ru.id);
    log(`  ${race?.name ?? ru.id}: start ${ru.scheduled_for}`);
  }

  if (dryRun) {
    log("DRY-RUN — ingen writes. Kør med --live for at anvende.");
    return { dryRun: true, races: raceUpdates.length, stages: stageRows.length, raceUpdates, stageRows };
  }

  for (const ru of raceUpdates) {
    const { error } = await supabase.from("races").update({ scheduled_for: ru.scheduled_for }).eq("id", ru.id);
    if (error) throw new Error(`races update ${ru.id}: ${error.message}`);
  }
  // Idempotent: ryd tidligere schedule-rækker for de berørte løb før insert.
  const raceIds = raceUpdates.map((r) => r.id);
  if (raceIds.length) {
    const { error: delErr } = await supabase.from("race_stage_schedule").delete().in("race_id", raceIds);
    if (delErr) throw new Error(`race_stage_schedule delete: ${delErr.message}`);
  }
  if (stageRows.length) {
    const { error: insErr } = await supabase.from("race_stage_schedule").insert(stageRows);
    if (insErr) throw new Error(`race_stage_schedule insert: ${insErr.message}`);
  }
  log(`LIVE — opdaterede ${raceUpdates.length} løb + ${stageRows.length} etape-tider.`);
  return { dryRun: false, races: raceUpdates.length, stages: stageRows.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("backfillRaceScheduledFor.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  runBackfill({ supabase, dryRun })
    .then((r) => { console.log("OK:", JSON.stringify(r.dryRun ? { dryRun: true, races: r.races, stages: r.stages } : r)); process.exit(0); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
