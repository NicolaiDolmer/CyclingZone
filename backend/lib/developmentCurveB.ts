// Kurve B (#3564, D-058): udviklingen styres af niveau og potentiale, ikke af alder.
//
// Spec: docs/superpowers/specs/2026-10-03-udvikling-2-design.md (D-058, §5 trin 2)
// og #6110 (D1, D1b, S2, S8). Regel: docs/TRAINING_RULES.md, "Kurve B".
//
// ═══ STATUS ══════════════════════════════════════════════════════════════════
// Bag flaget `development_curve_b` (slukket, developmentCurveBFlag.ts). Motoren
// sender i dag ingen kurve ind i dailyAbilityDelta, så intet i spillet ændrer
// sig. Første brugere er harnessen (scripts/dev/developmentCurveBHarness3564.mjs)
// og 10-sæsoners-simuleringen (scripts/dev/tenSeasonSim6110.mjs).
//
// ═══ HVAD KURVEN ER ══════════════════════════════════════════════════════════
// Dagens model: dagens fremdrift = afstand til loftet × en alderstabel. Alderen
// er den dominerende knap: samme spring tager flere gange længere som 26-årig
// end som 16-årig, og et toptalent er næsten færdigt som 21-årig.
//
// Kurve B erstatter KUN det led (basis-fremdriften). Resten af kæden (fokus,
// rolleklasse, træningsscore, træner, facilitet, støj, +1-loftet) er uændret.
//   1. NIVEAU: hvert point koster mere jo tættere evnen er på toppen af skalaen.
//      Lave niveauer er billige, de sidste point er dyre.
//   2. BLØDT LOFT FRA POTENTIALET (D1b, S2): rolleklassens loft fordeler niveauet
//      over evnerne, potentialet skalerer det. Tæt på det bløde loft aftager
//      fremdriften glidende (ingen mur, S8). Rolleklassens hårde loft klipper
//      stadig som i dag.
//   3. BELASTNINGSEVNE: de helt unge tåler ikke fuld træning. Faktoren stiger fra
//      et gulv til fuld belastning og står derefter fast. Den er ALDRIG over 1,
//      så alder kan kun bremse, aldrig give ekstra fart.
//   4. POTENTIALE = FART: potentialets fart kommer fra den eksisterende kæde
//      (træningsscorens talent-led). Kurven rører den ikke.
// Alderens turbo (alderstabellen og ungdomstillægget) indgår ikke, når kurven er
// sendt med: dailyAbilityDelta dropper alderstabellen og ungdomstillægget, og
// applyDailyTick driver udviklingen med en alders-neutral træningsscore (den
// viste score er uændret).
//
// Kurven giver aldrig negativ fremdrift (rating-reglen 17/9). Og ingen mur (#7316,
// S2/S8): en evne over sit bløde loft står aldrig stille. Den får en lille restfart,
// der aftager mod rolleklassens hårde loft og først er 0 dér.
//
// Tændingen (#7382): de første 14 dage kurve B kører, glider evner der stod over det
// bløde loft ved tændingen (ét samlet øjebliksbillede), fra den gamle models fart til
// restfarten (developmentCurveBTransition7382.ts).
//
// ═══ TAL ═════════════════════════════════════════════════════════════════════
// Alle kalibrerings-tal er PRIVATE (hard rule 17, balance-internals/6110/) og
// gives som `params`. Der er bevidst ingen standardværdier: uden gyldige params
// findes kurven ikke, og dailyAbilityDelta kører dagens model.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random.

// Skalaens top. Evner går til 99; kurven regner mod 100, så 99 aldrig koster
// uendeligt (fremdriften forbliver positiv under loftet).
const SCALE_TOP = 100;
// Potentialets skala internt (PROGRESSION_RULES §3).
const POT_MIN = 1;
const POT_MAX = 6;
// #7316: restfarten (andel af fuld fart, se curveBCapSoftness), når params ikke selv
// angiver `aboveCeilingFloor`. Params ligger i serverens miljø, så et manglende felt
// må aldrig give muren tilbage. Sikker kode-default > 0; kalibreringen er privat.
export const DEFAULT_ABOVE_CEILING_FLOOR = 0.1;

export interface DevelopmentCurveBParams {
  // Basis-fremdrift pr. sæson (i evne-point) ved niveau 0, fuld belastning og
  // fuld afstand til loftet. Deles med tick-delerens antal pr. sæson.
  rate: number;
  // Niveau-leddets stejlhed. Større = dyrere top.
  levelExponent: number;
  // Hvor tidligt fremdriften aftager mod det bløde loft. 0 = ingen opbremsning før loftet.
  capExponent: number;
  // Belastningsevne efter alder: `floor` til og med `fromAge`, glidende op til 1
  // ved `fullAge`, derefter 1.
  load: { fromAge: number; fullAge: number; floor: number };
  // Det bløde loft som andel af rolleklassens loft, pr. potentiale 1..6
  // (glidende imellem). Udeladt = det hårde loft er også det bløde.
  potentialCeiling?: readonly number[] | null;
  // #7316: restfarten (0 < x <= 1) op til det laveste potentiales bløde loft;
  // derfra lineært til 0 ved det hårde loft. Udeladt = DEFAULT_ABOVE_CEILING_FLOOR.
  aboveCeilingFloor?: number;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Validerer params. Returnerer en frossen kopi, eller null hvis noget mangler
 * eller er ugyldigt (så motoren falder tilbage til dagens model, fail-safe).
 */
export function validateDevelopmentCurveBParams(raw: unknown): DevelopmentCurveBParams | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const load = p.load as Record<string, unknown> | null | undefined;
  if (!isNum(p.rate) || !(p.rate > 0)) return null;
  if (!isNum(p.levelExponent) || !(p.levelExponent >= 0)) return null;
  if (!isNum(p.capExponent) || !(p.capExponent >= 0)) return null;
  if (!load || typeof load !== "object") return null;
  if (!isNum(load.fromAge) || !isNum(load.fullAge) || !isNum(load.floor)) return null;
  if (!(load.fullAge > load.fromAge)) return null;
  if (!(load.floor > 0 && load.floor <= 1)) return null;
  let potentialCeiling: readonly number[] | null = null;
  if (p.potentialCeiling != null) {
    const pc = p.potentialCeiling;
    if (!Array.isArray(pc) || pc.length !== POT_MAX - POT_MIN + 1) return null;
    if (!pc.every((x) => isNum(x) && x > 0 && x <= 1)) return null;
    // Højere potentiale må aldrig give et lavere loft.
    for (let i = 1; i < pc.length; i++) if (pc[i] < pc[i - 1]) return null;
    potentialCeiling = Object.freeze([...pc]);
  }
  // #7316: 0 ville give muren tilbage, så kun > 0 er gyldigt.
  let aboveCeilingFloor = DEFAULT_ABOVE_CEILING_FLOOR;
  if (p.aboveCeilingFloor != null) {
    if (!isNum(p.aboveCeilingFloor) || !(p.aboveCeilingFloor > 0 && p.aboveCeilingFloor <= 1)) return null;
    aboveCeilingFloor = p.aboveCeilingFloor;
  }
  return Object.freeze({
    rate: p.rate,
    levelExponent: p.levelExponent,
    capExponent: p.capExponent,
    load: Object.freeze({ fromAge: load.fromAge, fullAge: load.fullAge, floor: load.floor }),
    potentialCeiling,
    aboveCeilingFloor,
  });
}

/** Niveau-leddet: 1 ved niveau 0, falder mod 0 ved toppen af skalaen. */
export function curveBLevelCost(level: number, params: DevelopmentCurveBParams): number {
  const l = Math.min(SCALE_TOP - 1, Math.max(0, Number(level) || 0));
  return Math.pow(1 - l / SCALE_TOP, params.levelExponent);
}

/** Belastningsevne: gulvet for de helt unge, glidende op til 1, aldrig over 1. */
export function curveBLoadCapacity(age: number | null | undefined, params: DevelopmentCurveBParams): number {
  const { fromAge, fullAge, floor } = params.load;
  // Ukendt alder: fuld belastning (samme som en voksen), aldrig en turbo.
  if (!isNum(age)) return 1;
  if (age <= fromAge) return floor;
  if (age >= fullAge) return 1;
  const t = (age - fromAge) / (fullAge - fromAge);
  // Glidende: ingen knæk ved nogen fødselsdag.
  const s = t * t * (3 - 2 * t);
  return floor + (1 - floor) * s;
}

/** Det bløde loft for én evne: rolleklassens loft skaleret af potentialet. */
export function curveBSoftCeiling(cap: number, potentiale: number | null | undefined, params: DevelopmentCurveBParams): number {
  const pc = params.potentialCeiling;
  if (!(cap > 0)) return 0;
  if (!pc) return cap;
  const p = Math.min(POT_MAX, Math.max(POT_MIN, isNum(potentiale) ? potentiale : POT_MIN));
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const a = pc[lo - POT_MIN];
  const b = pc[hi - POT_MIN];
  return cap * (a + (b - a) * (p - lo));
}

/**
 * Blødt loft: 1 langt fra loftet og glidende ned mod det. Ingen mur (#7316, S8):
 * fremdriften falder aldrig under en restfart, der er den samme for alle
 * potentialer: `aboveCeilingFloor` op til det laveste potentiales bløde loft,
 * derfra lineært ned til 0 ved det hårde loft `cap`. Fordi restfarten ikke
 * afhænger af rytterens eget bløde loft, er kurven kontinuert i både niveau og
 * potentiale (intet spring ved loftet), og et højere potentiale er aldrig
 * langsommere. Udeladt `cap` eller intet potentialCeiling (blødt = hårdt loft):
 * ingen restfart, glider mod 0 ved loftet som før.
 */
export function curveBCapSoftness(
  current: number, ceiling: number, params: DevelopmentCurveBParams, cap: number = ceiling,
): number {
  if (!(ceiling > 0)) return 0;
  const gap = ceiling - current;
  const smooth = gap > 0 ? Math.pow(Math.min(1, gap / ceiling), params.capExponent) : 0;
  const hard = Number(cap);
  const lowest = params.potentialCeiling ? hard * params.potentialCeiling[0] : hard;
  if (!(hard > lowest)) return smooth;
  const room = hard - current;
  if (!(room > 0)) return 0;
  const floor = params.aboveCeilingFloor ?? DEFAULT_ABOVE_CEILING_FLOOR;
  const residual = floor * Math.min(1, room / (hard - lowest));
  return Math.max(smooth, residual);
}

/**
 * Dagens basis-fremdrift for én evne under kurve B. Erstatter dagens
 * `gap × vækstfraktion(alder) × boost / deler` i dailyAbilityDelta.
 * Altid >= 0. Over det bløde loft en lille aftagende restfart (#7316); 0 først
 * når evnen står på (eller over) sit hårde loft.
 */
export function curveBBase(
  { current, cap, age, divisor, potentiale = null }: {
    current: number; cap: number | null | undefined; age: number | null | undefined;
    divisor: number; potentiale?: number | null;
  },
  params: DevelopmentCurveBParams,
): number {
  const c = Number(current);
  const top = cap ?? c;
  if (!Number.isFinite(c) || !(top > c)) return 0;
  if (!(divisor > 0)) return 0;
  const ceiling = curveBSoftCeiling(top, potentiale, params);
  const value = (params.rate * curveBLevelCost(c, params) * curveBCapSoftness(c, ceiling, params, top)
    * curveBLoadCapacity(age, params)) / divisor;
  return value > 0 ? value : 0;
}
