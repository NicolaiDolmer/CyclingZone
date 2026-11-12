/**
 * #3564 / #6110: omregning af potentiale fra 1-6-skalaen (halve trin) til ét
 * fast tal på 1-99-skalaen. Ren funktion: ingen DB, ingen fil-I/O, ingen tid.
 *
 * Algoritmen er remap-variant B fra backend/scripts/dev/lib/remap3564.mjs
 * (den variant ejeren valgte 9/8, låst igen 11/10 og bekræftet 6/11):
 *
 *  1. Ryttere deles i aldersbånd, så hver aldersgruppe omregnes for sig.
 *  2. Lave og mellemste potentiale-trin beholder deres plads: hvert trin får
 *     sit eget stykke af 1-99-skalaen, og trinnets ryttere spredes rang-ordnet
 *     over det stykke. Ingen skifter trin.
 *  3. Toptalent-klassen (fra et param-bestemt trin og op) er den eneste der
 *     presses ned: den deles i hale-segmenter, hvor antallet i hvert segment
 *     følger målfordelingen for et friskt kuld. Resten af klassen lander i det
 *     nederste segment.
 *  4. Fredningsgulve: de øverste gamle trin må aldrig lande under deres gulv.
 *     Løftet er rang-sikkert, så ingen løftet rytter overhaler en rytter med
 *     samme eller højere gammelt potentiale.
 *
 * Alle kalibreringstal (trin-afstand, bredde, vægt-henfald, hvor toptalent-
 * klassen starter, hale-ankre, gulve, aldersbånd) er PRIVATE params, der
 * sendes ind udefra. Der findes med vilje ingen standardværdier her: de
 * rigtige tal ligger i balance-internals/ (hard rule 17).
 *
 * Rækkefølgen inden for samme gamle potentiale er deterministisk og afhænger
 * kun af rytter-id (samme FNV-1a-hash som riderProgression.seededUnit, og
 * id-sammenligning som sidste udvej), så resultatet er uafhængigt af den
 * rækkefølge rytterne kommer ind i.
 */

/** Skalaens ender. Strukturelle, ikke kalibrering. */
export const SCALE_MIN = 1;
export const SCALE_MAX = 99;

/** Den gamle skala: 1-6 i halve trin (strukturel definition, ikke kalibrering). */
export const POTENTIALE_STEPS: readonly number[] = Object.freeze(
  Array.from({ length: 11 }, (_, k) => 1 + k * 0.5),
);

export interface AgeBand {
  key: string;
  /** Inklusive nedre alder. */
  lo: number;
  /** Inklusive øvre alder. */
  hi: number;
}

export interface GrandfatherFloor {
  /** Gammelt potentiale (et af POTENTIALE_STEPS) som gulvet gælder for. */
  potentiale: number;
  /** Laveste tilladte værdi på 1-99-skalaen for et løftet trin. */
  floor: number;
  /** Løftet må aldrig gå over denne grænse (rang-sikkerhed mod trinnet over). */
  hardCap: number;
}

export interface PotentialeScale99Params {
  /** Afstand mellem trin-centre på 1-99-skalaen (trin k har center 1 + k * tierStep). */
  tierStep: number;
  /** Halv bredde af hvert trins stykke af skalaen. */
  tierHalfWidth: number;
  /** Geometrisk vægt-henfald pr. trin i målfordelingen (0 < decay <= 1). */
  tierDecay: number;
  /** Laveste gamle potentiale der hører til toptalent-klassen (presses ned). */
  compressFromPotentiale: number;
  /** Stigende segmentgrænser for toptalent-klassen, alle inden for skalaen. */
  tailAnchors: number[];
  /** Fredningsgulve. Se validateParams for de rang-sikre krav. */
  floors: GrandfatherFloor[];
  /** Aldersbånd. Må ikke overlappe; ryttere uden for alle bånd springes over. */
  ageBands: AgeBand[];
}

export interface RiderPotentialeInput {
  id: string;
  potentiale: number;
  age: number | null;
}

export interface ScaledRider {
  pot99: number;
  oldPot: number;
  band: string;
}

export type SkipReason = "invalid_potentiale" | "missing_age" | "no_age_band";

export interface RankViolation {
  band: string;
  prevId: string;
  curId: string;
  prev: number;
  cur: number;
}

export interface PotentialeScale99Result {
  byId: Map<string, ScaledRider>;
  skipped: { id: string; reason: SkipReason }[];
  rankViolations: RankViolation[];
}

// ── Deterministisk rækkefølge ──────────────────────────────────────────────

/** FNV-1a til [0,1). Samme hash som riderProgression.seededUnit (bevidst kopi, så libbet er rent og typet). */
export function idHashUnit(key: string): number {
  const s = String(key ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function compareRank(a: RiderPotentialeInput, b: RiderPotentialeInput): number {
  return (
    a.potentiale - b.potentiale ||
    idHashUnit(a.id) - idHashUnit(b.id) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ── Params ─────────────────────────────────────────────────────────────────

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function stepIndex(potentiale: number): number {
  const idx = POTENTIALE_STEPS.indexOf(potentiale);
  return idx;
}

/**
 * Afviser params der ikke kan give en rang-bevarende omregning. Kaster med en
 * besked der siger hvad der er galt. Ingen værdi gættes eller udfyldes.
 */
export function validateParams(params: PotentialeScale99Params): void {
  if (!params || typeof params !== "object") throw new Error("potentialeScale99: params mangler");
  const { tierStep, tierHalfWidth, tierDecay, compressFromPotentiale, tailAnchors, floors, ageBands } = params;
  if (!isFiniteNumber(tierStep) || tierStep <= 0) throw new Error("potentialeScale99: tierStep skal være et positivt tal");
  if (!isFiniteNumber(tierHalfWidth) || tierHalfWidth <= 0) throw new Error("potentialeScale99: tierHalfWidth skal være et positivt tal");
  if (2 * tierHalfWidth > tierStep) throw new Error("potentialeScale99: trinnenes stykker må ikke overlappe (2 * tierHalfWidth > tierStep)");
  if (!isFiniteNumber(tierDecay) || tierDecay <= 0 || tierDecay > 1) throw new Error("potentialeScale99: tierDecay skal ligge i (0, 1]");
  const lastCenter = SCALE_MIN + (POTENTIALE_STEPS.length - 1) * tierStep;
  if (lastCenter > SCALE_MAX) throw new Error("potentialeScale99: tierStep får øverste trin-center uden for skalaen");

  const compressIdx = stepIndex(compressFromPotentiale);
  if (compressIdx < 1) throw new Error("potentialeScale99: compressFromPotentiale skal være et halvt trin over 1");

  if (!Array.isArray(tailAnchors)) throw new Error("potentialeScale99: tailAnchors skal være en liste");
  const tailStart = tierInterval(params, compressIdx)[0];
  let prev = tailStart;
  for (const a of tailAnchors) {
    if (!isFiniteNumber(a) || a <= prev || a >= SCALE_MAX) {
      throw new Error("potentialeScale99: tailAnchors skal være strengt stigende og ligge over toptalent-klassens start og under skalaens top");
    }
    prev = a;
  }

  if (!Array.isArray(floors)) throw new Error("potentialeScale99: floors skal være en liste");
  const sortedFloors = [...floors].sort((a, b) => a.potentiale - b.potentiale);
  for (let i = 0; i < sortedFloors.length; i++) {
    const f = sortedFloors[i];
    const idx = stepIndex(f.potentiale);
    if (idx < compressIdx) throw new Error("potentialeScale99: gulve gælder kun trin i toptalent-klassen");
    if (!isFiniteNumber(f.floor) || !isFiniteNumber(f.hardCap) || f.floor < tailStart || f.hardCap < f.floor || f.hardCap > SCALE_MAX) {
      throw new Error("potentialeScale99: et gulv skal opfylde klassens start <= floor <= hardCap <= skalaens top");
    }
    if (i > 0) {
      const below = sortedFloors[i - 1];
      if (below.potentiale === f.potentiale) throw new Error("potentialeScale99: højst ét gulv pr. trin");
      // Rang-sikkerhed: trinnet under må ikke løftes forbi dette trins gulv.
      if (below.hardCap > f.floor) throw new Error("potentialeScale99: et gulvs hardCap må ikke overstige gulvet for trinnet over");
    }
  }
  // Rang-sikkerhed: er et trin fredet, skal alle trin over det også være fredet,
  // ellers kunne en løftet rytter havne over en rytter med højere potentiale.
  if (sortedFloors.length) {
    const lowestIdx = stepIndex(sortedFloors[0].potentiale);
    for (let k = lowestIdx; k < POTENTIALE_STEPS.length; k++) {
      if (!sortedFloors.some((f) => f.potentiale === POTENTIALE_STEPS[k])) {
        throw new Error("potentialeScale99: alle trin over det laveste fredede trin skal have et gulv");
      }
    }
  }

  if (!Array.isArray(ageBands) || ageBands.length === 0) throw new Error("potentialeScale99: ageBands skal være en ikke-tom liste");
  const keys = new Set<string>();
  const sortedBands = [...ageBands].sort((a, b) => a.lo - b.lo);
  for (let i = 0; i < sortedBands.length; i++) {
    const b = sortedBands[i];
    if (!b || typeof b.key !== "string" || !isFiniteNumber(b.lo) || !isFiniteNumber(b.hi) || b.hi < b.lo) {
      throw new Error("potentialeScale99: hvert aldersbånd skal have key og lo <= hi");
    }
    if (keys.has(b.key)) throw new Error("potentialeScale99: aldersbånd-nøgler skal være unikke");
    keys.add(b.key);
    if (i > 0 && b.lo <= sortedBands[i - 1].hi) throw new Error("potentialeScale99: aldersbånd må ikke overlappe");
  }
}

// ── Målgeometri ────────────────────────────────────────────────────────────

/** Trin k's stykke af 1-99-skalaen, klippet til skalaen. */
export function tierInterval(params: PotentialeScale99Params, k: number): [number, number] {
  const center = SCALE_MIN + k * params.tierStep;
  return [Math.max(SCALE_MIN, center - params.tierHalfWidth), Math.min(SCALE_MAX, center + params.tierHalfWidth)];
}

/**
 * Andel af målfordelingen (et friskt kuld) der ligger på eller over x.
 * Målfordelingen er en blanding af ensformige fordelinger over hvert trins
 * stykke, vægtet geometrisk med tierDecay. Regnes eksakt, ikke på et gitter.
 */
export function targetShareAtOrAbove(params: PotentialeScale99Params, x: number): number {
  let total = 0;
  let above = 0;
  for (let k = 0; k < POTENTIALE_STEPS.length; k++) {
    const w = params.tierDecay ** k;
    const [lo, hi] = tierInterval(params, k);
    if (hi <= lo) continue;
    total += w;
    if (x <= lo) above += w;
    else if (x < hi) above += (w * (hi - x)) / (hi - lo);
  }
  return total > 0 ? above / total : 0;
}

// ── Omregning ──────────────────────────────────────────────────────────────

function clampRound(x: number): number {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(x)));
}

/** Rang-ordnet ensformig spredning over (lo, hi) via (i + 0,5)/n-kvantiler, afrundet. */
function spreadInto(sorted: RiderPotentialeInput[], lo: number, hi: number, assign: (r: RiderPotentialeInput, v: number) => void): void {
  const n = sorted.length;
  sorted.forEach((r, i) => assign(r, clampRound(lo + ((i + 0.5) / n) * (hi - lo))));
}

export function bandFor(ageBands: AgeBand[], age: number): AgeBand | undefined {
  return ageBands.find((b) => age >= b.lo && age <= b.hi);
}

export function scalePotentialeTo99(riders: RiderPotentialeInput[], params: PotentialeScale99Params): PotentialeScale99Result {
  validateParams(params);
  const compressIdx = stepIndex(params.compressFromPotentiale);
  const tailStart = tierInterval(params, compressIdx)[0];

  const byId = new Map<string, ScaledRider>();
  const skipped: { id: string; reason: SkipReason }[] = [];
  const groups = new Map<string, RiderPotentialeInput[]>();
  for (const b of params.ageBands) groups.set(b.key, []);

  const seen = new Set<string>();
  for (const r of riders) {
    if (seen.has(r.id)) throw new Error(`potentialeScale99: rytter-id optræder to gange (${r.id})`);
    seen.add(r.id);
    const pot = Number(r.potentiale);
    if (stepIndex(pot) < 0) { skipped.push({ id: r.id, reason: "invalid_potentiale" }); continue; }
    if (r.age == null || !isFiniteNumber(r.age)) { skipped.push({ id: r.id, reason: "missing_age" }); continue; }
    const band = bandFor(params.ageBands, r.age);
    if (!band) { skipped.push({ id: r.id, reason: "no_age_band" }); continue; }
    groups.get(band.key)!.push({ id: r.id, potentiale: pot, age: r.age });
  }

  const floorsDesc = [...params.floors].sort((a, b) => b.potentiale - a.potentiale);

  for (const band of params.ageBands) {
    const group = groups.get(band.key)!;
    const nBand = group.length;
    if (!nBand) continue;
    const value = (r: RiderPotentialeInput): number => byId.get(r.id)!.pot99;
    const set = (r: RiderPotentialeInput, pot99: number): void => {
      byId.set(r.id, { pot99, oldPot: r.potentiale, band: band.key });
    };

    // 1) Trin under toptalent-klassen: hvert trin i sit eget stykke.
    for (let k = 0; k < compressIdx; k++) {
      const inTier = group.filter((r) => r.potentiale === POTENTIALE_STEPS[k]).sort(compareRank);
      if (!inTier.length) continue;
      const [lo, hi] = tierInterval(params, k);
      spreadInto(inTier, lo, hi, set);
    }

    // 2) Toptalent-klassen: hale-segmenter med målfordelingens antal.
    const high = group.filter((r) => r.potentiale >= params.compressFromPotentiale).sort(compareRank);
    const nHigh = high.length;
    if (!nHigh) continue;
    const bounds = [tailStart, ...params.tailAnchors, SCALE_MAX];
    // counts[j] = antal der skal ligge på eller over tailAnchors[j], indlejret og
    // aldrig flere end klassen har.
    const atOrAbove: number[] = [];
    let cap = nHigh;
    for (const anchor of params.tailAnchors) {
      const c = Math.min(cap, Math.round(nBand * targetShareAtOrAbove(params, anchor)));
      atOrAbove.push(c);
      cap = c;
    }
    const segmentSizes = bounds.slice(0, -1).map((_, j) => {
      const upper = j === 0 ? nHigh : atOrAbove[j - 1];
      const lower = j < atOrAbove.length ? atOrAbove[j] : 0;
      return upper - lower;
    });
    let cursor = 0;
    segmentSizes.forEach((n, j) => {
      if (n <= 0) return;
      spreadInto(high.slice(cursor, cursor + n), bounds[j], bounds[j + 1], set);
      cursor += n;
    });

    // 3) Fredningsgulve, øverste trin først. Løftet holdes under (a) gulvets
    //    hardCap, (b) laveste ikke-løftede værdi i samme trin og (c) laveste
    //    værdi i ethvert højere trin, så rangen bevares.
    for (const { potentiale, floor, hardCap } of floorsDesc) {
      const liftees = high
        .filter((r) => r.potentiale === potentiale && value(r) < floor)
        .sort((a, b) => value(a) - value(b) || compareRank(a, b));
      if (!liftees.length) continue;
      const ceilings = high
        .filter((r) => (r.potentiale === potentiale && value(r) >= floor) || r.potentiale > potentiale)
        .map(value);
      const liftHi = ceilings.length ? Math.min(hardCap, ...ceilings) : hardCap;
      spreadInto(liftees, floor, liftHi, set);
    }
  }

  return { byId, skipped, rankViolations: findRankViolations(riders, byId, params) };
}

/**
 * Kontrol, ikke antagelse: inden for hvert aldersbånd må den nye værdi aldrig
 * falde, når rytterne gås igennem i rang-orden (gammelt potentiale, så hash).
 */
export function findRankViolations(
  riders: RiderPotentialeInput[],
  byId: Map<string, ScaledRider>,
  params: PotentialeScale99Params,
): RankViolation[] {
  const out: RankViolation[] = [];
  for (const band of params.ageBands) {
    const group = riders
      .filter((r) => byId.get(r.id)?.band === band.key)
      .map((r) => ({ ...r, potentiale: Number(r.potentiale) }))
      .sort(compareRank);
    for (let i = 1; i < group.length; i++) {
      const prev = byId.get(group[i - 1].id)!.pot99;
      const cur = byId.get(group[i].id)!.pot99;
      if (cur < prev) out.push({ band: band.key, prevId: group[i - 1].id, curId: group[i].id, prev, cur });
    }
  }
  return out;
}
