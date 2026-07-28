// #3113 — daglig READ-ONLY invariant-vagt for den låste ejer-regel:
// **én rytter = ét løb pr. in-game løbsdag, i ALLE divisioner.**
//
// BAGGRUND: sæson-auditen 2026-07-28 fandt 6 ryttere på 2 ægte hold udtaget til to
// tidsoverlappende løb i S2 — 4 af dem NÅEDE at køre begge løb på game_day 0-1 og fik
// dobbelt point-/præmie-eksponering. Rod-årsagen lå i raceEntryGenerator (to læk, rettet
// i samme PR), men den blev først opdaget af en manuel audit tre dage efter. Denne vagt
// er safety-nettet: den REPARERER INTET, den alarmerer — uanset hvilken kodevej der
// måtte introducere bruddet næste gang (sweep, spiller-auto-fill, reschedule, import).
//
// Overlap MELLEM løb er by design (ejer-regel: divisioner kører overlappende kalendere).
// Det ulovlige er den SAMME rytter i to løb hvis in-game-dags-spans overlapper.
//
// Nøgle-rum: raceBindingWindow — in-game-dage (game_day) når hele løbet er backfillet,
// ellers CET-kalenderdag-ordinaler. Præcis samme funktion som save-guarden i
// PUT /selection bruger, så vagten og afvisningen aldrig kan være uenige.
//
// AFMELDTE (race,team) TÆLLER IKKE (Rod A, #1823): et afmeldt løb binder ikke rytteren,
// entries bevares kun så en gen-tilmelding giver samme trup. Uden det filter ville vagten
// larme falsk på hvert afmeldt hold.
//
// READ-ONLY: ingen writes, ingen ny tabel, ingen migration. Én Sentry-capture pr. tick med
// FAST fingerprint (mirror ownershipInvariantWatch #2647) — ét issue uanset antal fund.

import { fetchAllRows } from "./supabasePagination.js";
import { fetchAllPaged, IN_CHUNK_SIZE } from "./dbChunk.js";
import { raceBindingWindow, windowsOverlap } from "./raceBinding.js";

const SAMPLE_LIMIT = 25;

// Chunket .in() (URL-længde, #1307) KOMBINERET med range-paginering (PostgREST's 1000-
// rækkers cap trunkerer ellers TAVST — #2375/#1839). dbChunk.selectInChunks gør kun det
// første: med ~41k race_entries fordelt på 455 løb ville hver 200-løbs-chunk ryge over
// 1000 rækker, og vagten ville rapportere falsk "0 brud". Vi komponerer derfor de to
// eksisterende primitiver i stedet for at lægge en tredje kopi af logikken i repoet.
// `orderBy` SKAL være en unik nøgle — .range() uden stabil ORDER BY kan duplere/springe
// rækker over mellem sider.
async function selectInChunksPaged({ supabase, table, columns, inColumn, ids, orderBy }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await fetchAllPaged(() => {
      let q = supabase.from(table).select(columns).in(inColumn, chunk);
      for (const col of orderBy) q = q.order(col);
      return q;
    });
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

/**
 * Find alle (rytter, løb A, løb B)-par hvor de to løbs binding-vinduer overlapper.
 * Pure + deterministisk — al I/O ligger hos kalderen. Par rapporteres én gang, med det
 * kronologisk tidligste løb først, og sorteres stabilt så Sentry-samplet ikke flimrer.
 *
 * @param {{ entries: Array<{race_id, team_id, rider_id}>,
 *           windowByRace: Map<string,{start,end}>,
 *           withdrawnKeys?: Set<string> }} args  withdrawnKeys = "race_id|team_id"
 * @returns {Array<{rider_id, team_id, raceA, raceB}>}
 */
export function findDoubleBookedRiders({ entries = [], windowByRace, withdrawnKeys = new Set() }) {
  const byRider = new Map();
  for (const e of entries) {
    if (withdrawnKeys.has(`${e.race_id}|${e.team_id}`)) continue; // afmeldt → binder ikke (#1823)
    const window = windowByRace.get(e.race_id);
    if (!window) continue; // løb uden schedule kan ikke binde
    if (!byRider.has(e.rider_id)) byRider.set(e.rider_id, []);
    byRider.get(e.rider_id).push({ race_id: e.race_id, team_id: e.team_id, window });
  }

  const conflicts = [];
  for (const [riderId, races] of byRider) {
    if (races.length < 2) continue;
    races.sort((a, b) => a.window.start - b.window.start || String(a.race_id).localeCompare(String(b.race_id)));
    for (let i = 0; i < races.length; i++) {
      for (let j = i + 1; j < races.length; j++) {
        if (!windowsOverlap(races[i].window, races[j].window)) continue;
        conflicts.push({
          rider_id: riderId,
          team_id: races[i].team_id,
          raceA: races[i].race_id,
          raceB: races[j].race_id,
        });
      }
    }
  }
  conflicts.sort(
    (a, b) => String(a.rider_id).localeCompare(String(b.rider_id)) || String(a.raceA).localeCompare(String(b.raceA))
  );
  return conflicts;
}

/**
 * Kør invariant-tjekket for den aktive sæson. INGEN writes.
 *
 * `actionable` = par hvor mindst ét af de to løb endnu ikke er afviklet
 * (stages_completed === 0) — dem kan man stadig nå at rette uden at rulle resultater
 * tilbage. Resten er historik og kræver en ejer-gated datareparation.
 *
 * @param {{ supabase: object, captureExceptionFn?: (err:Error, ctx:object)=>void }} args
 * @returns {Promise<{skipped?:string, seasonId?:string, races:number, entries:number,
 *   conflicts:number, actionable:number, alerted:boolean}>}
 */
export async function runRiderDoubleBookingWatch({ supabase, captureExceptionFn } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) return { skipped: "no_active_season", races: 0, entries: 0, conflicts: 0, actionable: 0, alerted: false };

  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, stages_completed").eq("season_id", season.id).order("id"));
  const raceIds = races.map((r) => r.id);
  if (!raceIds.length) {
    return { seasonId: season.id, races: 0, entries: 0, conflicts: 0, actionable: 0, alerted: false };
  }
  const raceById = new Map(races.map((r) => [r.id, r]));

  // Binding-vinduer: game_day OG scheduled_at med, så raceBindingWindow selv vælger
  // nøgle-rummet (og aldrig blander de to inden for ét løb).
  const { data: schedRows, error: schedErr } = await selectInChunksPaged({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at, game_day",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "stage_number"],
  });
  if (schedErr) throw new Error(`race_stage_schedule: ${schedErr.message}`);
  const schedByRace = new Map();
  for (const row of schedRows || []) {
    if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
    schedByRace.get(row.race_id).push(row);
  }
  const windowByRace = new Map();
  for (const id of raceIds) {
    const w = raceBindingWindow(schedByRace.get(id));
    if (w) windowByRace.set(id, w);
  }

  const { data: wRows, error: wErr } = await selectInChunksPaged({
    supabase, table: "race_withdrawals", columns: "race_id, team_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "team_id"],
  });
  if (wErr) throw new Error(`race_withdrawals: ${wErr.message}`);
  const withdrawnKeys = new Set((wRows || []).map((w) => `${w.race_id}|${w.team_id}`));

  const { data: entries, error: entryErr } = await selectInChunksPaged({
    supabase, table: "race_entries", columns: "race_id, team_id, rider_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "rider_id"],
  });
  if (entryErr) throw new Error(`race_entries: ${entryErr.message}`);

  const conflicts = findDoubleBookedRiders({ entries: entries || [], windowByRace, withdrawnKeys });
  const actionable = conflicts.filter(
    (c) => (raceById.get(c.raceA)?.stages_completed ?? 0) === 0 || (raceById.get(c.raceB)?.stages_completed ?? 0) === 0
  );

  let alerted = false;
  if (conflicts.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Binding-invariant-brud: ${conflicts.length} rytter-par i to overlappende løb i sæson ${season.number} ` +
        `(${actionable.length} kan stadig nås før afvikling) — 1 rytter = 1 løb pr. løbsdag (#3113)`
      ),
      {
        tags: { cron: "rider-double-booking-watch" },
        fingerprint: ["rider-double-booked-overlapping-races"],
        extra: {
          seasonId: season.id,
          count: conflicts.length,
          actionable: actionable.length,
          sample: (actionable.length ? actionable : conflicts).slice(0, SAMPLE_LIMIT).map((c) => ({
            riderId: c.rider_id,
            teamId: c.team_id,
            raceA: raceById.get(c.raceA)?.name ?? c.raceA,
            raceB: raceById.get(c.raceB)?.name ?? c.raceB,
          })),
        },
      }
    );
  }

  return {
    seasonId: season.id,
    races: raceIds.length,
    entries: (entries || []).length,
    conflicts: conflicts.length,
    actionable: actionable.length,
    alerted,
  };
}
