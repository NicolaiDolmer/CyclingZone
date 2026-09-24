// backend/lib/squadCalendarPacker.js
// #5644 (Y5, #2492): kalenderen for en UNGDOMSTRUP (u23/junior), bygget fra truppens eget
// katalog (race_pool.squad). REN — ingen DB. tierCalendarMaterializer.js kalder den i stedet
// for selectTierRaceSet + packLaneCalendar, naar den bygger en trups kalender.
//
// HVORFOR IKKE SENIORENS PAKKER: packLaneCalendar er bygget til en division der koerer
// hver kalenderdag (density etaper pr. dag, §2). Ungdommen koerer 1-2 loeb om ugen (spec
// 2026-09-15 §10.5, YOUTH_RULES.md §2.3). Proevet 24/9: med ungdomskataloget og en lav kvote
// lae­gger seniorpakkeren alle loeb i traek fra dag 0 og efterlader resten af saesonen tom -
// fire loeb i foerste uge, nul i sidste. Ungdommen har derfor sin egen, lille pakker med
// ugen som enhed.
//
// FORMEN (SQUAD_CALENDAR i calendarTierCaps.js):
//   · Hver kalenderuge faar racesPerWeek.max loeb, talt efter START-dato.
//   · Hoejst maxRacingDayShare af datoerne baerer en etape (resten er rene traeningsdage).
//   · Aldrig to loeb samtidig (overlapCap 1): en etape pr. dato, etaperne i traek.
//   · Udvalget er prestige-foerst (samme PRESTIGE_RANK som senioren), saa stoerst-foerst,
//     og navne-dedup inden for truppen. Raekkefoelgen i kalenderen foelger loebenes rigtige
//     dato (seasonFraction), ligesom seniorens kronologi.
//
// LOEBSDAGS-AKSEN: samme maal som senioren (raceDayTarget, 140 i S4), fordelt jaevnt pr.
// kalenderdato som §1e-b (140/28 = 5). En ungdomsetape ligger paa datoens FOERSTE loebsdag;
// datoens andre loebsdage, og alle loebsdage paa datoer uden etape, er rene traeningsdage.

import { PRESTIGE_RANK, GRAND_TOUR_MIN_STAGES } from "./tierRaceSelection.js";

const DAYS_PER_WEEK = 7;

const prestigeOf = (rc) => PRESTIGE_RANK[rc] ?? 99;
const stagesOf = (r) => Math.max(1, Number(r?.stages) || 1);

// Samme FNV-form som tierRaceSelection.seededKey: varierer KUN raekkefoelgen inden for samme
// prestige + stoerrelse, deterministisk pr. seed.
function seededKey(id, seed) {
  let h = 2166136261 >>> 0;
  const s = `${(Number(seed) || 0) >>> 0}:${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Kalenderugerne som halvaabne intervaller [start, end) over real_day 0..days-1. */
export function calendarWeeks(days) {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  const weeks = [];
  for (let start = 0; start < n; start += DAYS_PER_WEEK) weeks.push({ start, end: Math.min(n, start + DAYS_PER_WEEK) });
  return weeks;
}

/**
 * Loebsdage pr. kalenderdato (largest remainder, samme fordeling som seniorens padding,
 * raceCalendarLanePacker.fordelJaevntPrDato) og hver datos foerste loebsdag.
 * Uden maal (target 0/null) har hver dato praecis een loebsdag.
 */
export function raceDayAxis({ days, target = null }) {
  const n = Math.max(1, Math.floor(Number(days) || 1));
  const maal = Math.max(0, Math.round(Number(target) || 0));
  const perDate = maal > 0
    ? Array.from({ length: n }, (_, d) => Math.floor(maal / n) + (d < maal - Math.floor(maal / n) * n ? 1 : 0))
    : Array.from({ length: n }, () => 1);
  const firstOf = [];
  let g = 0;
  for (let d = 0; d < n; d++) { firstOf.push(g); g += perDate[d]; }
  return { perDate, firstOf, length: g };
}

/**
 * Udvalget: prestige-foerst, stoerst-foerst, seed. Hvert valg skal efterlade mindst een dato
 * til hvert af de loeb der endnu mangler, inden for etape-budgettet.
 */
export function selectSquadRaces({ catalog = [], count = 0, stageBudget = 0, seed = 1, usedNames = new Set() } = {}) {
  const ranked = catalog
    .filter((r) => stagesOf(r) < GRAND_TOUR_MIN_STAGES)
    .filter((r) => r.name == null || !usedNames.has(r.name))
    .sort((a, b) => prestigeOf(a.race_class) - prestigeOf(b.race_class)
      || stagesOf(b) - stagesOf(a)
      || seededKey(a.id, seed) - seededKey(b.id, seed)
      || String(a.id).localeCompare(String(b.id)));
  const picked = [];
  const seen = new Set();
  let stageDays = 0;
  for (const r of ranked) {
    if (picked.length >= count) break;
    if (r.name != null && seen.has(r.name)) continue;
    const s = stagesOf(r);
    const stillNeededAfter = count - picked.length - 1;
    if (stageDays + s + stillNeededAfter > stageBudget) continue;
    picked.push(r);
    if (r.name != null) seen.add(r.name);
    stageDays += s;
  }
  return { picked, stageDays };
}

// Placér loebene uge for uge. `byWeek[w]` er ugens loeb i den raekkefoelge de skal koeres.
// Loeb j af k i en uge sigter paa ugens start + j·(ugens laengde)/k, men starter tidligst
// dagen efter forrige loebs sidste etape (overlapCap 1).
function placeByWeek({ byWeek, weeks, days }) {
  const placements = [];
  const violations = [];
  let cursor = 0;
  for (const [w, list] of byWeek.entries()) {
    const { start: ws, end: we } = weeks[w];
    const k = list.length;
    for (const [j, race] of list.entries()) {
      const target = ws + Math.floor((j * (we - ws)) / k);
      const start = Math.max(target, cursor);
      const s = stagesOf(race);
      if (start >= we) violations.push(`week ${w + 1}: race ${race.id} (${race.name ?? "?"}) cannot start inside its week (earliest day ${start + 1})`);
      if (start + s > days) violations.push(`race ${race.id} (${race.name ?? "?"}) ends after the season's last calendar day`);
      placements.push({ race, startRealDay: start, stages: s });
      cursor = start + s;
    }
  }
  return { placements, violations };
}

const chronological = (seasonFractionOf) => (a, b) => {
  const fa = seasonFractionOf(a.id);
  const fb = seasonFractionOf(b.id);
  if (fa != null && fb != null && fa !== fb) return fa - fb;
  if (fa == null && fb != null) return 1;
  if (fa != null && fb == null) return -1;
  return prestigeOf(a.race_class) - prestigeOf(b.race_class) || String(a.id).localeCompare(String(b.id));
};

// Forsoeg 1: ren kronologi - loeb i faar uge floor(i·uger/N). Kortere loeb foerst inden for
// ugen, saa et langt etapeloeb ikke skubber ugens andet loeb ud af ugen.
function chronologicalWeeks(picked, weekCount, perWeek, seasonFractionOf) {
  const order = [...picked].sort(chronological(seasonFractionOf));
  const byWeek = Array.from({ length: weekCount }, () => []);
  const n = order.length;
  for (const [i, r] of order.entries()) {
    const w = Math.min(weekCount - 1, Math.floor((i * weekCount) / Math.max(1, n)));
    if (byWeek[w].length < perWeek) byWeek[w].push(r);
    else byWeek.find((list) => list.length < perWeek)?.push(r);
  }
  for (const list of byWeek) list.sort((a, b) => stagesOf(a) - stagesOf(b) || chronological(seasonFractionOf)(a, b));
  return byWeek;
}

// Forsoeg 2 (kun hvis kronologien ikke kan placeres): balancér etape-dagene over ugerne -
// laengste loeb foerst i den uge der har faerrest etape-dage og en ledig plads.
function balancedWeeks(picked, weekCount, perWeek, seasonFractionOf) {
  const byWeek = Array.from({ length: weekCount }, () => []);
  const load = Array.from({ length: weekCount }, () => 0);
  const order = [...picked].sort((a, b) => stagesOf(b) - stagesOf(a) || chronological(seasonFractionOf)(a, b));
  for (const r of order) {
    let best = -1;
    for (let w = 0; w < weekCount; w++) {
      if (byWeek[w].length >= perWeek) continue;
      if (best < 0 || load[w] < load[best]) best = w;
    }
    if (best < 0) break;
    byWeek[best].push(r);
    load[best] += stagesOf(r);
  }
  for (const list of byWeek) list.sort((a, b) => stagesOf(a) - stagesOf(b) || chronological(seasonFractionOf)(a, b));
  return byWeek;
}

/** Loeb der STARTER i hver kalenderuge. */
export function weeklyRaceStarts(placements = [], days = 0) {
  const weeks = calendarWeeks(days);
  return weeks.map(({ start, end }) => placements.filter((p) => p.startRealDay >= start && p.startRealDay < end).length);
}

/**
 * Gaten for en trups kalender: hver uge mellem min og max loeb (efter start-dato), hoejst
 * maxRacingDayShare af datoerne med en etape, og aldrig to etaper paa samme dato.
 * @returns {string[]} brud som tekst (tom = ren)
 */
export function detectSquadCalendarViolations({ squad, placements = [], days = 0, racesPerWeek, maxRacingDayShare }) {
  const violations = [];
  const starts = weeklyRaceStarts(placements, days);
  for (const [w, n] of starts.entries()) {
    if (racesPerWeek && (n < racesPerWeek.min || n > racesPerWeek.max)) {
      violations.push(`${squad}: week ${w + 1} has ${n} race start(s), outside ${racesPerWeek.min}-${racesPerWeek.max} per week (#5644 Y5)`);
    }
  }
  const racingDates = new Map();
  for (const p of placements) {
    for (let d = p.startRealDay; d < p.startRealDay + p.stages; d++) racingDates.set(d, (racingDates.get(d) ?? 0) + 1);
  }
  const doubleBooked = [...racingDates.entries()].filter(([, n]) => n > 1).map(([d]) => d + 1);
  if (doubleBooked.length) violations.push(`${squad}: two youth races on the same date (day ${doubleBooked.join(", ")}) (#5644 overlapCap 1)`);
  if (maxRacingDayShare != null && days > 0 && racingDates.size > Math.floor(days * maxRacingDayShare)) {
    violations.push(`${squad}: ${racingDates.size} of ${days} dates carry a stage, above the training-day floor (#5644 §10.5)`);
  }
  return violations;
}

/**
 * @param {{ squad: string, catalog: object[], days: number, racesPerWeek: {min:number,max:number},
 *           maxRacingDayShare: number, raceDayTarget?: number|null, seed?: number,
 *           usedNames?: Set<string>, seasonFractionOf?: (id:any)=>number|null }} args
 */
export function packSquadCalendar({
  squad, catalog = [], days = 28, racesPerWeek, maxRacingDayShare, raceDayTarget = null,
  seed = 1, usedNames = new Set(), seasonFractionOf = () => null,
} = {}) {
  const weeks = calendarWeeks(days);
  const perWeek = Math.max(0, Number(racesPerWeek?.max) || 0);
  const count = weeks.length * perWeek;
  const stageBudget = Math.floor(days * (maxRacingDayShare ?? 1));
  const { picked, stageDays } = selectSquadRaces({ catalog, count, stageBudget, seed, usedNames });

  let attempt = placeByWeek({ byWeek: chronologicalWeeks(picked, weeks.length, perWeek, seasonFractionOf), weeks, days });
  if (attempt.violations.length) {
    const balanced = placeByWeek({ byWeek: balancedWeeks(picked, weeks.length, perWeek, seasonFractionOf), weeks, days });
    if (!balanced.violations.length) attempt = balanced;
  }

  const axis = raceDayAxis({ days, target: raceDayTarget });
  const usedGameDays = new Set();
  const placements = attempt.placements.map(({ race, startRealDay, stages }) => {
    const stagesPlaced = [];
    for (let i = 0; i < stages; i++) {
      const realDay = startRealDay + i;
      const gameDay = axis.firstOf[Math.min(realDay, axis.firstOf.length - 1)];
      usedGameDays.add(gameDay);
      stagesPlaced.push({ stage_number: i + 1, real_day: realDay, game_day: gameDay, lane: 0 });
    }
    return {
      id: race.id, type: stages > 1 ? "stage_race" : "single", race_class: race.race_class ?? null,
      stages, startRealDay, stagesPlaced,
    };
  });

  const trainingGameDays = [];
  const dateOfTrainingGameDay = [];
  let g = 0;
  for (let d = 0; d < axis.perDate.length; d++) {
    for (let k = 0; k < axis.perDate[d]; k++, g++) {
      if (!usedGameDays.has(g)) { trainingGameDays.push(g); dateOfTrainingGameDay.push(d); }
    }
  }

  const violations = [
    ...attempt.violations,
    ...detectSquadCalendarViolations({ squad, placements, days, racesPerWeek, maxRacingDayShare }),
  ];
  if (picked.length < count) {
    violations.push(`${squad}: catalog supplied ${picked.length} of ${count} races within the training-day floor (#5644)`);
  }

  return {
    placements,
    selectedIds: picked.map((r) => r.id),
    totalGameDays: stageDays,
    raceCount: placements.length,
    timelineLength: axis.length,
    naturalRaceDays: usedGameDays.size,
    trainingGameDays,
    dateOfTrainingGameDay,
    raceDaysPerDate: axis.perDate,
    weeklyStarts: weeklyRaceStarts(placements, days),
    racingDates: new Set(placements.flatMap((p) => p.stagesPlaced.map((s) => s.real_day))).size,
    violations,
  };
}
