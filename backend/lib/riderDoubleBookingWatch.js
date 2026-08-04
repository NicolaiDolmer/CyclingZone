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
// GHOST-ENTRIES TÆLLER IKKE (#3185, forensik 3/8): en SOLGT rytters entry hos det gamle
// hold er ikke et brud. Divisionernes kalendere er forskudt i real-tid (D2 kørte game_day
// 0-7 27-30/7, D4 kørte game_day 4 først 31/7), så en rytter der kørte færdig hos sælger
// og derefter blev solgt til en anden pulje kan lovligt køre "samme" game_day igen dér —
// alle guards (PUT /selection, regenerate, sweep) filtrerer bevidst ghost-entries fra
// (#1906) og tillader det. Vagten læste rå race_entries og talte netop dét som brud:
// præcis de 3 "nye" par der fik CYCLINGZONE-44 til at vokse 4→7 (30/7-2/8). Vagten
// krydser nu mod rytterens NUVÆRENDE tilstand via filterEligibleEntries — samme predikat
// som guards. Trade-off (delt med guards): et ÆGTE historisk brud forsvinder fra
// tællingen hvis rytteren efterfølgende sælges/pensioneres.
//
// AFVIKLEDE LØB ALARMERER IKKE (ejer-valg 4/8): et par hvor BEGGE løb har status
// "completed" er dødt — resultaterne er kørt, og bruddet kan hverken nås før afvikling
// eller rettes med en entry-sletning. De 4 tilbageværende Brutaliste-par fra sæson-
// auditen 28/7 fyrede derfor CYCLINGZONE-44 hver time i en uge uden at nogen kunne
// handle på det, hvilket er præcis den støj der får en vagt til at blive ignoreret.
// Vagten TÆLLER dem stadig (returneres som `historical` + logges dagligt), men
// Sentry-alarmen kræver mindst ét LEVENDE par. Bevidst konservativt valg af signal:
// et etapeløb midt i afvikling står som "scheduled" med stages_completed > 0 (prod 4/8:
// 359 scheduled-løb, heraf nogle med 13 kørte etaper), så et nyt brud på et løb der er
// i gang alarmerer stadig — kun endeligt afsluttede løb er tavse.
//
// READ-ONLY: ingen writes, ingen ny tabel, ingen migration. Én Sentry-capture pr. tick med
// FAST fingerprint (mirror ownershipInvariantWatch #2647) — ét issue uanset antal fund.

import { fetchAllRows } from "./supabasePagination.js";
import { fetchAllPaged, IN_CHUNK_SIZE } from "./dbChunk.js";
import { raceBindingWindow, windowsOverlap } from "./raceBinding.js";
import { filterEligibleEntries } from "./riderEligibility.js";

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
 * Del konflikterne i LEVENDE (mindst ét løb ikke endeligt afviklet) og HISTORISKE
 * (begge løb status "completed"). Kun levende par må fyre Sentry-alarmen — se
 * modul-kommentaren. Pure + deterministisk; bevarer input-rækkefølgen.
 *
 * @param {{ conflicts?: Array<{raceA:string, raceB:string}>,
 *           raceById: Map<string,{status?:string}> }} args
 * @returns {{ live: Array<object>, historical: Array<object> }}
 */
export function splitLiveConflicts({ conflicts = [], raceById = new Map() } = {}) {
  const isFinished = (raceId) => raceById.get(raceId)?.status === "completed";
  const live = [];
  const historical = [];
  for (const c of conflicts) {
    if (isFinished(c.raceA) && isFinished(c.raceB)) historical.push(c);
    else live.push(c);
  }
  return { live, historical };
}

/**
 * Kør invariant-tjekket for den aktive sæson. INGEN writes.
 *
 * `historical` = par hvor BEGGE løb er endeligt afviklet (status "completed") — de
 * alarmerer ikke (ejer-valg 4/8), men tælles og logges.
 * `actionable` = levende par hvor mindst ét af de to løb endnu ikke er startet
 * (stages_completed === 0) — dem kan man stadig nå at rette uden at rulle resultater
 * tilbage. Resten kræver en ejer-gated datareparation.
 *
 * @param {{ supabase: object, captureExceptionFn?: (err:Error, ctx:object)=>void }} args
 * @returns {Promise<{skipped?:string, seasonId?:string, races:number, entries:number,
 *   conflicts:number, live:number, historical:number, actionable:number, alerted:boolean}>}
 */
export async function runRiderDoubleBookingWatch({ supabase, captureExceptionFn } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) {
    return {
      skipped: "no_active_season", races: 0, entries: 0,
      conflicts: 0, live: 0, historical: 0, actionable: 0, alerted: false,
    };
  }

  // `status` er med (#3119-opfølgning 4/8): kun endeligt afviklede løb (status
  // "completed") gør et par historisk og dermed tavst.
  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, stages_completed, status").eq("season_id", season.id).order("id"));
  const raceIds = races.map((r) => r.id);
  if (!raceIds.length) {
    return {
      seasonId: season.id, races: 0, entries: 0,
      conflicts: 0, live: 0, historical: 0, actionable: 0, alerted: false,
    };
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

  const { data: rawEntries, error: entryErr } = await selectInChunksPaged({
    supabase, table: "race_entries", columns: "race_id, team_id, rider_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "rider_id"],
  });
  if (entryErr) throw new Error(`race_entries: ${entryErr.message}`);

  // Ghost-filter (#3185): kryds mod rytterens NUVÆRENDE hold/tilstand, så en solgt/
  // pensioneret rytters gamle entries ikke tælles som brud — samme semantik som
  // guards (#1906). Se modul-kommentaren for prod-forensikken bag.
  const entryRiderIds = [...new Set((rawEntries || []).map((e) => e.rider_id))];
  let entries = rawEntries || [];
  if (entryRiderIds.length) {
    const { data: riderRows, error: riderErr } = await selectInChunksPaged({
      supabase, table: "riders", columns: "id, team_id, is_academy, is_retired",
      inColumn: "id", ids: entryRiderIds, orderBy: ["id"],
    });
    if (riderErr) throw new Error(`riders (ghost-kryds): ${riderErr.message}`);
    const ridersById = new Map((riderRows || []).map((r) => [r.id, r]));
    entries = filterEligibleEntries({ entries, ridersById });
  }

  const conflicts = findDoubleBookedRiders({ entries, windowByRace, withdrawnKeys });
  const { live, historical } = splitLiveConflicts({ conflicts, raceById });
  const actionable = live.filter(
    (c) => (raceById.get(c.raceA)?.stages_completed ?? 0) === 0 || (raceById.get(c.raceB)?.stages_completed ?? 0) === 0
  );

  let alerted = false;
  if (live.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Binding-invariant-brud: ${live.length} rytter-par i to overlappende løb i sæson ${season.number} ` +
        `(${actionable.length} kan stadig nås før afvikling) — 1 rytter = 1 løb pr. løbsdag (#3119/#3185)`
      ),
      {
        tags: { cron: "rider-double-booking-watch" },
        fingerprint: ["rider-double-booked-overlapping-races"],
        extra: {
          seasonId: season.id,
          count: live.length,
          actionable: actionable.length,
          // Historik-tælleren følger med i alarmen, så triage kan se om et gammelt,
          // ikke-reparerbart par stadig ligger i data (det alarmerer ikke selv).
          historical: historical.length,
          sample: (actionable.length ? actionable : live).slice(0, SAMPLE_LIMIT).map((c) => ({
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
    live: live.length,
    historical: historical.length,
    actionable: actionable.length,
    alerted,
  };
}
