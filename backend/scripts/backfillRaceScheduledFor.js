// Backfill-script (WS1 Fase 3, Beslutning C-A): retrofit den live beta-sæson så
// stage-by-stage-scheduleren kan overtage afviklingen. Pakker alle scheduled løbs
// etaper tæt over kommende dage (STAGES_PER_DAY etaper/dag fra i morgen, sorteret på
// name for determinisme) og skriver:
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

// Faste danske etape-slots (CET/CEST wall-clock), ét slot pr. etape-position på dagen.
// Slot-index = spor-nummer. 09:00 ligger SIDST (= spor 4, kun brugt ved 5/dag) for at
// bevare bagudkompatibilitet: spor 0-3 = 12:30/15:00/18:00/21:00, så eksisterende
// 2-spors-kalendre er uændrede. Kronologisk på dagen: 09:00 < 12:30 < ... < 21:00.
export const STAGE_SLOTS_CET = Object.freeze(["12:30", "15:00", "18:00", "21:00", "09:00"]);

// Afviklings-cadence: antal etaper der afvikles pr. dag på tværs af en pulje-kalender.
// Etaperne pakkes TÆT (STAGES_PER_DAY/dag, intet dag-spild mellem løb), så en sæson
// afvikles i ~total-etaper / STAGES_PER_DAY dage. Launch (60-etape-kalender): 2 → ~30
// dage ≈ 4-ugers sæson, op fra den dødt-langsomme 1-pr-dag-mod-globalt-cap-5 (som med
// 7 live puljer gav ~0,7 etape/dag/pulje). Den fulde 140-etaper/5-per-dag-vision er
// post-launch (kræver race_days_total-rekalibrering af board/økonomi/progression).
export const STAGES_PER_DAY = 2;

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

// Greedy-balanceret tildeling af én løbs-pulje på et SAMMENHÆNGENDE bånd af spor
// [trackOffset .. trackOffset+trackCount-1]. Hvert spor planlægges sekventielt,
// 1 etape/dag, på sit faste dag-slot (spor t → slots[t]). Løb lægges i sporet med
// færrest kumulative dage (tie → laveste absolut spor-index → determinisme), så
// sporene afsluttes omtrent samtidig. `trackDays` indekseres med ABSOLUT spor-index
// og deles mellem flere bånd, så et endagsløb-bånd ikke kolliderer med etape-båndet.
// Muterer raceUpdates/stageRows/trackDays in-place. Pure mht. input-løb.
function assignTracksGreedy({ races, from, slots, trackOffset, trackCount, trackDays, raceUpdates, stageRows }) {
  for (const race of races) {
    const stageCount = Math.max(1, Number(race.stages) || 1);
    // Vælg sporet (inden for båndet) med færrest kumulative dage; tie → laveste index.
    let t = trackOffset;
    for (let i = trackOffset + 1; i < trackOffset + trackCount; i++) {
      if (trackDays[i] < trackDays[t]) t = i;
    }
    const startDayIdx = trackDays[t];
    const slot = slots[t % slots.length];

    raceUpdates.push({
      id: race.id,
      scheduled_for: copenhagenWallClockToUTC(copenhagenDatePlusDays(from, startDayIdx + 1), slot).toISOString(),
    });
    for (let s = 0; s < stageCount; s++) {
      const dayIdx = startDayIdx + s;
      stageRows.push({
        race_id: race.id,
        stage_number: s + 1,
        scheduled_at: copenhagenWallClockToUTC(copenhagenDatePlusDays(from, dayIdx + 1), slot).toISOString(),
      });
    }
    trackDays[t] += stageCount;
  }
}

/**
 * REN planlægning (ingen DB). Fordeler løbene på `tracks` parallelle spor og planlægger
 * hvert spor sekventielt, 1 etape/dag, på sit eget faste dag-slot (spor t → slots[t]).
 * To løb i forskellige spor på samme dag overlapper i tid → bindingen (Fase 0a) aktiveres.
 * Løb fordeles greedy-balanceret på kumulativ etape-sum, så sporene afsluttes omtrent
 * samtidig. Total throughput = tracks etaper/dag/pulje (uændret: tracks default = STAGES_PER_DAY).
 *
 * Deterministisk: løb sorteres på name→id; greedy-tie brydes mod laveste spor-index.
 * `tracks=1` giver én sekventiel stream (1 etape/dag). `raceUpdates` returneres altid i
 * name-sorteret løbsrækkefølge uanset spor-tildeling; `stageRows` følger samme
 * løbsrækkefølge, etape 1→N inden for hvert løb.
 *
 * KAPACITETS-BEVIDST (#1856): `stageRaceTracks` (default null = uændret blandet adfærd).
 * Når sat (fx 2) tildeles TYPE-BEVIDST: etapeløb (stages>1) lægges KUN på de forreste
 * `stageRaceTracks` spor (slots[0..stageRaceTracks-1]) → garanterer højst stageRaceTracks
 * SAMTIDIGE etapeløb pr. division; endagsløb (stages===1) lægges på de resterende spor
 * (slots[stageRaceTracks..tracks-1]). Begge bånd ankres fra samme `from` (dag 1) → kører
 * parallelt, op til `tracks` etaper/dag. Kræver `stageRaceTracks < tracks` (mindst ét
 * endagsløb-spor). Determinisme bevaret; dry-run == apply.
 *
 * @param {{ races: Array<{id,name,stages}>, from?: Date, slots?: string[], tracks?: number, stageRaceTracks?: number|null }} args
 * @returns {{ raceUpdates: Array<{id, scheduled_for}>, stageRows: Array<{race_id, stage_number, scheduled_at}> }}
 */
export function planRaceSchedules({ races = [], from = new Date(), slots = STAGE_SLOTS_CET, tracks = STAGES_PER_DAY, stageRaceTracks = null }) {
  const sorted = [...races].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "en") || String(a.id).localeCompare(String(b.id)),
  );
  // Un-clamp (#1856/#1712): tidligere clampede vi tracks til slots.length, hvilket
  // gav stille slot-wraparound (spor 4 → slot[0]) og duplikat-tider der brød
  // race-binding. Kræv eksplicit nok slots i stedet.
  const requestedTracks = Math.max(1, Number(tracks) || 1);
  if (requestedTracks > slots.length) {
    throw new Error(
      `planRaceSchedules: tracks=${requestedTracks} > slots=${slots.length} — tilføj flere STAGE_SLOTS_CET`,
    );
  }
  const trackCount = requestedTracks;
  const trackDays = new Array(trackCount).fill(0); // næste ledige dag-index (0-baseret) pr. spor

  const raceUpdates = [];
  const stageRows = [];

  if (stageRaceTracks == null) {
    // DEFAULT: alle løb blandet på alle `tracks` spor (uændret adfærd).
    assignTracksGreedy({
      races: sorted, from, slots, trackOffset: 0, trackCount,
      trackDays, raceUpdates, stageRows,
    });
    return { raceUpdates, stageRows };
  }

  // TYPE-BEVIDST: separate spor-bånd for etapeløb vs endagsløb.
  const stageTracks = Math.max(1, Number(stageRaceTracks) || 1);
  if (stageTracks >= trackCount) {
    throw new Error(
      `planRaceSchedules: stageRaceTracks=${stageTracks} skal være < tracks=${trackCount} (mindst ét endagsløb-spor)`,
    );
  }
  const stageRaces = sorted.filter((r) => Math.max(1, Number(r.stages) || 1) > 1);
  const oneDayRaces = sorted.filter((r) => Math.max(1, Number(r.stages) || 1) === 1);

  // Etapeløb → forreste `stageTracks` spor (slots[0..stageTracks-1]). Greedy-balanceret,
  // sekventielt → højst stageTracks samtidige etapeløb. Endagsløb → resterende spor.
  assignTracksGreedy({
    races: stageRaces, from, slots, trackOffset: 0, trackCount: stageTracks,
    trackDays, raceUpdates, stageRows,
  });
  assignTracksGreedy({
    races: oneDayRaces, from, slots, trackOffset: stageTracks, trackCount: trackCount - stageTracks,
    trackDays, raceUpdates, stageRows,
  });

  // Bevar name-sorteret output-rækkefølge (uafhængigt af type-opdelingen ovenfor).
  const order = new Map(sorted.map((r, i) => [r.id, i]));
  raceUpdates.sort((a, b) => order.get(a.id) - order.get(b.id));
  stageRows.sort((a, b) => order.get(a.race_id) - order.get(b.race_id) || a.stage_number - b.stage_number);

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
