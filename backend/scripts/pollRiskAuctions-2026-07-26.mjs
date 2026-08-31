#!/usr/bin/env node
// ENGANGS (cutover 26/7, drejebog 5b): print antal aktive auktioner på 36+-ryttere.
import { createClient } from "@supabase/supabase-js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data, error } = await supabase.from("auctions").select("id, rider:rider_id(birthdate)").in("status", ["active", "extended"]);
if (error) { console.log("ERR"); process.exit(1); }
const n = (data || []).filter((a) => ageForSeason(a.rider?.birthdate, 2) >= 36).length;
console.log(String(n));
