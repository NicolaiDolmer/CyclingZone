// backend/lib/seasonPhaseProfiles.js
// #3469: forankr kalenderens PLACERING/RÆKKEFØLGE i race_pool.date_text — hvert katalog-løbs
// VIRKELIGE dato (152 rækker verificeret 6/8, format "d/m" eller "d/m - d/m", dansk d/m,
// separator PRÆCIS " - "). Formålet er UDELUKKENDE placering — denne fil siger aldrig
// hvilke løb der vælges (det er stadig tierRaceSelection.js), kun HVOR på sæsonens
// tidslinje et allerede valgt løb hører hjemme.
//
// Samme princip som raceStageOrderProfiles.js/calendarCompositionTargets.js: data, ikke
// kode-konstanter, kalibreret mod det RIGTIGE katalog (læst read-only 6/8, se PR-body for
// den fulde dump), ikke gæt.
//
// ── Dataarkæologi bag SEASON_PHASES-grænserne (katalog-scan 6/8, alle 152 rækker har
//    date_text — ingen huller) ─────────────────────────────────────────────────────────
// Grand Tours (de tre eneste ≥15-etapers løb i kataloget) lander på:
//   Giro della Penisola   8/5   (doy 128)  → fraction ≈0,40 af det målte spænd [20,292]
//   Tour de l'Hexagone    4/7   (doy 185)  → fraction ≈0,61
//   Vuelta Ibérica        22/8  (doy 234)  → fraction ≈0,79 (spænder til 13/9, doy 256)
// Monumenterne (5 stk.) klumper 4 tidlige (21/3·5/4·12/4·26/4, doy 80-116) + 1 sen
// (10/10, doy 283) — den klassiske vår-klassiker-tyngde plus én efterårsklassiker.
// Brostens-klumpningen (63 % af cobbled_*-etaperne i marts-april) er #3326-trådens
// research-optælling af virkelige sæsoner (samme kilde som raceStageOrderProfiles.js),
// ikke en selvstændig date_text-optælling i denne fil.
// Katalogets fulde spænd (6/8): [20 (Tour of South Australia, 20/1), 292 (Chrono des
// Herbiers Mineur, 19/10)]. INGEN hardkodede 20/291-tal bruges nogen steder i koden —
// computeSeasonSpan() genberegner altid spændet af det AKTUELLE katalog, så en fremtidig
// katalog-udvidelse ikke kræver en kode-ændring her.
//
// SEASON_PHASES-grænserne er placeret så de tre GT'er falder centralt i hver sit bånd
// (First GT Block dækker 0,37-0,54 ⊇ Giro ≈0,40 · Second GT/Late Summer dækker 0,71-0,93
// ⊇ Vuelta ≈0,79) og Classics Block (0,15-0,37) dækker forårs-monumenterne. Den sene
// Classica d'Autunno (≈0,89) falder i Second GT/Late Summer, ikke Autumn Finale — den er
// en efterårs-outlier i kataloget, ikke bånd-definerende for Autumn Finale (0,93-1,0).
//
// REN + deterministisk (ingen DB/Date/random) — samme kontrakt som raceCalendarLanePacker.js.

const NON_LEAP_CUM_DAYS = Object.freeze([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]);
const NON_LEAP_MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function doyOf(day, month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > NON_LEAP_MONTH_LENGTHS[month - 1]) return null;
  return NON_LEAP_CUM_DAYS[month - 1] + day;
}

/**
 * Parse race_pool.date_text — "d/m" (endagsløb) eller "d/m - d/m" (etapeløb), dansk d/m,
 * separator PRÆCIS " - ". Whitespace-tolerant (trimmer hele strengen + omkring hver del).
 * Skudår findes ikke i denne kalender — 29/2 er altid ugyldig.
 * @param {string|null|undefined} dateText
 * @returns {{startDoy:number, endDoy:number}|null} null ved tom/manglende/uparselig streng.
 */
export function parseRaceDateText(dateText) {
  if (dateText == null) return null;
  const raw = String(dateText).trim();
  if (raw === "") return null;

  const range = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(raw);
  if (range) {
    const startDoy = doyOf(Number(range[1]), Number(range[2]));
    const endDoy = doyOf(Number(range[3]), Number(range[4]));
    if (startDoy == null || endDoy == null) return null;
    return { startDoy, endDoy };
  }

  const single = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(raw);
  if (single) {
    const doy = doyOf(Number(single[1]), Number(single[2]));
    if (doy == null) return null;
    return { startDoy: doy, endDoy: doy };
  }

  return null;
}

/**
 * Sæson-spænd (min/maks startDoy) over ALLE parsebare rækker i det FULDE katalog — beregnes
 * FØR tier-filtrering/dedup (#3469-kontrakt), så normaliseringen (seasonFraction) er den
 * samme uanset hvilken tier der spørger. Rækker uden parsebar date_text ignoreres stille
 * (de får seasonFraction=null længere nede i pipelinen, ikke et forkert spænd her).
 * @param {Array<{date_text?: string}>} catalogRows
 * @returns {{minDoy:number, maxDoy:number}} {0,0} hvis intet i kataloget kan parses.
 */
export function computeSeasonSpan(catalogRows = []) {
  let minDoy = Infinity;
  let maxDoy = -Infinity;
  for (const row of catalogRows) {
    const parsed = parseRaceDateText(row?.date_text);
    if (!parsed) continue;
    if (parsed.startDoy < minDoy) minDoy = parsed.startDoy;
    if (parsed.startDoy > maxDoy) maxDoy = parsed.startDoy;
  }
  if (!Number.isFinite(minDoy) || !Number.isFinite(maxDoy)) return { minDoy: 0, maxDoy: 0 };
  return { minDoy, maxDoy };
}

/**
 * Normalisér en startDoy til 0..1 inden for sæson-spændet (clamped). Et span på 0 (eller et
 * ugyldigt span) returnerer 0,5 — hverken tidligt eller sent, den mindst forkerte gæt frem
 * for en division-by-zero eller et vilkårligt endepunkt.
 * @param {number} startDoy
 * @param {{minDoy:number, maxDoy:number}} span
 * @returns {number}
 */
export function seasonFraction(startDoy, span) {
  const minDoy = span?.minDoy;
  const maxDoy = span?.maxDoy;
  const range = (maxDoy ?? 0) - (minDoy ?? 0);
  if (!Number.isFinite(startDoy) || !Number.isFinite(range) || range <= 0) return 0.5;
  return Math.min(1, Math.max(0, (startDoy - minDoy) / range));
}

// Se dataarkæologien i header-docstringen for grænse-begrundelsen. Rækkefølgen er
// rapport-rækkefølgen (samme mønster som COMPOSITION_CATEGORIES).
export const SEASON_PHASES = Object.freeze([
  Object.freeze({ index: 0, name: "Season Opening", min: 0, max: 0.15 }),
  Object.freeze({ index: 1, name: "Classics Block", min: 0.15, max: 0.37 }),
  Object.freeze({ index: 2, name: "First GT Block", min: 0.37, max: 0.54 }),
  Object.freeze({ index: 3, name: "High Summer", min: 0.54, max: 0.71 }),
  Object.freeze({ index: 4, name: "Second GT/Late Summer", min: 0.71, max: 0.93 }),
  Object.freeze({ index: 5, name: "Autumn Finale", min: 0.93, max: 1.0 }),
]);

/**
 * Find fasen for en 0..1-fraktion (clamped ved kald). Sidste fase er lukket i begge ender
 * ([0,93 ; 1,0]) så fraction=1 altid rammer et bånd.
 * @param {number} fraction
 * @returns {{index:number,name:string,min:number,max:number}|null} null hvis fraction ikke er et tal.
 */
export function phaseOf(fraction) {
  if (!Number.isFinite(fraction)) return null;
  const f = Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < SEASON_PHASES.length; i++) {
    const phase = SEASON_PHASES[i];
    const isLast = i === SEASON_PHASES.length - 1;
    if (f >= phase.min && (isLast ? f <= phase.max : f < phase.max)) return phase;
  }
  return SEASON_PHASES[SEASON_PHASES.length - 1];
}

/**
 * Klumpnings-metrik: for et givet sæt "arketyper" (matcher packLaneCalendar-placements'
 * `race_class`), hvor stor en andel af dens løbsdage der ligger inden for det TÆTTESTE
 * sammenhængende vindue der dækker `windowFraction` (default 25 %) af tidslinjen — et
 * glidende vindue over de lineære slots `real_day × density + lane` (samme slot-begreb som
 * raceCalendarLanePacker.test.js' monotoni-test bruger). Ren funktion.
 * @param {{placements?, archetypes?: string[], totalSlots?: number, density?: number, windowFraction?: number}} args
 * @returns {{windowShare:number, matchedDays:number, windowSize:number}}
 */
export function computeChronologyClumping({
  placements = [], archetypes = [], totalSlots = 0, density = 1, windowFraction = 0.25,
} = {}) {
  const set = new Set(archetypes);
  const slots = [];
  for (const p of placements) {
    if (!set.has(p.race_class)) continue;
    for (const s of p.stagesPlaced ?? []) slots.push(s.real_day * density + s.lane);
  }
  if (!slots.length || totalSlots <= 0) return { windowShare: 0, matchedDays: slots.length, windowSize: 0 };
  slots.sort((a, b) => a - b);
  const windowSize = Math.max(1, Math.round(totalSlots * windowFraction));
  let best = 0;
  let left = 0;
  for (let right = 0; right < slots.length; right++) {
    while (slots[right] - slots[left] >= windowSize) left++;
    best = Math.max(best, right - left + 1);
  }
  return { windowShare: best / slots.length, matchedDays: slots.length, windowSize };
}

/**
 * Pr.-fase løbsdags-optælling + arketype-fordeling for et sæt packLaneCalendar-placements.
 * `fractionByRaceId` er en Map<raceId, seasonFraction> bygget af KALDEREN fra de samme
 * berigede race-objekter der blev fodret til packLaneCalendar — placements selv bærer ikke
 * seasonFraction videre (kun id/type/race_class/stages/stagesPlaced). Løb uden en fraction i
 * kortet (date_text manglede/kunne ikke parses) tælles i `unknownFraction`, ikke i en fase.
 * @param {{placements?, fractionByRaceId?: Map<string,number>, totalSlots?: number, density?: number, clumpArchetypes?: string[]|null, clumpWindowFraction?: number}} args
 * @returns {{phases: Array<{index:number,name:string,raceDays:number,byArchetype:object}>, unknownFraction:number, clumping: object|null}}
 */
export function computePhaseStats({
  placements = [], fractionByRaceId = new Map(), totalSlots = 0, density = 1,
  clumpArchetypes = null, clumpWindowFraction = 0.25,
} = {}) {
  const buckets = SEASON_PHASES.map(() => ({ total: 0, byArchetype: {} }));
  let unknownFraction = 0;

  for (const p of placements) {
    const fraction = fractionByRaceId.get(p.id);
    const dayCount = p.stagesPlaced?.length ?? 0;
    if (!Number.isFinite(fraction)) { unknownFraction += dayCount; continue; }
    const phase = phaseOf(fraction);
    const bucket = buckets[phase.index];
    bucket.total += dayCount;
    const archetype = p.race_class ?? "(ukendt)";
    bucket.byArchetype[archetype] = (bucket.byArchetype[archetype] ?? 0) + dayCount;
  }

  const phases = SEASON_PHASES.map((ph, i) => ({
    index: ph.index, name: ph.name, raceDays: buckets[i].total, byArchetype: buckets[i].byArchetype,
  }));

  const clumping = clumpArchetypes
    ? computeChronologyClumping({ placements, archetypes: clumpArchetypes, totalSlots, density, windowFraction: clumpWindowFraction })
    : null;

  return { phases, unknownFraction, clumping };
}
