// backend/lib/squadEntryGate.js
// #6489 · Trup-skift: én port i databasen.
//
// Porten selv er SQL: triggeren trg_cleanup_ineligible_future_entries på riders
// (database/2026-10-15-6489-squad-entry-gate.sql) sletter en rytters rækker i
// ikke-startede løb, så snart hans trup, hold, akademi- eller pensionsstatus gør
// ham uberettiget. Den dækker alle stier: JS, RPC'er og manuel SQL.
//
// Denne fil er JS-siden af samme regel og den daglige vagt:
//   - isEntryAllowed: reglen i JS. Ingen kopi: den ER riderEligibility.
//     isEligibleRider med løbets trup (raceSquadOf) og entry'ens hold. SQL-
//     funktionen squad_entry_allowed spejler den, og paritetstesten
//     (squadEntryGate.test.js) kører samme tilfælde mod begge.
//   - findSquadEntryViolations: ren tælling af rækker i ikke-startede løb som
//     reglen afviser. Efter triggeren skal tallet altid være 0.
//   - runSquadEntryGateWatch: daglig READ-ONLY vagt. Tæller, genlæser fund én gang
//     (et trup-skift midt i læsningen må ikke give en falsk alarm) og alarmerer i
//     Sentry ved > 0. Reparerer intet.

import { fetchAllRows, fetchAllRowsChunkedIn, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";
import { isEligibleRider, raceSquadOf } from "./riderEligibility.js";

/** Samme "ikke startet" som triggeren og squadEntryCleanup.offSquadOpenRaceIds. */
export function isOpenRace(race) {
  return race?.status === "scheduled" && (race.stages_completed ?? 0) === 0;
}

/**
 * Må `rider` stå på startlisten for `race` hos holdet `entryTeamId`?
 * @param {{rider: object|null|undefined, race: object|null|undefined, entryTeamId?: string|null}} args
 * @returns {boolean}
 */
export function isEntryAllowed({ rider, race, entryTeamId = null }) {
  return isEligibleRider(rider, { teamId: entryTeamId, squad: raceSquadOf(race) });
}

/**
 * Hvorfor afvises rækken? Kun til logning og opdeling i vagten.
 *   ghost     = rytteren findes ikke, er pensioneret eller står ikke på entry'ens hold
 *   off_squad = rytteren er på holdet, men i en anden trup end løbets
 * @returns {"ghost"|"off_squad"|null} null = tilladt
 */
export function violationKind({ rider, race, entryTeamId = null }) {
  if (isEntryAllowed({ rider, race, entryTeamId })) return null;
  if (!rider || rider.is_retired === true) return "ghost";
  if (entryTeamId != null && rider.team_id !== entryTeamId) return "ghost";
  return "off_squad";
}

/**
 * Ren kerne: rækker i ikke-startede løb som reglen afviser.
 * @param {{races?: object[], entries?: object[], riders?: object[]}} args
 * @returns {{checked: number, violations: Array<{race_id:string, team_id:string,
 *   rider_id:string, kind:"ghost"|"off_squad", race_squad:string, rider_squad:string|null}>}}
 */
export function findSquadEntryViolations({ races = [], entries = [], riders = [] }) {
  const raceById = new Map(races.filter(isOpenRace).map((r) => [r.id, r]));
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const violations = [];
  let checked = 0;
  for (const e of entries) {
    const race = raceById.get(e.race_id);
    if (!race) continue;
    checked += 1;
    const rider = riderById.get(e.rider_id);
    const kind = violationKind({ rider, race, entryTeamId: e.team_id });
    if (!kind) continue;
    violations.push({
      race_id: e.race_id, team_id: e.team_id, rider_id: e.rider_id, kind,
      race_squad: raceSquadOf(race), rider_squad: rider?.squad ?? null,
    });
  }
  return { checked, violations };
}

const RIDER_COLUMNS = "id, team_id, squad, is_academy, is_retired";
const RACE_COLUMNS = "id, squad, status, stages_completed";

async function fetchRidersByIds(supabase, riderIds) {
  return fetchAllRowsChunkedIn(riderIds, (ids) => supabase.from("riders")
    .select(RIDER_COLUMNS).in("id", ids).order("id"));
}

/** Aktiv sæsons ikke-startede løb + deres entries + de ryttere der står på dem. */
export async function fetchGateSnapshot(supabase) {
  const { data: season, error } = await supabase
    .from("seasons").select("id, number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!season) return { season: null, races: [], entries: [], riders: [] };

  const races = (await fetchAllRows(() => supabase.from("races")
    .select(RACE_COLUMNS)
    .eq("season_id", season.id).eq("status", "scheduled")
    .order("id"))).filter(isOpenRace);
  const entries = await fetchAllRowsChunkedIn(races.map((r) => r.id), (ids) => supabase
    .from("race_entries")
    .select("race_id, team_id, rider_id")
    .in("race_id", ids)
    .order("race_id").order("rider_id"));
  const riders = await fetchRidersByIds(supabase, [...new Set(entries.map((e) => e.rider_id))]);
  return { season, races, entries, riders };
}

/**
 * Genlæs fundene: rytter, løb og entry kan have ændret sig mellem læsningerne
 * (triggeren sletter rækken i samme transaktion som skiftet). Kun det der stadig
 * er forkert efter genlæsningen er et brud.
 */
export async function confirmViolations(supabase, violations) {
  if (!violations.length) return [];
  const riderIds = [...new Set(violations.map((v) => v.rider_id))];
  const raceIds = [...new Set(violations.map((v) => v.race_id))];
  const riders = await fetchRidersByIds(supabase, riderIds);
  const races = await fetchAllRowsChunkedIn(raceIds, (ids) => supabase.from("races")
    .select(RACE_COLUMNS).in("id", ids).order("id"));
  const entries = await fetchViolationEntries(supabase, violations, raceIds);
  return findSquadEntryViolations({ races, entries, riders }).violations;
}

/**
 * Genlæs entries for fundene med BEGGE id-dimensioner opdelt: race-id'erne i
 * chunks, og pr. race-chunk kun de ryttere der har fund i netop de løb, også i
 * chunks. Én .in() med alle race-id'er sprænger PostgREST-gatewayens request-line
 * ved et bredt brud (#6677-review). Hvert (løb, rytter)-par ligger i præcis én
 * race-chunk, så der kommer ingen dubletter.
 */
async function fetchViolationEntries(supabase, violations, raceIds) {
  const entries = [];
  for (let i = 0; i < raceIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const raceChunk = raceIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const inChunk = new Set(raceChunk);
    const chunkRiderIds = [...new Set(
      violations.filter((v) => inChunk.has(v.race_id)).map((v) => v.rider_id),
    )];
    entries.push(...await fetchAllRowsChunkedIn(chunkRiderIds, (ids) => supabase.from("race_entries")
      .select("race_id, team_id, rider_id")
      .in("rider_id", ids)
      .in("race_id", raceChunk)
      .order("race_id").order("rider_id")));
  }
  return entries;
}

const SAMPLE_LIMIT = 10;

/**
 * Daglig READ-ONLY vagt (#6489). Alarmerer i Sentry ved > 0 bekræftede brud.
 * @returns {Promise<{ran:boolean, checked:number, offSquad:number, ghosts:number, alerted:boolean}>}
 */
export async function runSquadEntryGateWatch({
  supabase,
  captureExceptionFn,
  fetchSnapshotFn = fetchGateSnapshot,
  confirmFn = confirmViolations,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const snap = await fetchSnapshotFn(supabase);
  if (!snap.season) return { ran: false, checked: 0, offSquad: 0, ghosts: 0, alerted: false };

  const first = findSquadEntryViolations(snap);
  const confirmed = first.violations.length ? await confirmFn(supabase, first.violations) : [];
  const offSquad = confirmed.filter((v) => v.kind === "off_squad").length;
  const ghosts = confirmed.filter((v) => v.kind === "ghost").length;
  const alerted = confirmed.length > 0;

  if (alerted) {
    captureExceptionFn?.(
      new Error(
        `Trup-port-brud: ${confirmed.length} startliste-række(r) i ikke-startede løb som rytteren ikke må køre ` +
        `(anden trup: ${offSquad}, ikke på holdet/pensioneret: ${ghosts}) (#6489)`
      ),
      {
        tags: { cron: "squad-entry-gate-watch" },
        fingerprint: ["squad-entry-gate-violation"],
        extra: {
          count: confirmed.length,
          offSquad,
          ghosts,
          sample: confirmed.slice(0, SAMPLE_LIMIT).map(
            (v) => `race=${v.race_id} team=${v.team_id} rider=${v.rider_id} ` +
              `(${v.kind}: ${v.rider_squad ?? "?"} i ${v.race_squad}-løb)`
          ),
        },
      }
    );
  }
  return { ran: true, checked: first.checked, offSquad, ghosts, alerted };
}
