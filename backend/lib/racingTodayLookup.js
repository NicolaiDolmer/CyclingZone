// #3459 V3 — PRE-hoc "har rytteren løbsdag I DAG" lookup til trænings-UI'ets badge
// (frontend TrainingPage.jsx). Adskilt fra dailyTrainingEngine.js's
// loadRacedRiderIdsToday, som er POST-hoc (race_results.imported_at, læses EFTER
// løbet er kørt af motoren selv). Denne lookup viser badge'et FØR løbet afvikles:
// race_entries (holdets startfelt) JOIN race_stage_schedule (dagens etaper,
// scheduled_at i dagens danske kalenderdøgn) JOIN races (navn).
//
// Kun kaldt af GET /api/training/me når race_day_engine_enabled er on (kald-stedet
// gater query'en helt — flag off = ingen ekstra DB-belastning, samme mønster som
// dailyTrainingEngine's raceDayEngineOn-gate). Fail-safe by construction: ALDRIG
// throw — enhver fejl giver {} (ingen badge for nogen rytter) i stedet for at
// vælte hele /api/training/me-responsen for én best-effort-berigelse.

import { copenhagenMidnightUTC } from "./copenhagenTime.js";

// Ren sammenkobling — INGEN I/O. Holdets (race_id, rider_id)-entries krydses mod
// mængden af race_id'er der har en etape planlagt i dag, og løbsnavnet slås op.
// 1-rytter-1-løb/dag-invarianten (låst, #3113) betyder normalt højst ét match pr.
// rytter; ved en uventet dobbelt-række vinder sidste skrivning (harmløst — rent
// display, ingen game-state røres).
export function computeRacingTodayByRider({ entryRows = [], todayRaceIds = [], raceNameById = new Map() } = {}) {
  const todaySet = new Set(todayRaceIds);
  const out = {};
  for (const entry of entryRows) {
    if (!todaySet.has(entry.race_id)) continue;
    out[entry.rider_id] = { race: raceNameById.get(entry.race_id) ?? null };
  }
  return out;
}

// I/O-wrapper: 2 uafhængige queries (holdets entries + dagens globale etape-vindue)
// batched i ét Promise.all, + én opfølgende races-select for KUN de ramte løb —
// ingen N+1. race_stage_schedule-queryen er ikke team-scoped (globalt "hvilke løb
// har en etape i dag"-vindue, tabellen har et indeks på scheduled_at), men
// afgrænset til ét kalenderdøgn ad gangen — samme størrelsesorden som andre
// dags-scopede sweeps i repoet.
export async function loadRacingTodayByRider(supabase, teamId, riderIds, now = new Date()) {
  if (!supabase?.from || !teamId || !riderIds?.length) return {};
  try {
    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [{ data: entryRows, error: entryErr }, { data: schedRows, error: schedErr }] = await Promise.all([
      // pagination-safe: .eq("team_id")+.in("rider_id", riderIds) bounds this to
      // ÉT holds egen rytter-trup (typisk < 30, langt under PostgREST's 1000-
      // rækkers-loft) — samme mønster som dailyTrainingEngine.js's day-scopede loads.
      supabase.from("race_entries").select("race_id, rider_id").eq("team_id", teamId).in("rider_id", riderIds),
      // pagination-safe: dags-scopet (ét Copenhagen-kalenderdøgn), IKKE hele
      // tabellen — bundet af hvor mange etaper der reelt er planlagt til at køre
      // I DAG på tværs af hele spillet (typisk højst nogle titaller, langt under
      // 1000). Samme størrelsesorden/filosofi som riderDoubleBookingWatch's og
      // dailyTrainingEngine's dags-vinduer; fail-safe by construction (se modul-
      // kommentaren) hvis antagelsen alligevel skulle vise sig forkert en dag.
      supabase.from("race_stage_schedule").select("race_id")
        .gte("scheduled_at", dayStart.toISOString())
        .lt("scheduled_at", dayEnd.toISOString()),
    ]);
    if (entryErr || schedErr) return {};

    const todayRaceIds = [...new Set((schedRows ?? []).map((r) => r.race_id))];
    if (!todayRaceIds.length) return {};
    const todaySet = new Set(todayRaceIds);

    const raceIdsNeeded = [...new Set((entryRows ?? []).filter((e) => todaySet.has(e.race_id)).map((e) => e.race_id))];
    if (!raceIdsNeeded.length) return {};

    const { data: raceRows, error: raceErr } = await supabase.from("races").select("id, name").in("id", raceIdsNeeded);
    if (raceErr) return {};

    const raceNameById = new Map((raceRows ?? []).map((r) => [r.id, r.name]));
    return computeRacingTodayByRider({ entryRows: entryRows ?? [], todayRaceIds, raceNameById });
  } catch {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele
    // /api/training/me-responsen pga. én best-effort-berigelse (samme fail-safe-
    // kontrakt som dailyTrainingEngine.js's loadRacedRiderIdsToday).
    return {};
  }
}
