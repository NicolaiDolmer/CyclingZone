// backend/lib/raceBinding.js
// Race-hub Fase 0a: rytter-binding. En rytter kan kun køre ÉT løb ad gangen.
// Et etapeløb binder fra første til sidste etape (hele tidsvinduet).

import { copenhagenDateString } from "./copenhagenTime.js";
import { loadEligibleEntries } from "./raceEntriesLoader.js";

const DAY_MS = 86_400_000;

// Et løbs tidsvindue = [tidligste etape-tid, seneste etape-tid] som epoch-ms.
// Tom/ugyldig schedule → null (løbet kan ikke binde noget).
// BEMÆRK: bruges KUN til DISPLAY (hvilke løb er kolonner på den valgte dag, sæson-
// tidslinje). Til BINDING/overlap — om to løb konflikter for en rytter — brug
// raceBindingWindow (dag-granulær), så samme-dag-løb regnes som overlappende (#1823).
export function raceTimeWindow(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const times = scheduleRows
    .map((r) => Date.parse(r.scheduled_at))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

// CET-dag-ordinal for ét scheduled_at: stabilt heltal pr. dansk kalenderdag.
// DST-robust — vi udleder den danske DATO (copenhagenDateString) og mapper den til
// et dag-nummer; den faktiske UTC-offset (CET vs CEST) er irrelevant. UTC-midnat for
// en dato er altid et multiplum af DAY_MS, så divisionen giver et eksakt heltal.
function cetDayOrdinal(scheduledAt) {
  const ms = Date.parse(scheduledAt);
  if (!Number.isFinite(ms)) return null;
  const dayStr = copenhagenDateString(new Date(ms)); // "YYYY-MM-DD" i dansk tid
  return Date.parse(`${dayStr}T00:00:00Z`) / DAY_MS;
}

// Binding-vindue (#1823): en rytter kan kun køre ét løb pr. CET-KALENDERDAG
// (design §2/§3 — "hver division kører typisk 2 løb samme dag … én rytter ét løb").
// Returnerer { start, end } i CET-dag-ordinaler (heltal). Et endagsløb optager hele
// sin danske dag (start===end); et etapeløb optager fra første til sidste etapes
// danske dag. To løb konflikter iff dag-spans overlapper (windowsOverlap er unit-
// agnostisk). Erstatter raceTimeWindow PRÆCIS hvor binding afgøres — instant-vinduer
// fik to samme-dag-løb til ikke at overlappe → dobbeltbooking. Tom/ugyldig → null.
export function raceBindingWindow(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const ordinals = scheduleRows
    .map((r) => cetDayOrdinal(r.scheduled_at))
    .filter((o) => Number.isFinite(o));
  if (!ordinals.length) return null;
  return { start: Math.min(...ordinals), end: Math.max(...ordinals) };
}

// To vinduer overlapper hvis de deler mindst ét tidspunkt (inklusiv ender —
// to løb der starter samtidig overlapper). Defensiv mod null.
export function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
}

// Givet det løb man udtager til (thisWindow) og holdets andre løb (otherRaces:
// [{ window, riderIds }]), returnér de rider_ids fra `riderIds` der allerede er
// bundet i et tidsoverlappende løb. Pure + deterministisk.
export function findRiderBindingConflicts({ riderIds = [], thisWindow, otherRaces = [] }) {
  if (!thisWindow) return [];
  const wanted = new Set(riderIds);
  const bound = new Set();
  for (const other of otherRaces) {
    if (!windowsOverlap(thisWindow, other.window)) continue;
    for (const rid of other.riderIds || []) {
      if (wanted.has(rid)) bound.add(rid);
    }
  }
  return [...bound];
}

// Efter en reschedule der introducerer overlap: find ryttere udtaget (manuelt) til to
// tidsoverlappende løb. Pure + deterministisk. Returnerer ét par pr. konflikt med det
// kronologisk TIDLIGSTE løb som "keep" og det senere som "drop" (resolve = fjern
// rytteren fra drop-løbet, så holdet ikke dobbeltbookes; det bliver blot underbemandet dér).
//
// @param {{ entries: Array<{race_id, rider_id}>, windowByRace: Map<race_id,{start,end}> }} args
// @returns {Array<{ rider_id, keepRaceId, dropRaceId }>}
export function findManualOverlapConflicts({ entries = [], windowByRace }) {
  const byRider = new Map();
  for (const e of entries) {
    const w = windowByRace.get(e.race_id);
    if (!w) continue; // løb uden vindue kan ikke binde
    if (!byRider.has(e.rider_id)) byRider.set(e.rider_id, []);
    byRider.get(e.rider_id).push({ race_id: e.race_id, window: w });
  }
  const conflicts = [];
  for (const [rider_id, races] of byRider) {
    races.sort((a, b) => a.window.start - b.window.start || String(a.race_id).localeCompare(String(b.race_id)));
    for (let i = 0; i < races.length; i++) {
      for (let j = i + 1; j < races.length; j++) {
        if (windowsOverlap(races[i].window, races[j].window)) {
          conflicts.push({ rider_id, keepRaceId: races[i].race_id, dropRaceId: races[j].race_id });
        }
      }
    }
  }
  return conflicts;
}

// Race-hub pulje-binding (#1798-opfølgning): et hold hører kun til feltet for et løb
// i sin EGEN pulje. racePoolId = race.league_division_id (null = løbet har ingen pulje
// → ingen restriktion; spejler autofill-pulje-filteret i raceRunner.js, der springes
// over når løbet er pulje-løst). Pure + deterministisk.
export function teamInRacePool({ teamDivisionId, racePoolId }) {
  if (racePoolId == null) return true;
  return teamDivisionId === racePoolId;
}

// DB-loader: hent det aktuelle løbs tidsvindue + holdets udtagne ryttere i ANDRE
// løb (grupperet pr. løb med deres tidsvindue), så findRiderBindingConflicts kan
// afgøre om en udtagelse dobbeltbooker en rytter. Tynd I/O — al logik er pure ovenfor.
export async function loadTeamBindingContext({ supabase, race, teamId }) {
  const { data: thisSched, error: e1 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at").eq("race_id", race.id);
  if (e1) throw new Error(`race_stage_schedule (this): ${e1.message}`);
  const thisWindow = raceBindingWindow(thisSched);

  // Rod A (#1823): holdets afmeldte løb binder IKKE — de udtagne ryttere er frie til
  // det overlappende løb. Entries bevares (gen-tilmelding giver samme trup), men de
  // tæller ikke som optaget tid. Tidligere låste afmeldte løb stadig rytterne.
  const { data: wRows, error: eW } = await supabase
    .from("race_withdrawals").select("race_id").eq("team_id", teamId);
  if (eW) throw new Error(`race_withdrawals (binding): ${eW.message}`);
  const withdrawn = new Set((wRows || []).map((w) => w.race_id));

  // Holdets entries i ANDRE løb end dette (afmeldte udeladt). #1906/#1823 rod-årsag:
  // kryds gennem den delte eligibility-loader, så en ghost/udlånt rytter (solgt/fyret/
  // akademi/pensioneret/udlånt EFTER udtagelse) IKKE phantom-binder en ægte rytter og
  // får PUT /selection til at afvise med 409 selection_rider_bound. team_id tages med så
  // loaderen kan krydse entry'ens hold mod rytterens nuværende hold.
  const { data: entries, error: e2 } = await loadEligibleEntries({
    supabase,
    baseQuery: () => supabase
      .from("race_entries").select("race_id, rider_id, team_id").eq("team_id", teamId).neq("race_id", race.id),
  });
  if (e2) throw new Error(`race_entries (binding): ${e2.message}`);

  const ridersByRace = new Map();
  for (const e of entries || []) {
    if (withdrawn.has(e.race_id)) continue;
    if (!ridersByRace.has(e.race_id)) ridersByRace.set(e.race_id, []);
    ridersByRace.get(e.race_id).push(e.rider_id);
  }
  const otherRaceIds = [...ridersByRace.keys()];
  if (!otherRaceIds.length) return { thisWindow, otherRaces: [] };

  const { data: scheds, error: e3 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", otherRaceIds);
  if (e3) throw new Error(`race_stage_schedule (others): ${e3.message}`);

  const schedByRace = new Map();
  for (const s of scheds || []) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }

  const otherRaces = otherRaceIds
    .map((rid) => ({ window: raceBindingWindow(schedByRace.get(rid)), riderIds: ridersByRace.get(rid) }))
    .filter((o) => o.window); // løb uden schedule kan ikke binde
  return { thisWindow, otherRaces };
}
