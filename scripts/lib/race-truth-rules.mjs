// scripts/lib/race-truth-rules.mjs
// #7643: sandhedsvagten efter hver etape. Ren regel-kerne: ingen IO, input
// muteres aldrig, samme input giver samme fund.
//
// Vagten sammenligner fire kilder for én kørt etape:
//   - resultatet (race_results: etape, GC, point- og bjergtrøje),
//   - løbsfilmen (race_stage_timelines.events, og filmen som siden viser den:
//     backend/lib/raceStory.js),
//   - referat-input (race_stage_moments) og
//   - etapeplanens skift (stage_plan_leg-events i tidslinjen).
// Hver regel er en ren funktion, der returnerer en liste af fund. Et fund
// bærer kun id'er (rytter, gruppe, event-indeks) og km, aldrig navne.
//
// De syv regler (issue #7643):
//   R1 en "sat" rytter er ikke i hovedgruppen eller frontgruppen (#7635)
//   R2 en udgået rytter optræder ikke i tidslinjen efter udgangen (#7639)
//   R3 ingen gruppe hentes før den er dannet; ingen gruppe ud af ingenting (#6350)
//   R4 et split hvor rytteren kommer foran er aldrig "tabte tid" (#7640)
//   R5 filmens målrækkefølge og gab svarer til etaperesultatet
//   R6 referatets påstande (plan-led, sat, vinder, uheld) svarer til filmen
//   R7 GC, bonussekunder og trøjer svarer til summen af etaper og passager
//
// Tolerancerne nedenfor er vagtens egne måleusikkerheder (afrunding af viste
// tider, km-stempling), ikke motor-tuning.

import { buildRaceStory, checkpointGapForRider } from "../../backend/lib/raceStory.js";
import { withEventPlaces } from "../../backend/lib/raceTimeline.js";

export const RULES = Object.freeze({
  R1: "En sat rytter er ikke i hovedgruppen eller frontgruppen",
  R2: "En udgaaet rytter optraeder ikke efter sin udgang",
  R3: "Ingen gruppe hentes foer den er dannet, ingen gruppe ud af ingenting",
  R4: "Et split hvor rytteren kommer foran er aldrig tabt tid",
  R5: "Filmens maalraekkefoelge og gab svarer til etaperesultatet",
  R6: "Referatets paastande svarer til rytterens faktiske gruppe",
  R7: "GC, bonussekunder og troejer svarer til etaper og passager",
});

/** Viste tider er hele sekunder; filmen regner med brøker. */
export const TIME_TOLERANCE_S = 1.5;
/** Tidsrækkefølge mellem to hændelser (motorens exact_time har brøker). */
export const ORDER_TOLERANCE_S = 0.01;
/** km-rækkefølge mellem to hændelser. */
export const ORDER_TOLERANCE_KM = 0.01;
/** Hvor langt efter rytterens faktiske split et "sat"-skift må stå. */
export const PLAN_STAMP_TOLERANCE_KM = 1;

const INCIDENT_SOLO_ID = /^solo-m10-(\d+)-(\d+)$/;
const REST_GROUP_ID = "peloton-0";
const BOOKKEEPING_ATTACK_KINDS = new Set(["stage_decided", "placement_gap", "gap_survived"]);
const FORMING_TYPES = new Set(["breakaway_formed", "finale_attack", "peloton_splits", "breakaway_dropped"]);
const WIN_MOMENT_KEYS = new Set(["sprint_win", "close_win", "solo_win", "itt_win", "ttt_win", "reduced_sprint_win", "breakaway_win", "attack_win"]);

function finite(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ids(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && id.length > 0) : [];
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

/** Alle ryttere en hændelse navngiver (liste, ental og rolle-felter). */
export function namedRiderIds(event) {
  const p = event?.params ?? {};
  const out = new Set(ids(p.rider_ids));
  for (const key of ["rider_id", "winner_rider_id", "protected_rider_id"]) {
    const id = str(p[key]);
    if (id) out.add(id);
  }
  return [...out];
}

/** Hændelsens sande sted: exact_km/exact_time når motoren kender dem. */
export function placeOf(event) {
  const p = event?.params ?? {};
  return { km: finite(p.exact_km) ?? finite(event?.km), time: finite(p.exact_time), exact: finite(p.exact_km) != null };
}

/** "+m:ss" / "+h:mm:ss" / "m:ss" -> sekunder; null når feltet ikke er en tid. */
export function parseGapSeconds(text) {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  if (typeof text !== "string") return null;
  const m = /^\+?\s*(\d+(?::\d{1,2}){0,2})$/.exec(text.trim());
  if (!m) return null;
  return m[1].split(":").map(Number).reduce((acc, part) => acc * 60 + part, 0);
}

// ---------------------------------------------------------------------------
// Afspilning af tidslinjen: hvem kører i hvilken gruppe, med hvilket hul
// ---------------------------------------------------------------------------

/**
 * Afspiller tidslinjen i motorens rækkefølge (array-orden) og kalder
 * `visit(event, index, view)` FØR hændelsen anvendes. `view` er tilstanden
 * lige før hændelsen. Afspilningen returnerer bogføringen bagefter.
 *
 * Gruppers "angreb": en gruppe dannet af et udbrud eller et angreb
 * (breakaway_formed, finale_attack) er ikke en opdeling af feltet. Et split
 * af en angrebsgruppe arver mærket (motoren arver gruppens oprindelse).
 */
export function replayTimeline(events = [], startlist = [], visit = () => {}) {
  const members = new Map(); // group id -> Set(rider)
  const gaps = new Map(); // group id -> sidst kendte hul til fronten
  const attack = new Map(); // group id -> boolean
  const formation = new Map(); // group id -> { index, km, time, exact, via }
  const joinedAt = new Map(); // rider -> { km, exact, index } (seneste split/uheld der flyttede ham)
  const riderGroup = new Map(); // rider -> group id
  const out = new Map(); // rider -> { index, km } (udgået)
  const pendingIncidents = []; // { riderId, outcome, index, km }
  const incidentGroups = new Map(); // group id -> { riderId, outcome, index }
  const unformed = new Map(); // group id -> index (første reference uden dannelse)
  const ghostReferences = []; // { groupId, index, km, riderId }

  const setGroup = (groupId, riders) => {
    for (const id of riders) {
      const prev = riderGroup.get(id);
      if (prev && prev !== groupId) members.get(prev)?.delete(id);
      riderGroup.set(id, groupId);
    }
    if (!members.has(groupId)) members.set(groupId, new Set());
    for (const id of riders) members.get(groupId).add(id);
  };
  const removeRider = (id) => {
    const prev = riderGroup.get(id);
    if (prev) members.get(prev)?.delete(id);
    riderGroup.delete(id);
  };
  const referencedEarly = new Map(); // group id -> { index, km, formed_index }
  const form = (groupId, index, event, via) => {
    const place = placeOf(event);
    if (via !== "group_merged" && unformed.has(groupId)) {
      referencedEarly.set(groupId, { ...unformed.get(groupId), formed_index: index });
      unformed.delete(groupId);
    }
    formation.set(groupId, { index, km: place.km, time: place.time, exact: place.exact, via });
  };

  setGroup(REST_GROUP_ID, [...new Set(ids(startlist))]);
  attack.set(REST_GROUP_ID, false);
  gaps.set(REST_GROUP_ID, 0);
  formation.set(REST_GROUP_ID, { index: -1, km: 0, time: 0, exact: true, via: "start" });

  // Et uheldsoffer får sin egen gruppe (`solo-m10-<segment>-<seq>`). Loggen har
  // ingen dannelses-hændelse for den, og motoren tildeler <seq> i rider_id-orden
  // inden for segmentet, ikke i uheldenes km-orden. Rytteren udledes derfor af
  // id'et med samme regel som raceStory.js (incidentSegmentRiders), aldrig af
  // rækkefølgen grupperne nævnes i. Kan id'et ikke føres tilbage, bliver gruppen
  // ukendt hellere end at få en anden rytters uheld.
  const m10Segments = new Map(); // segment -> { riders (seq-orden), minKm, maxKm }
  const segmentRiders = (segment, km) => {
    const known = m10Segments.get(segment);
    if (known) return known.riders;
    let lo = -Infinity;
    let hi = Infinity;
    for (const [s, info] of m10Segments) {
      if (info.minKm == null) continue;
      if (s < segment) lo = Math.max(lo, info.maxKm);
      else if (s > segment) hi = Math.min(hi, info.minKm);
    }
    const inSegment = pendingIncidents.filter((x) => !x.assigned && x.recordedKm <= km + 1e-9 && x.recordedKm >= lo - 1e-9 && x.recordedKm <= hi + 1e-9);
    for (const x of inSegment) x.assigned = true;
    const riders = inSegment.map((x) => x.riderId).sort((a, b) => a.localeCompare(b));
    const kms = inSegment.map((x) => x.recordedKm);
    m10Segments.set(segment, { riders, minKm: kms.length ? Math.min(...kms) : null, maxKm: kms.length ? Math.max(...kms) : null });
    return riders;
  };
  const touch = (groupId, index, event) => {
    if (!groupId || members.has(groupId) || formation.has(groupId)) return;
    const m10 = INCIDENT_SOLO_ID.exec(groupId);
    const riderId = m10 ? segmentRiders(Number(m10[1]), finite(event?.km) ?? 0)[Number(m10[2])] : null;
    const incident = riderId ? pendingIncidents.find((x) => x.riderId === riderId) : null;
    if (incident) {
      incidentGroups.set(groupId, incident);
      attack.set(groupId, false);
      if (incident.outcome === "abandoned") {
        members.set(groupId, new Set());
      } else {
        setGroup(groupId, [incident.riderId]);
      }
    } else {
      members.set(groupId, new Set());
      attack.set(groupId, false);
    }
    if (!unformed.has(groupId)) unformed.set(groupId, { index, km: placeOf(event).km });
  };

  const view = {
    groupOf: (riderId) => riderGroup.get(riderId) ?? null,
    membersOf: (groupId) => [...(members.get(groupId) ?? [])],
    gapOf: (groupId) => (gaps.has(groupId) ? gaps.get(groupId) : null),
    isAttack: (groupId) => attack.get(groupId) === true,
    formationOf: (groupId) => formation.get(groupId) ?? null,
    joinedAt: (riderId) => joinedAt.get(riderId) ?? null,
    isOut: (riderId) => out.has(riderId),
    outInfo: (riderId) => out.get(riderId) ?? null,
    incidentGroup: (groupId) => incidentGroups.get(groupId) ?? null,
    /** Forreste gruppe der er en opdeling af feltet (ikke et udbrud/angreb). */
    frontRealGroup: () => {
      let best = null;
      for (const [groupId, set] of members) {
        if (set.size === 0 || attack.get(groupId) === true) continue;
        const gap = gaps.get(groupId) ?? 0;
        if (!best || gap < best.gap) best = { groupId, gap };
      }
      return best;
    },
  };

  events.forEach((event, index) => {
    if (!event || typeof event.type !== "string") return;
    const p = event.params ?? {};
    const groupId = str(p.group_id);
    const named = ids(p.rider_ids);
    // Grupper hændelsen henviser til (ikke den gruppe den selv danner, og ikke
    // målet for en sammenlægning: en sammenlægning må gerne skabe sit mål).
    const forming = FORMING_TYPES.has(event.type) && !BOOKKEEPING_ATTACK_KINDS.has(p.kind);
    const refs = [str(p.source_group_id), str(p.chase_group_id), str(p.from_group_id)];
    if (!forming && groupId) refs.push(groupId);
    for (const ref of refs) if (ref) touch(ref, index, event);
    for (const groupRef of [groupId, str(p.chase_group_id)]) {
      const inc = groupRef ? incidentGroups.get(groupRef) : null;
      if (inc?.outcome === "abandoned") ghostReferences.push({ groupId: groupRef, index, km: placeOf(event).km, riderId: inc.riderId });
    }

    visit(event, index, view);

    const place = placeOf(event);
    switch (event.type) {
      case "breakaway_formed": {
        if (!groupId) break;
        setGroup(groupId, named);
        attack.set(groupId, true);
        gaps.set(groupId, 0);
        form(groupId, index, event, "breakaway_formed");
        break;
      }
      case "finale_attack": {
        if (BOOKKEEPING_ATTACK_KINDS.has(p.kind)) break;
        const attackers = named.length ? named : str(p.rider_id) ? [p.rider_id] : [];
        if (!groupId || attackers.length === 0) break;
        if (groupId === REST_GROUP_ID) break;
        const sourceGap = gaps.get(riderGroup.get(attackers[0])) ?? 0;
        setGroup(groupId, attackers);
        attack.set(groupId, true);
        const gained = finite(p.gained_seconds);
        gaps.set(groupId, gained != null ? sourceGap - gained : sourceGap);
        form(groupId, index, event, "finale_attack");
        break;
      }
      case "peloton_splits":
      case "breakaway_dropped": {
        if (!groupId) break;
        const source = str(p.source_group_id) ?? str(p.from_group_id);
        const sourceGap = source ? gaps.get(source) ?? 0 : 0;
        setGroup(groupId, named);
        attack.set(groupId, source ? attack.get(source) === true : false);
        // Et splits gap_seconds er afstanden til den gruppe det blev splittet fra.
        const delta = finite(p.gap_seconds);
        gaps.set(groupId, sourceGap + (delta ?? 0));
        // #6350: en sen halvdel af et split danner ikke gruppen.
        if (!p.joined_late) form(groupId, index, event, event.type);
        for (const id of named) joinedAt.set(id, { km: place.km, exact: place.exact, index });
        break;
      }
      case "group_merged": {
        const into = str(p.into_group_id);
        if (!groupId || !into) break;
        const incoming = named.length ? named : [...(members.get(groupId) ?? [])];
        const targetKnown = members.has(into);
        const fromAttack = attack.get(groupId) === true;
        attack.set(into, targetKnown ? attack.get(into) === true && fromAttack : fromAttack);
        if (!gaps.has(into) && gaps.has(groupId)) gaps.set(into, gaps.get(groupId));
        if (!formation.has(into)) form(into, index, event, "group_merged");
        setGroup(into, incoming);
        for (const id of members.get(groupId) ?? []) setGroup(into, [id]);
        members.delete(groupId);
        gaps.delete(groupId);
        break;
      }
      case "gap_update": {
        const gap = finite(p.gap_seconds);
        if (groupId && gap != null) gaps.set(groupId, gap);
        break;
      }
      case "incident": {
        const riderId = str(p.rider_id);
        if (!riderId) break;
        // Kun M10's egne uheld (uden `cause`) tager et solo-m10-seq (raceStory.js).
        const m10Seq = p.cause == null;
        const recordedKm = finite(event.km) ?? 0;
        if (p.outcome === "abandoned" || p.outcome === "abandon") {
          removeRider(riderId);
          out.set(riderId, { index, km: place.km });
          if (m10Seq) pendingIncidents.push({ riderId, outcome: "abandoned", index, km: place.km, recordedKm, assigned: false });
        } else if (p.outcome === "time_loss") {
          removeRider(riderId);
          joinedAt.set(riderId, { km: place.km, exact: place.exact, index });
          if (m10Seq) pendingIncidents.push({ riderId, outcome: "time_loss", index, km: place.km, recordedKm, assigned: false });
        }
        break;
      }
      default:
        break;
    }
  });

  return { view, out, unformed, referencedEarly, incidentGroups, ghostReferences, formation };
}

// ---------------------------------------------------------------------------
// Reglerne
// ---------------------------------------------------------------------------

function finding(rule, code, fields = {}) {
  const out = { rule, code };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) out[key] = value;
  return out;
}

/** R1 (#7635): "sat" mens rytteren sidder i hovedgruppen eller foran den. */
export function ruleDroppedInFront(input) {
  const findings = [];
  replayTimeline(input.events, input.startlist, (event, index, view) => {
    if (event.type !== "stage_plan_leg" || event.params?.reason !== "dropped") return;
    const riderId = str(event.params?.rider_id);
    const groupId = riderId ? view.groupOf(riderId) : null;
    const front = view.frontRealGroup();
    if (!groupId || !front) return;
    const gap = view.gapOf(groupId) ?? 0;
    if (gap <= front.gap) {
      findings.push(finding("R1", groupId === front.groupId ? "dropped_in_main_group" : "dropped_ahead_of_main_group", {
        index, km: placeOf(event).km, rider_id: riderId, group_id: groupId, main_group_id: front.groupId,
      }));
    }
  });
  return findings;
}

/** R2 (#7639): intet efter en udgang, ingen spøgelsesgruppe, intet resultat. */
export function ruleAbandonedGone(input) {
  const findings = [];
  const replay = replayTimeline(input.events, input.startlist, (event, index, view) => {
    // Uheldet selv, og motorens bogføring ved målstregen (vises aldrig i filmen).
    if (event.type === "incident" || BOOKKEEPING_ATTACK_KINDS.has(event.params?.kind)) return;
    for (const riderId of namedRiderIds(event)) {
      if (!view.isOut(riderId)) continue;
      findings.push(finding("R2", "named_after_abandon", { index, km: placeOf(event).km, rider_id: riderId, type: event.type }));
    }
  });
  const ghosts = new Map();
  for (const ref of replay.ghostReferences) if (!ghosts.has(ref.groupId)) ghosts.set(ref.groupId, ref);
  for (const ref of ghosts.values()) {
    findings.push(finding("R2", "ghost_group_after_abandon", { index: ref.index, km: ref.km, group_id: ref.groupId, rider_id: ref.riderId }));
  }
  const finishers = new Set((input.stageRows ?? []).map((row) => row.rider_id));
  const gone = new Set(replay.out.keys());
  for (const row of input.incidents ?? []) if (row?.outcome === "abandon" || row?.outcome === "abandoned") if (str(row.rider_id)) gone.add(row.rider_id);
  for (const riderId of gone) {
    if (finishers.has(riderId)) findings.push(finding("R2", "abandoned_in_result", { rider_id: riderId }));
  }
  return findings;
}

/**
 * R3 (#6350): filmen som siden viser den (loggen læst gennem withEventPlaces) må
 * ikke modsige sig selv. Et split står ikke efter sin gruppes kontakt, og en rytter
 * står ikke i en gruppe før han er fri af den forrige.
 */
export function filmPlaceFindings(placed) {
  const findings = [];
  const known = (placed ?? []).map((event, index) => ({ event, index, place: placeOf(event) })).filter(({ event, place }) => event && place.exact);
  const contacts = known.filter(({ event }) => event.type === "breakaway_caught" || event.type === "group_merged");
  const byPlace = [...contacts].sort((a, b) => a.place.km - b.place.km || a.index - b.index);
  for (const { event, index, place } of known) {
    if (event.type !== "peloton_splits") continue;
    const groupId = str(event.params?.group_id);
    const own = contacts.filter((c) => c.event.km === event.km && str(c.event.params?.group_id) === groupId);
    if (own.length > 0) {
      const contactKm = Math.min(...own.map((c) => c.place.km));
      if (place.km > contactKm + ORDER_TOLERANCE_KM) findings.push(finding("R3", "split_after_group_contact", { index, km: place.km, group_id: groupId, contact_km: contactKm }));
    }
    // Gruppens egen linje: sammenlægninger videre er ikke et skift ud af en anden gruppe.
    const line = new Set([groupId]);
    for (const c of byPlace) {
      if (line.has(str(c.event.params?.group_id)) && str(c.event.params?.into_group_id)) line.add(c.event.params.into_group_id);
    }
    for (const riderId of ids(event.params?.rider_ids)) {
      const left = contacts.find((c) => !line.has(str(c.event.params?.group_id)) && ids(c.event.params?.rider_ids).includes(riderId)
        && c.place.km > place.km + ORDER_TOLERANCE_KM && c.place.km < event.km);
      if (left) findings.push(finding("R3", "rider_in_group_before_free", { index, km: place.km, group_id: groupId, rider_id: riderId, left_group_id: str(left.event.params?.group_id), left_km: left.place.km }));
    }
  }
  return findings;
}

/** R3 (#6350): hentet før dannet (km/tid), en gruppe uden dannelse, eller en film der modsiger sig selv. */
export function ruleCatchAfterFormation(input) {
  const findings = filmPlaceFindings(withEventPlaces(input.events));
  const seen = new Set();
  const replay = replayTimeline(input.events, input.startlist, (event, index, view) => {
    if (event.type !== "breakaway_caught" && event.type !== "group_merged") return;
    const groupId = str(event.params?.group_id);
    const formed = groupId ? view.formationOf(groupId) : null;
    if (!formed || !formed.exact) return;
    const place = placeOf(event);
    if (!place.exact) return;
    const kmBefore = place.km < formed.km - ORDER_TOLERANCE_KM;
    const timeBefore = place.time != null && formed.time != null && place.time < formed.time - ORDER_TOLERANCE_S;
    if (!kmBefore && !timeBefore) return;
    const key = `${groupId}|${formed.index}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding("R3", "caught_before_formed", {
      index, km: place.km, group_id: groupId, formed_index: formed.index, formed_km: formed.km,
      ...(timeBefore ? { order: "time" } : { order: "km" }),
    }));
  });
  for (const [groupId, ref] of replay.unformed) {
    // #6350: et uheldsoffers solo-gruppe er dannet af uheldet. Filmen fører den
    // tilbage dertil (raceStory.js), så den er ikke en gruppe ud af ingenting.
    if (replay.incidentGroups.has(groupId)) continue;
    findings.push(finding("R3", "group_without_formation", { index: ref.index, km: ref.km, group_id: groupId }));
  }
  for (const [groupId, ref] of replay.referencedEarly) {
    findings.push(finding("R3", "referenced_before_formed", { index: ref.index, km: ref.km, group_id: groupId, formed_index: ref.formed_index }));
  }
  return findings;
}

/**
 * R4 (#7640): et split er "tabte tid" (filmen og "hvor tabte min rytter tid"
 * læser det sådan). Splittets gap_seconds er afstanden til gruppen det kom
 * fra; et negativt hul betyder at rytteren kom FORAN, altså et angreb.
 */
export function ruleSplitNeverAhead(input) {
  const findings = [];
  (input.events ?? []).forEach((event, index) => {
    if (event?.type !== "peloton_splits") return;
    const gap = finite(event.params?.gap_seconds);
    if (gap == null || gap >= 0) return;
    findings.push(finding("R4", "split_ahead_of_source", {
      index, km: placeOf(event).km, group_id: str(event.params?.group_id),
      source_group_id: str(event.params?.source_group_id), cause: str(event.params?.cause),
    }));
  });
  return findings;
}

/** Filmen som siden viser den (raceStory.js), bygget én gang pr. etape. */
export function buildFilm(input) {
  const results = (input.stageRows ?? [])
    .filter((row) => typeof row.rider_id === "string" && typeof row.rank === "number")
    .map((row) => {
      const gap = parseGapSeconds(row.finish_time);
      return gap == null ? { rider_id: row.rider_id, rank: row.rank } : { rider_id: row.rider_id, rank: row.rank, gap_s: gap };
    });
  return buildRaceStory({ events: input.events, timelineVersion: input.timelineVersion ?? null, results, startlist: input.startlist });
}

/** R5: filmens mål (gruppe og hul pr. rytter) mod etaperesultatet. */
export function ruleFilmMatchesResult(input, film = buildFilm(input)) {
  const findings = [];
  if (!film || film.time_trial) return findings;
  const finish = [...(film.checkpoints ?? [])].reverse().find((c) => c.kind === "finish");
  if (!finish) {
    if ((input.stageRows ?? []).length) findings.push(finding("R5", "film_without_finish"));
    return findings;
  }
  const rows = [...(input.stageRows ?? [])].filter((row) => typeof row.rank === "number").sort((a, b) => a.rank - b.rank);
  // Filmens egen top ved målstregen (motorens rækkefølge): samme rytter på samme
  // plads og med samme hul som i resultatet. Fanger en byttet vinder, også når
  // hele gruppen har samme hul.
  const byRider = new Map(rows.map((row) => [row.rider_id, row]));
  for (const entry of Array.isArray(finish.top) ? finish.top : []) {
    const riderId = str(entry?.rider_id);
    const rank = finite(entry?.rank);
    if (!riderId || rank == null) continue;
    const row = byRider.get(riderId);
    if (!row) {
      findings.push(finding("R5", "film_top_rider_without_result", { rider_id: riderId, rank }));
      continue;
    }
    if (row.rank !== rank) findings.push(finding("R5", "film_top_rank_mismatch", { rider_id: riderId, rank: row.rank, film_rank: rank }));
    const gap = finite(entry?.gap);
    const resultGap = parseGapSeconds(row.finish_time);
    if (gap != null && resultGap != null && Math.abs(gap - resultGap) > TIME_TOLERANCE_S) {
      findings.push(finding("R5", "film_top_gap_mismatch", { rider_id: riderId, rank: row.rank }));
    }
  }
  let previous = null;
  for (const row of rows) {
    const resultGap = parseGapSeconds(row.finish_time);
    const film = checkpointGapForRider(finish, row.rider_id);
    if (!film) {
      findings.push(finding("R5", "finisher_missing_in_film", { rider_id: row.rider_id, rank: row.rank }));
      continue;
    }
    if (resultGap != null && Math.abs(film.gap_s - resultGap) > TIME_TOLERANCE_S) {
      findings.push(finding("R5", "finish_gap_mismatch", { rider_id: row.rider_id, rank: row.rank, group_id: film.group_id }));
    }
    if (previous && film.gap_s < previous.gap - TIME_TOLERANCE_S) {
      findings.push(finding("R5", "finish_order_mismatch", { rider_id: row.rider_id, rank: row.rank, group_id: film.group_id, ahead_of_rank: previous.rank }));
    }
    previous = { gap: film.gap_s, rank: row.rank };
  }
  return findings;
}

/** R6: plan-led (sat, hentet), vinder- og uheldsmomenter mod filmen og resultatet. */
export function ruleClaimsMatchGroup(input) {
  const findings = [];
  const everInEscape = new Set();
  replayTimeline(input.events, input.startlist, (event, index, view) => {
    if (event.type === "stage_plan_leg") {
      const riderId = str(event.params?.rider_id);
      if (!riderId) return;
      const reason = event.params?.reason;
      const groupId = view.groupOf(riderId);
      const place = placeOf(event);
      if (reason === "dropped") {
        const joined = view.joinedAt(riderId);
        if (joined?.exact && groupId && !view.isAttack(groupId) && place.km - joined.km > PLAN_STAMP_TOLERANCE_KM) {
          findings.push(finding("R6", "dropped_stamped_after_split", { index, km: place.km, rider_id: riderId, split_km: joined.km, split_index: joined.index }));
        }
      } else if (reason === "caught" || reason === "missed_break") {
        if (groupId && view.isAttack(groupId) && view.formationOf(groupId)?.via === "breakaway_formed") {
          findings.push(finding("R6", `${reason}_while_in_break`, { index, km: place.km, rider_id: riderId, group_id: groupId }));
        }
      }
    }
    if (event.type === "stage_plan_leg" && event.params?.reason === "caught") {
      const riderId = str(event.params?.rider_id);
      if (riderId && !everInEscape.has(riderId)) findings.push(finding("R6", "caught_never_in_break", { index, km: placeOf(event).km, rider_id: riderId }));
    }
    if (event.type === "breakaway_formed") for (const id of ids(event.params?.rider_ids)) everInEscape.add(id);
  });

  const rows = [...(input.stageRows ?? [])].filter((row) => typeof row.rank === "number").sort((a, b) => a.rank - b.rank);
  // Udgang og tidstab står i tidslinjen (uheld undervejs) og i race_incidents
  // (også udtrækning og tidsgrænse, som ikke er en hændelse på vejen).
  const abandoned = new Set();
  const timeLoss = new Set();
  const incidentRows = [
    ...(input.events ?? []).filter((event) => event?.type === "incident").map((event) => event.params ?? {}),
    ...(input.incidents ?? []),
  ];
  for (const row of incidentRows) {
    const riderId = str(row?.rider_id);
    if (!riderId) continue;
    if (row.outcome === "abandoned" || row.outcome === "abandon") abandoned.add(riderId);
    if (row.outcome === "time_loss") timeLoss.add(riderId);
  }
  for (const moment of input.moments ?? []) {
    const key = moment?.moment_key;
    const p = moment?.params ?? {};
    const riderId = str(p.riderId);
    if (WIN_MOMENT_KEYS.has(key) && rows.length) {
      if (riderId && riderId !== rows[0].rider_id) findings.push(finding("R6", "win_moment_not_stage_winner", { moment: key, rider_id: riderId }));
      const claimed = finite(p.gapSeconds);
      const secondGap = rows[1] ? parseGapSeconds(rows[1].finish_time) : null;
      if (claimed != null && secondGap != null && Math.abs(claimed - secondGap) > TIME_TOLERANCE_S) {
        findings.push(finding("R6", "win_margin_mismatch", { moment: key }));
      }
    } else if (key === "incident_abandon" && riderId && !abandoned.has(riderId)) {
      findings.push(finding("R6", "abandon_moment_without_abandon", { rider_id: riderId }));
    } else if (key === "incident_time_loss" && riderId && !timeLoss.has(riderId)) {
      findings.push(finding("R6", "time_loss_moment_without_incident", { rider_id: riderId }));
    } else if (key === "breakaway_caught") {
      const claimed = finite(p.count);
      const marked = (input.stageRows ?? []).filter((row) => row.breakaway_caught === true).length;
      if (claimed != null && claimed !== marked) findings.push(finding("R6", "caught_count_mismatch", { moment: key }));
    }
  }
  return findings;
}

/**
 * R7: GC = summen af etapernes huller minus bonussekunder; bonus og point pr.
 * etape = summen af passagerne; trøjerne står i rækkefølge efter summen.
 * Kun ryttere med en etape-række tæller (en udgået rytter har ingen).
 */
export function ruleStandingsAddUp(input) {
  const findings = [];
  const stage = input.stageNumber;
  const allRows = input.raceRows ?? [];
  const stageRows = allRows.filter((row) => row.result_type === "stage" && row.stage_number === stage);
  const passages = (input.passages ?? []).filter((row) => row.stage_number === stage);

  const passageSum = new Map(); // rider -> { bonus, sprint, kom }
  for (const row of passages) {
    if (typeof row.rider_id !== "string") continue;
    const sum = passageSum.get(row.rider_id) ?? { bonus: 0, sprint: 0, kom: 0 };
    sum.bonus += finite(row.bonus_seconds) ?? 0;
    if (row.waypoint_kind === "kom") sum.kom += finite(row.points) ?? 0;
    else sum.sprint += finite(row.points) ?? 0;
    passageSum.set(row.rider_id, sum);
  }
  if (passages.length) {
    for (const row of stageRows) {
      const sum = passageSum.get(row.rider_id) ?? { bonus: 0, sprint: 0, kom: 0 };
      if ((finite(row.bonus_seconds) ?? 0) !== sum.bonus) findings.push(finding("R7", "stage_bonus_not_passages", { rider_id: row.rider_id }));
      if (row.sprint_points != null && (finite(row.sprint_points) ?? 0) !== sum.sprint) findings.push(finding("R7", "stage_points_not_passages", { rider_id: row.rider_id }));
      if (row.kom_points != null && (finite(row.kom_points) ?? 0) !== sum.kom) findings.push(finding("R7", "stage_kom_not_passages", { rider_id: row.rider_id }));
    }
  }

  // Mellem-etaper skriver leader/points_day/mountain_day; slut-etapen skriver
  // gc/points/mountain (raceRunner.js). Et endagsløb (ingen etape-rækker) har
  // kun dagens resultat i gc-rækkerne, og der er ingen sum at tjekke.
  const hasStageRows = stageRows.length > 0;
  const finalOr = (dayType, finalType) => {
    const day = allRows.filter((row) => row.result_type === dayType && row.stage_number === stage);
    if (day.length || !hasStageRows) return day;
    return allRows.filter((row) => row.result_type === finalType && row.stage_number === stage);
  };
  const gcRows = finalOr("leader", "gc");
  if (gcRows.length) {
    const totals = new Map(); // rider -> { secs, stages }
    const cumulative = new Map(); // rider -> { sprint, kom }
    let complete = true;
    for (let n = 1; n <= stage; n += 1) {
      const rowsN = allRows.filter((row) => row.result_type === "stage" && row.stage_number === n);
      if (!rowsN.length) { complete = false; break; }
      for (const row of rowsN) {
        const gap = parseGapSeconds(row.finish_time);
        const total = totals.get(row.rider_id) ?? { secs: 0, stages: 0 };
        if (gap != null) { total.secs += gap - (finite(row.bonus_seconds) ?? 0); total.stages += 1; }
        totals.set(row.rider_id, total);
        const c = cumulative.get(row.rider_id) ?? { sprint: 0, kom: 0 };
        c.sprint += finite(row.sprint_points) ?? 0;
        c.kom += finite(row.kom_points) ?? 0;
        cumulative.set(row.rider_id, c);
      }
    }
    if (complete) {
      const eligible = gcRows.filter((row) => totals.get(row.rider_id)?.stages === stage);
      const best = Math.min(...eligible.map((row) => totals.get(row.rider_id).secs));
      for (const row of eligible) {
        const expected = totals.get(row.rider_id).secs - best;
        const shown = parseGapSeconds(row.finish_time);
        if (shown != null && Math.abs(shown - expected) > TIME_TOLERANCE_S) findings.push(finding("R7", "gc_gap_not_sum_of_stages", { rider_id: row.rider_id, rank: row.rank }));
      }
      // Klassementet tager kun ryttere med tid på ALLE kørte etaper med
      // (raceRunner.js filterCompletedEntrants); en rytter der mangler én, er forkert.
      for (const row of gcRows) {
        const total = totals.get(row.rider_id);
        if (!total) findings.push(finding("R7", "gc_rider_without_stage_rows", { rider_id: row.rider_id, rank: row.rank }));
        else if (total.stages < stage) findings.push(finding("R7", "gc_rider_missing_stage", { rider_id: row.rider_id, rank: row.rank }));
      }
      const jerseys = [[finalOr("points_day", "points"), "sprint", "points_order_not_sum"], [finalOr("mountain_day", "mountain"), "kom", "mountain_order_not_sum"]];
      for (const [jerseyRows, field, code] of jerseys) {
        const ranked = jerseyRows.filter((row) => typeof row.rank === "number").sort((a, b) => a.rank - b.rank);
        for (let i = 1; i < ranked.length; i += 1) {
          const above = cumulative.get(ranked[i - 1].rider_id)?.[field];
          const below = cumulative.get(ranked[i].rider_id)?.[field];
          if (above != null && below != null && below > above) findings.push(finding("R7", code, { rider_id: ranked[i].rider_id, rank: ranked[i].rank }));
        }
      }
    }
    const sorted = [...gcRows].filter((row) => typeof row.rank === "number").sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < sorted.length; i += 1) {
      const above = parseGapSeconds(sorted[i - 1].finish_time);
      const below = parseGapSeconds(sorted[i].finish_time);
      if (above != null && below != null && below < above) findings.push(finding("R7", "gc_order_not_gap_order", { rider_id: sorted[i].rider_id, rank: sorted[i].rank }));
    }
  }
  return findings;
}

/**
 * Dagens resultat-rækker: etapens `stage`-rækker; et endagsløb (etape 1 uden
 * etape-rækker) har sit resultat i `gc`-rækkerne. Samme valg som
 * raceStory.storyInputsFromResults og etapesiden.
 */
export function dayRowsFor(raceRows = [], stageNumber) {
  const onStage = (row) => row.stage_number === stageNumber || (stageNumber === 1 && row.stage_number == null);
  const stageRows = raceRows.filter((row) => row.result_type === "stage" && onStage(row));
  if (stageRows.length || stageNumber !== 1) return stageRows;
  return raceRows.filter((row) => row.result_type === "gc" && onStage(row));
}

/** Startlisten: alle med en etape-række plus alle tidslinjen navngiver. */
export function startlistFor(events = [], stageRows = []) {
  const out = new Set();
  for (const row of stageRows) if (typeof row.rider_id === "string") out.add(row.rider_id);
  for (const event of events) for (const id of namedRiderIds(event)) out.add(id);
  return [...out].sort();
}

/**
 * Kører alle syv regler for én etape. En regel der kaster, bliver til et
 * `guard_error`-fund (vagten må aldrig vælte); resten kører videre.
 * @param {{ raceId: string, stageNumber: number, timelineVersion?: number|null,
 *   events: object[], raceRows: object[], passages?: object[], moments?: object[] }} stage
 */
export function checkStage(stage) {
  let input;
  try {
    const events = (Array.isArray(stage?.events) ? stage.events : []).filter((e) => e && typeof e === "object");
    const raceRows = (Array.isArray(stage?.raceRows) ? stage.raceRows : []).filter((r) => r && typeof r === "object");
    const stageRows = dayRowsFor(raceRows, stage.stageNumber);
    input = { ...stage, events, raceRows, stageRows, startlist: startlistFor(events, stageRows) };
  } catch (err) {
    return [{ race_id: stage?.raceId, stage_number: stage?.stageNumber, rule: "GUARD", code: "guard_error", error: String(err?.name ?? "Error") }];
  }
  const findings = [];
  const run = (rule, fn) => {
    try {
      findings.push(...fn());
    } catch (err) {
      findings.push(finding(rule, "guard_error", { error: String(err?.name ?? "Error") }));
    }
  };
  let film = null;
  run("R5", () => { film = buildFilm(input); return []; });
  run("R1", () => ruleDroppedInFront(input));
  run("R2", () => ruleAbandonedGone(input));
  run("R3", () => ruleCatchAfterFormation(input));
  run("R4", () => ruleSplitNeverAhead(input));
  if (film) run("R5", () => ruleFilmMatchesResult(input, film));
  run("R6", () => ruleClaimsMatchGroup(input));
  run("R7", () => ruleStandingsAddUp(input));
  return findings.map((f) => ({ race_id: stage.raceId, stage_number: stage.stageNumber, ...f, km: round2(f.km), formed_km: round2(f.formed_km), split_km: round2(f.split_km) }))
    .map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined)));
}

/**
 * Den offentlige del af et fund: regel og kode, aldrig id'er på ryttere,
 * tider eller huller (repoet og Actions-loggen er offentlige).
 */
export function publicFinding(f) {
  return { race_id: f.race_id, stage_number: f.stage_number, rule: f.rule, code: f.code };
}

/** Tæller fund pr. regel og kode (til ops-beskeden). */
export function summarize(findings = []) {
  const byRule = {};
  for (const f of findings) {
    const rule = (byRule[f.rule] ??= { total: 0, codes: {} });
    rule.total += 1;
    rule.codes[f.code] = (rule.codes[f.code] ?? 0) + 1;
  }
  return byRule;
}
