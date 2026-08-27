// Sæsonmatrix — rytter × løbsdag-gitteret i /planning?tab=selection&view=season
// (#1146, ejer-godkendt design 27/8). Ren geometri/kladde-logik, ingen IO, testbar
// med node --test. Komponenten (SeasonMatrix.jsx) er den eneste bruger.
//
// LÅST KONTRAKT (afvig ikke — se opgavebeskrivelsen for #1146):
// 1. Kolonner = løbsdage (game_day), grupperet under datobånd. Klik på en
//    kolonneheader åbner ?day=N (samme navigation som SeasonView.openDay).
// 2. HARD INVARIANT: alle display-tal her kommer fra races[].gameDayStart/
//    gameDayEnd (raceGameDaySpan-semantikken, backend). bindingWindow/CET-
//    ordinaler indgår ALDRIG i dette lag.
// 3. En rytters udtagelse i et etapeløb er ÉT sammenhængende spænd over løbets
//    løbsdage (ét holdudtag pr. løb). Rollebogstav: C/S/H/F/D for captain/
//    sprint_captain/hunter/free_role/helper. GT-hviledage (race.restGameDays)
//    optager løbsdagen og vises inde i samme spænd, låst.
// 4. Kladde: celle-redigering ændrer en kladde pr. løb; "Save plan" sender hele
//    diffen i ét PUT /races/selection/bulk-kald.

// Rækkefølgen klik-cyklussen går igennem for én celle: tom → helper → captain →
// sprint_captain → hunter → free_role → tom (næste klik starter forfra).
export const ROLE_CYCLE = ["helper", "captain", "sprint_captain", "hunter", "free_role"];

// Rollebogstaver til cellen (#4246 ejer-valg A).
export const ROLE_LETTER = {
  captain: "C",
  sprint_captain: "S",
  hunter: "H",
  free_role: "F",
  helper: "D",
};

/** Tomt kladde-skelet for ét løb. */
export function emptyRaceDraft() {
  return { rider_ids: [], captain_id: null, sprint_captain_id: null, hunter_id: null, free_role_ids: [] };
}

/** entries: [{raceId, riderId, raceRole}] (GET /races/selection/season) → draftByRace. */
export function buildDraftsFromEntries(entries) {
  const byRace = new Map();
  for (const e of entries || []) {
    if (!byRace.has(e.raceId)) byRace.set(e.raceId, emptyRaceDraft());
    const d = byRace.get(e.raceId);
    d.rider_ids.push(e.riderId);
    if (e.raceRole === "captain") d.captain_id = e.riderId;
    else if (e.raceRole === "sprint_captain") d.sprint_captain_id = e.riderId;
    else if (e.raceRole === "hunter") d.hunter_id = e.riderId;
    else if (e.raceRole === "free_role") d.free_role_ids.push(e.riderId);
  }
  return byRace;
}

/** Rytterens rolle i en given løbs-kladde, eller null hvis han ikke er udtaget. */
export function roleOf(draft, riderId) {
  if (!draft || !draft.rider_ids.includes(riderId)) return null;
  if (draft.captain_id === riderId) return "captain";
  if (draft.sprint_captain_id === riderId) return "sprint_captain";
  if (draft.hunter_id === riderId) return "hunter";
  if (draft.free_role_ids.includes(riderId)) return "free_role";
  return "helper";
}

// Fjern rytteren fra en eksklusiv rolle-slot (bruges både ved cyklus-fremgang og
// ved en anden rytter der OVERTAGER slottet — den forrige indehaver degraderes
// til helper, aldrig til at forsvinde fra truppen).
function clearRole(draft, riderId) {
  const d = { ...draft, free_role_ids: draft.free_role_ids.filter((id) => id !== riderId) };
  if (d.captain_id === riderId) d.captain_id = null;
  if (d.sprint_captain_id === riderId) d.sprint_captain_id = null;
  if (d.hunter_id === riderId) d.hunter_id = null;
  return d;
}

/**
 * Fremad ét skridt i klik-cyklussen for én rytter i én løbs-kladde. Ren funktion,
 * returnerer en NY draft (muterer aldrig input). En eksklusiv rolle (captain/
 * sprint_captain/hunter) der allerede er besat af en ANDEN rytter degraderes
 * automatisk til helper, så kladden aldrig får to captains.
 */
export function advanceCell(draft, riderId) {
  const base = draft || emptyRaceDraft();
  const current = roleOf(base, riderId);
  if (current == null) {
    // Tom celle → tilføj som helper.
    return { ...base, rider_ids: [...base.rider_ids, riderId] };
  }
  const nextIdx = ROLE_CYCLE.indexOf(current) + 1;
  if (nextIdx >= ROLE_CYCLE.length) {
    // Sidste trin (free_role) → fjern helt.
    return clearRole({ ...base, rider_ids: base.rider_ids.filter((id) => id !== riderId) }, riderId);
  }
  const nextRole = ROLE_CYCLE[nextIdx];
  let next = clearRole(base, riderId);
  if (nextRole === "captain") { if (next.captain_id) next = clearRole(next, next.captain_id); next.captain_id = riderId; }
  else if (nextRole === "sprint_captain") { if (next.sprint_captain_id) next = clearRole(next, next.sprint_captain_id); next.sprint_captain_id = riderId; }
  else if (nextRole === "hunter") { if (next.hunter_id) next = clearRole(next, next.hunter_id); next.hunter_id = riderId; }
  else if (nextRole === "free_role") next.free_role_ids = [...next.free_role_ids, riderId];
  return next;
}

/** Er en løbs-kladde forskellig fra server-sandheden? (samme princip som RaceHubBoard.selectionDirty) */
export function raceDraftDirty(draft, server) {
  const a = draft || emptyRaceDraft();
  const b = server || emptyRaceDraft();
  const ids = (x) => [...x].sort().join(",");
  return ids(a.rider_ids) !== ids(b.rider_ids)
    || (a.captain_id ?? null) !== (b.captain_id ?? null)
    || (a.sprint_captain_id ?? null) !== (b.sprint_captain_id ?? null)
    || (a.hunter_id ?? null) !== (b.hunter_id ?? null)
    || ids(a.free_role_ids) !== ids(b.free_role_ids);
}

/** Kladder der reelt afviger fra serveren — raceId'erne "Save plan" skal sende. */
export function dirtyRaceIds(draftByRace, serverByRace) {
  const ids = new Set([...draftByRace.keys(), ...serverByRace.keys()]);
  return [...ids].filter((id) => raceDraftDirty(draftByRace.get(id), serverByRace.get(id)));
}

/**
 * Kolonne-aksen: alle game_day-heltal dækket af MINDST ét løbs spænd
 * [gameDayStart, gameDayEnd], sorteret stigende. HARD INVARIANT (kontrakt #2):
 * kun races[].gameDayStart/gameDayEnd bruges — aldrig et bindingWindow-tal.
 */
export function buildDayColumns(races) {
  const days = new Set();
  for (const r of races || []) {
    if (!Number.isFinite(r.gameDayStart) || !Number.isFinite(r.gameDayEnd)) continue;
    for (let d = r.gameDayStart; d <= r.gameDayEnd; d++) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Grupperer løbsdags-kolonnerne under datobånd (kontrakt #1: kolonner er
 * løbsdage, IKKE dato-celler — datoen er kun et bånd-overskrift). En løbsdag
 * uden kendt dato (ingen løb noget sted kører den dag) arver forrige kendte
 * dato — der findes ingen anden sandhed at vise.
 */
export function buildDateBands(dayColumns, dayDatesMap) {
  const bands = [];
  let lastDate = null;
  for (const day of dayColumns) {
    const date = dayDatesMap.get(day) ?? lastDate;
    lastDate = date ?? lastDate;
    const band = bands[bands.length - 1];
    if (band && band.date === date) band.days.push(day);
    else bands.push({ date: date ?? null, days: [day] });
  }
  return bands;
}

/**
 * Rytterens rækkesegmenter langs dayColumns: sammenhængende blokke (kontrakt
 * #3 — ét holdudtag pr. løb tegnes som ÉT spænd) eller enkeltstående tomme
 * celler. `activeRaces` = races[] filtreret til dem der reelt har en gyldig
 * dag-akse (buildDayColumns' input) — races-listen selv er fint.
 *
 * DEFENSIV GUARD: en rytter kan ikke lovligt sidde i to løb der overlapper i
 * game_day-spænd samtidig (DB-constraint no_rider_double_booking_day), så
 * ranges BØR aldrig overlappe. Hvis kladden alligevel indeholder et overlap
 * (data endnu ikke valideret/gemt), klippes det senere spænd til KUN de
 * kolonner der er tilbage fra det punkt — spændet forskyder ALDRIG resten af
 * rækken. countProblems() opdager og tæller konflikten uafhængigt af denne
 * visning (peerConflicts), så den forbliver synlig i problemtælleren.
 */
export function buildRiderRowSegments(dayColumns, races, draftByRace, riderId) {
  // Ranges rytteren sidder i lige nu, længste først, dernæst tidligste start
  // (defensivt ved overlap i data — deterministisk hvem der "vinder" spændet).
  const ranges = races
    .filter((r) => roleOf(draftByRace.get(r.id), riderId) != null)
    .map((r) => ({ race: r, role: roleOf(draftByRace.get(r.id), riderId) }))
    .sort((a, b) => (b.race.gameDayEnd - b.race.gameDayStart) - (a.race.gameDayEnd - a.race.gameDayStart)
      || a.race.gameDayStart - b.race.gameDayStart);

  const segments = [];
  let i = 0;
  while (i < dayColumns.length) {
    const day = dayColumns[i];
    const hit = ranges.find((r) => day >= r.race.gameDayStart && day <= r.race.gameDayEnd);
    if (!hit) { segments.push({ kind: "empty", day }); i += 1; continue; }
    // Klip til kolonner FRA `i` og frem (ikke hit.race.gameDayStart) — hvis et
    // tidligere, overlappende spænd allerede har konsumeret de(n) forreste
    // dag(e) af dette løb, tælles de ikke med igen.
    let j = i;
    while (j < dayColumns.length && dayColumns[j] <= hit.race.gameDayEnd) j += 1;
    const spanDays = dayColumns.slice(i, j);
    segments.push({ kind: "entry", race: hit.race, role: hit.role, days: spanDays, colSpan: spanDays.length });
    i = j;
  }
  return segments;
}

/** Hvilket (højst ét) løb dækker en given løbsdag, blandt de viste races. */
export function raceForDay(races, day) {
  return races.find((r) => day >= r.gameDayStart && day <= r.gameDayEnd) ?? null;
}

/**
 * Lane-pakning af løb der overlapper i game_day-spænd — SAMME algoritme som
 * seasonTimeline.packLanes bruger til Z1 v0's dato-bånd (længste spænd først,
 * dernæst tidligste start, grådig first-fit), men på game_day-HELTAL i stedet
 * for datostrenge (kontrakt #2 — ingen dato-konvertering i dette lag). Op til
 * 3 løb deler samme løbsdag i D1 — det er NORMALT, ikke en undtagelse.
 */
function packRaceLanes(races) {
  const valid = (races || []).filter(
    (r) => Number.isFinite(r.gameDayStart) && Number.isFinite(r.gameDayEnd) && r.gameDayEnd >= r.gameDayStart
  );
  const sorted = [...valid].sort((a, b) => (b.gameDayEnd - b.gameDayStart) - (a.gameDayEnd - a.gameDayStart)
    || a.gameDayStart - b.gameDayStart);
  const lanes = []; // pr. bane: liste af [start,end]-intervaller allerede placeret
  const laned = [];
  for (const r of sorted) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].every(([s, e]) => r.gameDayEnd < s || r.gameDayStart > e)) {
        lanes[i].push([r.gameDayStart, r.gameDayEnd]);
        laned.push({ ...r, lane: i });
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([[r.gameDayStart, r.gameDayEnd]]);
      laned.push({ ...r, lane: lanes.length - 1 });
    }
  }
  laned.laneCount = lanes.length;
  return laned;
}

/**
 * Race-navn-headeren over dag-kolonnerne. MODBEVIST antagelse rettet: løb
 * overlapper HYPPIGT i game_day-spænd (op til 3 løb samme løbsdag i D1,
 * normalt) — en enkelt header-række kan derfor ikke rumme alle løb uden at
 * dens colSpan-sum sprænger antallet af kolonner. Headeren lane-pakkes derfor
 * (packRaceLanes, samme mekanik som Z1 v0's packLanes): hver lane er en EGEN
 * header-række hvis grupper (løb + gap-celler for dage andre lanes dækker)
 * summer colSpan til NØJAGTIGT dayColumns.length. Returnerer et array af
 * lanes (`lanes[lane] = grupper[]`) med `.laneCount` på selve arrayet (samme
 * mønster som packLanes).
 */
export function buildRaceHeaderGroups(dayColumns, races) {
  const laned = packRaceLanes(races);
  const laneCount = laned.laneCount;
  const lanes = [];
  for (let lane = 0; lane < laneCount; lane++) {
    const laneRaces = laned.filter((r) => r.lane === lane);
    const groups = [];
    let i = 0;
    while (i < dayColumns.length) {
      const day = dayColumns[i];
      const race = laneRaces.find((r) => day >= r.gameDayStart && day <= r.gameDayEnd);
      if (!race) {
        // Gap: dage denne lane ikke dækker (et andet løb ligger her i en
        // anden lane) — slås sammen til ÉN gap-celle pr. sammenhængende run.
        let j = i;
        while (j < dayColumns.length && !laneRaces.some((r) => dayColumns[j] >= r.gameDayStart && dayColumns[j] <= r.gameDayEnd)) j += 1;
        const days = dayColumns.slice(i, j);
        groups.push({ race: null, days, colSpan: days.length });
        i = j;
        continue;
      }
      const days = dayColumns.filter((d) => d >= race.gameDayStart && d <= race.gameDayEnd);
      groups.push({ race, days, colSpan: days.length });
      i += days.length;
    }
    lanes.push(groups);
  }
  lanes.laneCount = laneCount;
  return lanes;
}

/** Rytterens samlede løbsdage i den AKTUELLE kladde (Load-linsen, #1146 kontrakt-punkt 6). */
export function riderLoadDays(races, draftByRace, riderId) {
  let total = 0;
  for (const r of races) {
    if (roleOf(draftByRace.get(r.id), riderId) != null) total += r.gameDayEnd - r.gameDayStart + 1;
  }
  return total;
}

/**
 * Problemtæller til fodnoten: løb over trupstørrelses-loftet + ryttere der (i
 * den AKTUELLE kladde) sidder i to indbyrdes overlappende løb samtidig — en
 * kladde-tilstand "Save plan" ikke kan gemme uden servergenerert fejl (peer-
 * konflikt-tjekket i PUT /races/selection/bulk).
 */
export function countProblems(races, draftByRace) {
  const overSize = races.filter((r) => (draftByRace.get(r.id)?.rider_ids?.length ?? 0) > r.sizeMax);
  const byRider = new Map(); // riderId -> race[]
  for (const r of races) {
    for (const riderId of draftByRace.get(r.id)?.rider_ids ?? []) {
      if (!byRider.has(riderId)) byRider.set(riderId, []);
      byRider.get(riderId).push(r);
    }
  }
  const peerConflicts = [];
  for (const [riderId, list] of byRider) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const overlap = list[a].gameDayStart <= list[b].gameDayEnd && list[b].gameDayStart <= list[a].gameDayEnd;
        if (overlap) peerConflicts.push({ riderId, raceIdA: list[a].id, raceIdB: list[b].id });
      }
    }
  }
  const affectedRaceIds = new Set([...overSize.map((r) => r.id), ...peerConflicts.flatMap((c) => [c.raceIdA, c.raceIdB])]);
  const affectedRiderIds = new Set(peerConflicts.map((c) => c.riderId));
  return { count: overSize.length + peerConflicts.length, overSize, peerConflicts, affectedRaceIds, affectedRiderIds };
}

/** Rute-match-score (0-100) for én rytter mod ét løb — riderSuitability, egen fil. */
export function raceCurrentCount(draftByRace, raceId) {
  return draftByRace.get(raceId)?.rider_ids?.length ?? 0;
}
