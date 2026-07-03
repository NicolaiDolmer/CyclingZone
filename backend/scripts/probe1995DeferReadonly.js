// #1995 READ-ONLY prod-probe: kør de faktiske defer-funktioner mod ægte data.
// Verificerer PostgREST-stierne (kolonner, to-trins lookup) — ingen mutationer.
// Kør: infisical run -- node scripts/probe1995DeferReadonly.js (eller med env sat)
import { createClient } from "@supabase/supabase-js";
import { getRidersInActiveStageRace, shouldDeferTeamChange } from "../lib/stageRaceTransferDefer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Missing SUPABASE_URL/SUPABASE_SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// 1) Find ét aktivt stage race + en deltager + en IKKE-deltager.
const { data: races, error } = await supabase.from("races")
  .select("id, name, stages_completed").eq("race_type", "stage_race").neq("status", "completed").gt("stages_completed", 0).limit(3);
if (error) throw error;
console.log(`Aktive stage races (sample): ${races.map(r => `${r.name} (etape ${r.stages_completed})`).join(" · ")}`);
if (!races.length) { console.log("Ingen aktive — probe kan ikke afgøre defer=true."); process.exit(0); }

const { data: entry } = await supabase.from("race_entries").select("rider_id").eq("race_id", races[0].id).limit(1).single();
const { data: outsider } = await supabase.from("riders").select("id").is("pending_team_id", null)
  .not("id", "in", `(${entry.rider_id})`).limit(1).single();

const locked = await getRidersInActiveStageRace(supabase, [entry.rider_id, outsider.id]);
const deferIn = await shouldDeferTeamChange(supabase, [entry.rider_id]);
const deferOut = await shouldDeferTeamChange(supabase, [outsider.id]);
console.log(`deltager ${entry.rider_id}: defer=${deferIn} (forventet true)`);
console.log(`outsider ${outsider.id}: defer=${deferOut} (forventet ${locked.includes(outsider.id)})`);
if (deferIn !== true) { console.error("FEJL: deltager i aktivt løb blev ikke deferred"); process.exit(1); }
console.log("✓ probe OK — defer-grænsen matcher live data (read-only)");
