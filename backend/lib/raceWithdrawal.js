// backend/lib/raceWithdrawal.js
// Race Hub Fase 0b: afmelding fra løb (frivillig deltagelse). Et (race_id, team_id)
// i race_withdrawals = holdet deltager ikke. Generator + afvikling respekterer det.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";

export async function withdrawTeam({ supabase, raceId, teamId, reason = null }) {
  const { error } = await supabase
    .from("race_withdrawals")
    .upsert({ race_id: raceId, team_id: teamId, withdrawn_reason: reason }, { onConflict: "race_id,team_id" });
  if (error) throw new Error(`race_withdrawals upsert: ${error.message}`);
}

export async function reinstateTeam({ supabase, raceId, teamId }) {
  const { error } = await supabase
    .from("race_withdrawals").delete().eq("race_id", raceId).eq("team_id", teamId);
  if (error) throw new Error(`race_withdrawals delete: ${error.message}`);
}

// Set af team_id der har trukket sig fra et løb.
export async function loadWithdrawnTeamIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_withdrawals").select("team_id").eq("race_id", raceId);
  if (error) throw new Error(`race_withdrawals select: ${error.message}`);
  return new Set((data || []).map((r) => r.team_id));
}

// #5301: nøglen til ÉN afmelding, delt af alle læseflader. race_entries bevares
// bevidst ved afmelding (#4306, så gen-deltag kan gendanne opstillingen), så
// "har holdet entries i løbet?" er IKKE det samme som "stiller holdet op".
// Enhver flade der udleder deltagelse af race_entries ALENE, lyver om et
// afmeldt hold — det var præcis rod-årsagen i #5301 (fire flader gjorde det).
export const withdrawalKey = (raceId, teamId) => `${raceId}|${teamId}`;

// Set af `${race_id}|${team_id}` for en liste løb (ALLE hold). Til flader der
// viser ANDRES startlister — divisions-oversigten, hvor ét fantom-hold vildleder
// hele puljen, ikke bare holdets egen ejer.
export async function loadWithdrawnPairs({ supabase, raceIds }) {
  const ids = [...new Set(raceIds || [])];
  if (!ids.length) return new Set();
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) =>
    supabase.from("race_withdrawals").select("race_id, team_id")
      // race_id alene er ikke en total orden (PK er race_id + team_id): uden den
      // sekundære nøgle kan rækker bytte plads mellem .range()-sider og falde helt
      // ud af resultatet (samme fejlklasse som #3126). En TABT afmelding her er
      // netop den fejl vi fikser, så pagineringen skal være deterministisk.
      .in("race_id", chunk).order("race_id").order("team_id"));
  return new Set(rows.map((r) => withdrawalKey(r.race_id, r.team_id)));
}

// Set af race_id som ÉT hold har trukket sig fra, scopet til en liste løb.
// `raceIds = null` → holdets afmeldinger i hele sæsonen (uscopet).
export async function loadWithdrawnRaceIdsForTeam({ supabase, teamId, raceIds = null }) {
  if (raceIds != null) {
    const ids = [...new Set(raceIds)];
    if (!ids.length) return new Set();
    const rows = await fetchAllRowsChunkedIn(ids, (chunk) =>
      supabase.from("race_withdrawals").select("race_id")
        .in("race_id", chunk).eq("team_id", teamId).order("race_id"));
    return new Set(rows.map((r) => r.race_id));
  }
  const rows = await fetchAllRows(() =>
    supabase.from("race_withdrawals").select("race_id").eq("team_id", teamId).order("race_id"));
  return new Set(rows.map((r) => r.race_id));
}
