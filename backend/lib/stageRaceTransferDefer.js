// backend/lib/stageRaceTransferDefer.js
// #1995: udskudt holdskifte når en rytter handles MIDT i et aktivt fleretape-løb.
//
// Problem: markedet er altid åbent (#1996), så en rytter kan sælges midt i et
// etapeløb. Etape 1-resultatet krediteres det gamle hold, men GC/senere etaper
// (importeret ved løbs-slut) ville tilfalde det nye hold → splittet attribution.
//
// Løsning (ejer 2026-06-29, option c): handel + betaling sker STRAKS (uændret),
// men hvis rytteren er i et AKTIVT fleretape-løb parkeres selve holdskiftet på
// riders.pending_team_id. Rytteren kører løbet færdigt for sælgeren; når løbet
// finaliseres flyttes team_id = pending_team_id. Hele det aktive løb krediteres
// dermed sælgeren, og først næste løb tilfalder køberen.
//
// "Aktivt fleretape-løb" = SAMME grænse som raceActiveGuard.isRaceLineupFrozen:
// race_type='stage_race' AND status != 'completed' AND stages_completed > 0.
// (status forbliver 'scheduled' hele afviklingen — kun stages_completed er en
// pålidelig "i gang"-markør; #1825/#1844/#2074.)

import { fetchAllRows } from "./supabasePagination.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";

const NOOP = () => {};

/**
 * Hvilke af `riderIds` er lige nu i et AKTIVT fleretape-løb?
 *
 * To-trins (samme robuste mønster som raceActiveGuard.detectInFlightRacesWithoutEntries):
 * find aktive stage races → find entries for dem blandt de givne ryttere. Undgår
 * PostgREST embedded-filter-usikkerhed.
 *
 * @param {object} supabase
 * @param {string[]} riderIds
 * @param {{ excludeRaceId?: string|null }} [opts] excludeRaceId: ignorér ét løb (flush-guard mod overlap)
 * @returns {Promise<string[]>} delmængden af riderIds der er i et aktivt stage race
 */
export async function getRidersInActiveStageRace(supabase, riderIds, { excludeRaceId = null } = {}) {
  const ids = [...new Set((riderIds || []).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id")
    .eq("race_type", "stage_race")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (rErr) throw new Error(`getRidersInActiveStageRace: races lookup failed: ${rErr.message}`);

  let raceIds = (races || []).map((r) => r.id);
  if (excludeRaceId) raceIds = raceIds.filter((id) => id !== excludeRaceId);
  if (raceIds.length === 0) return [];

  const { data: entries, error: eErr } = await supabase
    .from("race_entries")
    .select("rider_id")
    .in("race_id", raceIds)
    .in("rider_id", ids);
  if (eErr) throw new Error(`getRidersInActiveStageRace: entries lookup failed: ${eErr.message}`);

  return [...new Set((entries || []).map((e) => e.rider_id))];
}

/**
 * Skal et holdskifte for `riderIds` udskydes? (true hvis MINDST én er i et aktivt
 * fleretape-løb.) En handel er atomisk, så hvis én involveret rytter er låst,
 * parkeres hele handlen (begge ved swap).
 *
 * @param {object} supabase
 * @param {string[]} riderIds
 * @returns {Promise<boolean>}
 */
export async function shouldDeferTeamChange(supabase, riderIds) {
  const inActive = await getRidersInActiveStageRace(supabase, riderIds);
  return inActive.length > 0;
}

/**
 * Kaldes NÅR et løb er finaliseret (status='completed'). Flusher parkerede
 * holdskifter (rider.pending_team_id → team_id) for de af LØBETS deltagere der
 * ikke længere er i et andet aktivt fleretape-løb.
 *
 * Idempotent (TOCTOU-guard på pending_team_id) + pagineret (#879). Model: selve
 * handlen (offer/swap/auktion) blev allerede fuldført + notificeret ved
 * bekræftelsen — her flyttes KUN rytteren fysisk + en ankomst-besked sendes.
 *
 * @param {object} supabase
 * @param {{ id: string, race_type?: string, name?: string }} race det netop finaliserede løb
 * @param {{ notifyTeamOwner?: Function, now?: Date|null }} [deps]
 * @returns {Promise<{ ridersFlushed: number, riderIds: string[] }>}
 */
export async function flushDeferredTransfersForRace(supabase, race, { notifyTeamOwner = NOOP, now = null } = {}) {
  const empty = { ridersFlushed: 0, riderIds: [] };
  // Kun fleretape-løb kan have parkeret et skifte pga. sig selv (single races
  // importeres atomisk, så ingen handel kan ramme "midt i").
  if (!race || race.race_type !== "stage_race" || !race.id) return empty;
  const raceId = race.id;

  const entries = await fetchAllRows(() =>
    supabase.from("race_entries").select("rider_id").eq("race_id", raceId).order("rider_id")
  );
  const riderIds = [...new Set((entries || []).map((e) => e.rider_id))];
  if (riderIds.length === 0) return empty;

  const { data: parked, error: pErr } = await supabase
    .from("riders")
    .select("id, firstname, lastname, pending_team_id")
    .in("id", riderIds)
    .not("pending_team_id", "is", null);
  if (pErr) throw new Error(`flushDeferredTransfersForRace: parked riders lookup failed: ${pErr.message}`);
  if (!parked || parked.length === 0) return empty;

  // Overlap-guard: en rytter i FLERE aktive etapeløb flushes først når det SIDSTE
  // finaliseres (ellers ville han skifte hold midt i det andet løb).
  const stillActive = new Set(
    await getRidersInActiveStageRace(supabase, parked.map((r) => r.id), { excludeRaceId: raceId })
  );
  const toFlush = parked.filter((r) => !stillActive.has(r.id));
  if (toFlush.length === 0) return empty;

  const flushedAt = (now || new Date()).toISOString();
  const flushedIds = [];
  for (const rider of toFlush) {
    // Captur målholdet FØR update — rider-objektet kan være samme reference som
    // rækken der muteres (in-memory doubles), og notify skal bruge værdien bagefter.
    const targetTeamId = rider.pending_team_id;
    // TOCTOU/idempotency-guard: flush KUN hvis pending_team_id stadig peger hvor vi
    // læste. En genkørsel (recovery) finder pending_team_id=null → 0 rows → skip.
    const { data: moved, error: mErr } = await supabase
      .from("riders")
      .update({ team_id: targetTeamId, pending_team_id: null, acquired_at: flushedAt })
      .eq("id", rider.id)
      .eq("pending_team_id", targetTeamId)
      .select("id");
    if (mErr) throw new Error(`flushDeferredTransfersForRace: flush update failed (${rider.id}): ${mErr.message}`);
    if (!moved || moved.length === 0) continue;

    // Rytteren forlod sælgeren for fremtidige løb — ryd hans ghost-entries så de
    // ikke phantom-binder en plads (samme forsvar som transfer/auktion-stierne, #1906).
    await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "stage_race_deferred_flush" });

    const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
    await notifyTeamOwner(
      targetTeamId,
      "transfer_offer_accepted",
      "Rytteren er ankommet",
      `${riderName} er nu skiftet til dit hold — ${race.name || "hans etapeløb"} er kørt færdigt.`,
      rider.id,
      { riderId: rider.id }
    );
    flushedIds.push(rider.id);
  }

  return { ridersFlushed: flushedIds.length, riderIds: flushedIds };
}
