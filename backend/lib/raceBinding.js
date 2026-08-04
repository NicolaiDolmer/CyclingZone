// backend/lib/raceBinding.js
// Race-hub Fase 0a: rytter-binding. En rytter kan kun køre ÉT løb ad gangen.
// Et etapeløb binder fra første til sidste etape (hele tidsvinduet).

import { copenhagenDateString } from "./copenhagenTime.js";
import { loadEligibleEntries } from "./raceEntriesLoader.js";
import { selectInChunks } from "./dbChunk.js";
import { MONUMENT_GAMEDAY_BASE } from "./raceCalendarLanePacker.js";

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
// rebuild). Returnerer { start, end } i in-game-dag-nøgler (heltal). Et endagsløb optager
// én in-game-dag (start===end); et etapeløb fra første til sidste etapes in-game-dag. To
// FORSKELLIGE løb konflikter iff in-game-dag-spans overlapper (windowsOverlap er unit-
// agnostisk). Et løbs egne etaper binder aldrig mod hinanden (samme race_id). Tom/ugyldig → null.
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
  return { start: Math.min(...keys), end: Math.max(...keys) };
}

// Display-span for et løbs in-game løbsdage (#1984/#2195): { start, end } i game_day-heltal,
// afledt DIREKTE af schedule-rækkernes game_day. Adskilt fra raceBindingWindow (der falder til
// CET-ordinaler når game_day mangler) — dette er KUN til visning ("Race day N" / "Race days N–M")
// og returnerer null hvis nogen række mangler game_day, så UI'et kan skjule mærket frem for at vise
// skrald. Et endagsløb → start===end; et etapeløb → første..sidste in-game-dag.
export function raceGameDaySpan(scheduleRows) {
  if (!scheduleRows?.length) return null;
  const days = scheduleRows.map((r) => r?.game_day).filter((d) => Number.isFinite(d));
  if (days.length !== scheduleRows.length) return null; // en delvist-backfillet række → skjul mærket
  return { start: Math.min(...days), end: Math.max(...days) };
}

// ── Monument-bånd (#3114/#3119) ────────────────────────────────────────────────
// Lane-packeren giver Monuments game_day i 100000-båndet — en bevidst "uden for
// dags-gitteret"-markør (raceCalendarLanePacker.js). I game_day-rummet kan et
// monument derfor ALDRIG overlappe et normalt løb: vindue {100000+} mod {0..88}.
// Sweep'en (raceEntryGenerator) lukker hullet ved at aflede monumentets binding-
// vindue fra de NORMALE løb i SAMME pulje der deler dets danske kalenderdag(e):
// CET-ordinal → {min,max} game_day. Pulje-lokalt er obligatorisk — divisionernes
// kalendere er forskudt i real-tid, så samme game_day falder på forskellige datoer
// i forskellige puljer (målt i prod 3/8: D2 kørte gd 0-7 27-30/7, D4 kørte gd 4
// først 31/7).
//
// #3114b (4/8): save-guarden (loadTeamBindingContext, nedenfor) afleder nu SAMME
// vindue, on-demand: kun når det aktuelle løb eller et af holdets ANDRE committede
// løb rent faktisk er i monument-båndet, indlæses sæsonens (race, schedule)-par én
// gang og pulje-lokale spans bygges for de(t) nødvendige pulje(r) — se
// loadPoolLocalCetSpans. I dag er alle Monuments league_division_id=1 (D1, verificeret
// mod prod 4/8), som pt. er AI-only, så hullet var latent; relevant fra D1-oprykningen
// efter 23/8. Den atomare hård-garanti INDE i replace_race_selection-RPC'en (SQL,
// database/2026-07-10-replace-race-selection-binding-guard.sql) har STADIG samme hul
// for den snævre samtidigheds-case (to næsten-simultane manuelle gem) — ikke lukket
// her, se PR-beskrivelsen for #3114 for detaljer og en verificeret afledningsquery.

// Er HELE løbets schedule i monument-båndet? (Monuments er endagsløb — én række —
// men vi kræver alle rækker, så et blandet/korrupt løb falder tilbage til
// raceBindingWindow's normale valg i stedet for en forkert afledning.)
export function isMonumentBandSchedule(scheduleRows) {
  if (!scheduleRows?.length) return false;
  return scheduleRows.every((r) => Number.isFinite(r?.game_day) && r.game_day >= MONUMENT_GAMEDAY_BASE);
}

// Byg CET-ordinal → {start,end} game_day-span fra NORMALE (ikke-monument) schedule-
// rows i én pulje. Rækker uden finite game_day (legacy, ikke backfillet) springes
// over — de kan ikke bidrage til et game_day-rum-indeks.
export function buildCetToGameDaySpan(scheduleRows) {
  const byOrd = new Map();
  for (const row of scheduleRows || []) {
    if (!Number.isFinite(row?.game_day) || row.game_day >= MONUMENT_GAMEDAY_BASE) continue;
    const ord = cetDayOrdinal(row?.scheduled_at);
    if (!Number.isFinite(ord)) continue;
    const cur = byOrd.get(ord);
    if (!cur) byOrd.set(ord, { start: row.game_day, end: row.game_day });
    else {
      cur.start = Math.min(cur.start, row.game_day);
      cur.end = Math.max(cur.end, row.game_day);
    }
  }
  return byOrd;
}

// Afled et monument-løbs binding-vindue i game_day-rummet: unionen af puljens
// game_day-spans på monumentets danske kalenderdag(e). Kører intet normalt løb de
// dage → null (monumentet kan ikke binde — samme adfærd som guarden i dag; bevidst
// konservativt indtil #3114 løses ved roden).
export function deriveMonumentBindingWindow(scheduleRows, cetToGameDaySpan) {
  if (!scheduleRows?.length || !cetToGameDaySpan) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const row of scheduleRows) {
    const ord = cetDayOrdinal(row?.scheduled_at);
    const span = Number.isFinite(ord) ? cetToGameDaySpan.get(ord) : null;
    if (!span) continue;
    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
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

// Pulje-lokalt CET→game_day-spans-indeks til monument-afledning i loadTeamBindingContext
// (#3114b). Henter sæsonens løb + schedule ÉN gang (samme fremgangsmåde som sweep'en,
// raceEntryGenerator.js: hvilke løb der bidrager til hvilken puljes indeks kan først
// afgøres når man kender ALLE sæsonens løbs pulje-tilhør) og bygger ét CET-ordinal→
// {start,end}-span-indeks pr. ØNSKET pulje. Kaldes KUN når mindst ét af de involverede
// løb (dette eller et af holdets andre committede løb) rent faktisk er i monument-båndet
// — de fleste udtagelses-gem rammer aldrig denne gren (5 monumenter/sæson). Returnerer
// Map<pool, Map<cetOrdinal,{start,end}>>.
export async function loadPoolLocalCetSpans({ supabase, seasonId, pools }) {
  const wanted = new Set(pools);
  const { data: seasonRaces, error: eRaces } = await supabase
    .from("races").select("id, league_division_id").eq("season_id", seasonId);
  if (eRaces) throw new Error(`races (monument pool index): ${eRaces.message}`);
  const raceIds = (seasonRaces || []).map((r) => r.id);
  const { data: seasonSched, error: eSched } = await selectInChunks({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at, game_day",
    inColumn: "race_id", ids: raceIds,
  });
  if (eSched) throw new Error(`race_stage_schedule (monument pool index): ${eSched.message}`);
  const schedByRace = new Map();
  for (const s of seasonSched || []) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }
  const rowsByPool = new Map();
  for (const r of seasonRaces || []) {
    const key = r.league_division_id ?? null;
    if (!wanted.has(key)) continue;
    const rows = schedByRace.get(r.id);
    if (!rows || isMonumentBandSchedule(rows)) continue; // kun NORMALE løb bidrager til indekset
    if (!rowsByPool.has(key)) rowsByPool.set(key, []);
    rowsByPool.get(key).push(...rows);
  }
  const spanByPool = new Map();
  for (const [key, rows] of rowsByPool) spanByPool.set(key, buildCetToGameDaySpan(rows));
  return spanByPool;
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
// #3114b: dette ELLER et af holdets andre committede løb kan være i monument-båndet
// (game_day >= MONUMENT_GAMEDAY_BASE) — deres vindue afledes da pulje-lokalt via
// loadPoolLocalCetSpans + deriveMonumentBindingWindow, SAMME logik som sweep'en
// (raceEntryGenerator.js), i stedet for det naive {100000+}-vindue der aldrig kan
// overlappe et normalt løb. `race.league_division_id` SKAL derfor også med i kalderens
// select (begge kaldere i api.js gør det).
export async function loadTeamBindingContext({ supabase, race, teamId }) {
  const { data: thisSched, error: e1 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at, game_day").eq("race_id", race.id);
  if (e1) throw new Error(`race_stage_schedule (this): ${e1.message}`);
  const naiveThisWindow = raceBindingWindow(thisSched);
  const thisIsMonument = isMonumentBandSchedule(thisSched);

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
  // Ingen andre committede løb → intet at binde imod, uanset om DETTE løb er et
  // monument. naiveThisWindow er inert her (findRiderBindingConflicts/mapRiderBindingDetails
  // kortslutter på tom otherRaces), så en (evt. forkert) afledning er spildt arbejde.
  if (!otherRaceIds.length) return { thisWindow: naiveThisWindow, otherRaces: [] };

  // Sæson-filter (#3070): et separat opslag mod races (ikke et embedded
  // race_entries.select("...,races!inner(season_id)")-filter) — vi har allerede
  // otherRaceIds fra entries-krydsningen ovenfor, og et separat, eksplicit opslag er
  // lettere at verificere mod den ægte PostgREST-kontrakt end at stole på embedded-
  // filter-semantik vi ikke har testet ende-til-ende her. Chunket (#3030/#3031-
  // mønster): et hold kan i teorien have entries i mange løb på tværs af sæsoner.
  // #3114b: + league_division_id, så et evt. monument blandt de andre løb kan afledes
  // pulje-lokalt uden en ekstra tur til DB.
  const { data: otherRaceRows, error: e3Season } = await selectInChunks({
    supabase, table: "races", columns: "id, season_id, league_division_id", inColumn: "id", ids: otherRaceIds,
  });
  if (e3Season) throw new Error(`races season lookup (binding): ${e3Season.message}`);
  const seasonByRaceId = new Map((otherRaceRows || []).map((r) => [r.id, r.season_id]));
  const poolByRaceId = new Map((otherRaceRows || []).map((r) => [r.id, r.league_division_id ?? null]));
  otherRaceIds = otherRaceIds.filter((rid) => seasonByRaceId.get(rid) === race.season_id);
  if (!otherRaceIds.length) return { thisWindow: naiveThisWindow, otherRaces: [] };

  const { data: scheds, error: e3 } = await supabase
    .from("race_stage_schedule").select("race_id, scheduled_at, game_day").in("race_id", otherRaceIds);
  if (e3) throw new Error(`race_stage_schedule (others): ${e3.message}`);

  const schedByRace = new Map();
  for (const s of scheds || []) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }

  // #3114b: hvilke løb (dette + andre) er RENT FAKTISK i monument-båndet? Kun dem skal
  // afledes pulje-lokalt — resten bruger raceBindingWindow som hidtil. Byg kun indeks for
  // de pulje(r) der faktisk er i spil (typisk 0 eller 1 — begge kaldere sikrer at DETTE
  // løb har race.season_id + race.league_division_id sat).
  const otherMonumentIds = new Set(otherRaceIds.filter((rid) => isMonumentBandSchedule(schedByRace.get(rid))));
  const neededPools = new Set();
  if (thisIsMonument) neededPools.add(race.league_division_id ?? null);
  for (const rid of otherMonumentIds) neededPools.add(poolByRaceId.get(rid) ?? null);

  let cetSpanByPool = new Map();
  if (neededPools.size && race.season_id != null) {
    cetSpanByPool = await loadPoolLocalCetSpans({ supabase, seasonId: race.season_id, pools: [...neededPools] });
  }

  const thisWindow = thisIsMonument
    ? deriveMonumentBindingWindow(thisSched, cetSpanByPool.get(race.league_division_id ?? null))
    : naiveThisWindow;

  const otherRaces = otherRaceIds
    .map((rid) => {
      const rows = schedByRace.get(rid);
      const window = otherMonumentIds.has(rid)
        ? deriveMonumentBindingWindow(rows, cetSpanByPool.get(poolByRaceId.get(rid) ?? null))
        : raceBindingWindow(rows);
      return { raceId: rid, window, riderIds: ridersByRace.get(rid) };
    })
    .filter((o) => o.window); // løb uden (evt. afledt) vindue kan ikke binde

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
