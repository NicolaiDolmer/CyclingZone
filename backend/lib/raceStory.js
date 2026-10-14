// backend/lib/raceStory.js
// #6350 #6234 #6469 #6512 (spor A for etapeside 2.0, #6570): løbshistorien som
// én ren afledning af etapens tidslinje (race_stage_timelines.events).
// Regler (SSOT): docs/RACE_ENGINE_RULES.md, afsnittet "Løbshistorien".
// Kontrakt (felter): docs/superpowers/specs/2026-10-14-race-story-contract.md
//
// Leverer tre ting til siden, alt udledt af loggen, intet opdigtet:
//   1. moments    - de afgørende øjeblikke: km (eller ærligt km-spænd), race-tid,
//                   tekst-nøgle + data.
//   2. checkpoints - mellemtider pr. top, spurt og mål: førerens tid, førergruppe
//                   og hullet for enhver gruppe (og dermed enhver rytter).
//   3. snapshots  - gruppernes positioner pr. tjekpunkt (til replay, inkl. de
//                   sidste 5 km via replayFrames).
//
// Kilden til tider er motorens egen kodning (engine/v4, official_times_v2+):
//   - `gap_update` udsendes pr. gruppe BAG fronten, kun når hullet har flyttet
//     sig siden sidste melding (segmentLoop.ts). En gruppe uden ny melding har
//     derfor stadig sit sidst meldte hul ("carried").
//   - `params.exact_time` er gruppens ankomsttid (s siden start) på
//     `params.exact_km` (exactPlace.ts). Førerens tid på et tjekpunkt er derfor
//     exact_time - gap_seconds for enhver melding på det km.
//   - Mellem to tjekpunkter bevæger hver linje sig med konstant tempo (samme
//     bevægelsesgrundlag som exactPlace.ts), så interpolation er motorens egen
//     model, ikke et gæt.
//
// #6234: en "indhentning" er kun en indhentning, når de indhentede ender i en
// gruppe med ryttere uden for dagens udbrud. En sammenkomst inden i udbruddet
// er en samling, og en kontakt mellem to grupper uden udbrydere er en
// sammenkomst af grupper, ikke "udbruddet hentet".
//
// #6469: ændrer et hul sig mere end en visningstærskel mellem to meldinger, uden
// at loggen har en hændelse i det vindue der rører gruppen eller fronten, får
// historien en afledt linje med km-vinduet og terrænet (toppe/spurter) i det.
//
// REN: ingen IO, input muteres aldrig, samme input giver samme output.
// Motoren og løbsudfaldet røres ikke: dette er kun hvad der vises.

import { deriveParticipationHistory, nonEscapeeAheadByRider, settleBreakawayOutcome } from "./raceParticipationHistory.ts";

export const RACE_STORY_VERSION = 1;

/** #6469: visningstærskel (sekunder) for et hul der skal forklares. */
export const GAP_CHANGE_EXPLAIN_SECONDS = 60;

/** Replay: frames over de sidste km (ejer-krav: inkl. de sidste 5 km). */
export const REPLAY_FINALE_KM = 5;

const REST_GROUP_ID = "peloton-0";

// Hændelser motoren stempler ved tjekpunktet (segmentets slut-km) på en v4-
// tidslinje uden exact_km (orders_gc_v2 og ældre v4-revisioner). Samme liste
// som frontendens stageTimelineKmSpan.ts.
const CHECKPOINT_STAMPED = new Set(["group_merged", "breakaway_caught", "peloton_splits", "breakaway_dropped"]);
const PASSAGES = new Set(["kom_passage", "intermediate_sprint"]);

// Bogføring i motoren, aldrig en linje i historien.
const BOOKKEEPING_ATTACK_KINDS = new Set(["stage_decided", "placement_gap", "gap_survived"]);
const SKIPPED_TYPES = new Set(["gap_update", "gc_context", "ttt_team_result"]);

// Hændelser der flytter grupper og derfor kan forklare et hul (#6469).
const STRUCTURE_TYPES = new Set([
  "breakaway_formed", "breakaway_caught", "breakaway_dropped", "breakaway_survived",
  "peloton_splits", "group_merged", "finale_attack", "favorite_crack", "incident",
]);

// Fog-gate (#1791): nøgler historien aldrig sender videre, selv hvis en ældre
// tidslinje skulle bære dem. Samme sæt som engine/v4/timeline.ts.
const FOG_KEYS = new Set([
  "cp", "wprime", "wprimemax", "dayform", "seconds_over_cp", "work_norm",
  "cohesion", "demand", "collectivecp", "deficit", "noise", "weight",
  "weights", "probability", "score", "energydeficit", "cpweights",
  "wprimeweights", "components", "finalscore", "terrain",
]);

function finite(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ids(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && id.length > 0) : [];
}

function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Rytterne en hændelse navngiver: `rider_ids` (liste) og/eller `rider_id`
 * (ental). Et rigtigt sent angreb (lateAttack.ts) skriver kun `rider_id`.
 */
function namedRiders(p) {
  const out = ids(p?.rider_ids);
  const single = str(p?.rider_id);
  if (single && !out.includes(single)) out.push(single);
  return out;
}

function cleanParams(params) {
  const out = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (FOG_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/** Engine-ordering km (det motoren skrev), aldrig flyttet. */
function recordedKm(event) {
  return finite(event?.km) ?? 0;
}

/** Hændelsens sande km: exact_km når motoren kender det, ellers dens egen km. */
function placeKm(event) {
  return finite(event?.params?.exact_km) ?? finite(event?.exact_km) ?? recordedKm(event);
}

// ── Gruppe-medlemskab (replay af loggen) ──────────────────────────────────────
// Feltet starter samlet i "peloton-0". Ryttere der ikke er nævnt i en anden
// gruppe, kører i "resten" (rest-gruppen følger peloton-0's id gennem merges),
// så historien virker uden startliste. Et uheldsoffer kører i sin egen solo-
// gruppe (`solo-m10-<segment>-<seq>`), som incident-eventet ikke navngiver.
// Rytteren udledes af id'et med motorens egen navngivning (incidents.ts,
// makeIncidentSoloGroupId), ikke af rækkefølgen grupperne nævnes i
// (`members_inferred: true`):
//   - M10 behandler et segments kandidater i rider_id-orden (localeCompare),
//     og hvert uheld der tager rytteren ud af gruppen (tidstab ELLER
//     udgåelse, ikke 3 km-reglen) får næste <seq>. Et uheld fra en anden
//     mekanik (`cause`, fx nedkørslen) får ikke et solo-m10-id.
//   - Segmentets uheld er de endnu ikke tildelte M10-uheld på eller før det
//     km hvor gruppen først nævnes (motoren melder en ny gruppe ved
//     segmentets slut), afgrænset af de segmenter der allerede er tildelt.
// Kan id'et ikke føres tilbage til en ventende rytter, forbliver han ventende
// (hullet er ukendt), hellere end at få en anden rytters gruppe.

const INCIDENT_SOLO_ID = /^solo-m10-(\d+)-(\d+)$/;

function createMembership(fieldCount) {
  return {
    fieldCount,
    groups: new Map(), // id -> Set(rider)
    restId: REST_GROUP_ID,
    placed: new Map(), // rider -> group id (eksplicit placeret)
    abandoned: new Set(),
    pendingSolo: [], // uheldsofre uden kendt gruppe endnu
    inferred: new Set(), // gruppe-id'er hvis medlemmer er udledt
    m10Incidents: [], // { rider, km, assigned } - M10-uheld der tog rytteren ud af gruppen
    m10Segments: new Map(), // segment -> { riders (seq-orden), minKm, maxKm }
    m10Seen: new Set(), // solo-m10-id'er der allerede er ført tilbage
  };
}

function removeRider(m, id) {
  const current = m.placed.get(id);
  if (current) m.groups.get(current)?.delete(id);
  m.placed.delete(id);
}

function placeRiders(m, groupId, riderIds) {
  if (!groupId) return;
  if (!m.groups.has(groupId)) m.groups.set(groupId, new Set());
  for (const id of riderIds) {
    // En udgået rytter kører aldrig igen, heller ikke hvis en senere hændelse
    // (fx en sammenlægning) stadig nævner ham.
    if (m.abandoned.has(id)) continue;
    removeRider(m, id);
    m.pendingSolo = m.pendingSolo.filter((p) => p !== id);
    m.groups.get(groupId).add(id);
    m.placed.set(id, groupId);
  }
}

function ensureGroup(m, groupId) {
  if (!groupId || m.groups.has(groupId) || groupId === m.restId) return;
  m.groups.set(groupId, new Set());
}

/** Segmentets M10-uheld i motorens seq-orden (se blokken øverst). */
function incidentSegmentRiders(m, segment, km) {
  const known = m.m10Segments.get(segment);
  if (known) return known.riders;
  let lo = -Infinity;
  let hi = Infinity;
  for (const [s, info] of m.m10Segments) {
    if (info.minKm == null) continue;
    if (s < segment) lo = Math.max(lo, info.maxKm);
    else if (s > segment) hi = Math.min(hi, info.minKm);
  }
  const inSegment = m.m10Incidents.filter((x) => !x.assigned && x.km <= km + 1e-9 && x.km >= lo - 1e-9 && x.km <= hi + 1e-9);
  for (const x of inSegment) x.assigned = true;
  const riders = inSegment.map((x) => x.rider).sort((a, b) => a.localeCompare(b));
  const kms = inSegment.map((x) => x.km);
  m.m10Segments.set(segment, { riders, minKm: kms.length ? Math.min(...kms) : null, maxKm: kms.length ? Math.max(...kms) : null });
  return riders;
}

/** Første gang loggen nævner en uheldsgruppe: knyt dens rytter til den. */
function resolveIncidentGroup(m, groupId, km) {
  const match = INCIDENT_SOLO_ID.exec(groupId ?? "");
  if (!match || m.m10Seen.has(groupId)) return;
  m.m10Seen.add(groupId);
  const rider = incidentSegmentRiders(m, Number(match[1]), km)[Number(match[2])];
  if (!rider || !m.pendingSolo.includes(rider)) return;
  placeRiders(m, groupId, [rider]);
  m.inferred.add(groupId);
}

function mergeGroups(m, fromId, intoId, namedIds) {
  if (!fromId || !intoId || fromId === intoId) return;
  ensureGroup(m, intoId);
  const moving = new Set([...(m.groups.get(fromId) ?? []), ...namedIds]);
  if (fromId === m.restId) {
    // Resten (de unavngivne) følger med ind i den nye gruppe.
    m.restId = intoId;
  }
  m.groups.delete(fromId);
  placeRiders(m, intoId, [...moving]);
  if (m.inferred.has(fromId)) m.inferred.add(intoId);
}

/** Uafhængig kopi af medlemskabet (tilstanden på en passage, uden at røre replayet). */
function cloneMembership(m) {
  return {
    ...m,
    groups: new Map([...m.groups].map(([id, members]) => [id, new Set(members)])),
    placed: new Map(m.placed),
    abandoned: new Set(m.abandoned),
    pendingSolo: [...m.pendingSolo],
    inferred: new Set(m.inferred),
    m10Incidents: m.m10Incidents.map((x) => ({ ...x })),
    m10Segments: new Map(m.m10Segments),
    m10Seen: new Set(m.m10Seen),
  };
}

/**
 * Gruppen en hændelse danner på vejen og gruppen den kom fra (samme regler
 * som medlemskabet), eller null.
 */
function spanOpening(event, restId) {
  const p = event.params ?? {};
  const groupId = str(p.group_id);
  if (!groupId) return null;
  switch (event.type) {
    case "breakaway_formed":
      return ids(p.rider_ids).length ? { groupId, source: restId } : null;
    case "peloton_splits":
    case "breakaway_dropped":
      return ids(p.rider_ids).length ? { groupId, source: str(p.source_group_id) ?? str(p.from_group_id) } : null;
    case "finale_attack":
      return namedRiders(p).length && !BOOKKEEPING_ATTACK_KINDS.has(p.kind) ? { groupId, source: str(p.source_group_id) } : null;
    default:
      return null;
  }
}

function abandonRider(m, id) {
  removeRider(m, id);
  // Et uheldsoffer der senere udgår, venter ikke længere på sin solo-gruppe
  // (ellers tælles han dobbelt uden for resten og kan knyttes til en gruppe).
  m.pendingSolo = m.pendingSolo.filter((p) => p !== id);
  m.abandoned.add(id);
}

function applyMembership(m, event) {
  const p = event.params ?? {};
  const named = ids(p.rider_ids);
  const groupId = str(p.group_id);
  for (const id of [p.group_id, p.into_group_id, p.source_group_id, p.from_group_id, p.chase_group_id]) {
    if (str(id)) resolveIncidentGroup(m, id, recordedKm(event));
  }
  switch (event.type) {
    case "breakaway_formed":
    case "peloton_splits":
    case "breakaway_dropped":
      if (groupId && named.length) placeRiders(m, groupId, named);
      break;
    case "finale_attack": {
      // lateAttack.ts navngiver angriberen i `rider_id` (ental).
      const attackers = namedRiders(p);
      if (groupId && attackers.length && !BOOKKEEPING_ATTACK_KINDS.has(p.kind)) placeRiders(m, groupId, attackers);
      break;
    }
    case "group_merged":
      mergeGroups(m, groupId, str(p.into_group_id), named);
      break;
    case "incident": {
      const rider = str(p.rider_id);
      if (!rider || m.abandoned.has(rider)) break;
      // M10's egne uheld (uden `cause`) tager et solo-m10-seq, også en udgåelse.
      if (p.cause == null && (p.outcome === "abandoned" || p.outcome === "time_loss")) {
        m.m10Incidents.push({ rider, km: recordedKm(event), assigned: false });
      }
      if (p.outcome === "abandoned") abandonRider(m, rider);
      else if (p.outcome === "time_loss") { removeRider(m, rider); m.pendingSolo.push(rider); }
      break;
    }
    case "outside_time_limit":
      for (const id of named) abandonRider(m, id);
      break;
    default:
      break;
  }
  if (event.type === "gap_update") ensureGroup(m, groupId);
}

function groupView(m, groupId) {
  const explicit = [...(m.groups.get(groupId) ?? [])].sort();
  if (groupId !== m.restId) {
    return { rider_ids: explicit, size: explicit.length, includes_rest: false, members_inferred: m.inferred.has(groupId) };
  }
  // Resten: eksplicitte medlemmer + alle ikke-placerede, ikke-udgåede ryttere.
  const outside = m.placed.size - explicit.length + m.abandoned.size + m.pendingSolo.length;
  const size = m.fieldCount != null ? Math.max(explicit.length, m.fieldCount - outside) : null;
  return { rider_ids: explicit, size, includes_rest: true, members_inferred: false };
}

function liveGroupIds(m) {
  const out = new Set([m.restId]);
  for (const [id, members] of m.groups) if (members.size > 0) out.add(id);
  for (const id of m.groups.keys()) if (id.startsWith("solo-m10-")) out.add(id);
  return [...out];
}

// ── Førerens tidslinje ─────────────────────────────────────────────────────────

function buildLeaderLine(events, finishKm) {
  const points = new Map([[0, 0]]);
  for (const event of events) {
    const p = event.params ?? {};
    if (event.type === "gap_update") {
      const t = finite(p.exact_time);
      const gap = finite(p.gap_seconds);
      if (t != null && gap != null) {
        const km = placeKm(event);
        const leader = round2(t - gap);
        if (!points.has(km)) points.set(km, leader);
      }
    } else if (event.type === "finish") {
      const t = finite(p.exact_time);
      if (t != null) points.set(finishKm ?? placeKm(event), round2(t));
    }
  }
  return [...points.entries()].map(([km, time]) => ({ km, time })).sort((a, b) => a.km - b.km);
}

/** Førerens tid ved et km (lineært mellem kendte punkter; null udenfor). */
export function leaderTimeAt(story, km) {
  const line = story?.leader_line ?? [];
  if (!line.length || km == null) return null;
  for (let i = 0; i < line.length; i++) {
    const point = line[i];
    if (Math.abs(point.km - km) < 1e-6) return point.time;
    if (point.km > km) {
      if (i === 0) return null;
      const prev = line[i - 1];
      return round2(prev.time + ((point.time - prev.time) * (km - prev.km)) / (point.km - prev.km));
    }
  }
  return null;
}

// ── Hovedfunktion ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   events: Array<{km?: number, type: string, params?: object}>,
 *   timelineVersion?: number|null,
 *   results?: Array<{rider_id: string, rank: number}>|null,
 *   startlist?: string[]|null,
 * }} input
 */
export function buildRaceStory({ events = [], timelineVersion = null, results = null, startlist = null } = {}) {
  // Motorens egen rækkefølge: km som skrevet, samme km = input-rækkefølgen.
  const ordered = (Array.isArray(events) ? events : [])
    .map((event, i) => ({ event, i }))
    .filter(({ event }) => event && typeof event.type === "string")
    .sort((a, b) => recordedKm(a.event) - recordedKm(b.event) || a.i - b.i)
    .map(({ event }) => event);

  const start = ordered.find((e) => e.type === "stage_start");
  const finish = ordered.find((e) => e.type === "finish");
  const distanceKm = finite(start?.params?.distance_km) ?? (finish ? recordedKm(finish) : null);
  const fieldCount = finite(start?.params?.field_count) ?? (Array.isArray(startlist) ? startlist.length : null);
  const finishKm = finish ? recordedKm(finish) : distanceKm;
  const precise = ordered.some((e) => finite(e.params?.exact_time) != null);
  // En enkeltstart/holdtidskørsel har ingen grupper at fortælle om: mellem-
  // og sluttider står i resultatet (siden bruger race_results), ikke i loggen.
  const timeTrial = /^(itt|ttt)/.test(String(start?.params?.profile_type ?? ""));

  const history = deriveParticipationHistory(ordered, Array.isArray(startlist) ? startlist : []);
  const morning = history.morningRiderIds;

  const story = {
    version: RACE_STORY_VERSION,
    timeline_version: timelineVersion ?? null,
    distance_km: distanceKm,
    field_count: fieldCount,
    precise_times: precise,
    time_trial: timeTrial,
    leader_line: timeTrial ? [] : buildLeaderLine(ordered, finishKm),
    moments: [],
    snapshots: [],
    checkpoints: [],
    group_spans: [],
    breakaway: null,
  };

  // Ærlige km-spænd for tjekpunkt-stemplede hændelser uden exact_km (#6350).
  const checkpointEngine = typeof timelineVersion === "number" && timelineVersion >= 2;
  const anchors = [...new Set([0, ...ordered
    .filter((e) => e.type === "gap_update" || PASSAGES.has(e.type) || CHECKPOINT_STAMPED.has(e.type))
    .map(recordedKm)])].sort((a, b) => a - b);
  const spanOf = (event) => {
    if (finite(event.params?.exact_km) != null || !checkpointEngine || !CHECKPOINT_STAMPED.has(event.type)) return null;
    const km = recordedKm(event);
    if (finishKm != null && km >= finishKm) return null;
    let from = 0;
    for (const a of anchors) { if (a < km) from = a; else break; }
    return from < km ? { from, to: km } : null;
  };

  const m = createMembership(fieldCount);
  const lastGap = new Map(); // group id -> { km, gap }
  const observations = []; // { km, group_id, gap } (alle gruppe-målinger)
  const snapshotsByKm = new Map();

  // record=false: tilstanden ved en passage uden gap_update på samme km (til
  // kontrolpunktet), ikke et snapshot i replay-rækken. `membership` er
  // medlemskabet på stedet; `fresh` er hullet for en gruppe der er dannet
  // siden sidste melding (passagen ligger inde i et segment).
  const takeSnapshot = (km, { record = true, membership = m, fresh = null } = {}) => {
    const leaderTime = leaderTimeAt(story, km);
    const reportedHere = new Map(observations.filter((o) => Math.abs(o.km - km) < 1e-6).map((o) => [o.group_id, o.gap]));
    const groups = [];
    for (const id of liveGroupIds(membership)) {
      const view = groupView(membership, id);
      if (view.size === 0 && !reportedHere.has(id)) continue;
      let gap; let source;
      if (reportedHere.has(id)) { gap = reportedHere.get(id); source = "reported"; }
      else if (lastGap.has(id)) { gap = lastGap.get(id).gap; source = "carried"; }
      else if (fresh?.has(id)) { gap = fresh.get(id); source = "carried"; }
      else { gap = 0; source = "front"; }
      groups.push({ group_id: id, ...view, gap: Math.max(0, gap), source });
    }
    // Fronten meldes aldrig (hul 0). Er ingen gruppe på 0, er en ikke-meldt
    // gruppe kommet forrest igen: den med mindst båret hul. Motoren har da
    // flyttet nulpunktet med netop det hul, så de andre bårne huller flyttes
    // med (en meldt gruppe står allerede mod den nye front).
    if (groups.length && !groups.some((g) => g.gap === 0)) {
      const carried = groups.filter((g) => g.source === "carried");
      if (carried.length) {
        const shift = Math.min(...carried.map((g) => g.gap));
        for (const g of carried) {
          g.gap = Math.max(0, g.gap - shift);
          if (g.gap === 0) g.source = "front";
        }
      }
    }
    for (const g of groups) {
      g.gap_s = round2(g.gap);
      g.time_s = leaderTime == null ? null : round2(leaderTime + g.gap);
      g.gap_source = g.source;
      delete g.gap;
      delete g.source;
    }
    groups.sort((a, b) => a.gap_s - b.gap_s || (b.size ?? 0) - (a.size ?? 0) || a.group_id.localeCompare(b.group_id));
    // Udgåede ryttere (uheld eller uden for tidsgrænsen) indtil dette km: de
    // har hverken mellemtid eller måltid herfra.
    // Uheldsofre der endnu ikke er knyttet til deres solo-gruppe: de er ikke i
    // resten, og deres hul kendes først når loggen navngiver gruppen.
    const snapshot = { km: round2(km), leader_time_s: leaderTime, groups, out_rider_ids: [...membership.abandoned].sort(), pending_rider_ids: [...membership.pendingSolo].sort() };
    if (record) snapshotsByKm.set(round2(km), snapshot);
    return snapshot;
  };

  // Gruppernes levetid på vejen (replay): fra split/dannelse til sammenlægning,
  // på hændelsens sande km. `rider_ids` er gruppens eksplicitte medlemmer lige
  // efter hændelsen der dannede den (så replay kan vise en gruppe der både
  // opstår og forsvinder mellem to snapshots).
  const openSpans = new Map([[REST_GROUP_ID, { group_id: REST_GROUP_ID, from_km: 0, to_km: null, source_group_id: null, into_group_id: null, rider_ids: [] }]]);
  const spans = [];
  const openSpan = (groupId, fromKm, sourceId) => {
    if (!groupId || openSpans.has(groupId)) return null;
    const span = { group_id: groupId, from_km: round2(fromKm), to_km: null, source_group_id: sourceId ?? null, into_group_id: null, rider_ids: [] };
    openSpans.set(groupId, span);
    return span;
  };
  /** Returnerer de spans hændelsen åbnede (medlemmerne sættes efter medlemskabet). */
  const trackSpans = (event) => {
    const p = event.params ?? {};
    const groupId = str(p.group_id);
    const opening = spanOpening(event, m.restId);
    if (opening) return [openSpan(opening.groupId, placeKm(event), opening.source)].filter(Boolean);
    if (event.type === "gap_update") return [openSpan(groupId, placeKm(event), null)].filter(Boolean);
    if (event.type === "group_merged") {
      const into = str(p.into_group_id);
      const span = openSpans.get(groupId);
      if (!span || !into || into === groupId) return [];
      const opened = openSpan(into, placeKm(event), null);
      // Motoren kan placere et split og en sammenlægning i samme segment med
      // kontaktpunktet før separationspunktet (to skøn fra samme endepunkter).
      // Levetiden er da nul på split-punktet, aldrig negativ.
      span.to_km = round2(Math.max(span.from_km, placeKm(event)));
      span.into_group_id = into;
      openSpans.delete(groupId);
      spans.push(span);
      return [opened].filter(Boolean);
    }
    return [];
  };
  /** Kilden til en gruppe der er åben ved km (seneste span der startede senest der). */
  const spanSourceAt = (groupId, km) => {
    let best = null;
    for (const s of [...spans, ...openSpans.values()]) {
      if (s.group_id === groupId && s.from_km <= km + 1e-9 && (!best || s.from_km >= best.from_km)) best = s;
    }
    return best?.source_group_id ?? null;
  };
  const passageStates = new Map(); // km -> tilstand ved en passage uden snapshot

  // Tilstanden PÅ en passage inde i et segment. Motoren stempler strukturelle
  // hændelser ved segmentets slut (`km`), men de skete på `exact_km`: et split
  // med exact_km før passagen er sket når feltet passerer toppen, også selv om
  // dets km er segmentets slut. Medlemskabet er derfor loggen til og med
  // passagen PLUS de senere stemplede hændelser hvis sande km ligger
  // før passagen (i motorens rækkefølge, på en kopi). En gruppe dannet siden
  // sidste melding får sit eget målte hul (hændelsens exact_time på dens
  // exact_km), ellers hullet fra gruppen den kom fra; aldrig "forrest" af mangel
  // på en melding.
  const passageState = (km) => {
    const early = ordered.filter((e) => recordedKm(e) > km + 1e-9 && placeKm(e) < km - 1e-9);
    const membership = early.length ? cloneMembership(m) : m;
    const sources = new Map();
    for (const e of early) {
      const opening = spanOpening(e, membership.restId);
      if (opening && !sources.has(opening.groupId)) sources.set(opening.groupId, opening.source);
      applyMembership(membership, e);
    }
    const measured = new Map(); // group -> { km, gap }
    for (const e of ordered) {
      const pk = placeKm(e);
      const ep = e.params ?? {};
      const gid = str(ep.group_id);
      const t = finite(ep.exact_time);
      if (pk > km + 1e-9 || !gid || t == null) continue;
      // En sammenlægning/indhentning måler gruppen der forsvinder, et uheld
      // rytterens egen tid (inkl. stoppet), og bogføringen er ingen måling.
      if (e.type === "incident" || e.type === "breakaway_caught" || e.type === "group_merged") continue;
      if (e.type === "finale_attack" && BOOKKEEPING_ATTACK_KINDS.has(ep.kind)) continue;
      const leader = leaderTimeAt(story, pk);
      if (leader == null) continue;
      const prev = measured.get(gid);
      if (!prev || pk >= prev.km) measured.set(gid, { km: pk, gap: round2(Math.max(0, t - leader)) });
    }
    const resolve = (id, depth) => {
      if (!id || depth > 8) return null;
      if (lastGap.has(id)) return lastGap.get(id).gap;
      if (measured.has(id)) return measured.get(id).gap;
      return resolve(sources.get(id) ?? spanSourceAt(id, km), depth + 1);
    };
    const fresh = new Map();
    for (const id of liveGroupIds(membership)) {
      if (lastGap.has(id)) continue;
      const gap = resolve(id, 0);
      if (gap != null) fresh.set(id, gap);
    }
    return takeSnapshot(km, { record: false, membership, fresh });
  };

  const momentFor = (event, extra = {}) => {
    const p = event.params ?? {};
    const km = placeKm(event);
    const span = spanOf(event);
    const eventTime = finite(p.exact_time);
    const raceTime = eventTime ?? (span ? null : leaderTimeAt(story, km));
    return {
      type: event.type,
      key: `story.${event.type}`,
      km: span ? span.from : round2(km),
      ...(span ? { km_span: span, recorded_km: recordedKm(event) } : {}),
      race_time_s: raceTime,
      time_source: eventTime != null ? "event" : raceTime != null ? "leader_line" : null,
      importance: "detail",
      data: cleanParams(p),
      ...extra,
    };
  };

  const moments = [];
  const regroupCatches = history.regroupCatches;
  const kmGroups = new Map();
  for (const event of ordered) {
    const km = recordedKm(event);
    if (!kmGroups.has(km)) kmGroups.set(km, []);
    kmGroups.get(km).push(event);
  }

  for (const [km, atKm] of [...kmGroups.entries()].sort((a, b) => a[0] - b[0])) {
    for (const event of atKm) {
      const p = event.params ?? {};
      if (event.type === "breakaway_caught") {
        const caught = ids(p.rider_ids);
        const morningCaught = caught.filter((id) => morning.has(id));
        // Jagtgruppen før kontakten (egen replay): rummer den kun udbrydere, er
        // det en samling i udbruddet. Resten (feltet) rummer altid andre.
        const chaseId = str(p.chase_group_id);
        const chasers = chaseId && chaseId !== m.restId ? [...(m.groups.get(chaseId) ?? [])].filter((id) => !caught.includes(id)) : [];
        const escapeesOnly = chasers.length > 0 && chasers.every((id) => morning.has(id));
        let key = "story.breakaway_caught";
        if (regroupCatches.has(event) || escapeesOnly) key = "story.breakaway_regrouped";
        else if (morningCaught.length === 0) key = "story.group_caught";
        moments.push(momentFor(event, { key, importance: key === "story.breakaway_caught" ? "key" : "detail" }));
      } else if (!SKIPPED_TYPES.has(event.type)) {
        const moment = describeMoment(event, momentFor, m);
        if (moment) moments.push(moment);
      }
      const opened = trackSpans(event);
      applyMembership(m, event);
      for (const span of opened) span.rider_ids = [...(m.groups.get(span.group_id) ?? [])].sort();
      if (event.params && str(p.group_id) && finite(p.exact_time) != null && event.type !== "incident") {
        const leader = leaderTimeAt(story, placeKm(event));
        if (leader != null) {
          const gap = round2(Math.max(0, finite(p.exact_time) - leader));
          // Kun målinger på et tjekpunkt indgår i snapshots; inde i et segment
          // er det kun hændelsens egen tid. En indhentning/sammenlægning måler
          // den gruppe der forsvinder (eller en afgjort indhentning på stregen,
          // groups.ts), så den er aldrig en gruppe-måling (CodeRabbit).
          const live = (m.groups.get(p.group_id)?.size ?? 0) > 0 || p.group_id === m.restId;
          if (event.type === "gap_update"
            || (Math.abs(placeKm(event) - km) < 1e-6 && live && event.type !== "breakaway_caught" && event.type !== "group_merged")) {
            observations.push({ km, group_id: p.group_id, gap });
          }
        }
      }
    }
    const hasCheckpoint = atKm.some((e) => e.type === "gap_update" || e.type === "finish" || e.type === "stage_start");
    if (timeTrial) continue;
    if (!hasCheckpoint) {
      // Motoren melder ikke et uændret hul, så en top/spurt kan mangle en
      // gap_update. Kontrolpunktet får tilstanden PÅ passagen: grupperne som
      // de er efter loggen til og med dette sande km (passageState), hullerne
      // båret fra sidste melding. Aldrig et senere snapshot (det er fremtid).
      if (atKm.some((e) => PASSAGES.has(e.type))) passageStates.set(round2(km), passageState(km));
      continue;
    }
    const previous = new Map(lastGap);
    const snapshot = takeSnapshot(km);
    for (const g of snapshot.groups) lastGap.set(g.group_id, { km, gap: g.gap_s });
    // #6469: hul der flytter sig over tærsklen uden en forklarende hændelse.
    const explained = (fromKm, groupId, leaderIds) => ordered.some((e) => {
      const rk = recordedKm(e);
      if (!(rk > fromKm && rk <= km) || !STRUCTURE_TYPES.has(e.type)) return false;
      const ep = e.params ?? {};
      const touched = [ep.group_id, ep.into_group_id, ep.chase_group_id, ep.source_group_id, ep.from_group_id].filter(Boolean);
      return touched.some((id) => id === groupId || leaderIds.has(id));
    });
    const leaderIds = new Set(snapshot.groups.filter((g) => g.gap_s === 0).map((g) => g.group_id));
    // Løbets hul er hullet mellem fronten og den første gruppe bag den.
    const firstChaseId = snapshot.groups.find((g) => g.gap_s > 0)?.group_id ?? null;
    for (const g of snapshot.groups) {
      const prev = previous.get(g.group_id);
      if (!prev || g.gap_source !== "reported") continue;
      const delta = round2(g.gap_s - prev.gap);
      if (Math.abs(delta) < GAP_CHANGE_EXPLAIN_SECONDS) continue;
      const prevLeaders = new Set((snapshotsByKm.get(round2(prev.km))?.groups ?? []).filter((x) => x.gap_s === 0).map((x) => x.group_id));
      const allLeaders = new Set([...leaderIds, ...prevLeaders]);
      if (explained(prev.km, g.group_id, allLeaders)) continue;
      const terrain = ordered.filter((e) => PASSAGES.has(e.type) && recordedKm(e) > prev.km && recordedKm(e) <= km)
        .map((e) => ({ type: e.type, km: placeKm(e), name: e.params?.name ?? null, category: e.params?.category ?? null }));
      moments.push({
        type: "gap_change",
        key: delta > 0 ? "story.gap_grew" : "story.gap_shrank",
        km: round2(prev.km),
        km_span: { from: round2(prev.km), to: round2(km) },
        recorded_km: round2(km),
        race_time_s: snapshot.leader_time_s,
        time_source: snapshot.leader_time_s != null ? "leader_line" : null,
        importance: g.group_id === firstChaseId || g.includes_rest ? "key" : "detail",
        data: {
          group_id: g.group_id,
          group_size: g.size,
          includes_rest: g.includes_rest,
          gap_before_s: prev.gap,
          gap_after_s: g.gap_s,
          delta_s: delta,
          front_group_ids: [...leaderIds].sort(),
          terrain,
        },
      });
    }
  }

  story.snapshots = [...snapshotsByKm.values()].sort((a, b) => a.km - b.km);
  story.moments = moments
    .map((moment, i) => ({ moment, i }))
    .sort((a, b) => a.moment.km - b.moment.km || Number(Boolean(a.moment.km_span)) - Number(Boolean(b.moment.km_span)) || a.i - b.i)
    .map(({ moment }) => moment);
  story.group_spans = timeTrial ? [] : [...spans, ...openSpans.values()]
    .sort((a, b) => a.from_km - b.from_km || a.group_id.localeCompare(b.group_id));
  story.checkpoints = buildCheckpoints(ordered, story, passageStates);
  story.breakaway = breakawaySummary(history, results);
  return story;
}

function describeMoment(event, momentFor, m) {
  const p = event.params ?? {};
  switch (event.type) {
    case "breakaway_formed":
    case "breakaway_survived":
    case "sprint_decided":
    case "favorite_crack":
    case "gc_change":
    case "finish":
      return momentFor(event, { importance: "key" });
    case "breakaway_dropped":
    case "breakaway_attempt":
    case "own_riders_ahead":
    case "gc_reaction":
    case "weather":
    case "stage_start":
    case "jury_reinstated":
    case "outside_time_limit":
      return momentFor(event);
    case "kom_passage": {
      const major = ["HC", "1", "2"].includes(String(p.category ?? ""));
      return momentFor(event, { importance: major ? "key" : "detail" });
    }
    case "intermediate_sprint":
      return momentFor(event);
    case "incident":
      return momentFor(event, { importance: p.outcome === "protected_three_km_rule" ? "detail" : "key" });
    case "finale_attack":
      if (BOOKKEEPING_ATTACK_KINDS.has(p.kind) || namedRiders(p).length === 0) return null;
      // Siden læser altid `data.rider_ids` (også når motoren skrev ental).
      return momentFor(event, { importance: "key", data: { ...cleanParams(p), rider_ids: namedRiders(p) } });
    case "peloton_splits": {
      // Et split fra gruppen der kører forrest/resten er en selektion; et split
      // inde i en gruppetto er en detalje.
      const source = str(p.source_group_id);
      const major = !String(p.group_id ?? "").startsWith("gruppetto") || source === m.restId;
      return momentFor(event, { key: "story.split", importance: major ? "key" : "detail" });
    }
    case "group_merged": {
      // Målstregens placerings-bogføring (finale-*) er ingen hændelse på vejen.
      if (String(p.into_group_id ?? "").startsWith("finale-")) return null;
      return momentFor(event, { key: "story.groups_joined" });
    }
    default:
      return momentFor(event);
  }
}

function buildCheckpoints(ordered, story, passageStates) {
  const points = ordered.filter((e) => PASSAGES.has(e.type) || e.type === "finish");
  return points.map((event) => {
    const km = placeKm(event);
    const recorded = recordedKm(event);
    // Tilstanden PÅ passagen: et snapshot på samme km, ellers tilstanden der
    // blev taget ved passagen, ellers det seneste snapshot før (båret). Aldrig
    // et senere snapshot: det ville give passagen fremtidens huller.
    const snapshot = story.snapshots.find((s) => Math.abs(s.km - recorded) < 1e-6)
      ?? passageStates.get(round2(recorded))
      ?? [...story.snapshots].reverse().find((s) => s.km <= recorded) ?? null;
    const leaderTime = leaderTimeAt(story, km);
    const front = snapshot?.groups.find((g) => g.gap_s === 0) ?? snapshot?.groups[0] ?? null;
    return {
      kind: event.type === "kom_passage" ? "climb" : event.type === "intermediate_sprint" ? "sprint" : "finish",
      km: round2(km),
      name: event.params?.name ?? null,
      category: event.params?.category ?? null,
      top: Array.isArray(event.params?.top) ? event.params.top : [],
      leader_time_s: leaderTime,
      leader_group_id: front?.group_id ?? null,
      leader_rider_ids: front?.rider_ids ?? [],
      groups: (snapshot?.groups ?? []).map((g) => ({ ...g, time_s: leaderTime == null ? null : round2(leaderTime + g.gap_s) })),
      groups_from_km: snapshot?.km ?? null,
      // true = ingen gap_update på passagens km: hullerne er båret fra sidste melding.
      interpolated: !story.snapshots.some((s) => Math.abs(s.km - recorded) < 1e-6),
      out_rider_ids: snapshot?.out_rider_ids ?? [],
      pending_rider_ids: snapshot?.pending_rider_ids ?? [],
    };
  });
}

/**
 * Etapens målresultat og startliste til buildRaceStory ud fra race_results-
 * rækker, med samme valg som etapesidens mærker (RaceDetailPage +
 * raceParticipationMarkers.historyForStage): etapens `stage`-rækker, og for et
 * endagsløb (etape 1) uden etape-rækker dets `gc`-rækker. Så afgør serverens
 * `story.breakaway` udbrydernes udfald med samme svar som mærkerne.
 * @param {Array<{rider_id?: string|null, rank?: number|null, result_type?: string|null, stage_number?: number|null}>|null} rows
 * @param {number} stageNumber
 */
export function storyInputsFromResults(rows, stageNumber) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const onStage = (row) => row.stage_number === stageNumber || (stageNumber === 1 && row.stage_number == null);
  const stageRows = list.filter((row) => row.result_type === "stage" && onStage(row));
  const dayRows = stageRows.length ? stageRows : stageNumber === 1 ? list.filter((row) => row.result_type === "gc") : [];
  const results = dayRows
    .filter((row) => typeof row.rider_id === "string" && typeof row.rank === "number")
    .map((row) => ({ rider_id: row.rider_id, rank: row.rank }));
  const startlist = [...new Set(dayRows.map((row) => row.rider_id).filter((id) => typeof id === "string" && id.length > 0))];
  return { results, startlist };
}

function breakawaySummary(history, results) {
  if (history.morningRiderIds.size === 0) return null;
  const ahead = Array.isArray(results) && results.length ? nonEscapeeAheadByRider(history, results) : null;
  const outcomes = {};
  for (const id of [...history.morningRiderIds].sort()) {
    outcomes[id] = settleBreakawayOutcome(history.riders.get(id), ahead ? (ahead.get(id) ?? null) : null);
  }
  return { morning_rider_ids: [...history.morningRiderIds].sort(), outcomes };
}

/**
 * Hullet for én rytter ved et kontrolpunkt: hans gruppe, hul til føreren og
 * tid. Ryttere uden eksplicit gruppe kører i resten (`includes_rest`). null når
 * rytteren er udgået eller loggen ikke kender hans gruppe.
 */
export function checkpointGapForRider(checkpoint, riderId) {
  if (!checkpoint || !riderId) return null;
  // En udgået rytter er aldrig i resten og har hverken mellemtid eller måltid.
  if (Array.isArray(checkpoint.out_rider_ids) && checkpoint.out_rider_ids.includes(riderId)) return null;
  const explicit = checkpoint.groups.find((g) => g.rider_ids.includes(riderId));
  // Et uheldsoffer uden kendt gruppe endnu er ikke i resten: hullet er ukendt.
  if (!explicit && Array.isArray(checkpoint.pending_rider_ids) && checkpoint.pending_rider_ids.includes(riderId)) return null;
  const group = explicit ?? checkpoint.groups.find((g) => g.includes_rest) ?? null;
  if (!group) return null;
  return { group_id: group.group_id, gap_s: group.gap_s, time_s: group.time_s, in_front: group.gap_s === 0, via_rest: !explicit };
}

function lerp(fromKm, fromGap, toKm, toGap, km) {
  if (Math.abs(toKm - fromKm) < 1e-9) return round2(toGap);
  return round2(fromGap + ((toGap - fromGap) * (km - fromKm)) / (toKm - fromKm));
}

/**
 * Gruppernes hul ved et km mellem to snapshots (a <= km < b). Frame-medlemskab
 * bygges fra tilstanden FØR km (snapshot a) og den registrerede levetid
 * (`group_spans`, på hændelsens sande km), aldrig ved at projicere næste
 * snapshot baglæns. Levetiderne afspilles i km-orden fra a til km:
 *   - et split/en dannelse (fra `from_km`, også på selve a's km når hændelsen
 *     først er stemplet efter a) flytter gruppens ryttere (`rider_ids`) ud af
 *     den gruppe de kørte i; en unavngiven rytter kørte i resten;
 *   - en sammenlægning (efter `to_km`) flytter gruppens ryttere ind i gruppen
 *     den smelter ind i, så hver rytter tæller i præcis én gruppe;
 *   - en gruppe der både opstår og forsvinder mellem a og b, er på vejen i
 *     hele sin levetid, selv om ingen af de to snapshots kender den.
 * Hullet: en gruppe i både a og b interpoleres lineært; en gruppe der opstår,
 * starter i gruppen den kom fra; en gruppe der forsvinder, lukker lineært ind
 * på gruppen den smelter ind i på sit merge-punkt. En gruppe uden registreret
 * split/merge vises kun hvor loggen kender den.
 */
function groupsBetween(story, a, b, km) {
  const EPS = 1e-9;
  const spans = Array.isArray(story.group_spans) ? story.group_spans : [];
  const inA = new Map(a.groups.map((g) => [g.group_id, g]));
  const inB = new Map(b.groups.map((g) => [g.group_id, g]));
  // Gruppens levetid der dækker x (den senest startede, hvis id'et genbruges).
  const covering = (id, x) => {
    let best = null;
    for (const s of spans) {
      if (s.group_id !== id || s.from_km > x + EPS || (s.to_km != null && s.to_km < x - EPS)) continue;
      if (!best || s.from_km >= best.from_km) best = s;
    }
    return best;
  };
  // Linjens hul ved x for en gruppe der er på vejen i intervallet.
  const gapAt = (id, x, depth = 0) => {
    if (!id || depth > 8) return null;
    const ga = inA.get(id); const gb = inB.get(id);
    const s = covering(id, x);
    let from = null;
    if (ga && (!s || s.from_km <= a.km + EPS)) from = { km: a.km, gap: ga.gap_s };
    else if (s) from = { km: s.from_km, gap: (s.source_group_id ? gapAt(s.source_group_id, s.from_km, depth + 1) : null) ?? gb?.gap_s ?? null };
    let to = null;
    if (gb && (!s || s.to_km == null || s.to_km >= b.km - EPS)) to = { km: b.km, gap: gb.gap_s };
    else if (s && s.to_km != null && s.to_km <= b.km + EPS) to = { km: s.to_km, gap: (s.into_group_id ? gapAt(s.into_group_id, s.to_km, depth + 1) : null) ?? from?.gap ?? null };
    if (from?.gap == null && to?.gap == null) return ga?.gap_s ?? gb?.gap_s ?? null;
    if (from?.gap == null) return round2(to.gap);
    if (to?.gap == null) return round2(from.gap);
    return lerp(from.km, from.gap, to.km, to.gap, x);
  };

  // Medlemskabet ved km: a, plus levetidernes overgange i (a, km].
  const state = new Map(a.groups.map((g) => [g.group_id, { meta: g, riders: new Set(g.rider_ids), size: g.size, includes_rest: g.includes_rest }]));
  const gone = new Set([...(a.out_rider_ids ?? []), ...(a.pending_rider_ids ?? [])]);
  const transitions = [];
  for (const s of spans) {
    if (s.to_km != null && s.to_km < s.from_km - EPS) continue; // ingen levetid på vejen
    if (s.from_km >= a.km - EPS && s.from_km <= km + EPS) transitions.push({ km: s.from_km, order: 0, span: s });
    if (s.to_km != null && s.to_km >= a.km - EPS && s.to_km < km - EPS) transitions.push({ km: s.to_km, order: 1, span: s });
  }
  transitions.sort((x, y) => x.km - y.km || x.order - y.order);
  const shrink = (g) => { if (g.size != null) g.size = Math.max(g.riders.size, g.size - 1); };
  for (const { order, span } of transitions) {
    if (order === 0) {
      // Allerede på vejen i a (dannet før a): intet at flytte.
      if (state.has(span.group_id)) continue;
      const riders = Array.isArray(span.rider_ids) ? span.rider_ids : (inB.get(span.group_id)?.rider_ids ?? []);
      for (const r of riders) {
        const holder = [...state.values()].find((g) => g.riders.has(r));
        if (holder) { holder.riders.delete(r); shrink(holder); continue; }
        if (gone.has(r)) continue;
        const rest = [...state.values()].find((g) => g.includes_rest);
        if (rest) shrink(rest);
      }
      const meta = inB.get(span.group_id) ?? { group_id: span.group_id, rider_ids: [], size: 0, includes_rest: false, members_inferred: false };
      state.set(span.group_id, { meta, riders: new Set(riders), size: riders.length, includes_rest: false, born: span });
    } else {
      const from = state.get(span.group_id);
      if (!from || !span.into_group_id) continue;
      const into = state.get(span.into_group_id)
        ?? { meta: inB.get(span.into_group_id) ?? { group_id: span.into_group_id, rider_ids: [], size: 0, includes_rest: false, members_inferred: false }, riders: new Set(), size: 0, includes_rest: false };
      for (const r of from.riders) into.riders.add(r);
      into.size = into.size == null || from.size == null ? null : into.size + from.size;
      into.includes_rest = into.includes_rest || from.includes_rest;
      state.delete(span.group_id);
      state.set(span.into_group_id, into);
    }
  }

  const out = [];
  for (const [id, g] of state) {
    const s = covering(id, km);
    if (!inB.has(id) || (s && s.to_km != null && s.to_km < b.km - EPS)) {
      // Forsvinder før b: kun på vejen indtil sit registrerede merge-punkt.
      // Opstået uden kendt endeligt udfald: ukendt, vises ikke.
      if (!s || s.to_km == null || s.to_km > b.km + EPS) continue;
    }
    if (g.size === 0 && !g.includes_rest) continue;
    const gap = gapAt(id, km);
    if (gap == null) continue;
    out.push({ meta: { ...g.meta, rider_ids: [...g.riders].sort(), size: g.size, includes_rest: g.includes_rest }, gap });
  }
  return out;
}

/**
 * Replay-frames: gruppernes hul (og afstand i km) til føreren ved hvert
 * tjekpunkt og pr. km over de sidste `finaleKm` km. Mellem to tjekpunkter
 * interpoleres lineært (motorens konstante tempo pr. interval), og en gruppe
 * er på vejen fra sit split-punkt til sit merge-punkt (groupsBetween).
 * Afstanden i km bruger førerens fart på stedet.
 */
export function replayFrames(story, { finaleKm = REPLAY_FINALE_KM, stepKm = 1 } = {}) {
  if (!story?.snapshots?.length || story.distance_km == null) return [];
  const kms = new Set(story.snapshots.map((s) => s.km));
  const end = story.distance_km;
  for (let km = Math.max(0, end - finaleKm); km < end - 1e-9; km += stepKm) kms.add(round2(km));
  kms.add(round2(end));
  const ordered = [...kms].filter((km) => km >= 0 && km <= end + 1e-9).sort((a, b) => a - b);
  const snaps = story.snapshots;
  return ordered.map((km) => {
    const leader = leaderTimeAt(story, km);
    const speed = leaderSpeedAt(story, km);
    let a = null; let b = null;
    for (const s of snaps) { if (s.km <= km + 1e-9) a = s; else { b = s; break; } }
    let rows;
    if (!a) rows = [];
    else if (Math.abs(a.km - km) < 1e-6 || !b) rows = Math.abs(a.km - km) < 1e-6 ? a.groups.map((g) => ({ meta: g, gap: g.gap_s })) : [];
    else rows = groupsBetween(story, a, b, km);
    const groups = rows
      .map(({ meta, gap }) => ({ group_id: meta.group_id, size: meta.size, includes_rest: meta.includes_rest, gap_s: Math.max(0, gap), km_behind: speed == null ? null : round2(Math.max(0, gap) * speed) }))
      .sort((x, y) => x.gap_s - y.gap_s || x.group_id.localeCompare(y.group_id));
    return { km, leader_time_s: leader, groups };
  });
}

function leaderSpeedAt(story, km) {
  const line = story.leader_line;
  for (let i = 1; i < line.length; i++) {
    if (line[i].km >= km - 1e-9) {
      const dt = line[i].time - line[i - 1].time;
      return dt > 0 ? (line[i].km - line[i - 1].km) / dt : null;
    }
  }
  return null;
}
