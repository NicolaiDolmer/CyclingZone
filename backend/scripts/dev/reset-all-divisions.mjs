// backend/scripts/dev/reset-all-divisions.mjs
//
// FULD ALL-DIVISION KALENDER-REBUILD (ejer-valgt 2026-06-27) — sætter HELE sæson 1 på den
// nye game_day-baserede, dato-synkrone model, så mandags-tændingen ikke genoptager en
// strukturelt forkert kalender (Div 1/2 kører i dag den gamle per-pulje-kalender uden game_day).
//
// GØR (kun ved --apply):
//   1. af-linker ALLE løb-refererende finance-txns (kun 'prize', 100% AI) → race_id=null,
//      så løb kan slettes UDEN at røre balancer. Ægte-hold-præmie er allerede 0 (D3-reset),
//      og ingen aktive ægte managers er uden for Division 3 → nul spiller-penge berøres.
//   2. sletter ALLE sæson-løb (alle divisioner). FK CASCADE rydder
//      results/entries/schedule/profiler/sim-runs/withdrawals; season_standings.race_id = SET NULL.
//   3. nulstiller rytter-træthed (fresh sæson) + re-ankrer bestyrelse (satisfaction → sæson-start,
//      budget_modifier → 1.0).
//   4. re-materialiserer ALLE live tiers (1,2,3) med ÉN delt kalender pr. tier, materialiseret
//      identisk i hver pulje. Tier 4 er tom (ingen ægte managers) → poolHasCalendar=false → skippes.
//      Dato-synkron: samme `from` for alle tiers (resolveCalendarFrom → default næste mandag).
//   5. genberegner standings + rytter-værdier + race-days (globalt, idempotent).
//
// BEHOLDER: ryttere, alle indkøb/transfers, ALLE balancer (af-link rører ikke penge),
//   D3's 6 reset-lån. Dato-fix indbygget: dag-0 = fremtidig (guarden i resolveCalendarFrom
//   umuliggør blitz-fejlklassen — jf. .claude/learnings/2026-06-27-d3-reset-blitz.md).
//
// EJER-VALG (default = mindst risikabelt): præmie AF-LINKES (balancer urørt). Alternativ =
//   REVERSÉR AI-præmien for en ren restart (verificeret sikkert: 0 AI-hold i minus, alle ≥ 500k)
//   — skift kun efter eksplicit ejer-go; ikke implementeret som default her.
//
// Brug:  node backend/scripts/dev/reset-all-divisions.mjs                         (dry-run, intet skrives)
//        node backend/scripts/dev/reset-all-divisions.mjs --first-day=2026-06-29  (vælg dag-0; default næste mandag)
//        node backend/scripts/dev/reset-all-divisions.mjs --apply                 (udfører — KUN efter ejer-go + live-review)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { updateStandings, updateRiderValues } from "../../lib/economyEngine.js";
import { recomputeSeasonRaceDays } from "../../lib/seasonRaceDays.js";
import { resolveCalendarFrom, nextMonday } from "../../lib/calendarStartDate.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");
const FIRST_DAY = (process.argv.find((a) => a.startsWith("--first-day=")) || "").split("=")[1] || undefined;
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("da-DK");
const BATCH = 500;

// Range-pagineret select (PostgREST 1000-rk-cap; jf. reference_postgrest_1000_row_cap_in_scripts).
async function pageAll(makeQuery) {
  const rows = [];
  for (let lo = 0; ; lo += 1000) {
    const { data, error } = await makeQuery(lo, lo + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: season, error: sErr } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (sErr || !season) throw new Error(`aktiv sæson ikke fundet: ${sErr?.message}`);

  // Dag-0-anker: en FREMTIDIG første løbsdag (default næste mandag), aldrig sæson-start.
  const firstRaceDay = FIRST_DAY || nextMonday();
  const from = resolveCalendarFrom({ firstRaceDate: firstRaceDay });

  // Alle løb for sæsonen (alle divisioner).
  const races = await pageAll((a, b) => supabase.from("races").select("id, league_division_id").eq("season_id", season.id).range(a, b));
  const raceIds = races.map((r) => r.id);
  const byDiv = new Map();
  for (const r of races) byDiv.set(r.league_division_id, (byDiv.get(r.league_division_id) || 0) + 1);

  // Præmie-txns der refererer løbene (eneste blokerende FK mod sletning) + CASCADE-rapport.
  const prizeTx = [];
  let resultsCount = 0;
  let entriesCount = 0;
  for (let i = 0; i < raceIds.length; i += 300) {
    const chunk = raceIds.slice(i, i + 300);
    prizeTx.push(...await pageAll((a, b) => supabase.from("finance_transactions").select("id, amount").eq("type", "prize").in("race_id", chunk).range(a, b)));
    const { count: rc } = await supabase.from("race_results").select("race_id", { count: "exact", head: true }).in("race_id", chunk);
    const { count: ec } = await supabase.from("race_entries").select("race_id", { count: "exact", head: true }).in("race_id", chunk);
    resultsCount += rc || 0;
    entriesCount += ec || 0;
  }
  const prizeTotal = prizeTx.reduce((s, t) => s + Number(t.amount || 0), 0);

  // Ny kalender-plan (dry-run, alle live tiers; tier 4 tom → skippes af poolHasCalendar).
  const plan = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date, from, tiers: null, dryRun: true,
  });

  console.log(`\n=== Fuld all-division kalender-rebuild — sæson ${season.number} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Første løbsdag (dag 0): ${firstRaceDay}${FIRST_DAY ? "" : " (default: næste mandag)"} · alle divisioner dato-synkrone, 28-dages span`);
  console.log(`\nNuværende løb at slette:`);
  for (const [div, n] of [...byDiv.entries()].sort((a, b) => a[0] - b[0])) console.log(`   pulje ${div}: ${n} løb`);
  console.log(`   I ALT: ${raceIds.length} løb · ${fmt(resultsCount)} resultater + ${fmt(entriesCount)} entries ryddes (CASCADE)`);
  console.log(`\nPræmie-txns at af-linke (race_id=null, BALANCER URØRT): ${prizeTx.length} stk · ${fmt(prizeTotal)} (100% AI — ægte hold = 0)`);
  console.log(`\nNy kalender (delt pr. tier, identisk i hver live pulje):`);
  for (const t of plan.tiers) {
    const perPool = t.pools[0]?.selected ?? 0;
    const dropped = (t.unplacedStages || 0) + (t.unplacedSingles || 0);
    const droppedNote = dropped > 0 ? ` · ⚠ ${dropped} valgt men IKKE pakket (28-dages-cap: ${t.unplacedStages} etape/${t.unplacedSingles} endags)` : "";
    console.log(`   tier ${t.tier}: ${t.pools.length} pulje(r) × ${perPool} løb · tomme dage: ${t.emptyDays} · katalog-beskåret: ${t.truncatedStages}/${t.truncatedSingles}${droppedNote}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — intet skrevet. Kør med --apply EFTER ejer-go + live-review.`);
    return;
  }

  console.log(`\n--- APPLY ---`);
  // 1. Af-link alle løb-refererende præmie-txns (balancer urørt; muliggør sletning af løb).
  const prizeIds = prizeTx.map((t) => t.id);
  for (let i = 0; i < prizeIds.length; i += BATCH) {
    const { error } = await supabase.from("finance_transactions").update({ race_id: null }).in("id", prizeIds.slice(i, i + BATCH));
    if (error) throw new Error(`af-link prize: ${error.message}`);
  }
  // 2. Slet ALLE sæson-løb (CASCADE rydder results/entries/schedule/profiler/sim-runs/withdrawals).
  const { error: delErr } = await supabase.from("races").delete().eq("season_id", season.id);
  if (delErr) throw new Error(`slet løb: ${delErr.message}`);
  // 3. Nulstil rytter-træthed (fresh sæson).
  const riderIds = (await pageAll((a, b) => supabase.from("riders").select("id").range(a, b))).map((r) => r.id);
  for (let i = 0; i < riderIds.length; i += BATCH) {
    const { error } = await supabase.from("rider_condition").update({ fatigue: 0 }).in("rider_id", riderIds.slice(i, i + BATCH));
    if (error) throw new Error(`nulstil træthed: ${error.message}`);
  }
  // 4. Re-ankr bestyrelse for sæsonen (satisfaction → sæson-start-anker, budget_modifier → 1.0).
  const boards = await pageAll((a, b) => supabase.from("board_profiles").select("id, season_start_satisfaction").eq("season_id", season.id).range(a, b));
  for (const bp of boards) {
    await supabase.from("board_profiles").update({ satisfaction: bp.season_start_satisfaction ?? 50, budget_modifier: 1.0 }).eq("id", bp.id);
  }
  // 5. Materialisér alle tier-kalendre (dato-synkrone, fra `from`).
  const applied = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date, from, tiers: null, dryRun: false, log: (m) => console.log(m),
  });
  // 6. Genberegn standings + rytter-værdier + race-days (globalt, idempotent).
  await updateStandings(season.id);
  await updateRiderValues(supabase);
  await recomputeSeasonRaceDays({ supabase, seasonId: season.id });

  console.log(`\nFÆRDIG: nye løb ${applied.racesInserted}, etape-tider ${applied.stageSchedules}, profiler ${applied.stageProfiles}, træthed nulstillet (${riderIds.length} ryttere).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
