// backend/lib/s5TierTerrainQuota.js
// #6367 (S5-kalenderen overholder de låste regler, ejer 14/10 "Ret generatoren" — ingen regel
// løsnes): S5-modellens etapeløbs-filler fordeles efter KVOTE pr. division, ikke trukket frit.
//
// RODÅRSAGEN. Kalenderens terræn-regler er pr. division og stramme: §6's K-B-komposition
// (gated tolerance pr. division, ±2 pp på sæson-aggregatet), §6b's tre uniforme mål (±2 pp
// pr. division) og §5's terræn-gulve og rolling-bånd. Generatoren trak hver filler-etape
// UAFHÆNGIGT af vægtene i ARCHETYPE_PROFILES, så en divisions andel var en stikprøve omkring
// vægten. Med 96-160 etaper pr. division er standardfejlen på en andel 2-3 pp — samme
// størrelse som tolerancen. En korrekt kalibreret generator lå derfor uden for et eller
// flere bånd i de fleste sæson-træk (målt offline over mange træk, tal i
// balance-internals/6367/). Det er præcis den fejlklasse #5405 lukkede for finalerne
// (balanceFinaleQuotas, CALENDAR_RULES §7b "Finalerne fordeles efter kvote pr. division").
//
// S5 gjorde det synligt: GT'erne bygges af ejerens faste kvoter (spec §5) og ligger alle i
// D1, så en tredjedel af D1's etaper er låst og bjergtunge. Intet i den frie filler
// kompenserede for det, så D1's bjerg skød over og højbjerg/kuperet under.
//
// REGLEN NU (kun profileModel "s5"):
//   1. Hvert løb trækkes som før (samme seed, samme filler-træk = det naturlige træk).
//   2. Divisionens terræn-tal tælles over HELE dens repræsentative løbssæt (endagsløb og
//      Grand Tours er faste; garantier er faste).
//   3. Filler-pladserne i arketype-etapeløbene justeres én ad gangen, grådigt og
//      deterministisk, så længe det bringer divisionen tættere på målene (§6 K-B, §6b, §5
//      med én etapes margin). Kun typer arketypens filler allerede kan trække er lovlige,
//      TT-loftet (#2029) holdes, og et bjergfrit etapeløb får aldrig en bjergetape (#3327's
//      gulv for bjergfrie etapeløb). Trækket ændres kun hvor det flytter divisionen mod målet.
//   4. Løbene bygges med de fordelte filler-typer (generateRaceStageProfiles' fillerTypes):
//      rækkefølge, rute og afslutning følger S5-modellen uændret.
//
// HVOR DEN GÆLDER: tierCalendarMaterializer.js bruger makeS5TierProfileGenerator på alle
// skrivestier (realisme-gen-træk, dæknings-verifikation, scorecard, insert). Pr. division,
// over den repræsentative puljes løbssæt — samme sted og af samme grund som finale-kvoterne.
// Sæson 1-4 (v5) røres ikke.
//
// Ren: ingen DB. Deterministisk givet løbssættet og seed-nøglerne.

import { generateRaceStageProfiles, s5StageRaceFillerSlots, isTimeTrial, isOrderArchetypeFeasible } from "./raceStageProfileGenerator.js";
import {
  ACTIVE_TARGET, COMPOSITION_TOLERANCE_PP, TIER_COMPOSITION_TOLERANCE_PP, TIER_UNIFORM_TARGET_FRACTIONS, TIER_UNIFORM_TOLERANCE_PP,
  compositionCategory, toleranceFor,
} from "./calendarCompositionTargets.js";
import { TERRAIN_FAMILY_BY_PROFILE_TYPE, TIER_TERRAIN_FAMILY_MIN, TIER_TERRAIN_FAMILY_MAX } from "./tierCalendarGuarantees.js";

// K-B-kategorierne generatoren kan flytte (TTT genereres ikke, #2411).
const KB_CATEGORIES = Object.freeze(["flat", "hilly", "mountain", "itt", "cobbles"]);
// §6b: profiltyper pr. uniform akse (calendarCompositionTargets.computeUniformTierStats).
const UNIFORM_AXIS_TYPES = Object.freeze({ itt: ["itt", "itt_hilly"], cobbles: ["cobbles"], high_mountain: ["high_mountain"] });
// Bjerg-familien i #3327's forstand: et etapeløb med en af dem er ikke bjergfrit.
const MOUNTAIN_FAMILY_TYPES = Object.freeze(new Set(["mountain", "high_mountain", "medium_mountain"]));

// Margin til §5's gulve og rolling-loftet: én etape, så en regel ikke står på kanten.
export const S5_QUOTA_FAMILY_MARGIN = 1;
// Straf pr. ændret filler-plads: lille, men > 0, så kvoten kun ændrer et træk når det
// flytter divisionen mod målet (og ved lige tab vælges det naturlige træk).
export const S5_QUOTA_CHANGE_COST = 0.01;
// Straf pr. etape uden for et §5-bånd (+ margin). Stor nok til at gå forud for K-B.
export const S5_QUOTA_FAMILY_PENALTY = 4;
// Gated bånd går forud for de bløde mål: straf pr. pp en andel ligger uden for en GATES
// tolerance (minus margin). Rækkefølgen følger gatesne: §6b (±2 pp, gated i alle
// divisioner) og §6's pr.-division-tolerance stopper --apply; §6's strenge ±2 pp pr.
// division er rapport (CALENDAR_RULES §6, §10 modsigelse 2) og er derfor kun det bløde mål.
export const S5_QUOTA_GATE_PENALTY_PER_PP = 10;
export const S5_QUOTA_UNIFORM_MARGIN_PP = 0.5;
export const S5_QUOTA_TIER_KB_MARGIN_PP = 1;

/** @param {Record<string, number>} counts @param {string[]} types */
const sumOf = (counts, types) => types.reduce((s, t) => s + (counts[t] ?? 0), 0);

/**
 * Tabet for én divisions type-tal. Lavere er bedre; 0 = alle mål ramt præcist.
 * @param {Record<string, number>} counts  profile_type → antal etaper i divisionen
 * @param {number} tier
 */
export function tierTerrainLoss(counts, tier) {
  const n = Object.values(counts).reduce((s, c) => s + c, 0);
  if (!n) return 0;
  /** @type {Record<string, number>} */
  const kb = {};
  for (const [t, c] of Object.entries(counts)) {
    const cat = compositionCategory(t);
    if (cat) kb[cat] = (kb[cat] ?? 0) + c;
  }
  let loss = 0;
  const hinge = (/** @type {number} */ dev, /** @type {number} */ allowed) => S5_QUOTA_GATE_PENALTY_PER_PP * Math.max(0, Math.abs(dev) - allowed);
  const tierTol = Math.max(/** @type {any} */ (TIER_COMPOSITION_TOLERANCE_PP)[tier] ?? COMPOSITION_TOLERANCE_PP, toleranceFor(n));
  for (const cat of KB_CATEGORIES) {
    const dev = (100 * (kb[cat] ?? 0)) / n - /** @type {any} */ (ACTIVE_TARGET)[cat];
    loss += (dev / COMPOSITION_TOLERANCE_PP) ** 2 + hinge(dev, tierTol - S5_QUOTA_TIER_KB_MARGIN_PP);
  }
  for (const [axis, types] of Object.entries(UNIFORM_AXIS_TYPES)) {
    const dev = (100 * sumOf(counts, types)) / n - 100 * /** @type {any} */ (TIER_UNIFORM_TARGET_FRACTIONS)[axis];
    loss += (dev / TIER_UNIFORM_TOLERANCE_PP) ** 2 + hinge(dev, TIER_UNIFORM_TOLERANCE_PP - S5_QUOTA_UNIFORM_MARGIN_PP);
  }
  /** @type {Record<string, number>} */
  const family = {};
  for (const [t, c] of Object.entries(counts)) {
    const f = /** @type {any} */ (TERRAIN_FAMILY_BY_PROFILE_TYPE)[t];
    if (f) family[f] = (family[f] ?? 0) + c;
  }
  const mins = /** @type {any} */ (TIER_TERRAIN_FAMILY_MIN)[tier] ?? {};
  const maxs = /** @type {any} */ (TIER_TERRAIN_FAMILY_MAX)[tier] ?? {};
  for (const [f, lo] of Object.entries(mins)) loss += S5_QUOTA_FAMILY_PENALTY * Math.max(0, lo + S5_QUOTA_FAMILY_MARGIN - (family[f] ?? 0));
  for (const [f, hi] of Object.entries(maxs)) loss += S5_QUOTA_FAMILY_PENALTY * Math.max(0, (family[f] ?? 0) - (hi - S5_QUOTA_FAMILY_MARGIN));
  return loss;
}

/**
 * Fordel én divisions filler-pladser efter kvote.
 *
 * @param {{ tier: number, counts: Record<string, number>,
 *   slots: Array<{ id: string, guaranteed: string[], natural: string[], options: string[], ttCap: number, orderArchetype?: string }> }} args
 *   counts  divisionens type-tal med det NATURLIGE træk (alle løb, alle etaper)
 *   slots   arketype-etapeløbenes filler-pladser (s5StageRaceFillerSlots), i løbssættets rækkefølge
 * @returns {{ fillerById: Map<string, string[]>, changes: number, lossBefore: number, lossAfter: number }}
 */
export function allocateS5TierFillers({ tier, counts, slots }) {
  const cur = { ...counts };
  const fillers = slots.map((s) => s.natural.slice());
  const mountainFree = slots.map((s) => ![...s.guaranteed, ...s.natural].some((t) => MOUNTAIN_FAMILY_TYPES.has(t)));
  // Ordnings-arketypen må ikke blive umulig hvis det naturlige træk kunne bære den.
  const keepFeasible = slots.map((s) => Boolean(s.orderArchetype) && isOrderArchetypeFeasible(/** @type {string} */ (s.orderArchetype), [...s.guaranteed, ...s.natural]));
  const lossBefore = tierTerrainLoss(cur, tier);
  let loss = lossBefore;
  let changes = 0;
  const changedFrom = (/** @type {number} */ i, /** @type {number} */ j) => fillers[i][j] !== slots[i].natural[j];
  for (;;) {
    let best = null;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const tts = [...s.guaranteed, ...fillers[i]].filter(isTimeTrial).length;
      for (let j = 0; j < fillers[i].length; j++) {
        const from = fillers[i][j];
        for (const to of s.options) {
          if (to === from) continue;
          if (isTimeTrial(to) && !isTimeTrial(from) && tts + 1 > s.ttCap) continue;
          if (mountainFree[i] && MOUNTAIN_FAMILY_TYPES.has(to)) continue;
          if (keepFeasible[i]) {
            const after = fillers[i].slice(); after[j] = to;
            if (!isOrderArchetypeFeasible(s.orderArchetype, [...s.guaranteed, ...after])) continue;
          }
          cur[from] -= 1; cur[to] = (cur[to] ?? 0) + 1;
          const wasChanged = changedFrom(i, j);
          const willChange = to !== s.natural[j];
          const delta = tierTerrainLoss(cur, tier) - loss + S5_QUOTA_CHANGE_COST * ((willChange ? 1 : 0) - (wasChanged ? 1 : 0));
          cur[to] -= 1; cur[from] += 1;
          if (delta < -1e-9 && (best == null || delta < best.delta - 1e-12)) best = { i, j, to, delta };
        }
      }
    }
    if (!best) break;
    const from = fillers[best.i][best.j];
    const wasChanged = changedFrom(best.i, best.j);
    cur[from] -= 1; cur[best.to] = (cur[best.to] ?? 0) + 1;
    fillers[best.i][best.j] = best.to;
    changes += (best.to !== slots[best.i].natural[best.j] ? 1 : 0) - (wasChanged ? 1 : 0);
    loss = tierTerrainLoss(cur, tier);
  }
  return { fillerById: new Map(slots.map((s, i) => [s.id, fillers[i]])), changes, lossBefore, lossAfter: loss };
}

/**
 * Profil-generator for ÉN division under S5-modellen: samme kontrakt som
 * generateRaceStageProfiles(seedRace) pr. løb (så den kan gives til resolveTierDraw og
 * dæknings-verifikationen), men filler-pladserne er fordelt efter kvote over HELE
 * divisionens løbssæt. Fordelingen beregnes én gang pr. season_variant (realisme-gen-trækket
 * prøver flere) og caches.
 *
 * @param {{ tier: number, seedRaces: any[], archetypeProfiles?: Record<string, any>, onAllocate?: (info: any) => void }} args
 *   seedRaces  divisionens repræsentative løbssæt (seedRaceFor-formen); season_variant
 *              overskrives af kaldet
 * @returns {(seedRace: any) => any[]}
 */
export function makeS5TierProfileGenerator({ tier, seedRaces, archetypeProfiles = undefined, onAllocate = () => {} }) {
  /** @type {Map<number, Map<string, string[]>>} */
  const byVariant = new Map();
  const opts = archetypeProfiles ? { archetypeProfiles } : {};
  const allocationFor = (/** @type {number} */ variant) => {
    if (byVariant.has(variant)) return /** @type {Map<string, string[]>} */ (byVariant.get(variant));
    const races = seedRaces.map((r) => ({ ...r, season_variant: variant }));
    /** @type {Record<string, number>} */
    const counts = {};
    /** @type {Array<any>} */
    const slots = [];
    for (const race of races) {
      for (const p of generateRaceStageProfiles(race, { ...opts, profileModel: "s5" })) counts[p.profile_type] = (counts[p.profile_type] ?? 0) + 1;
      const s = s5StageRaceFillerSlots(race, opts);
      if (s && s.natural.length) slots.push({ id: race.id, ...s });
    }
    const result = allocateS5TierFillers({ tier, counts, slots });
    onAllocate({ tier, variant, changes: result.changes, lossBefore: result.lossBefore, lossAfter: result.lossAfter });
    byVariant.set(variant, result.fillerById);
    return result.fillerById;
  };
  return (seedRace) => {
    const fillerTypes = allocationFor(Number(seedRace?.season_variant) || 0).get(seedRace?.id) ?? null;
    return generateRaceStageProfiles(seedRace, { ...opts, profileModel: "s5", ...(fillerTypes ? { fillerTypes } : {}) });
  };
}
