// backend/lib/raceCalendarPacker.js
// Kalender-rebuild (2026-06-27): pak en divisions valgte løb ind i et HÅRDT real-dags-
// vindue (default 28) med den ejer-låste form:
//   - løb på HVER IRL-dag (ingen tomme dage, så længe der er nok endagsløb),
//   - etapeløb komprimeret (≤ maxStagesPerRealDay etaper/real-dag),
//   - etapeløbene SPREDT jævnt ud over sæsonen (ikke krammet sammen),
//   - nogle etapeløb SOLO (kører helt alene, intet overlap),
//   - bevidste etapeløb-på-etapeløb via forcedOverlaps (op til maxConcurrentStageRaces),
//   - endagsklassikere spredt jævnt + lagt oven på etapeløb (aldrig oven på solo-løb).
//
// Binding (ejer-valg A): nøgler på game_day = stagens real-dag i sæsonen. To FORSKELLIGE
// løb hvis game_day-spans overlapper deler IRL-dag → holdet splitter truppen. Et etapeløb
// binder sin trup for hele sin varighed. REN + deterministisk (ingen DB/Date/random).

function ceilDiv(a, b) { return Math.ceil(a / b); }

/**
 * @param {{
 *   stageRaces?: Array<{id, stages, solo?: boolean}>,
 *   oneDayRaces?: Array<{id}>,
 *   realDays?: number,
 *   maxStagesPerRealDay?: number,
 *   maxConcurrentStageRaces?: number,
 *   forcedOverlaps?: Array<[string, string]>,  // [primærId, sekundærId] — sekundær lægges oven på primær
 * }} args
 */
export function packDivisionCalendar({
  stageRaces = [],
  oneDayRaces = [],
  realDays = 28,
  maxStagesPerRealDay = 5,
  maxConcurrentStageRaces = 2,
  forcedOverlaps = [],
} = {}) {
  const load = new Array(realDays).fill(0);
  const stageLoad = new Array(realDays).fill(0);
  const soloDays = new Set();
  const placements = [];
  const startById = new Map();

  const lenOf = (race) => ceilDiv(Math.max(1, Number(race.stages) || 1), maxStagesPerRealDay);

  function stagesFor(race, start) {
    const total = Math.max(1, Number(race.stages) || 1);
    const out = [];
    for (let s = 0; s < total; s++) {
      const real_day = start + Math.floor(s / maxStagesPerRealDay);
      out.push({ stage_number: s + 1, real_day, game_day: real_day });
    }
    return out;
  }

  function validAt(race, start) {
    const len = lenOf(race);
    if (start < 0 || start + len > realDays) return false;
    for (let d = start; d < start + len; d++) {
      if (soloDays.has(d)) return false;
      if (race.solo) { if (load[d] !== 0) return false; }
      else if (stageLoad[d] >= maxConcurrentStageRaces) return false;
    }
    return true;
  }

  function commit(race, start) {
    const len = lenOf(race);
    for (let d = start; d < start + len; d++) {
      load[d]++; stageLoad[d]++;
      if (race.solo) soloDays.add(d);
    }
    placements.push({ id: race.id, type: "stage_race", stages: Math.max(1, Number(race.stages) || 1), startRealDay: start, stagesPlaced: stagesFor(race, start) });
    startById.set(race.id, start);
  }

  // Søg udad fra en foretrukken startdag (pref, pref+1, pref-1, pref+2, …) efter første gyldige plads.
  function placeNear(race, pref) {
    const clamped = Math.max(0, Math.min(pref, realDays - lenOf(race)));
    for (let off = 0; off < realDays; off++) {
      for (const start of (off === 0 ? [clamped] : [clamped + off, clamped - off])) {
        if (validAt(race, start)) { commit(race, start); return start; }
      }
    }
    return -1;
  }

  // Rækkefølge: solo først (rene vinduer), så størst-først; deterministisk på id.
  const ordered = [...stageRaces].sort((a, b) =>
    ((b.solo ? 1 : 0) - (a.solo ? 1 : 0)) ||
    ((Number(b.stages) || 1) - (Number(a.stages) || 1)) ||
    String(a.id).localeCompare(String(b.id)));

  const secondOf = new Map(); // sekundærId -> primærId (lægges oven på primær til sidst)
  for (const [primary, second] of forcedOverlaps) secondOf.set(second, primary);

  // 1) placér primære/solo-løb SPREDT (foretrukken start = jævn fordeling over sæsonen).
  const primaries = ordered.filter((r) => !secondOf.has(r.id));
  primaries.forEach((race, i) => {
    placeNear(race, Math.floor(((i + 0.5) * realDays) / Math.max(1, primaries.length)));
  });

  // 2) placér forced-overlap-sekundærer oven på deres primær (eller nærmest).
  for (const race of ordered) {
    if (!secondOf.has(race.id)) continue;
    const partnerStart = startById.get(secondOf.get(race.id));
    placeNear(race, partnerStart != null ? partnerStart : 0);
  }

  const unplacedStages = ordered.filter((r) => !startById.has(r.id)).map((r) => r.id);

  // 3) endagsløb: fyld tomme dage, så der er løb hver IRL-dag.
  const od = [...oneDayRaces].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let oi = 0;
  function placeSingle(day) {
    placements.push({ id: od[oi].id, type: "single", stages: 1, startRealDay: day, stagesPlaced: [{ stage_number: 1, real_day: day, game_day: day }] });
    load[day]++; oi++;
  }
  for (let d = 0; d < realDays && oi < od.length; d++) {
    if (load[d] === 0) placeSingle(d);
  }

  // 4) spred resterende klassikere jævnt oven på ikke-solo etape-dage med plads (load<2).
  const cand = [];
  for (let d = 0; d < realDays; d++) {
    if (!soloDays.has(d) && stageLoad[d] >= 1 && load[d] < 2) cand.push(d);
  }
  const picks = Math.min(od.length - oi, cand.length);
  const usedIdx = new Set();
  for (let k = 0; k < picks; k++) {
    let idx = Math.round((k * (cand.length - 1)) / Math.max(1, picks - 1));
    while (usedIdx.has(idx) && idx < cand.length - 1) idx++;
    while (usedIdx.has(idx) && idx > 0) idx--;
    if (usedIdx.has(idx)) break;
    usedIdx.add(idx);
    placeSingle(cand[idx]);
  }

  return {
    placements, load, stageLoad,
    soloDays: [...soloDays].sort((a, b) => a - b),
    realDays,
    emptyDays: load.filter((x) => x === 0).length,
    unplacedStages,
    unplacedSingles: od.slice(oi).map((r) => r.id),
  };
}
