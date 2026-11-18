// Pure month-grid helpers for the Race Calendar page (#in-game-race-calendar).
// No React, no I/O — so `node --test` can load this directly and calendarGrid.test.js
// can verify the Monday-first grid + date grouping without rendering.
//
// Dates are plain "YYYY-MM-DD" strings (from the API, already projected to
// Europe/Copenhagen). We never construct a Date from them with new Date("...") to
// avoid the UTC-midnight timezone skew — all math is on the {year, month, day} parts.

// Days in a given month (1-based month). Handles leap years.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Weekday index Monday-first (0=Mon … 6=Sun) for a Y-M-D, via Zeller-free Date()
// in local time but only reading getDay() (no time component → no TZ skew on the
// weekday itself). new Date(y, m-1, d) is local-midnight; getDay() returns 0=Sun.
export function mondayFirstWeekday(year, month, day) {
  const js = new Date(year, month - 1, day).getDay(); // 0=Sun..6=Sat
  return (js + 6) % 7; // 0=Mon..6=Sun
}

// Builds the 7-column grid for a month: an array of weeks, each a 7-slot array of
// cells. Leading/trailing slots outside the month are null. Each in-month cell is
// { year, month, day, iso }.
export function buildMonthGrid(year, month) {
  const total = daysInMonth(year, month);
  const lead = mondayFirstWeekday(year, month, 1);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) {
    cells.push({ year, month, day: d, iso: isoOf(year, month, d) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function isoOf(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

// Groups calendar entries by their ISO date → Map<iso, entry[]>. Entries without a
// date (no schedule yet) are dropped from the grid (they have no calendar cell).
export function groupEntriesByDate(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e.date) continue;
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

// #5841: puljerne i en division kører samme løb på samme datoer med samme ruter (én kopi pr.
// pulje i databasen). Uden sammenlægning viste divisionsfilteret hvert løb én gang pr. pulje.
// Nøglen er division + navn + løbstype + etapeplanen (etape, dato, rute). Klokkeslæt er ikke
// med: samme løb på samme dag er samme løb for spilleren. Afviger blot én etape, er det to løb.
function poolTwinKey(e) {
  const sched = e.stageSchedule && e.stageSchedule.length
    ? e.stageSchedule.map((s) => `${s.stage}@${s.date || ""}@${s.profileType || s.terrain || ""}`)
    : [`1@${e.date || ""}@${e.terrain || ""}`];
  return [e.division ?? "", e.name, e.raceType || "", e.stages ?? 1, sched.join("|")].join("#");
}

// Slår puljernes ens løb sammen til ét pr. division. Har holdet en pulje (preferPoolId), peger
// løbet på holdets eget; ellers på puljen der står først i divisionstræet (laveste nummer).
// Et løb der kun findes i én pulje er uændret. poolLabel ryddes på et sammenlagt løb der ikke er
// holdets eget, fordi én puljes navn ville påstå at løbet kun køres der. Ren, bevarer rækkefølgen.
/** @param {any[]|null|undefined} entries @param {{ divisions?: any[], preferPoolId?: number|null }} [opts] @returns {any[]} */
export function mergePoolTwins(entries, { divisions = [], preferPoolId = null } = {}) {
  const rank = new Map();
  let i = 0;
  for (const d of divisions || []) for (const p of d.pools || []) rank.set(p.id, i++);
  const rankOf = (e) => (e.poolId != null && rank.has(e.poolId) ? rank.get(e.poolId) : Number.MAX_SAFE_INTEGER);
  const better = (a, b) => {
    const aOwn = preferPoolId != null && a.poolId === preferPoolId;
    const bOwn = preferPoolId != null && b.poolId === preferPoolId;
    if (aOwn !== bOwn) return aOwn;
    return rankOf(a) < rankOf(b);
  };
  const groups = new Map();
  const order = [];
  for (const e of entries || []) {
    const key = poolTwinKey(e);
    const g = groups.get(key);
    if (!g) { groups.set(key, { best: e, count: 1 }); order.push(key); continue; }
    g.count += 1;
    if (better(e, g.best)) g.best = e;
  }
  return order.map((key) => {
    const { best, count } = groups.get(key);
    if (count === 1) return best;
    const own = preferPoolId != null && best.poolId === preferPoolId;
    return own ? best : { ...best, poolLabel: null };
  });
}

// #5841 (udgave-skiftet): hvert løbs puljetvillinger efter samme regel som mergePoolTwins, i
// divisionstræets orden. Map<løbs-id, [{ id, poolId, poolIndex }]>; et løb uden tvillinger er udeladt.
/** @param {any[]|null|undefined} entries @param {{ divisions?: any[] }} [opts] @returns {Map<any, {id:any, poolId:any, poolIndex:number|null}[]>} */
export function poolTwinsByRaceId(entries, { divisions = [] } = {}) {
  const poolById = new Map();
  let i = 0;
  for (const d of divisions || []) for (const p of d.pools || []) poolById.set(p.id, { rank: i++, poolIndex: p.poolIndex ?? null });
  const groups = new Map();
  for (const e of entries || []) {
    const key = poolTwinKey(e);
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  const out = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const twins = list
      .map((e) => ({ id: e.id, poolId: e.poolId ?? null, poolIndex: poolById.get(e.poolId)?.poolIndex ?? null, rank: poolById.get(e.poolId)?.rank ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _rank, ...twin }) => twin);
    for (const e of list) out.set(e.id, twins);
  }
  return out;
}

// #5841: den pulje en kommende sæsons tidslinje vises fra, mens holdets division ikke er afgjort:
// den første pulje (laveste nummer) i den forventede division, der har løb. null hvis ingen.
/** @param {{ divisions?: any[], entries?: any[], expectedDivision?: number|null }} [opts] @returns {number|null} */
export function expectedPoolId({ divisions = [], entries = [], expectedDivision = null } = {}) {
  if (expectedDivision == null) return null;
  const tier = (divisions || []).find((d) => d.division === expectedDivision);
  if (!tier) return null;
  const withRaces = new Set((entries || []).map((e) => e.poolId));
  return (tier.pools || []).find((p) => withRaces.has(p.id))?.id ?? null;
}

// Expands each race entry into ONE event PER STAGE (from entry.stageSchedule), so a stage race
// shows up on every day it runs ("1. etape" on its day, "2. etape" the next, …). Falls back to a
// single event on the entry's start date if no per-stage schedule is present (defensive).
export function expandStageEvents(entries) {
  const out = [];
  for (const e of entries || []) {
    const sched = e.stageSchedule && e.stageSchedule.length
      ? e.stageSchedule
      : (e.date ? [{ stage: 1, date: e.date, time: null, terrain: e.terrain }] : []);
    for (const s of sched) {
      if (!s.date) continue;
      out.push({
        raceId: e.id,
        name: e.name,
        raceType: e.raceType,
        stages: e.stages,
        stage: s.stage,
        date: s.date,
        time: s.time || null,
        terrain: s.terrain || e.terrain || null,
        // #6683: etapens egen profile_type (ét farvet ikon pr. etapetype); null for ældre svar.
        profileType: s.profileType || null,
        division: e.division,
        poolId: e.poolId ?? null,
        poolLabel: e.poolLabel,
        isMine: e.isMine,
        leaderSet: e.leaderSet,
      });
    }
  }
  return out;
}

// Filters stage events to a single month (and optionally a division/tier + pool/group
// within that tier + "mine only"). poolId narrows a tier down to a single group (e.g.
// "Division 2 A") — null means "every pool in the tier" (#2756: scouting a whole
// division's calendar, then a single group within it).
export function filterStageEvents(events, { year, month, division = null, poolId = null, mineOnly = false } = {}) {
  const prefix = `${year}-${pad2(month)}`;
  return (events || []).filter((ev) => {
    if (!ev.date || !ev.date.startsWith(prefix)) return false;
    if (division != null && ev.division !== division) return false;
    if (poolId != null && ev.poolId !== poolId) return false;
    if (mineOnly && !ev.isMine) return false;
    return true;
  });
}

// Groups stage events by ISO date → Map<iso, event[]>, sorted by time-of-day within a day so the
// cell reads top-to-bottom chronologically (12:00 før 15:00 før 18:00).
export function groupStageEventsByDate(events) {
  const map = new Map();
  for (const ev of events || []) {
    if (!ev.date) continue;
    if (!map.has(ev.date)) map.set(ev.date, []);
    map.get(ev.date).push(ev);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.time || "").localeCompare(b.time || "") || a.name.localeCompare(b.name) || (a.stage - b.stage));
  }
  return map;
}

// The set of months (as {year, month}) that contain at least one stage event, sorted. Lets the
// page default to the first month with races. Uses per-stage dates so a stage race that spills
// into the next month is counted there too.
export function monthsWithRaces(entries) {
  const seen = new Set();
  for (const ev of expandStageEvents(entries)) {
    if (!ev.date) continue;
    seen.add(ev.date.slice(0, 7)); // "YYYY-MM"
  }
  return [...seen]
    .sort()
    .map((ym) => ({ year: +ym.slice(0, 4), month: +ym.slice(5, 7) }));
}

// Steps a {year, month} by ±1 month, rolling the year. Pure.
export function stepMonth({ year, month }, delta) {
  let y = year;
  let m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

// Filters entries to a single month (and optionally a division/tier and "mine only").
export function filterEntries(entries, { year, month, division = null, mineOnly = false } = {}) {
  const prefix = `${year}-${pad2(month)}`;
  return (entries || []).filter((e) => {
    if (!e.date || !e.date.startsWith(prefix)) return false;
    if (division != null && e.division !== division) return false;
    if (mineOnly && !e.isMine) return false;
    return true;
  });
}
