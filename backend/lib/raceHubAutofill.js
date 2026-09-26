// backend/lib/raceHubAutofill.js
// #5789 (Sentry CYCLINGZONE-4P): Race Hubs "Auto-udfyld igen"
// (POST /api/races/distribution/regenerate) kunne booke en rytter i to løb samme
// løbsdag, og DB-invarianten no_rider_double_booking_day (#3420) afviste så skrivningen.
// To huller, begge lukket her:
//
// 1. SKRIVE-RÆKKEFØLGEN (prod-formen 22/9): endpointet skriver dagens løb ét ad gangen
//    (delete-så-insert pr. løb). To seniorløb i holdets pulje samme løbsdag er begge
//    targets. Flytter assistenten en rytter fra det løb der skrives SIDST til det der
//    skrives FØRST, står hans gamle række stadig i det sene løb, når det tidlige løbs
//    insert kører → afvist. Samme klasse som sweepens fallback (#5693/PR #5697), og
//    samme prædikat (findCrossUnitMoves): flyttede ryttere slippes i kilden FØR løkken.
//
// 2. LÅSNINGEN (S4 og frem): committede ryttere i løb der ikke regenereres låses via
//    lockedWindowsFromEntries, men vindue-mappet blev kun bygget for seniorløb (#5517),
//    mens entries kom fra alle løb. En entry i et U23-/juniorløb låste derfor ikke
//    rytterens løbsdag. Nu får ALLE holdets løb i sæsonen et binding-vindue, uanset trup
//    (samme ANY_SQUAD-princip som loadTeamBindingContext, #5645).
//    Et løb UDEN schedule-rækker får intet vindue og låser intet. Det er korrekt: DB-
//    invarianten (race_entry_days_rebuild) skriver heller ingen dag-rækker for et løb
//    uden game_day, så sådan en entry kan aldrig kollidere.

import { raceBindingWindow, isRiderDayInvariantViolation } from "./raceBinding.js";
import { findCrossUnitMoves } from "./raceEntryGenerator.js";
import { AUTO_FILL_SOURCES, writeRaceEntriesWithSource } from "./raceEntryAutoFillSource.js";
import { isRaceLineupFrozen } from "./raceActiveGuard.js";

const PAGE = 1000;

/**
 * Holdets race_entries i ÉN sæson, range-pagineret med stabil ORDER BY. Erstatter en
 * upagineret læsning af holdets entries på tværs af ALLE sæsoner: den kunne ramme
 * PostgRESTs tavse 1000-rækkers cap (og dermed tabe låse), og game_day er sæson-relativ
 * (#3070), så en anden sæsons entry må aldrig nå ind i låse-mappet.
 */
export async function loadTeamSeasonEntries({ supabase, teamId, seasonId }) {
  if (!teamId || !seasonId) return [];
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("race_entries")
      .select("race_id, rider_id, is_auto_filled, race_role, races!inner()")
      .eq("team_id", teamId)
      .eq("races.season_id", seasonId)
      .order("race_id", { ascending: true })
      .order("rider_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`race_entries (distribution/regenerate): ${error.message}`);
    for (const r of data || []) {
      rows.push({ race_id: r.race_id, rider_id: r.rider_id, is_auto_filled: r.is_auto_filled, race_role: r.race_role });
    }
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Løb med entries som endnu ikke har en nøgle i vindue-mappet (fx U23/junior). Ren. */
export function raceIdsMissingWindow({ entries = [], windowByRace }) {
  const missing = new Set();
  for (const e of entries) if (!windowByRace.has(e.race_id)) missing.add(e.race_id);
  return [...missing];
}

/**
 * Udvid binding-vindue-mappet med vinduer for de ekstra løbs schedule-rækker.
 * Eksisterende nøgler bevares uændret. Ren.
 */
export function withEntryRaceWindows({ windowByRace, scheduleRows = [] }) {
  const byRace = new Map();
  for (const s of scheduleRows) {
    if (windowByRace.has(s.race_id)) continue;
    if (!byRace.has(s.race_id)) byRace.set(s.race_id, []);
    byRace.get(s.race_id).push(s);
  }
  const merged = new Map(windowByRace);
  for (const [raceId, rows] of byRace) merged.set(raceId, raceBindingWindow(rows));
  return merged;
}

/**
 * Skriv regenererede trupper for dagens target-løb uden at en rytter der FLYTTES
 * mellem to af dem rammer rider-day-invarianten midt i skrivningen.
 *
 * Rækkefølge:
 *   1. Slip flyttede ryttere i deres kilde-løb (findCrossUnitMoves).
 *   2. Pr. løb: slet holdets rækker, indsæt de nye picks (uændret semantik).
 *   3. Fejler et løb: genskab de sluppede rækker hvis mål-løbet ikke landede OG
 *      kilde-løbet ikke selv nåede at blive skrevet om, så en rytter aldrig forsvinder
 *      fra begge løb pga. trin 1. Fejlen kastes derefter videre.
 *
 * @param {{ supabase, teamId: string, target: Array<object>, picksByRace: Record<string, Array<{rider_id, race_role}>>,
 *           existingEntries: Array<{race_id, rider_id, is_auto_filled, race_role}> }} args
 * @returns {Promise<{ regenerated: number, released: number }>}
 */
export async function writeRegeneratedLineups({ supabase, teamId, target = [], picksByRace = {}, existingEntries = [] }) {
  // Kun løb der faktisk skrives: frosne (#1825/#2074) og løb uden picks/kaptajn røres ikke.
  const planned = [];
  for (const race of target) {
    if (isRaceLineupFrozen(race)) continue;
    const picks = picksByRace[race.id] || [];
    const captainId = picks.find((p) => p.race_role === "captain")?.rider_id ?? picks[0]?.rider_id ?? null;
    if (!picks.length || !captainId) continue;
    planned.push({ race, picks });
  }
  if (!planned.length) return { regenerated: 0, released: 0 };

  const plannedIds = new Set(planned.map((p) => p.race.id));
  const existingByRace = new Map();
  for (const e of existingEntries) {
    if (!plannedIds.has(e.race_id)) continue;
    if (!existingByRace.has(e.race_id)) existingByRace.set(e.race_id, new Map());
    existingByRace.get(e.race_id).set(e.rider_id, e);
  }

  const { deleteRidersByRace, targetRaceByRider } = findCrossUnitMoves(planned.map(({ race, picks }) => {
    const existing = existingByRace.get(race.id) || new Map();
    const pickIds = new Set(picks.map((p) => p.rider_id));
    return {
      race_id: race.id,
      toDelete: [...existing.keys()].filter((rid) => !pickIds.has(rid)),
      toInsert: [...pickIds].filter((rid) => !existing.has(rid)),
    };
  }));

  const released = []; // { sourceRaceId, row, targetRaceId }
  const touched = new Set(); // løb hvis rækker er slettet i trin 2
  const written = new Set(); // løb hvis nye picks landede
  let regenerated = 0;
  try {
    for (const [sourceRaceId, riderIds] of deleteRidersByRace) {
      const { error: relErr } = await supabase.from("race_entries").delete()
        .eq("race_id", sourceRaceId).eq("team_id", teamId).in("rider_id", riderIds);
      if (relErr) throw new Error(`race_entries release (${sourceRaceId}): ${relErr.message}`);
      const existing = existingByRace.get(sourceRaceId) || new Map();
      for (const riderId of riderIds) {
        const row = existing.get(riderId);
        if (row) released.push({ sourceRaceId, row, targetRaceId: targetRaceByRider.get(riderId) });
      }
    }

    for (const { race, picks } of planned) {
      const rows = picks.map((p) => ({
        race_id: race.id, rider_id: p.rider_id, team_id: teamId, race_role: p.race_role, is_auto_filled: true,
        // #5246: Race Hubs udfyld er managerens egen handling, ikke assistentens late-fill.
        auto_filled_source: AUTO_FILL_SOURCES.MANAGER_AUTO,
      }));
      touched.add(race.id);
      // Surfacér delete/insert-fejl i stedet for tavst at efterlade et løb med 0 entries
      // (ægte atomicitet kræver en RPC; her gør vi i det mindste fejlen synlig + retry-bar).
      const { error: delErr } = await supabase.from("race_entries").delete().eq("race_id", race.id).eq("team_id", teamId);
      if (delErr) throw new Error(`race_entries delete (${race.id}): ${delErr.message}`);
      // #5246: tolerant hvis auto_filled_source-kolonnen ikke findes endnu (deploy-vinduet).
      const { error: insErr } = await writeRaceEntriesWithSource({ supabase, rows });
      if (insErr) {
        // #3420: DB-backstoppet er den sidste linje hvis laasningen alligevel overser en
        // konflikt; samme navngivne fejlkode som PUT /selection (#3098).
        if (isRiderDayInvariantViolation(insErr)) {
          const err = new Error(`race_entries insert (${race.id}): DB-invariant (#3420) afviste insert: ${insErr.message}`);
          err.code = "selection_rider_bound";
          throw err;
        }
        throw new Error(`race_entries insert (${race.id}): ${insErr.message}`);
      }
      written.add(race.id);
      regenerated++;
    }
  } catch (err) {
    await restoreReleased({ supabase, teamId, released, touched, written });
    throw err;
  }
  return { regenerated, released: released.length };
}

// Genskab sluppede rækker hvis mål-løbet ikke landede og kilde-løbet står urørt.
// Best-effort: en fejlet genskabelse logges højlydt, men den oprindelige fejl vinder.
async function restoreReleased({ supabase, teamId, released, touched, written }) {
  const rows = released
    .filter((r) => !written.has(r.targetRaceId) && !touched.has(r.sourceRaceId))
    .map(({ row }) => ({
      race_id: row.race_id, rider_id: row.rider_id, team_id: teamId,
      race_role: row.race_role ?? "helper", is_auto_filled: row.is_auto_filled !== false,
    }));
  if (!rows.length) return;
  try {
    const { error: restoreErr } = await writeRaceEntriesWithSource({
      supabase, rows, upsertOptions: { onConflict: "race_id,rider_id", ignoreDuplicates: true },
    });
    if (restoreErr) console.error(`race_entries restore (#5789, ${rows.length} rows): ${restoreErr.message}`);
  } catch (thrown) {
    console.error(`race_entries restore (#5789, ${rows.length} rows): ${thrown?.message || thrown}`);
  }
}
