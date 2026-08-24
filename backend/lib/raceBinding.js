// backend/lib/raceBinding.js
// Race-hub Fase 0a: rytter-binding. En rytter kan kun køre ÉT løb ad gangen.
// Et etapeløb binder fra første til sidste etape (hele tidsvinduet).

import { copenhagenDateString } from "./copenhagenTime.js";
import { loadEligibleEntries } from "./raceEntriesLoader.js";
import { selectInChunks } from "./dbChunk.js";

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

// Binding-nøgle pr. schedule-row i ÉT valgt nøgle-rum: in-game-dagen (game_day) når hele
// løbet er backfillet, ellers CET-kalenderdag-ordinalen af scheduled_at (legacy). `useGameDay`
// vælges ÉN gang pr. løb (se raceBindingWindow) — vi blander ALDRIG de to rum i samme løb.
// Rod-årsag for kalender-rebuilden (2026-06-27): binding MÅ nøgle på in-game-dagen, ikke på
// det IRL-tidspunkt simuleringen tilfældigvis kører — flere løb komprimeret til samme real-
// eftermiddag er forskellige in-game-dage, så en rytter må gerne køre flere af dem.
function bindingDayKey(row, useGameDay) {
  return useGameDay ? row.game_day : cetDayOrdinal(row?.scheduled_at);
}

// Binding-vindue: en rytter kan kun køre ét løb pr. IN-GAME løbsdag (#1823 + kalender-
// rebuild). Returnerer { start, end, days } i in-game-dag-nøgler (heltal). Et endagsløb
// optager én in-game-dag (start===end); et etapeløb sine FAKTISKE etape-dage.
//
// #4173: `days` (sorteret, unik array) er MÆNGDEN af løbsdage — to FORSKELLIGE løb
// konflikter iff de deler mindst én faktisk løbsdag (windowsOverlap skærer mængderne).
// Et spænd bandt også de dage et løb holdt pause (Tour des Émirats: 7 etaper på løbsdag
// 8-13 med én pause låste 7 andre løb). start/end BEVARES til display/sortering og som
// fallback for vinduer bygget uden days. Array (ikke Set) så vinduet kan serialiseres
// JSON-rent til frontenden (raceHubLogic.js spejler overlap-testen).
// Et løbs egne etaper binder aldrig mod hinanden (samme race_id). Tom/ugyldig → null.
//
// ÉT nøgle-rum pr. løb: game_day kun hvis ALLE rækker har den (ellers ville et delvist-
// backfillet løb blande relative game_day-værdier (fx 5) med absolutte CET-ordinaler (~20k)
// → Math.min/max blæser det op til et sæson-langt vindue → falsk binding).
export function raceBindingWindow(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const useGameDay = scheduleRows.every((row) => Number.isFinite(row?.game_day));
  const keys = scheduleRows
    .map((row) => bindingDayKey(row, useGameDay))
    .filter((o) => Number.isFinite(o));
  if (!keys.length) return null;
  const days = [...new Set(keys)].sort((a, b) => a - b);
  return { start: days[0], end: days[days.length - 1], days };
}

// Display-span for et løbs in-game løbsdage (#1984/#2195): { start, end } i game_day-heltal,
// afledt DIREKTE af schedule-rækkernes game_day. Adskilt fra raceBindingWindow (der falder til
// CET-ordinaler når game_day mangler) — dette er KUN til visning ("Race day N" / "Race days N–M")
// og returnerer null hvis nogen række mangler game_day, så UI'et kan skjule mærket frem for at vise
// skrald. Et endagsløb → start===end; et etapeløb → første..sidste in-game-dag.
//
// B2 (#4075, spec §3.4): monumenter har nu en NORMAL game_day (100000-sentinelen og hele
// det afledte monument-binding-apparat — isMonumentBandSchedule/buildCetToGameDaySpan/
// deriveMonumentBindingWindow/loadPoolLocalCetSpans — er fjernet). Et monument viser og
// binder sin egen løbsdag som ethvert andet endagsløb.
export function raceGameDaySpan(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const days = scheduleRows.map((r) => r?.game_day).filter((d) => Number.isFinite(d));
  if (days.length !== scheduleRows.length) return null; // en delvist-backfillet række → skjul mærket
  return { start: Math.min(...days), end: Math.max(...days) };
}

// #3420: race_entries.binding_span + no_rider_double_booking (EXCLUDE USING gist,
// database/2026-08-18-3420-race-entries-rider-day-invariant.sql) er DB-backstoppet
// mod "1 rytter = 1 løb pr. in-game-dag" — den sidste linje hvis en af de FIRE
// separate skriveres pre-flight-tjek alligevel skulle tage fejl (den klasse bugs
// #3420 findes for at gøre umulig, jf. #3113/#3119/#3122/5-8-Team-Fakta). Postgres
// afviser med SQLSTATE 23P01 (exclusion_violation); supabase-js/PostgREST sætter
// error.code til den rå Postgres-kode for et almindeligt insert/upsert (i modsætning
// til en RPC's egen RAISE EXCEPTION-besked, som replace_race_selection allerede
// oversætter til 'selection_rider_bound' INDE i SQL'en, se migrationen). Kaldere af
// et RÅT race_entries.insert/upsert (raceEntryGenerator.js, raceRunner.js,
// api.js's auto-select + regenerate) bruger dette til at give en navngiven fejl
// i stedet for en opak 500 (#3098-mønsteret).
// #4173: invarianten flyttede fra en EXCLUDE-constraint på race_entries.binding_span
// (SQLSTATE 23P01, exclusion_violation) til en UNIQUE på race_entry_days (SQLSTATE
// 23505, unique_violation) — et SPÆND bandt også de dage et løb holdt pause, og låste
// derfor ryttere på dage de ikke kørte. Begge koder accepteres: 23P01 fordi et miljø
// kan have den gamle constraint endnu, 23505 fordi det er den nye.
export function isRiderDayInvariantViolation(error) {
  if (!error) return false;
  const message = String(error.message || "");
  // 23505 dækker OGSÅ race_entries' egen PK (race_id, rider_id) og uq_race_entries_*-
  // rolleslottene (#2D) — kun binding-nøglen må tælle som et dag-brud, ellers ville et
  // helt almindeligt dublet-insert blive rapporteret som "rytteren er bundet".
  if (error.code === "23505") return message.includes("no_rider_double_booking");
  if (error.code === "23P01") return true;
  return message.includes("no_rider_double_booking");
}

// #4163: SÆRTILFÆLDE der skal fanges FØR isRiderDayInvariantViolation ovenfor.
// Batch-RPC'en apply_race_entry_unit_batch (#3934) starter med `set constraints
// no_rider_double_booking deferred`. Er constrainten IKKE deferrable, afviser
// Postgres med SQLSTATE 42809 og beskeden `constraint "no_rider_double_booking"
// is not deferrable` — en besked der INDEHOLDER constraint-navnet og derfor ellers
// læses som en ægte dobbeltbooking. Det er den stik modsatte diagnose: intet er
// dobbeltbooket, DB-skemaet er drevet fra det #3934 kræver (prod 24/8: #4155-
// reparationen genskabte constrainten uden `deferrable`, og sweepen faldt tavst
// tilbage i insert-før-delete-dødvandet, 140 fejlende enheder pr. tick).
export function isConstraintNotDeferrable(error) {
  if (!error) return false;
  if (error.code === "42809") return true;
  return /is not deferrable/i.test(String(error.message || ""));
}

// To vinduer overlapper hvis de deler mindst én FAKTISK løbsdag (#4173) — bærer begge
// sider en days-mængde, skæres den (et løb med pause binder IKKE pausedagene). Ellers
// spænd-fallback: deler mindst ét tidspunkt, inklusiv ender (vinduer bygget manuelt/
// legacy uden days, fx raceTimeWindow-display eller gamle payloads). Defensiv mod null.
export function windowsOverlap(a, b) {
  if (!a || !b) return false;
  if (Array.isArray(a.days) && Array.isArray(b.days)) {
    const bDays = new Set(b.days);
    return a.days.some((d) => bDays.has(d));
  }
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

// #2265: som findRiderBindingConflicts, men returnerer HVILKET løb der binder hver rytter,
// så UI'et kan sige "optaget i <løbsnavn>" i stedet for blot at afvise. Deterministisk:
// første overlappende løb i otherRaces-rækkefølgen vinder (én binding pr. rytter er nok
// til at gråne ham). otherRaces-elementer skal bære raceId (loadTeamBindingContext gør).
// Returnerer Map<rider_id, raceId>.
export function mapRiderBindingDetails({ riderIds = [], thisWindow, otherRaces = [] }) {
  const details = new Map();
  if (!thisWindow) return details;
  const wanted = new Set(riderIds);
  for (const other of otherRaces) {
    if (!windowsOverlap(thisWindow, other.window)) continue;
    for (const rid of other.riderIds || []) {
      if (wanted.has(rid) && !details.has(rid)) details.set(rid, other.raceId);
    }
  }
  return details;
}

// #2637: klassificér hver bundet rytter (fra findRiderBindingConflicts): kan konflikten
// LØSES automatisk, eller skal den afvises med en navngivet fejl?
//
// Root-cause: en rytter auto-udtaget til et endagsløb inden for et manuelt valgt
// etapeløbs vindue blokerede FØR ALTID gemningen ("selection_rider_bound"), selvom
// assistentens forslag aldrig burde vinde over et manuelt valg. Nu: er konflikten en
// AUTO-genereret entry i et løb der IKKE er startet endnu, kan den frigives automatisk
// (kalderen sletter kun DEN ene rytter fra det konfliktende løb, se PUT /selection).
// Er konflikten derimod en MANUEL entry, eller er det konfliktende løb allerede i gang,
// kan vi ikke gætte spillerens hensigt — den klassificeres som "blocking", og kalderen
// afviser med en navngivet 409 (rytter + løb) i stedet.
//
// Ren funktion — al DB-hentning ligger hos kalderen (loadTeamBindingContext +
// supplerende race/entry-opslag for de konkrete konflikt-løb).
//
// @param {{ boundRiderIds: string[], details: Map<string,string>, raceMetaById: Map<string,{name?:string, stages_completed?:number}>, autoFilledKeys: Set<string>, riderNameById?: Map<string,string> }} args
// @returns {{ resolvable: Array, blocking: Array }} — hvert element: { rider_id, rider_name, race_id, race_name }
export function classifyBindingConflicts({ boundRiderIds = [], details, raceMetaById, autoFilledKeys, riderNameById = new Map() }) {
  const resolvable = [];
  const blocking = [];
  for (const riderId of boundRiderIds) {
    const raceId = details.get(riderId) ?? null;
    const meta = raceId ? raceMetaById.get(raceId) : null;
    const item = {
      rider_id: riderId, rider_name: riderNameById.get(riderId) ?? null,
      race_id: raceId, race_name: meta?.name ?? null,
    };
    const isAutoFilled = raceId ? autoFilledKeys.has(`${raceId}|${riderId}`) : false;
    const raceAlreadyStarted = (meta?.stages_completed ?? 0) > 0;
    if (isAutoFilled && !raceAlreadyStarted) resolvable.push(item);
    else blocking.push(item);
  }
  return { resolvable, blocking };
}

// #3098: DB-tur der slår detaljer op for en allerede-fundet liste bundne rytter-ids
// (mapRiderBindingDetails → hvilket løb; races/race_entries → løbs-navn, om løbet er
// startet, om den konfliktende entry er auto-genereret) og klassificerer dem
// (classifyBindingConflicts). Fælles for PUT /selection's pre-flight-tjek OG dens
// RPC-fallback-catch (samme 409-payload {bound_rider_ids, conflicts} begge veje) —
// før denne udtræk levede opslaget kun i pre-flight-grenen, så RPC-fallbacken (der
// rammes ved et TOCTOU-tab under advisory-låsen, #2256) svarede med en tom fejl uden
// rytter/løb-navn, og UI'et faldt tilbage til den generiske (ikke-navngivne) copy —
// selvom races.json's "selection_rider_bound_named" allerede findes og bruges af den
// anden vej. Ren I/O-wrapper: klassifikationslogikken er stadig i classifyBindingConflicts.
export async function resolveBindingConflictDetails({ supabase, teamId, boundRiderIds, thisWindow, otherRaces, riders = [] }) {
  const details = mapRiderBindingDetails({ riderIds: boundRiderIds, thisWindow, otherRaces });
  const conflictRaceIds = [...new Set(details.values())];
  const [{ data: conflictRaces, error: crErr }, { data: conflictEntries, error: ceErr }] = await Promise.all([
    supabase.from("races").select("id, name, stages_completed").in("id", conflictRaceIds),
    // pagination-safe: bounded af conflictRaceIds × boundRiderIds (begge små in-lists, ≤ trupstørrelse)
    supabase.from("race_entries").select("race_id, rider_id, is_auto_filled")
      .eq("team_id", teamId).in("race_id", conflictRaceIds).in("rider_id", boundRiderIds),
  ]);
  if (crErr) throw new Error(`races (binding conflict details): ${crErr.message}`);
  if (ceErr) throw new Error(`race_entries (binding conflict details): ${ceErr.message}`);
  const raceMetaById = new Map((conflictRaces || []).map((r) => [r.id, r]));
  const autoFilledKeys = new Set(
    (conflictEntries || []).filter((e) => e.is_auto_filled).map((e) => `${e.race_id}|${e.rider_id}`)
  );
  const riderNameById = new Map(riders.map((r) => [r.id, r.name]));
  return classifyBindingConflicts({ boundRiderIds, details, raceMetaById, autoFilledKeys, riderNameById });
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
//
// #3070 rod-årsag: binding-nøglen (raceBindingWindow) er game_day, som er SÆSON-
// RELATIV og nulstilles hver sæson (S1 og S2 spænder begge game_day 0..~100000 i
// prod). Uden sæson-filter binder en forrige-sæson-entry på game_day 4 et løb i den
// nye sæson der overlapper samme dag-tal — 102/156 ægte hold blev blokeret af netop
// dette. `race.season_id` SKAL derfor være med i kalderens select (begge kaldere i
// api.js gør det). Vi filtrerer FØR raceBindingWindow bygges, så en anden sæsons
// entries aldrig når ind i otherRaces.
//
// B2 (#4075): monumenter har nu normal game_day og binder via raceBindingWindow som alle
// andre løb — det afledte pulje-lokale monument-vindue (#3114b) er fjernet.
export async function loadTeamBindingContext({ supabase, race, teamId }) {
  const { data: thisSched, error: e1 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at, game_day").eq("race_id", race.id);
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
  let otherRaceIds = [...ridersByRace.keys()];
  // Ingen andre committede løb → intet at binde imod.
  if (!otherRaceIds.length) return { thisWindow, otherRaces: [] };

  // Sæson-filter (#3070): et separat opslag mod races (ikke et embedded
  // race_entries.select("...,races!inner(season_id)")-filter) — vi har allerede
  // otherRaceIds fra entries-krydsningen ovenfor, og et separat, eksplicit opslag er
  // lettere at verificere mod den ægte PostgREST-kontrakt end at stole på embedded-
  // filter-semantik vi ikke har testet ende-til-ende her. Chunket (#3030/#3031-
  // mønster): et hold kan i teorien have entries i mange løb på tværs af sæsoner.
  const { data: otherRaceRows, error: e3Season } = await selectInChunks({
    supabase, table: "races", columns: "id, season_id", inColumn: "id", ids: otherRaceIds,
  });
  if (e3Season) throw new Error(`races season lookup (binding): ${e3Season.message}`);
  const seasonByRaceId = new Map((otherRaceRows || []).map((r) => [r.id, r.season_id]));
  otherRaceIds = otherRaceIds.filter((rid) => seasonByRaceId.get(rid) === race.season_id);
  if (!otherRaceIds.length) return { thisWindow, otherRaces: [] };

  const { data: scheds, error: e3 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at, game_day").in("race_id", otherRaceIds);
  if (e3) throw new Error(`race_stage_schedule (others): ${e3.message}`);

  const schedByRace = new Map();
  for (const s of scheds || []) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }

  const otherRaces = otherRaceIds
    .map((rid) => ({ raceId: rid, window: raceBindingWindow(schedByRace.get(rid)), riderIds: ridersByRace.get(rid) }))
    .filter((o) => o.window); // løb uden vindue kan ikke binde

  // Forward-guard (#3070): sæson-filtret ovenfor er den ENESTE ting der forhindrer
  // game_day-nøglerummet (sæson-relativt, nulstilles hver sæson) i at blande to
  // sæsoners løb igen. Assertion i stedet for en stille regression: hvis en fremtidig
  // ændring omgår filteret (fx en ny kaldevej der glemmer race.season_id), skal det
  // crashe højlydt her — som en tydelig 500 med rod-årsagen i beskeden — frem for at
  // gengive #3070 (102/156 hold blokeret) tavst i prod. Se også regressionstesten i
  // raceBinding.test.js ("entry fra en ANDEN sæson binder ikke").
  for (const o of otherRaces) {
    const s = seasonByRaceId.get(o.raceId);
    if (s !== race.season_id) {
      throw new Error(
        `loadTeamBindingContext: race ${o.raceId} season_id=${s} matcher ikke race.season_id=${race.season_id} — sæson-filter blev omgået (#3070)`
      );
    }
  }

  return { thisWindow, otherRaces };
}
