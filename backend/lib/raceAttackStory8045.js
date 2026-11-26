// #8045 · Angrebets forløb fortalt kronologisk (design: docs/superpowers/specs/2026-11-12-8045-angrebsforloeb-design.md).
//
// Ren læser af en etapes gemte løbslog (race_stage_timelines.events, version 2). Den
// rører ikke motoren og opfinder intet: hver hændelse her er en hændelse motoren
// allerede har skrevet, med motorens eget punkt (km) og, når motoren har den, sin
// egen løbstid. Findes et punkt eller en tid ikke i loggen, kommer linjen ikke.
//
// Faserne følger designets kontrakt (afsnit 2, trin A):
//   started    angrebet: hvor rytterens indsats blev angreb OG angrebet kan virke (den
//              sidste stignings første motorgrænse, eller senere hvis planen skiftede senere).
//   away       første synlige adskillelse fra gruppen, han angreb fra (motorens split-punkt).
//   checkpoint forspringet ved en ægte motorgrænse, mens han stadig er adskilt.
//   bridged    han når en gruppe foran.
//   caught     gruppen, han angreb fra, får kontakt igen (motorens kontaktpunkt).
//   dropped    gruppen, han angreb fra, kører fra ham (knæk, kræfterne slap op, eller tempoet).
//   held       han ligger stadig foran gruppen ved toppen eller i mål; afstanden er målt.
//   level      han kom aldrig væk og når toppen/målet med gruppen (ingen tidsgevinst at fortælle).
//
// Gruppen, han angreb fra ("reference"), følges gennem split og sammenkørsler: tager et
// split flertallet af gruppen med, er det flertallet, der er "feltet" bagefter.
// Gruppens navn i teksten afledes kun af ting, der er sande: den største gruppe på
// vejen er feltet, et udbrud er udbruddet, ellers er det "hans gruppe".

const EPS_KM = 0.051;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function idsOf(v) {
  return Array.isArray(v) ? v.filter((id) => typeof id === "string" && id) : [];
}

/** Motorens punkt for hændelsen: det præcise sted, ellers segmentgrænsen. */
function placeKm(e) {
  return num(e?.params?.exact_km) ?? num(e?.km);
}

function placeTime(e) {
  return num(e?.params?.exact_time);
}

/** Den sidste stigning (højeste top-km) og dens fod. null uden stigninger. */
export function lastClimb8045(climbs, distanceKm) {
  let best = null;
  for (const c of Array.isArray(climbs) ? climbs : []) {
    const crest = num(c?.crest_km);
    const length = num(c?.length_km);
    if (crest == null || length == null || !(length > 0)) continue;
    if (distanceKm != null && crest > distanceKm + EPS_KM) continue;
    if (!best || crest > best.crest) {
      best = { crest, foot: round2(Math.max(0, crest - length)), name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null };
    }
  }
  return best;
}

/** Planens opgave-intervaller pr. rytter: [{ km, task }] sorteret på km. */
function planLegs(events) {
  const byRider = new Map();
  for (const e of events) {
    if (e?.type !== "stage_plan_leg") continue;
    const id = e.params?.rider_id;
    const km = placeKm(e);
    if (typeof id !== "string" || km == null) continue;
    if (!byRider.has(id)) byRider.set(id, []);
    byRider.get(id).push({ km, task: String(e.params?.task ?? "") });
  }
  for (const legs of byRider.values()) legs.sort((a, b) => a.km - b.km);
  return byRider;
}

/** Hvor angrebs-opgaven begynder at virke på den sidste stigning, eller null. */
function attackStartFromPlan(legs, foot, crest) {
  if (!legs) return null;
  for (let i = 0; i < legs.length; i += 1) {
    if (legs[i].task !== "attack") continue;
    const from = legs[i].km;
    const to = i + 1 < legs.length ? legs[i + 1].km : Infinity;
    const start = Math.max(from, foot);
    if (start < to - 1e-9 && start < crest - 1e-9) return round2(start);
  }
  return null;
}

/**
 * Grupperne på vejen, rekonstrueret fra loggen: eksplicitte medlemmer (alle rytter-id'er
 * hændelserne nævner) og "resten" (ryttere loggen aldrig har flyttet).
 */
class Road {
  constructor(fieldCount) {
    this.fieldCount = fieldCount;
    this.memberOf = new Map();
    this.members = new Map();
    this.rest = "peloton-0";
    this.alive = new Set([this.rest]);
  }

  groupOf(riderId) {
    return this.memberOf.get(riderId) ?? this.rest;
  }

  size(groupId) {
    const explicit = this.members.get(groupId)?.size ?? 0;
    if (groupId !== this.rest) return explicit;
    return explicit + Math.max(0, this.fieldCount - this.memberOf.size);
  }

  largest() {
    let best = null;
    let bestSize = -1;
    for (const g of this.alive) {
      const s = this.size(g);
      if (s > bestSize) { best = g; bestSize = s; }
    }
    return best;
  }

  move(riderId, to) {
    const from = this.memberOf.get(riderId);
    if (from) this.members.get(from)?.delete(riderId);
    this.memberOf.set(riderId, to);
    if (!this.members.has(to)) this.members.set(to, new Set());
    this.members.get(to).add(riderId);
    this.alive.add(to);
  }

  split(sourceId, groupId, riderIds) {
    this.alive.add(sourceId);
    for (const r of riderIds) this.move(r, groupId);
    this.alive.add(groupId);
  }

  merge(groupId, intoId, riderIds) {
    for (const r of riderIds) this.move(r, intoId);
    for (const r of [...(this.members.get(groupId) ?? [])]) this.move(r, intoId);
    if (this.rest === groupId) this.rest = intoId;
    this.alive.delete(groupId);
    this.alive.add(intoId);
  }
}

const MEMBERSHIP = new Set(["breakaway_formed", "peloton_splits", "group_merged"]);

/** Inden for en grænse: efter stedet det skete (altid kendt), ved samme sted efter tiden. */
function compareMoves(a, b) {
  return (placeKm(a) ?? Infinity) - (placeKm(b) ?? Infinity) || (placeTime(a) ?? Infinity) - (placeTime(b) ?? Infinity);
}

/** Hændelserne i motorens rækkefølge: pr. segmentgrænse, og inden i den efter det tidspunkt, de skete. */
function chronological(events) {
  const buckets = [];
  let current = null;
  for (const e of events) {
    const km = num(e?.km);
    if (km == null) continue;
    if (!current || Math.abs(current.km - km) > 1e-9) {
      current = { km, items: [] };
      buckets.push(current);
    }
    current.items.push(e);
  }
  const out = [];
  for (const b of buckets) {
    const moves = b.items.filter((e) => MEMBERSHIP.has(e.type)).map((e, i) => ({ e, i }));
    moves.sort((x, y) => compareMoves(x.e, y.e) || x.i - y.i);
    let m = 0;
    for (const e of b.items) out.push(MEMBERSHIP.has(e.type) ? moves[m++].e : e);
  }
  return out;
}

function isFinaleGroup(id) {
  return typeof id === "string" && id.startsWith("finale-");
}

/** Løbstiden for den første gruppe bag tiden `t` ved grænsen (null når ingen). */
function nearestBehind(times, t) {
  let best = null;
  for (const v of times.values()) if (v > t + 0.5 && (best == null || v < best)) best = v;
  return best;
}

function labelOf(road, groupId) {
  if (typeof groupId === "string" && groupId.startsWith("breakaway-")) return "breakaway";
  if (road.largest() === groupId) return "peloton";
  return "group";
}

/**
 * Angrebets forløb for den sidste stigning, som hændelser i den rækkefølge de skete.
 * Tom liste uden v2-log, uden stigning eller uden angreb.
 */
export function attackStory8045(events, { timelineVersion = null, climbs = null, distanceKm = null } = {}) {
  if (!Array.isArray(events) || !events.length) return [];
  if (timelineVersion != null && Number(timelineVersion) < 2) return [];
  const start = events.find((e) => e?.type === "stage_start");
  const distance = num(distanceKm) ?? num(start?.params?.distance_km);
  const climb = lastClimb8045(climbs, distance);
  if (!climb) return [];
  const finishKm = distance ?? climb.crest;
  const topKm = Math.min(climb.crest, finishKm);
  const atFinish = Math.abs(topKm - finishKm) <= EPS_KM;

  // Hvem angreb: motorens "alt ud"-udfald på stigningen, og planens Angrib-opgave på stigningen.
  const allOut = new Map();
  for (const e of events) {
    if (e?.type !== "all_out_gain" && e?.type !== "all_out_cracked") continue;
    const id = e.params?.rider_id;
    if (typeof id !== "string") continue;
    const at = num(e.km);
    if (at == null || at < climb.foot - EPS_KM || at > finishKm + EPS_KM) continue;
    const rec = allOut.get(id) ?? {};
    if (e.type === "all_out_cracked") rec.cracked = true;
    if (e.type === "all_out_gain") rec.gainTime = placeTime(e);
    allOut.set(id, rec);
  }
  const legs = planLegs(events);
  const attackers = new Map();
  for (const [id, riderLegs] of legs) {
    const at = attackStartFromPlan(riderLegs, climb.foot, topKm);
    if (at != null) attackers.set(id, { startKm: at, viaPlan: true });
  }
  for (const id of allOut.keys()) if (!attackers.has(id)) attackers.set(id, { startKm: climb.foot, viaPlan: false });
  if (!attackers.size) return [];

  const fieldCount = num(start?.params?.field_count) ?? 0;
  const ordered = chronological(events);
  const road = new Road(fieldCount);
  const state = new Map();
  for (const [id, a] of attackers) {
    state.set(id, {
      id,
      startKm: a.startKm,
      phase: "waiting", // waiting → racing → settled (efter toppen) → done
      ref: null,
      away: false,
      lastGap: null,
      attackId: `${id}:all_out_7280:${climb.crest}`,
    });
  }
  const finishEvent = events.find((e) => e?.type === "finish");
  const firstPlace = Array.isArray(finishEvent?.params?.top) ? finishEvent.params.top.find((t) => Number(t?.rank) === 1) : null;
  const winner = { riderId: typeof firstPlace?.rider_id === "string" ? firstPlace.rider_id : null, time: placeTime(finishEvent) };

  const out = [];
  const emit = (s, phase, km, time, extra = {}) => {
    out.push({
      attack_id: s.attackId,
      phase,
      rider_id: s.id,
      km: round2(km),
      time: time != null ? round2(time) : null,
      climb_name: climb.name,
      ...extra,
    });
  };

  // Hver gruppes egen løbstid ved en motorgrænse (gap_update ved grænsen).
  const timesCache = new Map();
  const boundaryTimes = (km) => {
    const key = round2(km);
    if (timesCache.has(key)) return timesCache.get(key);
    const m = new Map();
    for (const e of events) {
      if (e?.type !== "gap_update") continue;
      const at = num(e.km);
      if (at == null || Math.abs(at - km) > 1e-6) continue;
      const g = e.params?.group_id;
      const t = placeTime(e);
      if (typeof g === "string" && t != null) m.set(g, t);
    }
    timesCache.set(key, m);
    return m;
  };

  const nearFinish = (km) => Math.abs(km - finishKm) <= EPS_KM;
  const riderTimeAt = (s, times, km) => {
    const g = road.groupOf(s.id);
    if (times.has(g)) return times.get(g);
    // I mål har motoren rytterens egen sluttid på "alt ud"-hændelsen og vinderens på målet.
    const rec = allOut.get(s.id);
    if (nearFinish(km) && rec?.gainTime != null) return rec.gainTime;
    if (nearFinish(km) && winner.riderId === s.id) return winner.time;
    return null;
  };

  const startIfDue = (km) => {
    for (const s of state.values()) {
      if (s.phase !== "waiting" || s.startKm > km + 1e-9) continue;
      s.phase = "racing";
      s.ref = road.groupOf(s.id);
      s.refSize = road.size(s.ref);
      emit(s, "started", s.startKm, boundaryTimes(s.startKm).get(s.ref) ?? null);
    }
  };

  const causeOf = (s, split) => {
    if (allOut.get(s.id)?.cracked) return "cracked";
    if (split.params?.cause === "wprime_depleted") return "out_of_strength";
    return "outpaced";
  };

  function onSplit(e) {
    const src = e.params?.source_group_id;
    const grp = e.params?.group_id;
    if (typeof src !== "string" || typeof grp !== "string") return;
    const riders = idsOf(e.params?.rider_ids);
    const gap = num(e.params?.gap_seconds) ?? 0;
    const km = placeKm(e);
    const time = placeTime(e);
    const moved = new Set(riders);
    road.split(src, grp, riders);
    for (const s of state.values()) {
      if (s.phase !== "racing" || s.ref !== src) continue;
      // Tager splittet flertallet af gruppen, som den var ved angrebet, er det gruppen herefter.
      const follow = riders.length * 2 > s.refSize;
      const mineAfter = road.groupOf(s.id);
      if (moved.has(s.id)) {
        if (gap > 0) {
          emit(s, "dropped", km, time, { cause: causeOf(s, e), group: labelOf(road, src) });
          s.phase = "done";
        } else if (gap < 0 && !s.away && !follow) {
          s.away = true;
          emit(s, "away", km, time, { group: labelOf(road, src) });
        }
        if (follow) s.ref = grp;
      } else if (follow) {
        s.ref = grp;
        if (mineAfter !== src) continue;
        if (gap > 0 && !s.away) {
          s.away = true;
          emit(s, "away", km, time, { group: labelOf(road, grp) });
        } else if (gap < 0) {
          emit(s, "dropped", km, time, { cause: causeOf(s, e), group: labelOf(road, grp) });
          s.phase = "done";
        }
      }
    }
  }

  function onMerge(e) {
    const from = e.params?.group_id;
    const into = e.params?.into_group_id;
    if (typeof from !== "string" || typeof into !== "string") return;
    if (isFinaleGroup(into)) {
      // Finalens fordeling i mål flytter rytterne, men er ingen indhentning.
      for (const r of idsOf(e.params?.rider_ids)) road.move(r, into);
      return;
    }
    const km = placeKm(e);
    const time = placeTime(e);
    const mineBefore = new Map([...state.values()].map((s) => [s.id, road.groupOf(s.id)]));
    road.merge(from, into, idsOf(e.params?.rider_ids));
    for (const s of state.values()) {
      const refBefore = s.ref;
      if (s.ref === from) s.ref = into;
      if ((s.phase !== "racing" && s.phase !== "settled") || !s.away) continue;
      const mine = mineBefore.get(s.id);
      const caught = (mine === from && into === refBefore) || (mine === into && from === refBefore);
      if (caught) {
        emit(s, "caught", km, time, { group: labelOf(road, into) });
        s.phase = "done";
      } else if (mine === from && s.phase === "racing" && !nearFinish(km ?? 0)) {
        // Grupper, der mødes på selve målstregen, er ingen historie om at køre op til nogen.
        emit(s, "bridged", km, time, { group: labelOf(road, into) });
      }
    }
  }

  const seenBoundary = new Set();
  function onBoundary(bucketKm) {
    const key = round2(bucketKm);
    if (seenBoundary.has(key)) return;
    seenBoundary.add(key);
    const times = boundaryTimes(bucketKm);
    for (const s of state.values()) {
      if (s.phase !== "racing" || !s.away) continue;
      if (bucketKm <= s.startKm + 1e-9 || bucketKm >= topKm - EPS_KM) continue;
      if (road.groupOf(s.id) === s.ref) continue;
      const tA = riderTimeAt(s, times, bucketKm);
      const tR = times.get(s.ref);
      if (tA == null || tR == null) continue;
      const gap = tR - tA;
      if (!(gap > 0.5)) continue;
      const trend = s.lastGap == null ? null : gap > s.lastGap + 0.5 ? "growing" : gap < s.lastGap - 0.5 ? "shrinking" : "steady";
      s.lastGap = gap;
      emit(s, "checkpoint", bucketKm, tA, { gap_seconds: Math.round(gap), trend, group: labelOf(road, s.ref) });
    }
  }

  // Udfaldet ved toppen (eller i mål), når alle grænsens hændelser er læst.
  let settled = false;
  function settleTop() {
    if (settled) return;
    settled = true;
    const times = boundaryTimes(topKm);
    const at = atFinish ? "finish" : "top";
    for (const s of state.values()) {
      if (s.phase === "waiting") continue;
      if (s.phase !== "racing") continue;
      const mine = road.groupOf(s.id);
      const tA = riderTimeAt(s, times, topKm);
      if (mine === s.ref) {
        if (!s.away) emit(s, "level", topKm, tA, { at, group: labelOf(road, s.ref) });
        s.phase = "done";
        continue;
      }
      // Er gruppen, han angreb fra, smuldret (under halvdelen tilbage), måles mod de
      // nærmeste forfølgere: den første gruppe bag ham på vejen.
      const refStands = road.size(s.ref) * 2 >= s.refSize;
      const chasers = tA == null ? null : nearestBehind(times, tA);
      const tR = refStands ? times.get(s.ref) : chasers;
      if (tA == null || tR == null) { s.phase = "done"; continue; }
      const gap = tR - tA;
      const group = refStands ? labelOf(road, s.ref) : "chasers";
      if (gap > 0.5) {
        emit(s, "held", topKm, tA, { at, gap_seconds: Math.round(gap), group });
        s.phase = atFinish ? "done" : "settled";
      } else if (gap < -0.5) {
        emit(s, "dropped", topKm, tA, { cause: allOut.get(s.id)?.cracked ? "cracked" : "outpaced", group });
        s.phase = "done";
      } else {
        emit(s, s.away ? "caught" : "level", topKm, tA, s.away ? { group } : { at, group });
        s.phase = "done";
      }
    }
  }

  ordered.forEach((e) => {
    const bucketKm = num(e.km);
    if (!settled && bucketKm > topKm + EPS_KM) settleTop();
    const at = placeKm(e) ?? bucketKm;
    if (!settled) startIfDue(at);
    if (e.type === "breakaway_formed") road.split(road.rest, e.params?.group_id, idsOf(e.params?.rider_ids));
    else if (e.type === "peloton_splits") onSplit(e);
    else if (e.type === "group_merged") onMerge(e);
    else if (e.type === "gap_update" && !settled) onBoundary(bucketKm);
  });
  settleTop();

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.km - b.x.km || (a.x.time ?? -1) - (b.x.time ?? -1) || a.i - b.i)
    .map(({ x }) => x);
}

const PHASE_ORDER = ["started", "away", "checkpoint", "bridged", "caught", "dropped", "held", "level"];

/**
 * Filmens linjer: hændelser, der skete på samme sted, samme tid og med samme udfald,
 * bliver én linje med flere navne (fx tre ryttere, der kører fra feltet sammen).
 */
export function attackStoryLines8045(entries) {
  const lines = [];
  const byKey = new Map();
  for (const e of entries ?? []) {
    const key = [e.phase, e.km, e.time ?? "", e.group ?? "", e.cause ?? "", e.at ?? "", e.gap_seconds ?? "", e.trend ?? ""].join("|");
    const hit = byKey.get(key);
    if (hit) { if (!hit.rider_ids.includes(e.rider_id)) hit.rider_ids.push(e.rider_id); continue; }
    const line = {
      id: `attackStory-${e.phase}-${e.km}-${e.rider_id}`,
      kind: "attackStory",
      phase: e.phase,
      km: e.km,
      kmTo: null,
      span: false,
      time: e.time,
      rider_ids: [e.rider_id],
      climb_name: e.climb_name ?? null,
      group: e.group ?? null,
      cause: e.cause ?? null,
      at: e.at ?? null,
      gap_seconds: e.gap_seconds ?? null,
      trend: e.trend ?? null,
    };
    byKey.set(key, line);
    lines.push(line);
  }
  return lines.sort((a, b) => a.km - b.km
    || (a.time ?? -1) - (b.time ?? -1)
    || PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
}

/** En afstand i hele sekunder som minutter og sekunder (til teksten: fulde ord, intet tal-format). */
export function gapParts8045(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return { minutes: Math.floor(s / 60), seconds: s % 60, total: s };
}
