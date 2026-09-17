// backend/lib/raceWithdrawal.js
// Race Hub Fase 0b: afmelding fra løb (frivillig deltagelse). Et (race_id, team_id)
// i race_withdrawals = holdet deltager ikke. Generator + afvikling respekterer det.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { loadTeamBindingContext, mapRiderBindingDetails } from "./raceBinding.js";

// withdrawTeam/reinstateTeam er FJERNET (#5301). De var doed kode: ruterne
// (POST/DELETE /races/:raceId/withdrawal) upserter og sletter selv inline, og
// funktionerne havde nul kaldere i hele repoet. reinstateTeam var desuden
// aktivt farlig efter #5301 - den slettede en afmelding UDEN
// findRejoinConflicts-guarden nedenfor, saa en fremtidig kaldevej kunne have
// genindfoert dobbeltbookingen guarden netop lukker. Praecis den fejlklasse
// ("endnu en kopi der glemmer reglen") var rod-aarsagen i #5301.
// Historik: docs/superpowers/plans/2026-06-23-race-hub-fase-0b-generator-afmeld.md

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

/**
 * #5301: kan holdet gen-deltage i `race` uden at dobbeltbooke en rytter?
 *
 * Afmeldingen NULLer de bevarede entries' binding_span (race_entries_binding_span
 * + trg_race_withdrawals_resync_binding), så holdet lovligt kan bruge de samme
 * ryttere i et OVERLAPPENDE løb imens. Fjernes afmeldingen, genberegner trigger'en
 * spanet på de bevarede entries (#4306) — og rammer så exclusion-constrainten med
 * en rå Postgres-fejl uden nogen forklaring til spilleren.
 *
 * Måles med PRÆCIS samme maskineri som PUT /selection's egen gate
 * (loadTeamBindingContext + mapRiderBindingDetails), så gen-deltag og gem aldrig
 * kan blive uenige om hvad der binder — #3410's postmortem: to separate
 * udledninger af samme tilstand driver fra hinanden.
 *
 * `race` skal bære id + season_id (loadTeamBindingContext's sæson-filter, #3070).
 * Returnerer [] når gen-deltag er sikkert, ellers én post pr. bunden rytter med
 * NAVNE — et antal ville være lige så ubrugeligt som den rå DB-fejl.
 *
 * Fejler ÅBENT (tomt array) når løbet ikke har et binding-vindue: det er samme
 * regel som PUT-gaten, og en guard der gætter ville blokere lovlige gen-deltag.
 */
export async function findRejoinConflicts({ supabase, race, teamId }) {
  if (!race?.id) return [];
  // pagination-safe: ÉT løb × ÉT hold — feltstørrelsen er hårdt loftet til size.max
  // (8, selectionSizeForRace), så rækketallet er tocifret, ikke nær 1000-cappet.
  const { data: kept, error: keptErr } = await supabase
    .from("race_entries").select("rider_id")
    .eq("race_id", race.id).eq("team_id", teamId);
  if (keptErr) throw new Error(`race_entries (rejoin): ${keptErr.message}`);
  if (!kept?.length) return [];

  const binding = await loadTeamBindingContext({ supabase, race, teamId });
  const details = mapRiderBindingDetails({
    riderIds: kept.map((e) => e.rider_id),
    thisWindow: binding.thisWindow,
    otherRaces: binding.otherRaces,
  });
  if (!details.size) return [];

  const conflictRaceIds = [...new Set(details.values())];
  const [{ data: conflictRaces }, { data: conflictRiders }] = await Promise.all([
    supabase.from("races").select("id, name").in("id", conflictRaceIds),
    // pagination-safe: details' nøgler er et undersæt af `kept` ovenfor (maks
    // feltstørrelsen) — én række pr. id, aldrig flere.
    supabase.from("riders").select("id, firstname, lastname").in("id", [...details.keys()]),
  ]);
  const raceNameById = new Map((conflictRaces || []).map((r) => [r.id, r.name]));
  const riderById = new Map((conflictRiders || []).map((r) => [r.id, r]));

  return [...details.entries()].map(([riderId, raceId]) => ({
    rider_id: riderId,
    rider_name: riderById.has(riderId)
      ? [riderById.get(riderId).firstname, riderById.get(riderId).lastname].filter(Boolean).join(" ") || null
      : null,
    bound_race_id: raceId,
    bound_race_name: raceNameById.get(raceId) ?? null,
  }));
}
