// Engangs-genberegning efter D3-blitz-oprydning (2026-06-27): stillinger + rytter-værdier
// + race-days afspejler nu de slettede blitz-resultater. Read-after-write, ingen sletning.
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { updateStandings, updateRiderValues } from "../../lib/economyEngine.js";
import { recomputeSeasonRaceDays } from "../../lib/seasonRaceDays.js";
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data: season } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
await updateStandings(season.id);
await updateRiderValues(supabase);
await recomputeSeasonRaceDays({ supabase, seasonId: season.id });
console.log("recompute done (sæson " + season.number + ")");
