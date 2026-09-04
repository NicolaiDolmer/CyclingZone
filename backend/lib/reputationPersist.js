// #1099 spec §5: persistens for omdømme-systemet. Alt I/O bor her — motoren
// (`reputationEngine.js`) er ren, og hverken hook, backfill eller harness
// skriver selv mod Supabase.
//
// To operationer, i denne rækkefølge:
//   1. `persistReputationEvents` — skriv hændelsesbogen. Idempotent via
//      `dedupe_key` UNIQUE: en gen-finalisering af samme etape må ALDRIG
//      dublere point.
//   2. `refreshRiderReputations` — genberegn de ramte rytteres tal FRA HELE
//      hændelsesbogen (ikke som et delta oven på den gamle værdi). Et delta
//      ville gøre enhver dedupe, backfill eller sæson-halvering til en kilde
//      til drift; en fuld genberegning pr. ramt rytter koster ét bounded
//      opslag og kan aldrig komme ud af sync med bogen.
//
// Idempotens-detalje: bulk-insertet forsøges FØRST i ét kald (den normale sti:
// ingen af rækkerne findes). Rammer det 23505 (mindst én række fandtes
// allerede — gen-finalisering), falder vi tilbage til række-for-række, hvor
// 23505 tælles som "allerede registreret" i stedet for at være en fejl. Uden
// fallback ville ÉN allerede-kendt hændelse blokere alle de nye i samme batch.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { computeReputation } from "./reputationEngine.js";
import { SEED_FLOOR_WEIGHT } from "./reputationConstants.js";

export const REPUTATION_EVENTS_TABLE = "rider_reputation_events";
const UNIQUE_VIOLATION = "23505";
// Supabase/PostgREST-inserts skal holdes under request-størrelsesgrænsen; en
// grand tour-finalisering kan producere nogle hundrede hændelser, en backfill
// titusinder. 500 rækker pr. kald er langt under grænsen og holder antallet af
// rundture nede.
export const EVENT_INSERT_CHUNK_SIZE = 500;

const EVENT_COLUMNS = "rider_id, race_id, stage_number, season_id, event_kind, race_class, form_points, floor_credit, dedupe_key";

function eventRow(event) {
  return {
    rider_id: event.rider_id,
    team_id: event.team_id ?? null,
    race_id: event.race_id,
    stage_number: event.stage_number,
    season_id: event.season_id ?? null,
    event_kind: event.event_kind,
    race_class: event.race_class ?? null,
    form_points: event.form_points ?? 0,
    floor_credit: event.floor_credit ?? 0,
    occurred_at: event.occurred_at ?? null,
    dedupe_key: event.dedupe_key,
  };
}

async function insertChunk({ supabase, chunk }) {
  const stats = { inserted: 0, deduped: 0 };
  const { error } = await supabase.from(REPUTATION_EVENTS_TABLE).insert(chunk);
  if (!error) {
    stats.inserted += chunk.length;
    return stats;
  }
  if (error.code !== UNIQUE_VIOLATION) throw error;

  // Mindst én række fandtes allerede — skriv resten enkeltvis.
  for (const row of chunk) {
    const { error: rowError } = await supabase.from(REPUTATION_EVENTS_TABLE).insert(row);
    if (!rowError) {
      stats.inserted += 1;
    } else if (rowError.code === UNIQUE_VIOLATION) {
      stats.deduped += 1;
    } else {
      throw rowError;
    }
  }
  return stats;
}

/**
 * Skriv hændelser til bogen. Idempotent pr. dedupe_key.
 *
 * @returns {Promise<{inserted:number, deduped:number}>}
 */
export async function persistReputationEvents({ supabase, events = [] }) {
  const stats = { inserted: 0, deduped: 0 };
  if (!supabase?.from || !events.length) return stats;

  // Dubletter INDEN FOR samme kald ville ellers udløse fallback-stien for hele
  // chunken; motoren afviser dem allerede pr. etape, men en backfill samler
  // mange løb i én batch.
  const seen = new Set();
  const rows = [];
  for (const event of events) {
    if (!event?.dedupe_key || seen.has(event.dedupe_key)) continue;
    seen.add(event.dedupe_key);
    rows.push(eventRow(event));
  }

  for (let i = 0; i < rows.length; i += EVENT_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + EVENT_INSERT_CHUNK_SIZE);
    const chunkStats = await insertChunk({ supabase, chunk });
    stats.inserted += chunkStats.inserted;
    stats.deduped += chunkStats.deduped;
  }
  return stats;
}

/**
 * season_id (uuid) → seasons.number. Hændelsesbogen bærer sæson-ID'et (§5),
 * mens halveringen regner i sæson-NUMRE. Tabellen er ganske få rækker.
 */
export async function loadSeasonNumberById(supabase) {
  const rows = await fetchAllRows(() => supabase
    .from("seasons").select("id, number").order("id", { ascending: true }));
  return new Map(rows.map((s) => [s.id, Number(s.number)]));
}

async function loadEventsForRiders({ supabase, riderIds }) {
  if (!riderIds.length) return [];
  return fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from(REPUTATION_EVENTS_TABLE)
    .select(EVENT_COLUMNS)
    .in("rider_id", chunk)
    .order("id", { ascending: true }));
}

/**
 * Genberegn + skriv `riders.reputation/_floor/_form/_updated_at` for de ramte
 * ryttere, ud fra HELE deres hændelsesbog.
 *
 * @param {object} args
 * @param {Array<string>} args.riderIds
 * @param {number} args.currentSeasonIndex   seasons.number for den AKTIVE sæson
 * @param {Map<string, number>} [args.seasonNumberById]
 * @returns {Promise<{updated:number, skipped:number}>}
 */
export async function refreshRiderReputations({
  supabase,
  riderIds = [],
  currentSeasonIndex,
  seasonNumberById = null,
  now = new Date(),
  options = { seedFloorWeight: SEED_FLOOR_WEIGHT },
}) {
  const stats = { updated: 0, skipped: 0 };
  const uniqueIds = [...new Set(riderIds.filter(Boolean))];
  if (!supabase?.from || !uniqueIds.length) return stats;

  const seasonMap = seasonNumberById ?? await loadSeasonNumberById(supabase);
  const seasonIndex = Number.isFinite(Number(currentSeasonIndex))
    ? Number(currentSeasonIndex)
    : Math.max(0, ...seasonMap.values());

  const riders = await fetchAllRowsChunkedIn(uniqueIds, (chunk) => supabase
    .from("riders").select("id, popularity").in("id", chunk).order("id", { ascending: true }));
  const popularityById = new Map(riders.map((r) => [r.id, Number(r.popularity) || 0]));

  const events = await loadEventsForRiders({ supabase, riderIds: uniqueIds });
  const eventsByRider = new Map();
  for (const event of events) {
    if (!eventsByRider.has(event.rider_id)) eventsByRider.set(event.rider_id, []);
    eventsByRider.get(event.rider_id).push(event);
  }

  const updatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const seasonIndexOf = (event) => seasonMap.get(event?.season_id) ?? seasonIndex;

  for (const riderId of uniqueIds) {
    if (!popularityById.has(riderId)) {
      // Rytteren findes ikke længere (slettet mellem afvikling og genberegning).
      stats.skipped += 1;
      continue;
    }
    const { floor, form, reputation } = computeReputation({
      seedPopularity: popularityById.get(riderId),
      events: eventsByRider.get(riderId) ?? [],
      currentSeasonIndex: seasonIndex,
      seasonIndexOf,
      options,
    });
    const { error } = await supabase.from("riders").update({
      reputation,
      reputation_floor: floor,
      reputation_form: form,
      reputation_updated_at: updatedAt,
    }).eq("id", riderId);
    if (error) throw error;
    stats.updated += 1;
  }

  return stats;
}
