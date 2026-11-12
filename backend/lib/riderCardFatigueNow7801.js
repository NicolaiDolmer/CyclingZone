// #7801: rytterkortets træthed lige nu (hover-kortet, egne ryttere).
//
// Kortet læste rider_condition direkte fra klienten og viste derfor morgenens tal, også når
// Træningssiden viser trætheden lige nu. Med kontakten fatigue_now_7801 henter kortet tallet
// her, fra samme kerne som Træningssiden (fatigueByRiderNow, uden etape: tallet nu).
// Slukket: { enabled: false }, intet ud over kontakten læses, og kortet viser som før.

import { fatigueByRiderNow } from "./riderFatigueNow.js";
import { isFatigueNow7801Enabled } from "./riderFatigueNowFlag.js";

/**
 * @returns {Promise<{ enabled: false } | { enabled: true, own: boolean, fatigue: number|null }>}
 *   `own: false` = ikke holdets rytter; kortet viser ingen træthed for andres ryttere.
 */
export async function riderCardFatigueNow7801({ supabase, riderId, teamId, now = new Date() }) {
  if (!teamId || !riderId) return { enabled: false };
  if (!await isFatigueNow7801Enabled(supabase)) return { enabled: false };
  // pagination-safe: én rytter via primærnøglen.
  const { data: rider, error } = await supabase.from("riders").select("id, team_id").eq("id", riderId).maybeSingle();
  if (error) throw new Error(`riders (card fatigue now): ${error.message}`);
  if (!rider || String(rider.team_id) !== String(teamId)) return { enabled: true, own: false, fatigue: null };
  // pagination-safe: én rytter via primærnøglen.
  const { data: cond, error: condErr } = await supabase.from("rider_condition")
    .select("rider_id, form, fatigue").eq("rider_id", riderId).maybeSingle();
  if (condErr) throw new Error(`rider_condition (card fatigue now): ${condErr.message}`);
  if (!cond) return { enabled: true, own: true, fatigue: null };
  const live = await fatigueByRiderNow({ supabase, conditions: [cond], teamId, now });
  const fatigue = live.get(cond.rider_id);
  return { enabled: true, own: true, fatigue: Number.isFinite(Number(fatigue)) && fatigue !== null ? Number(fatigue) : null };
}
