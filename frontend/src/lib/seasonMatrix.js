// Sæsonmatrix — rytter × løbsdag-gitteret i /planning?tab=selection&view=season
// (#1146, ejer-godkendt design 27/8). Ren geometri/kladde-logik, ingen IO, testbar
// med node --test. Komponenten (SeasonMatrix.jsx) er den eneste bruger.
//
// LÅST KONTRAKT (afvig ikke — se opgavebeskrivelsen for #1146):
// 1. Kolonner = løbsdage. Klik på en kolonneheader åbner ?day=N (samme
//    navigation som SeasonView.openDay). #4535: per-kolonne-datobåndet er
//    fjernet — SeasonView-båndet over matrixen er sidens ENE kalender (tid +
//    overlap); her viser hvert løbs header i stedet ét datospænd
//    (raceDateRangeLabel), så en dato aldrig gentages i gitteret.
// 2. HARD INVARIANT: alle display-tal her kommer fra races[].gameDayStart/
//    gameDayEnd (raceGameDaySpan-semantikken, backend). bindingWindow/CET-
//    ordinaler indgår ALDRIG i dette lag.
// 3. En rytters udtagelse i et etapeløb er ÉT sammenhængende spænd over løbets
//    løbsdage (ét holdudtag pr. løb). Rollebogstav: C/S/H/F/D for captain/
//    sprint_captain/hunter/free_role/helper. GT-hviledage (race.restGameDays)
//    optager løbsdagen og vises inde i samme spænd, låst.
// 4. Kladde: celle-redigering ændrer en kladde pr. løb; "Save plan" sender hele
//    diffen i ét PUT /races/selection/bulk-kald.
// 5. Celle-klik åbner en POPOVER (SeasonMatrixCellPopover.jsx), ikke en klik-
//    cyklus (#4323, ejer 27/8 — cyklussen C→S→H→F→D uden forklaring blev fundet
//    uforståelig). Popoveren dækker de fem roller (ROLE_ORDER), fjern-fra-løb
//    og rute-match. Kun geometrien/kladde-logikken bor her — popoverens IO/UI
//    bor i komponentfilen.
// 6. Et løb en rytter forsøger tilføjes til, der overlapper hans EKSISTERENDE
//    udtagelse et andet sted (conflictingEntryForRace) vises LÅST med
//    navngivet årsag — refutations-fund #4323 (27/8, still gyldig efter
//    akse-konverteringen: overlap regnes stadig på HELE løbs-spændet, ikke
//    kolonnen). setRiderRole har en `blocked`-guard som sidste forsvarslinje.
//    Årsagsteksten GENBRUGER #3410's rytterpulje-mønster (raceLockLabel
//    nedenfor + races.json's racehub.boundNamed/lockBoundUnnamed) i stedet for
//    matrixens egen formulering — #3410's rod-årsag var netop to SEPARATE
//    udledninger af lås (boolean) og årsag (tekst) der kunne drive fra
//    hinanden; her er lås og årsag ALTID samme funktions returværdi
//    (conflictingEntryForRace), og nu samme TEKST som puljen (spillertest-
//    punkt 2+3, Discord 29/8).
// 7. AKSE-KONVERTERING (ejer-låst 27-28/8, spillertest-punkt 6, PR #4323-
//    opfølgning): ÉN kolonne pr. (løb, løbsdag) — IKKE pr. delt game_day. Op
//    til 5 løb kan dele samme kalenderdag i D1 (design-issue #1146: "potentielt
//    omkring fem etaper per realdag"); den GAMLE akse (union af raa game_day-
//    heltal, buildDayColumns) lod da FLERE løb dele ÉN kolonne, hvilket krævede
//    header-lane-pakning (packRaceLanes, nu fjernet — død kode efter denne
//    konvertering) og gjorde dag-nummereringen tvetydig for den delte kolonne
//    (viste kun ÉT af de overlappende løbs stage-index, uanset hvilket løb
//    cellen faktisk hørte til for netop DEN spiller) — roden til "tæller til
//    19-20 og starter forfra"-forvirringen (Discord 29/8, egomadsen, punkt 5).
//    Hvert løbs egne kolonner er SAMMENHÆNGENDE (races[] er allerede sorteret
//    efter gameDayStart+navn), så rækkefølgen er løb-for-løb, ikke kronologisk
//    på tværs af løb der deler dage — to løb der deler en dato vises som to
//    ADSKILTE, side-om-side kolonner, ikke én fælles kolonne. Dette gør en
//    kolonne ENTYDIGT bundet til ét løb, hvilket eliminerer hele "hvilket løb"-
//    vælgeren punkt 6 ovenfor plejede at kunne have brug for ved delte dage —
//    en tom celle peger nu altid på PRÆCIS ét løb (dens egen kolonne), aldrig
//    en delt kandidatliste.

// Rollerækkefølgen i celle-popoverens rollevælger (#4323, ejer-beslutning
// 27/8 — erstatter den blinde klik-cyklus, som forvirrede ejeren: klik åbnede
// C→S→H→F→D uden forklaring). IKKE cyklus-rækkefølge — dette er visningsorden.
export const ROLE_ORDER = ["captain", "sprint_captain", "hunter", "free_role", "helper"];

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

// Fjern rytteren fra en eksklusiv rolle-slot (bruges både når rytteren selv
// skifter/fjernes og ved en anden rytter der OVERTAGER slottet — den forrige
// indehaver degraderes til helper, aldrig til at forsvinde fra truppen).
function clearRole(draft, riderId) {
  const d = { ...draft, free_role_ids: draft.free_role_ids.filter((id) => id !== riderId) };
  if (d.captain_id === riderId) d.captain_id = null;
  if (d.sprint_captain_id === riderId) d.sprint_captain_id = null;
  if (d.hunter_id === riderId) d.hunter_id = null;
  return d;
}

/**
 * Sætter rytterens rolle DIREKTE i én løbs-kladde — celle-popoverens rollevalg
 * (#4323, kontrakt 2b). Erstatter den fjernede klik-cyklus (advanceCell):
 * spilleren vælger rollen han vil have, i stedet for at klikke sig forbi de
 * roller han ikke vil have. Ren funktion, ny draft. Samme eksklusivitets-
 * nedgradering som cyklussen havde: overtager rytteren en besat eksklusiv
 * rolle (captain/sprint_captain/hunter), degraderes den forrige indehaver til
 * helper i stedet for at forsvinde fra truppen.
 *
 * `blocked` (defense-in-depth, refutations-fund #4323 27/8 — se
 * conflictingEntryForRace nedenfor): kaldes rollesætningen alligevel for et
 * løb der overlapper rytterens eksisterende udtagelse et andet sted, er
 * kaldet et NO-OP — draften returneres uændret. Popoveren tjekker allerede
 * FØR den kalder herind (UI-låsen), men denne guard er den sidste linje hvis
 * en fremtidig kode-sti springer den tjek over.
 */
export function setRiderRole(draft, riderId, role, blocked = false) {
  const base = draft || emptyRaceDraft();
  if (blocked) return base;
  let next = clearRole(base, riderId);
  if (!next.rider_ids.includes(riderId)) next = { ...next, rider_ids: [...next.rider_ids, riderId] };
  if (role === "captain") { if (next.captain_id) next = clearRole(next, next.captain_id); next.captain_id = riderId; }
  else if (role === "sprint_captain") { if (next.sprint_captain_id) next = clearRole(next, next.sprint_captain_id); next.sprint_captain_id = riderId; }
  else if (role === "hunter") { if (next.hunter_id) next = clearRole(next, next.hunter_id); next.hunter_id = riderId; }
  else if (role === "free_role") next.free_role_ids = [...next.free_role_ids, riderId];
  return next;
}

/** Fjerner rytteren helt fra én løbs-kladde — celle-popoverens "Fjern fra løbet" (kontrakt 2c). */
export function removeRiderFromRace(draft, riderId) {
  const base = draft || emptyRaceDraft();
  return clearRole({ ...base, rider_ids: base.rider_ids.filter((id) => id !== riderId) }, riderId);
}

/**
 * Rytterens eksisterende kladde-udtagelse i et ANDET løb, hvis dets game_day-
 * spænd overlapper `race`s spænd — refutations-fund #4323 (27/8, reproduceret
 * empirisk): en tom celle tilbød et løb uden at tjekke om rytteren allerede
 * sad i et overlappende løb et andet sted (GT dag 1-10 + endagsløb dag 5 —
 * rytteren endte i BEGGE, tavst, og først serverens deferred constraint
 * stoppede det ved gem). Samme spænd-overlap som countProblems' peerConflicts
 * (fulde spænd, ikke kun den viste kolonnes dag — DB-constraint
 * no_rider_double_booking_day er spænd-baseret: dækker to løbs spænd samme
 * dag NOGET sted, kan rytteren ikke sidde i begge). Samme løb er ALTID
 * lovligt (rolle-skift) og udelades derfor eksplicit. Uændret af akse-
 * konverteringen (kontrakt #7) — overlap regnes stadig på HELE løbs-spændet,
 * ikke på den enkelte kolonne. Returnerer det konfliktende races[]-objekt
 * (har .name til raceLockLabel nedenfor) eller null.
 */
export function conflictingEntryForRace(riderId, race, races, draftByRace) {
  if (!race || !Number.isFinite(race.gameDayStart) || !Number.isFinite(race.gameDayEnd)) return null;
  for (const other of races || []) {
    if (other.id === race.id) continue;
    if (!Number.isFinite(other.gameDayStart) || !Number.isFinite(other.gameDayEnd)) continue;
    if (roleOf(draftByRace.get(other.id), riderId) == null) continue;
    const overlap = race.gameDayStart <= other.gameDayEnd && other.gameDayStart <= race.gameDayEnd;
    if (overlap) return other;
  }
  return null;
}

/**
 * Låse-årsagens FÆRDIGE tekst — celle-popoverens visning når conflictingEntryForRace
 * (ovenfor) finder en konflikt (kontrakt #6, spillertest-punkt 2+3, Discord 29/8).
 * GENBRUGER #3410's rytterpulje-nøgler (racehub.boundNamed/lockBoundUnnamed,
 * races.json) i stedet for en matrix-egen formulering ("Riding {race} those
 * days") — #3410's postmortem (fix ca38bde07, PR #4468): lås (boolean) og
 * årsag (tekst) må ALDRIG udledes to separate steder, for så driver de fra
 * hinanden i grene ingen har testet, og UI'et tier eller lyver ("låst i et løb
 * der kun varer én dag" for en rytter der reelt sad i et overlappende
 * etapeløb). Her er kilden ALTID den samme `conflict`-race som selve
 * blocked-guarden bruger (setRiderRole), og nu samme TEKST som rytterpuljen —
 * to flader kan ikke længere sige to forskellige ting om samme låste tilstand.
 * `conflict` er races[]-objektet fra conflictingEntryForRace, eller null.
 */
export function raceLockLabel(conflict, t) {
  if (!conflict || typeof t !== "function") return null;
  return conflict.name ? t("racehub.boundNamed", { race: conflict.name }) : t("racehub.lockBoundUnnamed");
}

/**
 * Rolle-baggrund til en rolle-badge (celle-popoverens rollevælger + gitterets
 * egne celler, #4323 — flyttet hertil fra SeasonMatrix.jsx's lokale roleBg for
 * at undgå at duplikere den i celle-popoveren). Kaptajn/sprint-kaptajn skiller
 * sig ud (gold-tint), resten neutral accent-tint. Gold er RATIONERET til ÉN
 * primary-knap pr. view (kontrakt #8) — dette er en tint, ikke en knap.
 */
export function roleBadgeClass(role) {
  if (role === "captain" || role === "sprint_captain") return "bg-cz-accent/25 text-cz-accent-t";
  return "bg-cz-accent/10 text-cz-1";
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
 * Kolonne-aksen (kontrakt #7, akse-konvertering ejer-låst 27-28/8): ÉN kolonne
 * pr. (løb, løbsdag) — race-relativ, 1-baseret (stageIndex). HARD INVARIANT
 * (kontrakt #2) uændret: kun races[].gameDayStart/gameDayEnd bruges. Løbene
 * gennemløbes i races[]' egen rækkefølge (allerede sorteret gameDayStart+navn,
 * backend), og hvert løbs kolonner emitteres SAMMENHÆNGENDE — to løb der deler
 * en kalenderdag (op til 5 i D1, design-issue #1146) bliver derfor to ADSKILTE
 * kolonner side om side, ALDRIG én fælles kolonne. Det er dette der eliminerer
 * "hvilket løb"-vælgeren (den gamle kontrakt #6): en kolonne er nu entydigt ét
 * løb, så en tom celle i den kolonne kan kun betyde det ene løb.
 */
export function buildDayColumns(races) {
  const columns = [];
  for (const race of races || []) {
    if (!Number.isFinite(race.gameDayStart) || !Number.isFinite(race.gameDayEnd)) continue;
    for (let day = race.gameDayStart; day <= race.gameDayEnd; day++) {
      columns.push({ key: `${race.id}:${day}`, raceId: race.id, gameDay: day, stageIndex: day - race.gameDayStart + 1 });
    }
  }
  return columns;
}

// "28 AUG"-kortform (fra SeasonMatrix.jsx's formatBandDate da datobånds-rækken
// forsvandt, #4535) — sprog-neutral, samme mønster som SeasonView's fmt.range.
// Kun raceDateRangeLabel bruger den; eksporteret for testbarhed.
export function formatShortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const s = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(/\./g, "").toUpperCase();
  // en-GB staver september "SEPT" (4 tegn) — klip måneden til 3 så spænd-labels er ensbredde.
  const [day, month] = s.split(" ");
  return `${day} ${(month || "").slice(0, 3)}`;
}

/**
 * #4535 — ét datospænd pr. løbs-header ("28 AUG – 8 SEP", samme måned
 * "1–5 SEP", endagsløb "5 SEP"). Ukendt dato (delvist backfillet spænd)
 * → null, headeren viser da intet spænd frem for et gæt — samme
 * ingen-fallback-disciplin som kontrakt #2.
 */
export function raceDateRangeLabel(startIso, endIso) {
  if (!startIso) return null;
  if (!endIso || endIso === startIso) return formatShortDate(startIso);
  const start = formatShortDate(startIso);
  const end = formatShortDate(endIso);
  const [sd, sm] = start.split(" ");
  const [, em] = end.split(" ");
  return sm === em ? `${sd}–${end}` : `${start} – ${end}`;
}

/**
 * Rytterens rækkesegmenter langs dayColumns: sammenhængende blokke (kontrakt
 * #3 — ét holdudtag pr. løb tegnes som ÉT spænd) eller enkeltstående tomme
 * celler. Siden hver kolonne nu ENTYDIGT tilhører ét løb (kontrakt #7), er et
 * løbs egne kolonner altid sammenhængende i dayColumns — ingen klip-logik
 * nødvendig længere (den gamle "overlappende spænd konkurrerer om samme
 * kolonne"-defensiv-guard er væk sammen med de delte kolonner selv: overlapper
 * to løb rytterens kladde stadig, får de nu hver sin ADSKILTE synlige
 * kolonnegruppe i stedet for at forskyde/klippe hinanden). countProblems()
 * opdager og tæller den slags overlap uafhængigt af denne visning
 * (peerConflicts), så konflikten forbliver synlig i problemtælleren.
 */
export function buildRiderRowSegments(dayColumns, races, draftByRace, riderId) {
  const raceById = new Map((races || []).map((r) => [r.id, r]));
  const segments = [];
  let i = 0;
  while (i < dayColumns.length) {
    const col = dayColumns[i];
    const race = raceById.get(col.raceId);
    const role = race ? roleOf(draftByRace.get(race.id), riderId) : null;
    if (role == null) { segments.push({ kind: "empty", day: col.gameDay, raceId: col.raceId }); i += 1; continue; }
    let j = i;
    while (j < dayColumns.length && dayColumns[j].raceId === col.raceId) j += 1;
    const spanCols = dayColumns.slice(i, j);
    segments.push({ kind: "entry", race, role, days: spanCols.map((c) => c.gameDay), colSpan: spanCols.length });
    i = j;
  }
  return segments;
}

/**
 * Race-navn-headeren over dag-kolonnerne. FØR akse-konverteringen (kontrakt
 * #7) kunne op til 3 løb dele én kolonne (D1-normalen), hvilket krævede
 * lane-pakning (packRaceLanes, seasonTimeline.packLanes-mønsteret) for at
 * undgå at colSpan-summen sprang antallet af kolonner. Efter konverteringen
 * er hver kolonne entydigt ét løb, så løbene i dayColumns er ALDRIG indbyrdes
 * overlappende der — én enkelt gennemløbning rækker. `.laneCount` (altid 1)
 * bevares på returværdien som en tynd kompatibilitets-facade, så kaldstedets
 * `rowSpan={raceLanes.laneCount + 2}` ikke skal omskrives.
 */
export function buildRaceHeaderGroups(dayColumns) {
  const groups = [];
  let i = 0;
  while (i < dayColumns.length) {
    const col = dayColumns[i];
    let j = i;
    while (j < dayColumns.length && dayColumns[j].raceId === col.raceId) j += 1;
    const spanCols = dayColumns.slice(i, j);
    groups.push({ raceId: col.raceId, days: spanCols.map((c) => c.gameDay), colSpan: spanCols.length });
    i = j;
  }
  const lanes = [groups];
  lanes.laneCount = 1;
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

/**
 * Oversætter PUT /races/selection/bulk's fejlsvar (#4316) til en NAVNGIVET
 * besked pr. berørt løb — spillertest-punkt 1 (Discord 29/8, begge testere
 * ramte en tavs generisk fejl). Genbruger samme fejlkode-katalog som
 * RaceHubBoard.jsx's enkelt-løbs "Gem ændringer" allerede oversætter via
 * `selection.errors.*` (races.json) — races.json's `errors`-namespace, IKKE
 * duplikeret her.
 *
 * `selection_rider_bound` findes i TO former i bulk-svaret: db_conflict (mod
 * et løb UDENFOR denne "Gem plan"-batch) leverer allerede navngivne conflicts
 * (rider_name/race_name, fra backend/lib/raceBinding.js's
 * resolveBindingConflictDetails), mens peer_conflict (mod en ANDEN celle i
 * SAMME batch, classifyBulkSelectionConflicts) kun leverer rå id'er
 * (conflict_race_id) — disse slås op client-side mod de races/riders
 * gitteret allerede har indlæst, intet ekstra kald.
 *
 * Returnerer { code, raceId, raceName, params } — `code` er i18n-nøglen under
 * `selection.errors.*` (matcher altid, races.json har en `generic`-fallback),
 * `raceId`/`raceName` bruges til at NAVNGIVE beskeden og markere den berørte
 * kolonne i gitteret (ingen tavse fejl).
 */
export function buildSaveError(body, races, riders) {
  const code = body?.error || "generic";
  const raceId = body?.race_id ?? null;
  const raceName = raceId ? (races.find((r) => r.id === raceId)?.name ?? null) : null;
  if (code === "selection_rider_bound" && Array.isArray(body?.conflicts) && body.conflicts.length) {
    const c = body.conflicts[0];
    const riderName = c.rider_name ?? riders.find((r) => r.id === c.rider_id)?.name ?? "?";
    // db_conflict er allerede navngivet af serveren (c.race_name); peer_conflict
    // leverer kun c.conflict_race_id — slås op mod de allerede indlæste races[].
    const conflictName = c.race_name ?? races.find((r) => r.id === c.conflict_race_id)?.name ?? "?";
    return { code: "selection_rider_bound_named", raceId, raceName, params: { rider: riderName, race: conflictName } };
  }
  if (code === "selection_bulk_too_large") {
    return { code, raceId: null, raceName: null, params: { max: body?.max ?? 60 } };
  }
  return { code, raceId, raceName, params: {} };
}
