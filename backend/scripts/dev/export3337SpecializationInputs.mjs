#!/usr/bin/env node
// READ-ONLY eksport til måling af issue #3337 (betaler specialisering sig?).
// Ingen mutationer — kun SELECT. Skriver én JSON til scratchpad.
//
//   cd backend && node scripts/dev/export3337SpecializationInputs.mjs --out=<sti>

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { writeFileSync } from "node:fs";

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const OUT = arg("out", "./3337-inputs.json");
const SEASON = "00000000-0000-0000-0000-000000000002";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const ABIL = [
  "climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone",
  "acceleration", "recovery", "tactics", "positioning", "flat", "tempo",
  "durability", "descending", "aggression",
];

async function main() {
  // 1. Divisions
  const { data: divs, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index");
  if (dErr) throw dErr;
  const tierById = new Map(divs.map((d) => [d.id, d.tier]));
  const poolById = new Map(divs.map((d) => [d.id, d.pool_index]));

  // 2. Etapeløb i sæson 2
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, name, race_type, stages, status, stages_completed, league_division_id, race_class, pool_race_id")
    .eq("season_id", SEASON);
  if (rErr) throw rErr;

  const stageRaces = races
    .map((r) => ({ ...r, tier: tierById.get(r.league_division_id) ?? null, pool: poolById.get(r.league_division_id) ?? null }));

  // 3. Stage-profiler for alle etapeløb
  const raceIds = stageRaces.map((r) => r.id);
  const profiles = [];
  for (let i = 0; i < raceIds.length; i += 40) {
    const chunk = raceIds.slice(i, i + 40);
    const { data, error } = await supabase
      .from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors")
      .in("race_id", chunk);
    if (error) throw error;
    profiles.push(...data);
  }

  // 4. Entries (felter)
  const entries = [];
  for (let i = 0; i < raceIds.length; i += 20) {
    const chunk = raceIds.slice(i, i + 20);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("race_entries")
        .select("race_id, rider_id, team_id, race_role")
        .in("race_id", chunk)
        .range(from, from + 999);
      if (error) throw error;
      entries.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  // 5. Abilities for alle ryttere i felterne
  const riderIds = [...new Set(entries.map((e) => e.rider_id))];
  const abilities = [];
  for (let i = 0; i < riderIds.length; i += 200) {
    const chunk = riderIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("rider_derived_abilities")
      .select(["rider_id", ...ABIL].join(","))
      .in("rider_id", chunk);
    if (error) throw error;
    abilities.push(...data);
  }

  // 6. Race points-tabel (til point/præmier)
  const { data: racePoints, error: pErr } = await supabase
    .from("race_points")
    .select("*");
  if (pErr) throw pErr;

  // 7. rider_condition (form/fatigue) — nuværende værdier
  const condition = [];
  for (let i = 0; i < riderIds.length; i += 200) {
    const chunk = riderIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("rider_condition")
      .select("rider_id, form, fatigue")
      .in("rider_id", chunk);
    if (error) throw error;
    condition.push(...data);
  }

  // 8. riders: markedsværdi + typer + alder/potentiale (til pris-siden af analysen)
  const riders = [];
  for (let i = 0; i < riderIds.length; i += 200) {
    const chunk = riderIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("riders")
      .select("id, market_value, base_value, primary_type, secondary_type, valuation_type, birthdate, potentiale, team_id, is_academy")
      .in("id", chunk);
    if (error) throw error;
    riders.push(...data);
  }

  const out = { season: SEASON, exported_at: new Date().toISOString(), races: stageRaces, profiles, entries, abilities, racePoints, condition, riders };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(JSON.stringify({
    races: stageRaces.length, profiles: profiles.length, entries: entries.length,
    riders: riderIds.length, abilities: abilities.length, racePoints: racePoints.length,
    condition: condition.length, ridersRows: riders.length, out: OUT,
  }, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
