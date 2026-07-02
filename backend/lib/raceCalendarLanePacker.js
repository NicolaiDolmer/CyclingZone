// backend/lib/raceCalendarLanePacker.js
// Kalender-kronologi-rebuild (2026-06-28): adskil IN-GAME-dagen (game_day) fra IRL-dagen (real_day).
// Spec: docs/superpowers/specs/2026-06-28-race-calendar-chronology-rebuild-design.md.
//
// HVER etape får sin EGEN game-dag (et 21-etapers løb spænder 21 game-dage = fuldt commitment).
// Binding (raceBinding.js) nøgler på game_day → uændret kode. To layout-strategier, valgt automatisk:
//
//   BANDED (foretrukket — Div 2/3/4): B "baseline"-spor dækker hele tidslinjen + en overlay på R af
//     hver IRL-dags K game-dage. Hver IRL-dag = K HELE game-dage → går præcist op i density UDEN
//     straddle, og giver en bevidst BLANDING (fx Div 3: skiftevis 1 og 2 samtidige løb). Kræver nok
//     endagsløb og ingen binding-fri monumenter (de hører i Div 1).
//   STREAM (fallback — Div 1): least-loaded på `cap` spor + game-dag-ordnet komprimering. Håndterer
//     Grand Tour-rygrad + binding-fri monumenter; kan have lidt straddle. Bruges når BANDED ikke kan
//     realiseres (for få endagsløb / monumenter til stede).
//
// REN + deterministisk (ingen DB/Date/random).

export const MONUMENT_GAMEDAY_BASE = 100000;

const lenOf = (r) => Math.max(1, Number(r.stages) || 1);
const byBigThenId = (a, b) => lenOf(b) - lenOf(a) || String(a.id).localeCompare(String(b.id));

// Fletter to lister jævnt (a typisk etapeløb, b klassikere) så b spredes ud mellem a.
function interleave(a, b) {
  const out = [];
  let ia = 0, ib = 0;
  for (let i = 0, n = a.length + b.length; i < n; i++) {
    const wantA = b.length === 0 || (a.length > 0 && ia / a.length <= ib / Math.max(1, b.length));
    if (wantA && ia < a.length) out.push(a[ia++]);
    else if (ib < b.length) out.push(b[ib++]);
    else if (ia < a.length) out.push(a[ia++]);
  }
  return out;
}

// ---- BANDED: B baseline-spor + overlay; hele game-dage pr. IRL-dag (straddle-fri) ----
// Returnerer { placements, timelineLength } eller null hvis ikke realiserbart.
function layoutBanded({ stageRaces, classics, density: D, days, cap }) {
  if (D < 1 || days < 1) return null;
  const K = Math.ceil(D / cap);          // game-dage pr. IRL-dag
  const B = Math.floor(D / K);           // baseline-niveau (spor der dækker hele tidslinjen)
  const R = D - B * K;                    // ekstra overlay-events pr. IRL-dag (på R af de K game-dage)
  const T = K * days;                     // tidslinje-længde i game-dage
  if (B < 1) return null;
  const stageEvents = stageRaces.reduce((s, r) => s + lenOf(r), 0);
  if (stageEvents > B * T) return null;            // for mange etape-game-dage til baseline
  if (stageRaces.some((r) => lenOf(r) > T)) return null;
  const overlayCount = R * days;
  const baselineClassics = B * T - stageEvents;
  if (baselineClassics < 0) return null;
  if (classics.length !== baselineClassics + overlayCount) return null; // skal gå præcist op (kvote)

  // Bin-pack etapeløb i B spor (FFD, kapacitet T).
  const chains = Array.from({ length: B }, () => ({ items: [], used: 0 }));
  for (const r of [...stageRaces].sort(byBigThenId)) {
    let best = -1;
    for (let c = 0; c < B; c++) if (chains[c].used + lenOf(r) <= T && (best === -1 || chains[c].used < chains[best].used)) best = c;
    if (best === -1) return null;
    chains[best].items.push(r);
    chains[best].used += lenOf(r);
  }
  // Fyld hvert spor til T med baseline-klassikere (interleaved for spredning).
  const pool = [...classics];
  for (const chain of chains) {
    const fill = pool.splice(0, T - chain.used);
    chain.seq = interleave(chain.items, fill); // rækkefølge af race-objekter
  }
  const overlay = pool; // resterende = overlayCount

  // chainAt[c][g] = { race, stage_number } for game-dag g i spor c.
  const chainAt = chains.map((chain) => {
    const arr = new Array(T).fill(null);
    let g = 0;
    for (const race of chain.seq) {
      const L = lenOf(race);
      for (let k = 0; k < L; k++) { arr[g] = { race, stage_number: k + 1 }; g++; }
    }
    return arr;
  });

  // Komprimering: IRL-dag d = game-dage [d*K, d*K+K). Overlay på de første R game-dage i hver IRL-dag.
  const placementsById = new Map();
  const ensure = (race) => {
    if (!placementsById.has(race.id)) placementsById.set(race.id, { id: race.id, type: lenOf(race) > 1 ? "stage_race" : "single", race_class: race.race_class ?? null, stages: lenOf(race), startRealDay: Infinity, stagesPlaced: [] });
    return placementsById.get(race.id);
  };
  let oi = 0;
  for (let d = 0; d < days; d++) {
    let lane = 0;
    for (let k = 0; k < K; k++) {
      const g = d * K + k;
      for (let c = 0; c < B; c++) {
        const cell = chainAt[c][g];
        const p = ensure(cell.race);
        p.stagesPlaced.push({ stage_number: cell.stage_number, real_day: d, game_day: g, lane: lane++ });
        p.startRealDay = Math.min(p.startRealDay, d);
      }
      if (k < R && oi < overlay.length) {
        const race = overlay[oi++];
        const p = ensure(race);
        p.stagesPlaced.push({ stage_number: 1, real_day: d, game_day: g, lane: lane++ });
        p.startRealDay = Math.min(p.startRealDay, d);
      }
    }
  }
  const placements = [...placementsById.values()];
  for (const p of placements) p.stagesPlaced.sort((a, b) => a.stage_number - b.stage_number);
  return { placements, timelineLength: T };
}

// ---- STREAM: least-loaded på `cap` spor + game-dag-ordnet komprimering (håndterer GT + monumenter) ----
function layoutStream({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }) {
  const gts = stageRaces.filter((r) => lenOf(r) >= spineMinStages).sort(byBigThenId);
  const others = stageRaces.filter((r) => lenOf(r) < spineMinStages).sort(byBigThenId);
  const streamCursor = new Array(cap).fill(0);
  const raceSpan = new Map();
  const placeStream = (s, race) => { const start = streamCursor[s]; streamCursor[s] = start + lenOf(race); raceSpan.set(race.id, { start, len: lenOf(race), stream: s, race }); };
  const rest = interleave(others, classics);

  if (gts.length) {
    const perGap = Math.floor(Math.floor(rest.length / 2) / gts.length);
    let ri = 0;
    gts.forEach((gt) => { placeStream(0, gt); for (let k = 0; k < perGap && ri < rest.length; k++) placeStream(0, rest[ri++]); });
    for (; ri < rest.length; ri++) { let s = 0; for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t; placeStream(s, rest[ri]); }
  } else {
    for (const race of rest) { let s = 0; for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t; placeStream(s, race); }
  }
  const timelineLength = Math.max(0, ...streamCursor);

  // Events ordnet efter game-dag, så spor (stabil).
  const events = [];
  for (const { start, len, stream, race } of raceSpan.values()) {
    const type = len > 1 ? "stage_race" : "single";
    for (let k = 0; k < len; k++) events.push({ race, type, stage_number: k + 1, game_day: start + k, stream });
  }
  events.sort((a, b) => a.game_day - b.game_day || a.stream - b.stream || String(a.race.id).localeCompare(String(b.race.id)) || a.stage_number - b.stage_number);

  const totalSlots = D * days;
  const monSlot = new Set();
  if (monuments.length) {
    const stepF = totalSlots / monuments.length;
    for (let i = 0; i < monuments.length; i++) { let slot = Math.min(totalSlots - 1, Math.floor(i * stepF + stepF / 2)); while (monSlot.has(slot)) slot = (slot + 1) % totalSlots; monSlot.add(slot); }
  }
  const placementsById = new Map();
  const ensure = (race, type, stages) => { if (!placementsById.has(race.id)) placementsById.set(race.id, { id: race.id, type, race_class: race.race_class ?? null, stages, startRealDay: Infinity, stagesPlaced: [] }); return placementsById.get(race.id); };
  let ei = 0, monIdx = 0, monGameDay = MONUMENT_GAMEDAY_BASE;
  for (let slot = 0; slot < totalSlots; slot++) {
    const real_day = Math.floor(slot / D), lane = slot % D;
    if (monSlot.has(slot) && monIdx < monuments.length) {
      const m = monuments[monIdx++];
      const p = ensure(m, "single", 1);
      p.stagesPlaced.push({ stage_number: 1, real_day, game_day: monGameDay++, lane }); p.startRealDay = Math.min(p.startRealDay, real_day);
      continue;
    }
    if (ei < events.length) {
      const ev = events[ei++];
      const p = ensure(ev.race, ev.type, lenOf(ev.race));
      p.stagesPlaced.push({ stage_number: ev.stage_number, real_day, game_day: ev.game_day, lane }); p.startRealDay = Math.min(p.startRealDay, real_day);
    }
  }
  const placements = [...placementsById.values()];
  for (const p of placements) p.stagesPlaced.sort((a, b) => a.stage_number - b.stage_number);
  return { placements, timelineLength };
}

// Diagnostik fra placements (ÆGTE binding-overlap fra game-dag-spans, uafhængigt af layout).
function diagnose(placements, days, D, cap, timelineLength, layoutMode) {
  const load = new Array(days).fill(0);
  const racesOnDay = Array.from({ length: days }, () => new Set());
  for (const p of placements) for (const st of p.stagesPlaced) { load[st.real_day] += 1; racesOnDay[st.real_day].add(p.id); }

  const spans = placements
    .filter((p) => p.stagesPlaced.every((s) => s.game_day < MONUMENT_GAMEDAY_BASE))
    .map((p) => [Math.min(...p.stagesPlaced.map((s) => s.game_day)), Math.max(...p.stagesPlaced.map((s) => s.game_day))]);
  const hi = spans.length ? Math.max(...spans.map((s) => s[1])) : -1;
  const overlapHistogram = {};
  let maxOverlap = 0;
  for (let g = 0; g <= hi; g++) {
    const n = spans.filter(([a, b]) => a <= g && b >= g).length;
    overlapHistogram[n] = (overlapHistogram[n] || 0) + 1;
    if (n > maxOverlap) maxOverlap = n;
  }

  const irlByGameDay = new Map();
  for (const p of placements) for (const st of p.stagesPlaced) {
    if (st.game_day >= MONUMENT_GAMEDAY_BASE) continue;
    if (!irlByGameDay.has(st.game_day)) irlByGameDay.set(st.game_day, new Set());
    irlByGameDay.get(st.game_day).add(st.real_day);
  }
  let straddleGameDays = 0;
  for (const set of irlByGameDay.values()) if (set.size > 1) straddleGameDays += 1;

  return {
    load, racesPerDay: racesOnDay.map((s) => s.size), days, density: D, overlapCap: cap, layoutMode, timelineLength,
    emptyDays: load.filter((x) => x === 0).length,
    underfilledDays: load.filter((x) => x < D).length,
    overlapDays: racesOnDay.map((s) => s.size).filter((n) => n >= 2).length,
    maxOverlap, overlapHistogram, straddleGameDays,
  };
}

// #1856: binding-game_day-span for én placement (min..max game_day på tværs af dens etaper).
// Monument-etaper (game_day i højt bånd) binder ikke → udeladt. Tom → null.
function placementBindingSpan(p) {
  const gds = (p.stagesPlaced || [])
    .map((s) => s.game_day)
    .filter((g) => Number.isFinite(g) && g < MONUMENT_GAMEDAY_BASE);
  if (!gds.length) return null;
  return { start: Math.min(...gds), end: Math.max(...gds) };
}

/**
 * #1856 forward-guard: en invariant der forhindrer at pakkeren placerer et NYT løb oven i et
 * IGANGVÆRENDE (in-flight) løbs resterende vindue i samme game_day-nøglerum. Ren + deterministisk.
 *
 * Bruges når kalenderen genopbygges i det SAMME game_day-rum som de igangværende løb (fx en
 * in-place reschedule). Til en fuld rebuild hvor game_day er 0-baseret pr. division og in-flight-
 * løbet bærer et andet game_day-rum, sammenlignes i stedet på fysisk CET-kalenderdag (se
 * tierCalendarMaterializer.js / raceRemainingTimeWindow).
 *
 * @param {{ placements: Array<{id, stagesPlaced}>, occupiedWindows?: Array<{start, end, raceId?}> }} args
 * @throws {Error} hvis en placement overlapper et optaget (in-flight) vindue.
 * @returns {true} hvis ingen overlap.
 */
export function assertNoInFlightOverlap({ placements = [], occupiedWindows = [] } = {}) {
  if (!occupiedWindows.length) return true;
  for (const p of placements) {
    const span = placementBindingSpan(p);
    if (!span) continue;
    for (const occ of occupiedWindows) {
      if (occ && span.start <= occ.end && occ.start <= span.end) {
        throw new Error(
          `in-flight overlap invariant: race ${p.id} (game_day ${span.start}..${span.end}) ` +
          `overlaps in-flight window ${occ.start}..${occ.end}` +
          (occ.raceId ? ` (race ${occ.raceId})` : ""),
        );
      }
    }
  }
  return true;
}

/**
 * @param {{ stageRaces?, oneDayRaces?, density?, days?, overlapCap?, spineMinStages?, seed? }} args
 */
export function packLaneCalendar({
  stageRaces = [], oneDayRaces = [], density = 1, days = 28,
  overlapCap = 2, spineMinStages = 15,
} = {}) {
  const D = Math.max(1, density);
  const cap = Math.max(1, overlapCap);
  const monuments = oneDayRaces.filter((r) => r.race_class === "Monuments");
  const classics = oneDayRaces.filter((r) => r.race_class !== "Monuments");

  // Foretræk BANDED (straddle-fri blanding) når ingen monumenter; ellers STREAM.
  let layoutMode = "banded";
  let res = monuments.length === 0 ? layoutBanded({ stageRaces, classics, density: D, days, cap }) : null;
  if (!res) { layoutMode = "stream"; res = layoutStream({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }); }

  const placements = res.placements;
  const diag = diagnose(placements, days, D, cap, res.timelineLength, layoutMode);

  const placedIds = new Set(placements.map((p) => p.id));
  return {
    placements,
    ...diag,
    unplaced: stageRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
    leftoverSingles: oneDayRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
  };
}
