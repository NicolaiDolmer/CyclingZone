// backend/lib/s5BenchmarkGate.js
// #6367 (S5-etapeprofiler, Spor 3): benchmark-gaten. S5-kalenderen maales mod rigtige
// Grand Tours FOER den maa skrives.
//
// Spec (design-go ejer 12/10): docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md
//   §2 terraen-reglen B+ · §3 afslutninger + matrix · §5 kvoter, ugestruktur, motor-facit.
// Byg-plan: docs/superpowers/plans/2026-10-13-s5-etapeprofiler-byg-plan.md, Spor 3.
// Benchmark: backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json (315 GT-etaper, Tour/Giro/Vuelta
// 2021-2025). Fordelinger og medianer LAESES af filen, de skrives ikke af her.
//
// HVAD GATEN DOEMMER (fire dele, i spec'ens raekkefoelge):
//   (1) etape     hver etape: typen == B+(stigningerne), og afslutningen ligger i matrixen
//                 for det terraen, inkl. cellens betingelser (bjergtop-kategori, nedkoersel
//                 fra en kat. 3+-top 5-25 km foer maal, finale-rampens geometri).
//   (2) Grand Tour pr. GT: ejerens kvoter pr. GT-type (Tour/Giro/Vuelta) inden for
//                 S5_GT_QUOTA_TOLERANCE + ugestrukturen.
//   (3) saeson    afslutnings-andelene over saesonens GT-etaper mod benchmarkens fordeling,
//                 med et binomialt stikproeve-tillaeg (samme metode som stageFinaleMetrics).
//   (4) motor     median gap10 (tid vinder -> nr. 10) pr. afslutning fra motor-bench ligger
//                 i benchmarkens kvartil-interval. #6362: dommen kommer fra den rigtige
//                 motor-bench (backend/scripts/dev/s5MotorBench.mjs: v4 under s5_profiles_v1
//                 paa S5-ruter fra generatoren) via __fixtures__/s5MotorBench.json, og den
//                 BLOKERER ved fail. Fixturen baerer kun dommene (gab + vindertype pr.
//                 afslutning), aldrig tal eller taerskler (hard rule 17);
//                 s5MotorBench.test.ts genkoerer benchen og kraever samme dom.
//
// HVEM GATEN GAELDER. KUN S5-modellen (profileModelForSeason). Saeson 1-4 har deres egne
// gates (K-B, §7b-finalebaand, realisme), og S4-etiketterne ville ALTID vaere roede her
// (byg-planen §2: 34 % af etaperne har en type der ikke passer med ruten). Det er netop
// gatens egen test: den nuvaerende v5-generator SKAL give roed paa (1) og (2).
//
// INGEN OVERRIDE. Der findes ikke et --allow-flag til denne gate. En roed gate rettes i
// generatoren (eller i spec'en med ejer-go), aldrig ved at slaa maalingen fra.
//
// REN: ingen DB, intet ur, ingen RNG. Den eneste I/O er loadS5Benchmark (en fil-laesning),
// som kalderen kalder eksplicit og sender ind.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  TERRAIN_TYPES, FINISH_MATRIX, canonicalFinaleType,
} from "./stageProfileTypes.js";
import { regionOf } from "./raceRouteGenerator.js";
import { GRAND_TOUR_MIN_STAGES } from "./grandTourRestDays.js";
import { checkElevationProfile, ELEVATION_PROFILE_MIN_GENERATOR_VERSION } from "./routeElevationProfile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Ligger under backend/ (ikke docs/): Railway bygger med rootDirectory /backend, saa en fil
// uden for backend/ findes ikke i prod, og gaten ville kaste ENOENT paa alle skrivestier.
// backend/lib/s5BenchmarkGateFiles.test.js holder det fast.
export const DEFAULT_BENCHMARK_PATH = join(__dirname, "__fixtures__", "s5Benchmark.gt-2021-2025.json");
/** #6362: den rigtige motor-benchs dom (erstatter #6367's stub). */
export const DEFAULT_MOTOR_BENCH_PATH = join(__dirname, "__fixtures__", "s5MotorBench.json");
/** Bagudkompatibelt navn (buildSeasonCalendar, calendarGoldenDiff): peger nu paa den rigtige bench. */
export const DEFAULT_MOTOR_STUB_PATH = DEFAULT_MOTOR_BENCH_PATH;

// ── 0. Hvem gaten gaelder ──────────────────────────────────────────────────────────

export const S5_PROFILE_MODEL = "s5";
/** Foerste saeson der genereres med S5-modellen (ejer 8/10: "stor pakke til S5"). */
export const S5_FIRST_SEASON = 5;

/**
 * Profil-modellen en saeson SKAL genereres med. Afledt af saesonnummeret, ikke af et flag:
 * et flag der kunne vaelge v5 for saeson 5 ville vaere en override af gaten.
 */
export function profileModelForSeason(seasonNumber) {
  const n = Number(seasonNumber);
  return Number.isInteger(n) && n >= S5_FIRST_SEASON ? S5_PROFILE_MODEL : "v5";
}

// ── 1. B+ (spec §2) ────────────────────────────────────────────────────────────────
//
// Gaten har sin EGEN implementering af reglen i stedet for at importere generatorens
// (deriveTerrainType, #6359). Det er bevidst: en gate der laaner generatorens funktion
// maaler generatoren mod sig selv. s5BenchmarkGate.test.js sammenligner de to over
// tilfaeldige stigningssaet, saa snart generatoren eksporterer sin.

/** Spec §2: en kat. 2 er "lang" fra 5 km; en enlig kat. 2 bærer mellembjerg fra 8 km. */
export const B_PLUS_CAT2_LONG_MIN_KM = 5;
export const B_PLUS_CAT2_SINGLE_MIN_KM = 8;
const KM_EPS = 1e-9;

/**
 * Terraen-reglen B+ (spec §2, rettet paa kort 5). Foerste regel der passer, oppefra:
 *   hoejbjerg    >= 1 HC eller >= 3 x kat. 1
 *   bjerg        >= 1 x kat. 1
 *   mellembjerg  >= 2 x kat. 2 paa mindst 5 km, eller 1 x kat. 2 paa mindst 8 km,
 *                eller kat. 2 paa mindst 5 km som bjergtopmaal
 *   kuperet      kat. 3 eller kort kat. 2 (kat. 4 taeller ALDRIG mod kuperet)
 *   boelget      2 x kat. 4
 *   flad         hoejst 1 x kat. 4
 * Ukendte kategorier ignoreres.
 * @param {Array<{category: string, length_km: number, summit_finish?: boolean}>} climbs
 */
export function deriveTerrainTypeBPlus(climbs = []) {
  let hc = 0, cat1 = 0, cat2 = 0, cat2Long = 0, cat2Single = 0, cat3 = 0, cat4 = 0;
  let cat2LongSummit = false;
  for (const c of Array.isArray(climbs) ? climbs : []) {
    const cat = String(c?.category ?? "");
    const len = Number(c?.length_km);
    if (cat === "HC") hc += 1;
    else if (cat === "1") cat1 += 1;
    else if (cat === "2") {
      cat2 += 1;
      if (Number.isFinite(len) && len >= B_PLUS_CAT2_LONG_MIN_KM - KM_EPS) {
        cat2Long += 1;
        if (c?.summit_finish === true) cat2LongSummit = true;
        if (len >= B_PLUS_CAT2_SINGLE_MIN_KM - KM_EPS) cat2Single += 1;
      }
    } else if (cat === "3") cat3 += 1;
    else if (cat === "4") cat4 += 1;
  }
  if (hc >= 1 || cat1 >= 3) return "high_mountain";
  if (cat1 >= 1) return "mountain";
  if (cat2Long >= 2 || cat2Single >= 1 || cat2LongSummit) return "medium_mountain";
  if (cat3 >= 1 || cat2 >= 1) return "hilly";
  if (cat4 >= 2) return "rolling";
  return "flat";
}

// ── 2. Afslutningen (spec §3) ──────────────────────────────────────────────────────

const TT_PROFILE_TYPES = new Set(["itt", "itt_hilly", "ttt"]);
const CAT_RANK = Object.freeze({ HC: 0, "1": 1, "2": 2, "3": 3, "4": 4 }); // 0 = haardest

/** Nedkoersel (spec §3, kort 5): sidste top 5-25 km foer maal, og den top er kat. 3+. */
export const S5_DESCENT_TOP_WINDOW_KM = Object.freeze([5, 25]);
/** Bjergtop pr. terraen (spec §3): hvilken kategori maalstigningen skal have. */
export const S5_SUMMIT_CATEGORIES = Object.freeze({
  medium_mountain: Object.freeze(["2"]),
  mountain: Object.freeze(["1"]),
  high_mountain: Object.freeze(["1", "HC"]),
});
/**
 * Finale-rampen for de tre korte opad-afslutninger (spec §3). [min, max] inklusive; mur
 * er "under 1,5 km", saa dens loft er eksklusivt (se checkFinishRamp).
 *   stigende spurt  sidste 0,5-1 km paa 2-5 %
 *   mur             under 1,5 km paa 10-20 %
 *   bakke           1-3 km paa 5-8 %
 */
export const S5_FINISH_RAMPS = Object.freeze({
  uphill_sprint: Object.freeze({ km: Object.freeze([0.5, 1.0]), grad: Object.freeze([2, 5]) }),
  wall_finish:   Object.freeze({ km: Object.freeze([0, 1.5]), grad: Object.freeze([10, 20]), kmMaxExclusive: true }),
  punch:         Object.freeze({ km: Object.freeze([1, 3]), grad: Object.freeze([5, 8]) }),
});
const GEOMETRY_EPS = 0.5; // crest_km er afrundet til hele km i ruten

/**
 * Etapens S5-afslutning. Tidskoersler af formatet (holdtidskoersel = profile_type `ttt`);
 * ellers finale_type med alias opløst (bunch/reduced -> flat_sprint). `breakaway` og
 * ukendte vaerdier returneres raat, saa de fejler matrix-tjekket med deres eget navn.
 */
export function s5FinishOf(stage) {
  const pt = stage?.profile_type;
  if (pt === "ttt") return "ttt";
  if (pt === "itt" || pt === "itt_hilly") return "solo_tt";
  return canonicalFinaleType(stage?.finale_type) ?? (stage?.finale_type ?? null);
}

function lastClimb(climbs) {
  const list = (Array.isArray(climbs) ? climbs : []).filter((c) => c && Number.isFinite(Number(c.crest_km)));
  if (!list.length) return null;
  return list.reduce((a, b) => (Number(b.crest_km) >= Number(a.crest_km) ? b : a));
}

function finishSprint(stage) {
  return (Array.isArray(stage?.sprints) ? stage.sprints : []).find((s) => s?.kind === "finish") ?? null;
}

function within(x, [lo, hi], { hiExclusive = false } = {}) {
  return Number.isFinite(x) && x >= lo - KM_EPS && (hiExclusive ? x < hi : x <= hi + KM_EPS);
}

function checkFinishRamp(stage, finish) {
  const spec = S5_FINISH_RAMPS[finish];
  const sp = finishSprint(stage);
  const km = Number(sp?.ramp_km);
  const grad = Number(sp?.ramp_gradient);
  if (!Number.isFinite(km) || !Number.isFinite(grad)) {
    return `${finish} uden finale-rampe i ruten (spec §3 kræver ${spec.km[0]}-${spec.km[1]} km på ${spec.grad[0]}-${spec.grad[1]} %)`;
  }
  const kmOk = within(km, spec.km, { hiExclusive: spec.kmMaxExclusive === true }) && km > 0;
  const gradOk = within(grad, spec.grad);
  if (!kmOk || !gradOk) {
    return `${finish}-rampen er ${km} km på ${grad} %, spec §3 kræver ${spec.kmMaxExclusive ? "under " : ""}${spec.kmMaxExclusive ? spec.km[1] : `${spec.km[0]}-${spec.km[1]}`} km på ${spec.grad[0]}-${spec.grad[1]} %`;
  }
  return null;
}

/**
 * Del (1) for EN etape. Returnerer terraenet efter B+, afslutningen, og bruddene.
 * @param {object} stage  genereret etape: profile_type, finale_type, distance_km, climbs, sprints
 * @returns {{ terrain: string, finish: string|null, isTimeTrial: boolean, violations: string[] }}
 */
export function checkStage(stage) {
  const violations = [];
  const terrain = deriveTerrainTypeBPlus(stage?.climbs);
  const pt = stage?.profile_type ?? null;
  const finish = s5FinishOf(stage);
  const isTimeTrial = TT_PROFILE_TYPES.has(pt);

  // Typen: de seks terraen-typer SKAL vaere B+. Formater (tidskoersel, brosten, grus,
  // klassiker) beholder deres type; deres terraen er B+ og bindes af matrixen nedenfor.
  if (TERRAIN_TYPES.includes(pt) && pt !== terrain) {
    violations.push(`type ${pt} ≠ B+ ${terrain}`);
  } else if (!TERRAIN_TYPES.includes(pt) && !isTimeTrial && !["cobbles", "gravel", "classic"].includes(pt)) {
    violations.push(`ukendt profile_type ${pt ?? "(tom)"}`);
  }
  // #6594: S5-etaper har en højdeprofil, og den summerer til elevation_gain_m uden negative højder.
  if (Number(stage?.generator_version) >= ELEVATION_PROFILE_MIN_GENERATOR_VERSION) {
    const elevation = checkElevationProfile(stage);
    if (elevation) violations.push(elevation);
  }

  if (isTimeTrial) {
    if (finish !== "solo_tt" && finish !== "ttt") violations.push(`tidskørsel med afslutning ${finish}`);
    return { terrain, finish, isTimeTrial, violations };
  }

  const allowed = FINISH_MATRIX[terrain] ?? [];
  if (!allowed.includes(finish)) {
    violations.push(`afslutning ${finish ?? "(tom)"} er ikke tilladt på ${terrain} (matrix: ${allowed.join(", ")})`);
    return { terrain, finish, isTimeTrial, violations };
  }

  const distance = Number(stage?.distance_km);
  const last = lastClimb(stage?.climbs);
  if (finish === "long_climb") {
    const cats = S5_SUMMIT_CATEGORIES[terrain] ?? [];
    if (!last || last.summit_finish !== true) {
      violations.push(`bjergtop uden målstigning (sidste stigning er ikke et topmål)`);
    } else if (!cats.includes(String(last.category))) {
      violations.push(`bjergtop på ${terrain} kræver kat. ${cats.join("/")}, målstigningen er kat. ${last.category}`);
    }
  } else if (finish === "descent") {
    const toGo = last && Number.isFinite(distance) ? distance - Number(last.crest_km) : NaN;
    const [lo, hi] = S5_DESCENT_TOP_WINDOW_KM;
    if (!last || !(String(last.category) in CAT_RANK) || CAT_RANK[String(last.category)] > CAT_RANK["3"]) {
      violations.push(`nedkørsel kræver at sidste top er kat. 3 eller hårdere (er ${last ? `kat. ${last.category}` : "ingen stigning"})`);
    } else if (!Number.isFinite(toGo) || toGo < lo - GEOMETRY_EPS || toGo > hi + GEOMETRY_EPS) {
      violations.push(`nedkørsel kræver sidste top ${lo}-${hi} km før mål (er ${Number.isFinite(toGo) ? `${toGo} km` : "ukendt"})`);
    }
  } else {
    if (S5_FINISH_RAMPS[finish]) {
      const v = checkFinishRamp(stage, finish);
      if (v) violations.push(v);
    }
    // Mellembjerg: flad spurt kun "langt efter sidste top" (spec §3). Ligger toppen inden
    // for nedkoersels-vinduet, er etapen en nedkoersel, ikke en flad spurt.
    if (terrain === "medium_mountain" && finish === "flat_sprint" && last && Number.isFinite(distance)) {
      const toGo = distance - Number(last.crest_km);
      if (toGo <= S5_DESCENT_TOP_WINDOW_KM[1] + GEOMETRY_EPS) {
        violations.push(`flad spurt på mellembjerg kræver sidste top mere end ${S5_DESCENT_TOP_WINDOW_KM[1]} km før mål (er ${toGo} km)`);
      }
    }
  }
  return { terrain, finish, isTimeTrial, violations };
}

// ── 3. Grand Tours (spec §5) ───────────────────────────────────────────────────────

/** Ejerens kvoter pr. GT-type (spec §5, kort 5). `summits` = heraf bjergtop. */
export const S5_GT_QUOTAS = Object.freeze({
  tour:   Object.freeze({ high_mountain: 5, mountain: 1, medium_mountain: 1, hilly: 5, rolling: 1, flat: 3, itt: 2, ttt: 0, summits: 4 }),
  giro:   Object.freeze({ high_mountain: 2, mountain: 4, medium_mountain: 2, hilly: 4, rolling: 0, flat: 3, itt: 2, ttt: 0, summits: 4 }),
  vuelta: Object.freeze({ high_mountain: 2, mountain: 6, medium_mountain: 2, hilly: 2, rolling: 0, flat: 3, itt: 1, ttt: 1, summits: 7 }),
});
export const S5_GT_ROAD_TERRAINS = Object.freeze(["high_mountain", "mountain", "medium_mountain", "hilly", "rolling", "flat"]);

/**
 * Toleransen paa kvoterne (#6367, fastlagt i PR'en). Kvoten er et TAL pr. GT, ikke en
 * sandsynlighed, saa tolerancen er i etaper:
 *   perTerrain     hvert terraen maa afvige hoejst saa mange etaper fra kvoten
 *   roadL1         summen af |afvigelse| over landevejs-terraenerne (een etape flyttet
 *                  fra et terraen til et andet koster 2)
 *   summits        antal bjergtoppe
 *   timeTrials     antal tidskoersler (enkeltstart + holdtidskoersel tilsammen; en
 *                  holdtidskoersel maa blive en enkeltstart, byg-planen risiko 4)
 */
export const S5_GT_QUOTA_TOLERANCE = Object.freeze({ perTerrain: 1, roadL1: 2, summits: 1, timeTrials: 0 });

/**
 * GT-typen: Tour-klassen er Tour-typen; ellers afgoer loebets region (Giro/Vuelta), samme
 * regel som generatoren. Ukendt region: Tour-typen ved 18+ etaper, ellers Giro-typen.
 */
export function grandTourTypeOf(race) {
  if (race?.race_class === "TourFrance") return "tour";
  const region = regionOf(race?.name);
  if (region === "fr") return "tour";
  if (region === "it") return "giro";
  if (region === "es") return "vuelta";
  return Number(race?.stages ?? race?.stageList?.length) >= 18 ? "tour" : "giro";
}

/** Er loebet en Grand Tour? Arketypen afgoer; klassen og etapeantallet er fallback. */
export function isGrandTourRace(race) {
  if (race?.terrain_archetype === "grand_tour") return true;
  if (race?.race_class === "TourFrance" || race?.race_class === "GiroVuelta") return true;
  return race?.race_type === "stage_race" && (race?.stages?.length ?? 0) >= GRAND_TOUR_MIN_STAGES;
}

/**
 * Kvoten skaleret til en GT med `stageCount` etaper: tidskoerslerne holdes faste,
 * landevejs-terraenerne skaleres med stoerste-rest-metoden (som generatoren). Ved kvotens
 * eget etapeantal (18/17/17) er resultatet kvoten selv.
 */
export function expectedGrandTourCounts(gtType, stageCount) {
  const q = S5_GT_QUOTAS[gtType] ?? S5_GT_QUOTAS.tour;
  const timeTrials = q.itt + q.ttt;
  const roadTarget = Math.max(0, Number(stageCount) - timeTrials);
  const roadTotal = S5_GT_ROAD_TERRAINS.reduce((s, t) => s + q[t], 0);
  const exact = S5_GT_ROAD_TERRAINS.map((t) => (q[t] * roadTarget) / roadTotal);
  const counts = exact.map((e) => Math.floor(e + 1e-9));
  let rest = roadTarget - counts.reduce((s, c) => s + c, 0);
  const order = exact.map((_, k) => k).sort((a, b) => (exact[b] - counts[b]) - (exact[a] - counts[a]) || a - b);
  for (let i = 0; rest > 0; i = (i + 1) % order.length, rest--) counts[order[i]] += 1;
  return {
    terrains: Object.fromEntries(S5_GT_ROAD_TERRAINS.map((t, k) => [t, counts[k]])),
    summits: Math.round((q.summits * roadTarget) / roadTotal),
    timeTrials,
  };
}

const TERRAIN_RANK = Object.freeze({ flat: 0, rolling: 1, hilly: 2, medium_mountain: 3, mountain: 4, high_mountain: 5 });

/**
 * Del (2) for EN Grand Tour: kvoter + ugestruktur.
 *   ugestruktur (spec §5): ingen hoejbjerg i foerste tredjedel · kongeetapen (en etape af
 *   loebets haardeste terraen) i sidste tredjedel · en enkeltstart tidligt (foerste
 *   tredjedel) og en sent (sidste tredjedel) · sidste dag flad eller tidskoersel.
 * @param {{name?: string, race_class?: string, stages: object[]}} race
 */
export function checkGrandTour(race) {
  const stages = Array.isArray(race?.stages) ? race.stages : [];
  const n = stages.length;
  const gtType = grandTourTypeOf({ ...race, stages: n });
  const expected = expectedGrandTourCounts(gtType, n);
  const tol = S5_GT_QUOTA_TOLERANCE;
  const violations = [];

  const checked = stages.map((s) => checkStage(s));
  const terrains = Object.fromEntries(S5_GT_ROAD_TERRAINS.map((t) => [t, 0]));
  let summits = 0;
  let timeTrials = 0;
  for (const c of checked) {
    if (c.isTimeTrial) { timeTrials += 1; continue; }
    terrains[c.terrain] += 1;
    if (c.finish === "long_climb") summits += 1;
  }

  let roadL1 = 0;
  for (const t of S5_GT_ROAD_TERRAINS) {
    const dev = terrains[t] - expected.terrains[t];
    roadL1 += Math.abs(dev);
    if (Math.abs(dev) > tol.perTerrain) violations.push(`${t} ${terrains[t]} mod kvote ${expected.terrains[t]} (±${tol.perTerrain})`);
  }
  if (roadL1 > tol.roadL1) violations.push(`terræn-afvigelse i alt ${roadL1} etaper (højst ${tol.roadL1})`);
  if (Math.abs(summits - expected.summits) > tol.summits) violations.push(`bjergtoppe ${summits} mod kvote ${expected.summits} (±${tol.summits})`);
  if (Math.abs(timeTrials - expected.timeTrials) > tol.timeTrials) violations.push(`tidskørsler ${timeTrials} mod kvote ${expected.timeTrials} (±${tol.timeTrials})`);

  // Ugestrukturen. Tredjedele som generatoren: foerste = indeks < floor(n/3), sidste =
  // indeks >= n - floor(n/3).
  const third = Math.floor(n / 3);
  const firstThirdEnd = third;
  const lastThirdStart = n - third;
  const week = [];
  checked.forEach((c, i) => {
    if (i < firstThirdEnd && !c.isTimeTrial && c.terrain === "high_mountain") week.push(`højbjerg på etape ${i + 1} (første tredjedel, etape 1-${firstThirdEnd})`);
  });
  const road = checked.map((c, i) => ({ c, i })).filter(({ c }) => !c.isTimeTrial);
  if (road.length) {
    const hardest = Math.max(...road.map(({ c }) => TERRAIN_RANK[c.terrain] ?? 0));
    const queenLate = road.some(({ c, i }) => (TERRAIN_RANK[c.terrain] ?? 0) === hardest && i >= lastThirdStart);
    const hardestName = Object.keys(TERRAIN_RANK).find((k) => TERRAIN_RANK[k] === hardest);
    if (!queenLate) week.push(`kongeetapen (${hardestName}) ligger ikke i sidste tredjedel (etape ${lastThirdStart + 1}-${n})`);
  }
  if (expected.timeTrials >= 2 && n >= 3) {
    if (!checked.some((c, i) => c.isTimeTrial && i < firstThirdEnd)) week.push(`ingen tidskørsel i første tredjedel (etape 1-${firstThirdEnd})`);
    if (!checked.some((c, i) => c.isTimeTrial && i >= lastThirdStart)) week.push(`ingen tidskørsel i sidste tredjedel (etape ${lastThirdStart + 1}-${n})`);
  }
  const lastStage = checked[n - 1];
  if (lastStage && !lastStage.isTimeTrial && lastStage.terrain !== "flat") week.push(`sidste etape er ${lastStage.terrain}, skal være flad eller en tidskørsel`);
  for (const w of week) violations.push(`ugestruktur: ${w}`);

  return {
    name: race?.name ?? null, gtType, stageCount: n,
    counts: { terrains, summits, timeTrials, roadL1 }, expected, violations,
  };
}

// ── 4. Benchmark (__fixtures__/s5Benchmark.gt-2021-2025.json) ──────────────────────

/** Benchmarkens afslutnings-navne -> S5-afslutningen. Tidskoersler samles i `tt`. */
export const BENCHMARK_FINISH_MAP = Object.freeze({
  flad_spurt: "flat_sprint",
  stigende_spurt: "uphill_sprint",
  bakke: "punch",
  mur: "wall_finish",
  bjergtop: "long_climb",
  nedkoersel: "descent",
  itt: "tt",
  ttt: "tt",
});
/** Afslutnings-klasserne del (3) og (4) maaler i. `other` = alt matrixen ikke kender. */
export const SEASON_FINISH_CLASSES = Object.freeze(["flat_sprint", "uphill_sprint", "punch", "wall_finish", "long_climb", "descent", "tt", "other"]);

/** Laeser benchmark-filen. Den eneste I/O i modulet; kalderen styrer hvornaar. */
export function loadS5Benchmark(path = DEFAULT_BENCHMARK_PATH) {
  const rows = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`S5-benchmark ${path}: forventede en ikke-tom liste`);
  return rows;
}

function seasonFinishClass(finish) {
  if (finish === "solo_tt" || finish === "ttt") return "tt";
  return SEASON_FINISH_CLASSES.includes(finish) ? finish : "other";
}

/** Benchmarkens andel (0-1) pr. afslutnings-klasse. */
export function benchmarkFinishShares(benchmark) {
  const counts = Object.fromEntries(SEASON_FINISH_CLASSES.map((c) => [c, 0]));
  for (const r of benchmark) counts[BENCHMARK_FINISH_MAP[r?.finish] ?? "other"] += 1;
  return { n: benchmark.length, shares: Object.fromEntries(SEASON_FINISH_CLASSES.map((c) => [c, counts[c] / benchmark.length])) };
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Mindste antal benchmark-etaper en afslutning skal have for at faa et interval i del (4). */
export const MOTOR_GAP_MIN_BENCHMARK_N = 5;

/**
 * Benchmarkens gap10 pr. afslutning: median og kvartil-interval (25.-75. percentil).
 * Neutraliserede etaper (gap10_s = null) taeller ikke med. Holdtidskoersler (`ttt`) er
 * holdt for sig, fordi en holdtid ikke er et individuelt gab.
 */
export function benchmarkGapIntervals(benchmark) {
  const by = new Map();
  for (const r of benchmark) {
    const gap = r?.gap10_s;
    if (gap == null || !Number.isFinite(Number(gap))) continue;
    const key = r.finish === "ttt" ? "ttt" : (BENCHMARK_FINISH_MAP[r.finish] === "tt" ? "solo_tt" : BENCHMARK_FINISH_MAP[r.finish]);
    if (!key) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(Number(gap));
  }
  return Object.fromEntries([...by].map(([k, v]) => {
    const s = v.slice().sort((a, b) => a - b);
    return [k, { n: s.length, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75) }];
  }));
}

/** Stikproeve-tillaegget i del (3): saa mange standardfejl, og aldrig under gulvet (pp). */
export const SEASON_SHARE_ALLOWANCE_SE = 2;
export const SEASON_SHARE_FLOOR_PP = 3;

/**
 * Del (3): afslutnings-andelene over saesonens GT-etaper mod benchmarken.
 *
 * Toleransen er binomial (samme begrundelse som stageFinaleMetrics.js: en saeson har kun
 * ~50 GT-etaper, saa en korrekt generator svinger 5-7 pp omkring benchmarken): tilladt
 * afvigelse = SEASON_SHARE_ALLOWANCE_SE standardfejl ved benchmarkens andel og saesonens n,
 * dog mindst SEASON_SHARE_FLOOR_PP. `other` (udbrud, ukendte) har benchmark 0 og maa
 * derfor hoejst udgoere gulvet.
 *
 * @param {{ stages: object[], benchmark: object[] }} args  stages = alle GT-etaper i saesonen
 */
export function checkSeasonFinishShares({ stages = [], benchmark }) {
  const bench = benchmarkFinishShares(benchmark);
  const n = stages.length;
  const counts = Object.fromEntries(SEASON_FINISH_CLASSES.map((c) => [c, 0]));
  for (const s of stages) counts[seasonFinishClass(s.finish ?? s5FinishOf(s))] += 1;
  const rows = SEASON_FINISH_CLASSES.map((c) => {
    const p = bench.shares[c];
    const actualPct = n ? (counts[c] / n) * 100 : 0;
    const se = n ? 100 * Math.sqrt((p * (1 - p)) / n) : 0;
    const allowance = Math.max(SEASON_SHARE_FLOOR_PP, SEASON_SHARE_ALLOWANCE_SE * se);
    const benchPct = p * 100;
    const pass = n > 0 && Math.abs(actualPct - benchPct) <= allowance + 1e-9;
    return { finish: c, count: counts[c], actualPct, benchmarkPct: benchPct, allowancePp: allowance, pass };
  });
  const violations = n === 0
    ? ["0 Grand Tour-etaper i sæsonen: andelene kan ikke vurderes"]
    : rows.filter((r) => !r.pass).map((r) => `${r.finish} ${r.actualPct.toFixed(1)} % mod benchmark ${r.benchmarkPct.toFixed(1)} % (±${r.allowancePp.toFixed(1)} pp, n=${n})`);
  return { n, rows, violations };
}

/** #6362: dommen pr. afslutning i del (4). Kun "inside" er groen. */
export const MOTOR_GAP_VERDICTS = Object.freeze(["inside", "below", "above"]);
/** #6362: vindertype-dommen pr. afslutning i del (4). Kun "pass" er groen. */
export const MOTOR_WINNER_VERDICTS = Object.freeze(["pass", "fail"]);
/**
 * #6362: vindertype-tjekkene del (4) SKAL have en dom for (afslutning -> forventet ryttertype).
 * Samme tjek som benchens S5_WINNER_EXPECTATIONS (scripts/dev/s5MotorBench.mjs); drift fanges
 * af s5BenchmarkGate.test.js (mod fixturen) og s5MotorBench.test.ts (fixturen mod benchen).
 * En ikke-stub-maaling uden en gyldig dom for hvert tjek er roed (fail-closed).
 */
export const MOTOR_REQUIRED_WINNERS = Object.freeze({ uphill_sprint: "sprinter", long_climb: "climber" });

function gapVerdict(m, iv) {
  if (m < iv.p25 - 1e-9) return "below";
  if (m > iv.p75 + 1e-9) return "above";
  return "inside";
}

/**
 * #6362: motorens medianer -> dom pr. doemt afslutning ("inside" / "below" / "above").
 * Afslutninger med for faa benchmark-etaper og afslutninger motoren ikke har maalt er
 * ikke med (evaluateMotorGaps melder de sidste som "ikke maalt").
 * @param {{ medians: Record<string, number>, benchmark: object[] }} args
 */
export function motorGapVerdicts({ medians = {}, benchmark }) {
  const out = {};
  for (const [finish, iv] of Object.entries(benchmarkGapIntervals(benchmark))) {
    if (iv.n < MOTOR_GAP_MIN_BENCHMARK_N) continue;
    const m = medians[finish];
    if (m == null || !Number.isFinite(Number(m))) continue;
    out[finish] = gapVerdict(Number(m), iv);
  }
  return out;
}

/**
 * Del (4): motorens median gap10 pr. afslutning mod benchmarkens kvartil-interval.
 *
 * `motor` har en af to former:
 *   { stub?: boolean, source?, medians: { [finish]: sekunder } }   tallene (lokalt, tests)
 *   { stub: false, source?, verdicts: { [finish]: "inside"|"below"|"above" } }
 *       dommen fra motor-benchen (#6362, __fixtures__/s5MotorBench.json): tallene ligger
 *       i balance-internals (hard rule 17), og s5MotorBench.test.ts holder dommen sand.
 *   - En afslutning med for faa benchmark-etaper (< MOTOR_GAP_MIN_BENCHMARK_N) doemmes ikke.
 *   - Mangler motorens tal/dom for en afslutning med et interval, er det et brud ("ikke maalt").
 *   - stub: true -> `status: "stub"`: sammenlignes og vises, men BLOKERER IKKE (en stub er
 *     ikke en maaling af motoren). Den rigtige bench er ikke en stub og blokerer ved fail.
 *   - `winners` (PAAKRAEVET): { [finish]: { expected, verdict: "pass"|"fail" } } fra benchen.
 *     Hvert tjek i MOTOR_REQUIRED_WINNERS skal have dommen "pass" med den forventede type;
 *     mangler `winners`, et tjek, en gyldig dom, eller er typen en anden, er det et brud
 *     (fail-closed: en fil med kun medianer/domme kan ikke goere del (4) groen). Ekstra
 *     tjek ud over de paakraevede doemmes ogsaa. Taersklen bag dommen er privat (hard rule 17).
 */
export function evaluateMotorGaps({ motor, benchmark }) {
  const intervals = benchmarkGapIntervals(benchmark);
  const medians = motor?.medians ?? {};
  const verdicts = motor?.verdicts && typeof motor.verdicts === "object" ? motor.verdicts : null;
  const rows = [];
  const violations = [];
  for (const [finish, iv] of Object.entries(intervals)) {
    const m = medians[finish];
    const has = m != null && Number.isFinite(Number(m));
    const verdict = verdicts ? (MOTOR_GAP_VERDICTS.includes(verdicts[finish]) ? verdicts[finish] : null) : (has ? gapVerdict(Number(m), iv) : null);
    if (iv.n < MOTOR_GAP_MIN_BENCHMARK_N) {
      rows.push({ finish, ...iv, motor: has ? Number(m) : null, verdict, judged: false, pass: null });
      continue;
    }
    const pass = verdict === "inside";
    rows.push({ finish, ...iv, motor: has ? Number(m) : null, verdict, judged: true, pass });
    if (!verdict) violations.push(`${finish}: motorens median gap10 er ikke målt`);
    else if (!pass) {
      const where = verdict === "below" ? "under" : "over";
      violations.push(has
        ? `${finish}: motor ${Number(m)} s uden for benchmarkens interval ${iv.p25}-${iv.p75} s (median ${iv.median} s)`
        : `${finish}: motorens median gap10 ligger ${where} benchmarkens interval ${iv.p25}-${iv.p75} s (median ${iv.median} s)`);
    }
  }
  // Vindertype (#6362): { [finish]: { expected, verdict: "pass"|"fail" } }. Taersklen er
  // privat (balance-internals); her doemmes kun dommen. Alt andet end "pass" er et brud,
  // og hvert paakraevet tjek (MOTOR_REQUIRED_WINNERS) skal vaere med (fail-closed).
  const winnerRows = [];
  const winners = motor?.winners && typeof motor.winners === "object" && !Array.isArray(motor.winners) ? motor.winners : {};
  const winnerFinishes = [...Object.keys(MOTOR_REQUIRED_WINNERS), ...Object.keys(winners).filter((f) => !Object.hasOwn(MOTOR_REQUIRED_WINNERS, f))];
  for (const finish of winnerFinishes) {
    const required = Object.hasOwn(MOTOR_REQUIRED_WINNERS, finish) ? MOTOR_REQUIRED_WINNERS[finish] : null;
    const w = Object.hasOwn(winners, finish) ? winners[finish] : null;
    const expected = w?.expected ?? required;
    const verdict = MOTOR_WINNER_VERDICTS.includes(w?.verdict) ? w.verdict : null;
    const wrongType = required != null && w?.expected != null && w.expected !== required;
    const pass = verdict === "pass" && !wrongType;
    winnerRows.push({ finish, expected: expected ?? null, verdict, pass });
    if (pass) continue;
    if (!w) violations.push(`${finish}: vindertype-dommen mangler på motor-benchen (${required} forventes)`);
    else if (wrongType) violations.push(`${finish}: vindertype-dommen gælder ${w.expected}, men ${required} forventes`);
    else violations.push(`${finish}: ${expected ?? "den forventede ryttertype"} vinder ikke afslutningen ofte nok på motor-benchen${verdict ? "" : " (dom mangler)"}`);
  }
  const stub = motor?.stub === true;
  return { status: stub ? "stub" : (violations.length ? "red" : "green"), stub, source: motor?.source ?? null, rows, winnerRows, violations };
}

/** Laeser motor-bench-fixturen (#6362) eller en fil med samme form (medianer eller domme). */
export function loadMotorGapFile(path = DEFAULT_MOTOR_BENCH_PATH) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const ok = j && (typeof j.medians === "object" || typeof j.verdicts === "object") && (j.medians ?? j.verdicts) !== null;
  if (!ok) throw new Error(`motor-gap-fil ${path}: mangler "medians" eller "verdicts"`);
  return j;
}

// ── 5. Hele gaten ──────────────────────────────────────────────────────────────────

function raceKey(r, i) {
  return r?.pool_race_id ?? r?.id ?? r?.name ?? `#${i}`;
}

/**
 * Hele benchmark-gaten over en saesons loeb.
 *
 * @param {{
 *   races: Array<{pool_race_id?: string, name?: string, race_type?: string, race_class?: string,
 *     terrain_archetype?: string, stages: object[]}>,
 *   benchmark: object[],                  loadS5Benchmark()
 *   motor?: object|null,                  loadMotorGapFile(); null = del (4) ikke maalt (roed)
 * }} args
 *   Samme loeb i flere divisioner (samme pool_race_id) taelles een gang: et loebs parcours
 *   er seedet paa loebets identitet, saa det ER den samme rute.
 * @returns {{ green: boolean, blocking: string[], parts: object }}
 */
export function evaluateS5BenchmarkGate({ races = [], benchmark, motor = null }) {
  if (!Array.isArray(benchmark) || benchmark.length === 0) throw new Error("evaluateS5BenchmarkGate: benchmark mangler");
  const seen = new Set();
  const unique = [];
  races.forEach((r, i) => {
    const k = raceKey(r, i);
    if (seen.has(k)) return;
    seen.add(k);
    unique.push(r);
  });

  // (1) hver etape
  const stageViolations = [];
  let stageCount = 0;
  let mismatchedType = 0;
  for (const r of unique) {
    for (const s of r.stages ?? []) {
      stageCount += 1;
      const c = checkStage(s);
      if (c.violations.some((v) => v.startsWith("type "))) mismatchedType += 1;
      for (const v of c.violations) stageViolations.push(`${r.name ?? raceKey(r, 0)} etape ${s.stage_number ?? "?"}: ${v}`);
    }
  }

  // (2) pr. GT
  const gts = unique.filter(isGrandTourRace).map((r) => checkGrandTour(r));
  const gtViolations = gts.flatMap((g) => g.violations.map((v) => `${g.name ?? "GT"} (${g.gtType}-typen, ${g.stageCount} etaper): ${v}`));

  // (3) saeson
  const gtStages = unique.filter(isGrandTourRace).flatMap((r) => r.stages ?? []);
  const season = checkSeasonFinishShares({ stages: gtStages, benchmark });

  // (4) motor
  const motorPart = motor
    ? evaluateMotorGaps({ motor, benchmark })
    : { status: "red", stub: false, source: null, rows: [], violations: ["motor-bench mangler: del (4) er ikke målt"] };

  const blocking = [
    ...stageViolations.map((v) => `S5 (1) etape — ${v}`),
    ...gtViolations.map((v) => `S5 (2) Grand Tour — ${v}`),
    ...(gts.length === 0 ? ["S5 (2) Grand Tour — ingen Grand Tours i sæsonen: kvoterne kan ikke vurderes"] : []),
    ...season.violations.map((v) => `S5 (3) sæson — ${v}`),
    ...(motorPart.stub ? [] : motorPart.violations.map((v) => `S5 (4) motor — ${v}`)),
  ];

  return {
    green: blocking.length === 0,
    blocking,
    parts: {
      stages: { stageCount, mismatchedType, violations: stageViolations, green: stageViolations.length === 0 },
      grandTours: { races: gts, violations: gtViolations, green: gts.length > 0 && gtViolations.length === 0 },
      season: { ...season, green: season.violations.length === 0 },
      motor: motorPart,
    },
  };
}

/**
 * Rapporten som linjer (dry-run og golden-diff printer den). Viser tolerancerne som tal,
 * saa en roed linje kan laeses uden at aabne koden.
 * @param {ReturnType<typeof evaluateS5BenchmarkGate>} result
 * @param {{ maxLines?: number, judged?: boolean }} [opts]  judged=false: maalt, ikke doemt
 */
export function formatS5BenchmarkReport(result, { maxLines = 15, judged = true } = {}) {
  const ud = [];
  const mark = (green) => (!judged ? "--" : green ? "✅" : "❌");
  const p = result.parts;
  ud.push(`── S5 benchmark-gate (#6367, spec §2/§3/§5) ${judged ? "" : "— MÅLT, IKKE DØMT (gaten gælder kun S5-modellen)"} ──`);

  ud.push(`  ${mark(p.stages.green)} (1) etape: ${p.stages.stageCount} etaper · ${p.stages.mismatchedType} med type ≠ B+ · ${p.stages.violations.length} brud i alt`);
  for (const v of p.stages.violations.slice(0, maxLines)) ud.push(`       · ${v}`);
  if (p.stages.violations.length > maxLines) ud.push(`       ... og ${p.stages.violations.length - maxLines} flere`);

  const t = S5_GT_QUOTA_TOLERANCE;
  ud.push(`  ${mark(p.grandTours.green)} (2) Grand Tour: ${p.grandTours.races.length} GT'er · tolerance ±${t.perTerrain} etape pr. terræn, højst ${t.roadL1} i alt, bjergtoppe ±${t.summits}, tidskørsler ±${t.timeTrials}`);
  for (const g of p.grandTours.races) {
    const got = S5_GT_ROAD_TERRAINS.map((k) => `${k} ${g.counts.terrains[k]}/${g.expected.terrains[k]}`).join(" · ");
    ud.push(`       ${g.name ?? "GT"} (${g.gtType}, ${g.stageCount}): ${got} · bjergtop ${g.counts.summits}/${g.expected.summits} · TT ${g.counts.timeTrials}/${g.expected.timeTrials}  ${g.violations.length ? `❌ ${g.violations.length}` : "✅"}`);
    for (const v of g.violations.slice(0, maxLines)) ud.push(`         · ${v}`);
  }

  ud.push(`  ${mark(p.season.green)} (3) sæson: afslutninger over ${p.season.n} GT-etaper mod benchmark (±${SEASON_SHARE_ALLOWANCE_SE} SE, mindst ${SEASON_SHARE_FLOOR_PP} pp)`);
  for (const r of p.season.rows) {
    ud.push(`       ${r.finish.padEnd(14)} ${r.actualPct.toFixed(1).padStart(5)} %  benchmark ${r.benchmarkPct.toFixed(1).padStart(5)} %  ±${r.allowancePp.toFixed(1)} pp  ${r.pass ? "OK" : "UDENFOR"}`);
  }

  const m = p.motor;
  const mMark = m.status === "stub" ? "⚠" : mark(m.status === "green");
  ud.push(`  ${mMark} (4) motor: median gap10 pr. afslutning i benchmarkens kvartil-interval${m.stub ? " — STUB, ikke en måling af motoren (blokerer ikke)" : ""}`);
  const VERDICT_LABEL = { inside: "inden for", below: "under", above: "over" };
  for (const r of m.rows) {
    const verdict = !r.judged ? `ikke dømt (n=${r.n})` : r.pass ? "OK" : "UDENFOR";
    const shown = r.motor != null ? `${r.motor} s` : r.verdict ? VERDICT_LABEL[r.verdict] : "—";
    ud.push(`       ${r.finish.padEnd(14)} motor ${shown}  benchmark ${r.p25}-${r.p75} s (median ${r.median} s)  ${verdict}`);
  }
  for (const w of m.winnerRows ?? []) ud.push(`       ${w.finish.padEnd(14)} vindertype ${w.expected ?? "—"}  ${w.pass ? "OK" : "FEJL"}`);
  for (const v of (m.stub ? [] : m.violations)) ud.push(`       · ${v}`);

  ud.push(`  ${judged ? (result.green ? "✅ GRØN" : `❌ RØD (${result.blocking.length} brud) — hårdt krav, ingen override`) : `-- ${result.blocking.length} brud målt`}`);
  return ud;
}
