// backend/lib/catalogSupplyCheck.js
//
// #5405 — FORSYNINGS-KONTROL: kan kataloget overhovedet opfylde en divisions terræn-mål?
//
// HVORFOR DEN FINDES. 19/9 blev det opdaget at Division 2 og 3 manglede afgørende
// bjergdage. Årsagen var ikke en fejl i pakkeren eller i den grådige udvælger: kataloget
// indeholder simpelthen ikke nok løb af den rigtige slags i de to divisioners klasse-
// vinduer, og de to divisioner deler oven i købet et klasse-bånd, så de konkurrerer om de
// samme løb. Fundet kom otte dage før et sæsonskifte. Det er samme fejlklasse som
// `.claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md`: en
// garanti uden forsyning er en blokering, ikke en garanti — og CALENDAR_RULES.md §5b siger
// allerede at et katalog-loft lukkes ved at TILFØJE LØB, ikke ved at slække et mål.
//
// Det der manglede var ikke reglen. Det var en kontrol der kunne stille spørgsmålet FØR
// nogen bygger en sæson: *uafhængigt af hvad udvælgeren tilfældigvis vælger — findes de løb
// overhovedet?*
//
// ───────────────────────────────────────────────────────────────────────────────────────
// TRE TAL PR. DIVISION OG MÅL — og præcis hvad hvert af dem betyder
//
// 1. `bestAchievable` — OPTIMISTISK LOFT. Et EKSAKT knapsack-maksimum (DP over den præcise
//    etape-kvote, §1b) hvor hvert løb bidrager med sit STØRST MULIGE udfald. Loftet ser
//    bort fra den grådige prestige-rækkefølge, endagsløb/etapeløb-budgettet (§4),
//    arketype-reservationerne (§5), og det antager at HVERT filler-træk i HVERT løb falder
//    ud til fordel for målet. Konsekvensen er præcis én, og den er den nyttige:
//    **et mål over loftet kan ikke nås — et mål under loftet er ikke dermed nået.**
//
// 2. `bestGuaranteed` — samme eksakte knapsack, men hvert løb bidrager kun med det det
//    leverer DETERMINISTISK (arketypens garantier, jf. ARCHETYPE_PROFILES). Ligger kravet
//    over dette tal, kan målet kun nås hvis den tilfældige filler spiller med — divisionen
//    har ingen garanteret forsyning at falde tilbage på, og en regenerering kan tabe
//    dækningen uden at noget er ændret. Det er præcis dét der skete for D4's rullende
//    terræn i sæson 3 (0 af 62 etaper, §5).
//
// 3. `worstAchievable` — det eksakte minimum. Bruges til LOFT-mål (§5's rolling-loft): et
//    loft kan kun være uopnåeligt hvis selv det mindste udfald ligger over det.
//
// Den krydsdivisionelle dom (`contested`) er en ÆGTE nødvendig betingelse — se
// `evaluateSharedSupply` nedenfor: et løb kan kun ligge i én division (cross-tier dedup,
// #2276), så for enhver gruppe af divisioner skal den samlede forsyning i foreningen af
// deres klasse-vinduer kunne dække gruppens samlede krav. Er den betingelse brudt, er det
// bevist at ikke alle divisioner i gruppen kan nå målet — uanset hvem der vælger først.
//
// MÅLT MOD DET COMMITTEDE KATALOG (19/9): ingen af de fire divisioners terræn-mål ligger
// over sit loft, og ingen gruppe af divisioner er bestridt. Det er et fund i sig selv, og
// det er det samme som undersøgelsen i `docs/audits/2026-09-19-5405-bjergdage-bytte.md`
// nåede frem til ad en helt anden vej (dens F1: det bjergrige løb Division 3 manglede,
// "lå ubrugt i kataloget"). **Den bindende grænse for dagens kalender er altså IKKE at
// løbene mangler — den er at kvoten er fast, så de mål der konkurrerer om den samme kvote
// ikke kan mættes samtidigt.** Denne kontrol kan bevise mangel; den kan ikke afgøre en
// prioritering mellem to mål, og den foregiver ikke at kunne det.
//
// REN FUNKTION. Ingen DB, ingen Date, ingen RNG, ingen skrivning. Input er kataloget som
// ren data (samme form som `race_pool`-rækkerne i
// `backend/lib/__fixtures__/racePoolCatalog.prod.json`). Kontrollen ændrer ALDRIG
// udvælgeren — den læser de samme konstanter som den.
//
// Se CALENDAR_RULES.md §5b1 for hvornår den skal køres.

import {
  TIER_TERRAIN_FAMILY_MIN,
  TIER_TERRAIN_FAMILY_MAX,
  TERRAIN_FAMILIES,
  TERRAIN_FAMILY_BY_PROFILE_TYPE,
  CLASS_STAGE_LENGTH_BAND,
  TIER_ARCHETYPE_RESERVATIONS,
} from "./tierCalendarGuarantees.js";
import {
  TIER_CLASS_WHITELIST,
  GRAND_TOUR_MIN_STAGES,
} from "./tierRaceSelection.js";
import {
  ARCHETYPE_PROFILES,
  timeTrialCap,
  isTimeTrial,
} from "./raceStageProfileGenerator.js";
import {
  compositionCategory,
  ACTIVE_TARGET,
  COMPOSITION_TOLERANCE_PP,
  TIER_UNIFORM_TARGET_CATEGORIES,
  TIER_UNIFORM_TARGET_FRACTIONS,
  TIER_UNIFORM_TOLERANCE_PP,
} from "./calendarCompositionTargets.js";
import { TIER_DENSITY } from "./calendarTierCaps.js";

export const SUPPLY_TIERS = Object.freeze([1, 2, 3, 4]);

// Kvoten er density × løbsdatoer (CALENDAR_RULES.md §1b — `TIER_GAME_DAY_QUOTA` er en
// forældet default fra dengang sæsonen var 28 dage og må IKKE bruges som facit). Den
// udregnes her af de samme to kilder reglen peger på, så kontrollen aldrig kan komme til at
// måle mod en anden kvote end den kalenderen faktisk bygges mod.
export function quotasForRaceDays(raceDays, density = TIER_DENSITY) {
  const days = Math.max(0, Math.floor(Number(raceDays) || 0));
  return Object.freeze(Object.fromEntries(SUPPLY_TIERS.map((t) => [t, (density[t] ?? 0) * days])));
}

// Sæson 4's ramme (§2, ejer-låst 3/9): 28 løbsdatoer. Kaldere der undersøger en ANDEN
// sæson skal sende deres eget tal — kvoten arves ikke (§2d).
export const SUPPLY_DEFAULT_RACE_DAYS = 28;

// ── Generatorens generiske fald-tilbage-vægte, SPEJLET ─────────────────────────────────
//
// `SINGLE_PROFILE_WEIGHTS` og `STAGE_FILLER_WEIGHTS` er modul-private i
// raceStageProfileGenerator.js. De spejles her i stedet for at eksportere dem, så denne
// kontrol ikke ændrer en fil den kun læser. Spejlet er IKKE en antagelse der lever
// ubevogtet: `catalogSupplyCheck.test.js` kører den rigtige generator mod et katalog-løb
// uden kendt arketype over mange seeds og fælder testen hvis generatoren producerer en
// profiltype der ikke står her. Kataloget har i dag 0 løb uden arketype, så stien er ren
// robusthed — men det er præcis den slags stille hul §5 allerede har betalt for tre gange
// (`rolling`, `classic`, `itt_hilly`).
const GENERIC_SINGLE_PROFILES = Object.freeze(["flat", "hilly", "rolling", "cobbles", "classic", "mountain"]);
const GENERIC_STAGE_FILLER_PROFILES = Object.freeze(["flat", "rolling", "hilly", "mountain", "high_mountain"]);
// buildStageRaceGeneric garanterer flad + bjerg, og TILFØJER en enkeltstart med 70 %
// sandsynlighed når løbet har mindst 5 etaper. Loftet regner med at den falder ud; bunden
// regner med at den ikke gør.
const GENERIC_STAGE_GUARANTEES = Object.freeze(["flat", "mountain"]);
const GENERIC_STAGE_OPTIONAL_ITT_MIN_STAGES = 5;

export {
  GENERIC_SINGLE_PROFILES,
  GENERIC_STAGE_FILLER_PROFILES,
  GENERIC_STAGE_GUARANTEES,
  GENERIC_STAGE_OPTIONAL_ITT_MIN_STAGES,
};

const stagesOf = (r) => Math.max(1, Math.floor(Number(r?.stages) || 1));
const isStageRace = (r) => r?.race_type === "stage_race";
const effectiveStages = (r) => (isStageRace(r) ? Math.max(2, stagesOf(r)) : 1);

/**
 * Hvor mange etaper af ÉN kategori kan / skal dette løb bidrage med?
 *
 * Returnerer `{ min, max }` — et lukket interval over alle mulige RNG-udfald af
 * `generateRaceStageProfiles` for løbet. `max` er loftet der bærer hele denne fils dom:
 * ingen seed kan give mere end `max`, så et mål der kræver mere end summen af `max` er
 * bevisligt uopnåeligt.
 *
 * @param {{race_type?:string, stages?:number, terrain_archetype?:string}} race
 * @param {(profileType:string)=>boolean} inCategory prædikat på generatorens profiltype
 * @param {{archetypeProfiles?:object}} [opts]
 * @returns {{min:number, max:number}}
 */
export function raceCategoryYieldBounds(race, inCategory, { archetypeProfiles = ARCHETYPE_PROFILES } = {}) {
  const stages = effectiveStages(race);
  const cfg = archetypeProfiles?.[race?.terrain_archetype] ?? null;

  // Endagsløb: ÉN etape, trukket fra arketypens faste vægte (eller de generiske).
  if (!isStageRace(race)) {
    const values = cfg?.kind === "single"
      ? cfg.weights.filter((w) => w.weight > 0).map((w) => w.value)
      : GENERIC_SINGLE_PROFILES;
    const anyHit = values.some((v) => inCategory(v));
    const allHit = values.length > 0 && values.every((v) => inCategory(v));
    return { min: allHit ? 1 : 0, max: anyHit ? 1 : 0 };
  }

  // Etapeløb, kendt arketype: garantier (trimmet til etapeantallet) + filler på resten.
  if (cfg?.kind === "stage") {
    const guarantees = cfg.guarantees.slice(0, stages);
    const remaining = Math.max(0, stages - guarantees.length);
    const fillerValues = cfg.filler.filter((w) => w.weight > 0).map((w) => w.value);
    const guaranteed = guarantees.filter((g) => inCategory(g)).length;
    const fillerAnyHit = fillerValues.some((v) => inCategory(v));
    const fillerAllHit = fillerValues.length > 0 && fillerValues.every((v) => inCategory(v));
    let max = guaranteed + (fillerAnyHit ? remaining : 0);
    const min = guaranteed + (fillerAllHit ? remaining : 0);
    max = clampTimeTrialCategory({ max, inCategory, guarantees, stages });
    return { min, max };
  }

  // Etapeløb uden kendt arketype → generatorens generiske sti.
  const guaranteed = GENERIC_STAGE_GUARANTEES.filter((g) => inCategory(g)).length;
  const optionalItt = stages >= GENERIC_STAGE_OPTIONAL_ITT_MIN_STAGES && inCategory("itt") ? 1 : 0;
  const remaining = Math.max(0, stages - GENERIC_STAGE_GUARANTEES.length);
  const fillerAnyHit = GENERIC_STAGE_FILLER_PROFILES.some((v) => inCategory(v));
  // Loftet overvurderer bevidst: den optionelle enkeltstart og alle filler-pladser tælles
  // med samtidigt, selv om enkeltstarten i praksis ville spise en af pladserne.
  const max = guaranteed + optionalItt + (fillerAnyHit ? remaining : 0);
  const fillerAllHit = GENERIC_STAGE_FILLER_PROFILES.every((v) => inCategory(v));
  const min = guaranteed + (fillerAllHit ? remaining : 0);
  return { min, max };
}

// #2029/#4539: et etapeløb må højst have `timeTrialCap()` tidskørsler — filler-tilføjede
// TT ud over loftet re-rulles til ikke-TT-terræn. Består kategorien UDELUKKENDE af
// tidskørsels-profiler (§5's `itt`-familie og §6/§6b's `itt`-kategori gør begge dét), er
// loftet dermed hårdt, uanset hvor mange filler-pladser løbet har.
function clampTimeTrialCategory({ max, inCategory, guarantees, stages }) {
  const categoryIsAllTimeTrial = ["itt", "itt_hilly", "ttt"].some((t) => inCategory(t))
    && !["flat", "rolling", "hilly", "classic", "cobbles", "gravel", "mountain", "high_mountain"].some((t) => inCategory(t));
  if (!categoryIsAllTimeTrial) return max;
  const cap = timeTrialCap(guarantees.filter(isTimeTrial), stages);
  return Math.min(max, cap);
}

// ── Mål-kataloget ──────────────────────────────────────────────────────────────────────
//
// Hvert mål oversættes til ét spørgsmål: "hvor mange ETAPER af denne kategori skal
// divisionen have, og hvor mange KAN den få?". Andels-mål omregnes til et etape-krav med
// divisionens egen kvote som nævner (samme nævner som §6/§6b bruger), så alle mål kan
// sammenlignes og summeres i den krydsdivisionelle dom.

const familyPredicate = (family) => (profileType) => TERRAIN_FAMILY_BY_PROFILE_TYPE[profileType] === family;
const compositionPredicate = (category) => (profileType) => compositionCategory(profileType) === category;
const UNIFORM_PREDICATES = Object.freeze({
  // Samme gruppering som computeUniformTierStats (#4103/#4105) — ikke familie-tabellens.
  itt: (p) => p === "itt" || p === "itt_hilly",
  cobbles: (p) => p === "cobbles" || p === "gravel",
  high_mountain: (p) => p === "high_mountain",
});

/**
 * Alle de mål forsynings-kontrollen dømmer. `kind`:
 *   "floor" — et minimum i ANTAL ETAPER (§5's terræn-familie-gulve)
 *   "cap"   — et maksimum i antal etaper (§5's rolling-loft)
 *   "share" — en andel af divisionens egne etaper, med tolerance i procentpoint
 *             (§6's K-B-profil og §6b's tre uniforme mål)
 */
export function buildSupplyGoals({
  terrainFamilyMin = TIER_TERRAIN_FAMILY_MIN,
  terrainFamilyMax = TIER_TERRAIN_FAMILY_MAX,
  compositionTarget = ACTIVE_TARGET,
  compositionTolerancePp = COMPOSITION_TOLERANCE_PP,
  uniformCategories = TIER_UNIFORM_TARGET_CATEGORIES,
  uniformFractions = TIER_UNIFORM_TARGET_FRACTIONS,
  uniformTolerancePp = TIER_UNIFORM_TOLERANCE_PP,
} = {}) {
  const goals = [];

  for (const family of TERRAIN_FAMILIES) {
    goals.push({
      id: `family:${family}`,
      kind: "floor",
      rule: "§5",
      label: `terræn-familie "${family}" — gulv`,
      inCategory: familyPredicate(family),
      requirementFor: (tier) => terrainFamilyMin?.[tier]?.[family] ?? null,
    });
    const cap = Object.values(terrainFamilyMax ?? {}).some((m) => m?.[family] != null);
    if (cap) {
      goals.push({
        id: `family:${family}:max`,
        kind: "cap",
        rule: "§5",
        label: `terræn-familie "${family}" — loft`,
        inCategory: familyPredicate(family),
        requirementFor: (tier) => terrainFamilyMax?.[tier]?.[family] ?? null,
      });
    }
  }

  for (const category of uniformCategories) {
    goals.push({
      id: `uniform:${category}`,
      kind: "share",
      rule: "§6b",
      label: `uniformt mål "${category}"`,
      inCategory: UNIFORM_PREDICATES[category] ?? compositionPredicate(category),
      targetPct: (uniformFractions?.[category] ?? 0) * 100,
      tolerancePp: uniformTolerancePp,
    });
  }

  for (const [category, targetPct] of Object.entries(compositionTarget ?? {})) {
    if (!(targetPct > 0)) continue; // TTT står på 0 % — motoren scorer den ikke endnu (§6)
    goals.push({
      id: `kb:${category}`,
      kind: "share",
      rule: "§6",
      label: `komposition "${category}"`,
      inCategory: compositionPredicate(category),
      targetPct,
      tolerancePp: compositionTolerancePp,
    });
  }

  return goals;
}

// Andels-mål → etape-krav. Nedre krav rundes OP (divisionen skal over gulvet), øvre
// tolerance rundes NED. Et krav på 0 betyder at målet ikke kan brydes nedad.
function requirementForGoal(goal, tier, quota) {
  if (goal.kind === "floor" || goal.kind === "cap") return goal.requirementFor(tier);
  const lowPct = Math.max(0, goal.targetPct - goal.tolerancePp);
  return Math.ceil((lowPct / 100) * quota);
}

function toleranceCeilingForGoal(goal, quota) {
  if (goal.kind !== "share") return null;
  const highPct = goal.targetPct + goal.tolerancePp;
  return Math.floor((highPct / 100) * quota);
}

// ── Divisionens klasse-vindue ──────────────────────────────────────────────────────────

/**
 * De løb en division overhovedet kan vælge imellem: klasse-whitelisten (#2276),
 * klasse↔etapeantal-båndet (#3328/#4270) og Grand Tour-porten (#2251). Præcis de tre
 * filtre `selectTierRaceSet` selv lægger på, og ingen flere — alt derudover er valg, ikke
 * forsyning.
 */
export function classWindowFor(tier, catalog, {
  classWhitelist = TIER_CLASS_WHITELIST,
  classStageLengthBand = CLASS_STAGE_LENGTH_BAND,
  grandTourMinStages = GRAND_TOUR_MIN_STAGES,
} = {}) {
  const allowed = classWhitelist?.[tier];
  const allowedSet = Array.isArray(allowed) ? new Set(allowed) : null;
  return catalog.filter((r) => {
    const st = effectiveStages(r);
    if (tier !== 1 && st >= grandTourMinStages) return false;
    if (allowedSet && !allowedSet.has(r.race_class)) return false;
    if (classStageLengthBand && st >= 2) {
      const band = classStageLengthBand[r.race_class];
      if (band && (st < band[0] || st > band[1])) return false;
    }
    return true;
  });
}

// ── Eksakt knapsack mod den præcise kvote (§1b) ────────────────────────────────────────
//
// Kvoten skal rammes EKSAKT (ejer-beslutning 3/9, #4270 — hård gate uden override), så
// loftet søges over delmængder hvis etapeantal summer til PRÆCIS kvoten. Det er en
// 0/1-knapsack med eksakt vægt: DP over etape-totalen, O(løb × kvote).
//
// `reachable === false` betyder at kataloget ikke engang kan RAMME kvoten i den division —
// et fund i sin egen ret, og alvorligere end et enkelt brudt terræn-mål.
function exactQuotaExtreme(rows, quota, direction) {
  const NONE = direction === "max" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const dp = new Array(quota + 1).fill(NONE);
  dp[0] = 0;
  for (const row of rows) {
    const w = row.stages;
    if (w > quota) continue;
    for (let t = quota; t >= w; t--) {
      const prev = dp[t - w];
      if (prev === NONE) continue;
      const cand = prev + row.value;
      if (direction === "max" ? cand > dp[t] : cand < dp[t]) dp[t] = cand;
    }
  }
  return dp[quota] === NONE ? null : dp[quota];
}

// ── Kontrollen ─────────────────────────────────────────────────────────────────────────

/**
 * Forsynings-kontrol for ét katalog.
 *
 * @param {{
 *   catalog: Array<{id:string, name?:string, race_class:string, race_type:string, stages:number, terrain_archetype:string}>,
 *   raceDays?: number, quotas?: object, tiers?: number[], goals?: Array<object>,
 *   classWhitelist?: object, classStageLengthBand?: object, archetypeProfiles?: object
 * }} args
 * @returns {{ quotas:object, rows:Array<object>, findings:Array<object>, quotaReachable:object }}
 */
export function checkCatalogSupply({
  catalog = [],
  raceDays = SUPPLY_DEFAULT_RACE_DAYS,
  quotas = null,
  tiers = SUPPLY_TIERS,
  goals = null,
  classWhitelist = TIER_CLASS_WHITELIST,
  classStageLengthBand = CLASS_STAGE_LENGTH_BAND,
  archetypeProfiles = ARCHETYPE_PROFILES,
} = {}) {
  const effectiveQuotas = quotas ?? quotasForRaceDays(raceDays);
  const effectiveGoals = goals ?? buildSupplyGoals();

  const windows = new Map(
    tiers.map((tier) => [tier, classWindowFor(tier, catalog, { classWhitelist, classStageLengthBand })])
  );

  const quotaReachable = {};
  for (const tier of tiers) {
    const rows = windows.get(tier).map((r) => ({ stages: effectiveStages(r), value: 0 }));
    quotaReachable[tier] = exactQuotaExtreme(rows, effectiveQuotas[tier] ?? 0, "max") !== null;
  }

  const rows = [];
  for (const goal of effectiveGoals) {
    // Forsyningen pr. løb regnes ÉN gang pr. mål og genbruges i både divisions-loftet og
    // den krydsdivisionelle dom, så de to aldrig kan blive uenige om samme løb.
    const boundsById = new Map();
    for (const race of catalog) {
      boundsById.set(race.id, raceCategoryYieldBounds(race, goal.inCategory, { archetypeProfiles }));
    }

    const perTier = new Map();
    for (const tier of tiers) {
      const quota = effectiveQuotas[tier] ?? 0;
      const requirement = requirementForGoal(goal, tier, quota);
      if (requirement == null) continue;
      const window = windows.get(tier);
      const maxRows = window.map((r) => ({ stages: effectiveStages(r), value: boundsById.get(r.id).max }));
      const minRows = window.map((r) => ({ stages: effectiveStages(r), value: boundsById.get(r.id).min }));
      const best = exactQuotaExtreme(maxRows, quota, "max");
      const bestGuaranteed = exactQuotaExtreme(minRows, quota, "max");
      const worst = exactQuotaExtreme(minRows, quota, "min");
      perTier.set(tier, {
        tier, goalId: goal.id, rule: goal.rule, kind: goal.kind, label: goal.label,
        quota, requirement, toleranceCeiling: toleranceCeilingForGoal(goal, quota),
        bestAchievable: best, bestGuaranteed, worstAchievable: worst,
        supplyInWindow: window.reduce((s, r) => s + boundsById.get(r.id).max, 0),
        missingSources: missingSourcesFor(window, boundsById, catalog),
      });
    }

    const shared = evaluateSharedSupply({ goal, tiers, windows, boundsById, perTier });
    for (const tier of tiers) {
      const row = perTier.get(tier);
      if (!row) continue;
      rows.push({ ...row, contestedWith: shared.get(tier) ?? null, verdict: verdictFor(row, shared.get(tier) ?? null) });
    }
  }

  const reservations = checkReservationSupply({ tiers, windows });
  const findings = [
    ...rows.filter((r) => r.verdict !== "reachable"),
    ...reservations.filter((r) => r.verdict !== "reachable"),
  ];
  return { quotas: effectiveQuotas, raceDays, rows, reservations, findings, quotaReachable };
}

/**
 * §5's arketype-reservationer er den ENESTE del af udvælgelsen der er deterministisk: hver
 * division tager et fast antal løb af bestemte arketyper FØR prestige-walket. Reservationen
 * er også den knap der har svigtet tre gange, altid af samme grund — en højere division
 * støvsugede den forsyning en lavere division skulle bruge (#4075: D1's cobbled_tour;
 * #3469: D2 sultede D4's cobbled_tour og D1/D2 tømte D3's cobbled_classic). Den kontrol
 * hører hjemme her, fordi den kan afgøres på kataloget alene.
 *
 * To domme pr. arketype:
 *   · pr. division — findes der overhovedet nok løb af arketypen i divisionens klasse-vindue?
 *   · pr. gruppe af divisioner — kan foreningen af deres vinduer bære gruppens samlede
 *     reservation? Et løb kan kun ligge i én division (#2276), så er den sum for lille, er
 *     det bevist at mindst én divisions reservation ikke kan opfyldes.
 */
export function checkReservationSupply({
  tiers = SUPPLY_TIERS,
  windows,
  reservations = TIER_ARCHETYPE_RESERVATIONS,
} = {}) {
  const archetypes = [...new Set(Object.values(reservations ?? {}).flatMap((cfg) => Object.keys(cfg ?? {})))].sort();
  const out = [];
  for (const archetype of archetypes) {
    const demandOf = (tier) => Math.max(0, Number(reservations?.[tier]?.[archetype]) || 0);
    const inWindow = new Map(tiers.map((t) => [t, windows.get(t).filter((r) => r.terrain_archetype === archetype)]));

    const contested = new Map();
    const candidates = tiers.filter((t) => demandOf(t) > 0);
    for (let mask = 1; mask < (1 << candidates.length); mask++) {
      const group = candidates.filter((_, i) => mask & (1 << i));
      if (group.length < 2) continue;
      const union = new Set();
      for (const tier of group) for (const race of inWindow.get(tier)) union.add(race.id);
      const demand = group.reduce((s, t) => s + demandOf(t), 0);
      if (union.size >= demand) continue;
      for (const tier of group) {
        const prev = contested.get(tier);
        if (prev && prev.group.length >= group.length) continue;
        contested.set(tier, { group, supply: union.size, demand, shortfall: demand - union.size });
      }
    }

    for (const tier of tiers) {
      const demand = demandOf(tier);
      if (demand <= 0) continue;
      const supply = inWindow.get(tier).length;
      const share = contested.get(tier) ?? null;
      out.push({
        tier, goalId: `reservation:${archetype}`, rule: "§5", kind: "reservation",
        label: `arketype-reservation "${archetype}"`,
        requirement: demand, supplyInWindow: supply, contestedWith: share,
        verdict: supply < demand ? "impossible" : (share ? "contested" : "reachable"),
      });
    }
  }
  return out;
}

/**
 * Den krydsdivisionelle dom — en ÆGTE nødvendig betingelse, ikke et loft.
 *
 * Et løb kan kun ligge i ÉN division i samme sæson (cross-tier dedup, #2276). For enhver
 * gruppe af divisioner gælder derfor: den samlede forsyning i FORENINGEN af deres
 * klasse-vinduer skal mindst dække gruppens samlede krav. Er den sum mindre, er det
 * bevist at ikke alle divisioner i gruppen kan nå målet — uanset hvem der vælger først,
 * og uanset hvor godt udvælgeren fungerer.
 *
 * Med fire divisioner er der 11 grupper på to eller flere at afprøve; vi går dem alle
 * igennem og markerer hver division i den STØRSTE brudte gruppe, så meldingen bliver
 * "disse divisioner deler en forsyning der ikke kan mætte dem alle".
 */
export function evaluateSharedSupply({ goal, tiers, windows, boundsById, perTier }) {
  const contested = new Map();
  if (goal.kind === "cap") return contested; // et loft brydes af overflod, ikke af mangel

  const candidates = tiers.filter((t) => perTier.has(t) && (perTier.get(t).requirement ?? 0) > 0);
  for (let mask = 1; mask < (1 << candidates.length); mask++) {
    const group = candidates.filter((_, i) => mask & (1 << i));
    if (group.length < 2) continue;
    const union = new Map();
    for (const tier of group) {
      for (const race of windows.get(tier)) union.set(race.id, race);
    }
    let supply = 0;
    for (const race of union.values()) supply += boundsById.get(race.id).max;
    const demand = group.reduce((s, t) => s + perTier.get(t).requirement, 0);
    if (supply >= demand) continue;
    for (const tier of group) {
      const prev = contested.get(tier);
      if (prev && prev.group.length >= group.length) continue;
      contested.set(tier, { group, supply, demand, shortfall: demand - supply });
    }
  }
  return contested;
}

function verdictFor(row, contested) {
  if (row.kind === "cap") {
    // Et loft kan kun være uopnåeligt hvis selv det MINDSTE udfald ligger over det.
    if (row.worstAchievable != null && row.requirement != null && row.worstAchievable > row.requirement) return "impossible";
    return "reachable";
  }
  if (row.bestAchievable == null) return "impossible"; // kvoten kan ikke engang rammes
  if (row.requirement != null && row.bestAchievable < row.requirement) return "impossible";
  if (contested) return "contested";
  // Loftet rækker, men kataloget garanterer det ikke: målet afhænger af at den tilfældige
  // filler falder ud til dets fordel. Ikke et brud — en skrøbelighed, og den slags der
  // først opdages når en regenerering taber dækningen (§5, D4's rullende terræn i S3).
  if (row.requirement != null && row.bestGuaranteed != null && row.bestGuaranteed < row.requirement) return "luck-dependent";
  return "reachable";
}

/**
 * Hvilke LØBSTYPER mangler? Arketyper er kalenderens egen vokabular for "hvilken slags løb"
 * (§5's reservationstabel bruger dem), og de er ikke løbsnavne — de kan derfor stå i et
 * offentligt repo. Vi rapporterer to ting: de arketyper der KUNNE bidrage til målet men
 * slet ikke findes i divisionens klasse-vindue, og dem der findes, med hvor meget de
 * højst kan levere.
 */
function missingSourcesFor(window, boundsById, catalog) {
  const inWindow = new Map();
  for (const race of window) {
    const y = boundsById.get(race.id).max;
    if (y <= 0) continue;
    const key = race.terrain_archetype ?? "(ingen arketype)";
    const cur = inWindow.get(key) ?? { archetype: key, races: 0, maxStages: 0 };
    cur.races += 1;
    cur.maxStages += y;
    inWindow.set(key, cur);
  }
  const absent = new Set();
  for (const race of catalog) {
    if (boundsById.get(race.id).max <= 0) continue;
    const key = race.terrain_archetype ?? "(ingen arketype)";
    if (!inWindow.has(key)) absent.add(key);
  }
  return {
    present: [...inWindow.values()].sort((a, b) => b.maxStages - a.maxStages || a.archetype.localeCompare(b.archetype)),
    absentFromWindow: [...absent].sort(),
  };
}

// ── FORVENTEDE AFVIGELSER ──────────────────────────────────────────────────────────────
//
// En kendt, navngivet og TIDSBEGRÆNSET afvigelse. Formålet er at CI er grøn i DAG uden at
// fundet bliver usynligt: bliver forsyningen VÆRRE, eller bliver et NYT mål umuligt, går
// testen rødt alligevel. `reviewBy` er en hård udløbsdato — passeres den uden at nogen har
// genmålt, fælder testen sig selv. Det er med vilje: en "midlertidig" undtagelse uden
// udløb er bare en regel ingen har skrevet ned.
//
// En afvigelse er IKKE en accept af tilstanden. Den lukkes ved at TILFØJE LØB til kataloget
// (CALENDAR_RULES.md §5b) — ikke ved at hæve `maxShortfall` og ikke ved at slække målet.
export const KNOWN_SUPPLY_DEVIATIONS = Object.freeze([
  Object.freeze({
    id: "5405-rolling-har-ingen-garanteret-kilde",
    issue: 5405,
    goalId: "family:rolling",
    tiers: Object.freeze([1, 2, 3, 4]),
    verdict: "luck-dependent",
    // Underskuddet er hele gulvet minus den garanterede forsyning. Vokser det, er
    // forsyningen blevet værre og testen går rødt. Tallet låses af testen mod den
    // committede fixture, så en katalog-ændring der forværrer det ikke kan slippe igennem.
    reviewBy: "2026-12-01",
    note: "INGEN arketype garanterer en rullende etape — `rolling` kommer udelukkende fra "
      + "filler-vægte (ARCHETYPE_PROFILES). Gulvet i §5 kan derfor kun nås hvis det "
      + "tilfældige filler-træk spiller med, i alle fire divisioner. Det er ikke en "
      + "hypotese: målt i sæson 3 leverede Division 4 NUL rullende etaper, og ingen gate "
      + "sagde fra (§5). Lukkes af en arketype med en rullende garanti eller af §6b's "
      + "genkalibrering af filler-vægtene pr. division (S5-opgaven i §6b) — ikke ved at "
      + "sænke gulvet.",
  }),
]);

/**
 * Hold fundene op mod de kendte afvigelser.
 *
 * @returns {{ unexpected:Array, expected:Array, expired:Array, worsened:Array }}
 */
export function classifySupplyFindings(findings, {
  deviations = KNOWN_SUPPLY_DEVIATIONS,
  today = null,
  shortfallLimits = null,
} = {}) {
  const unexpected = [];
  const expected = [];
  const worsened = [];
  const expired = [];

  for (const dev of deviations) {
    if (today && dev.reviewBy && today > dev.reviewBy) expired.push(dev);
  }

  for (const finding of findings) {
    const dev = deviations.find((d) => d.goalId === finding.goalId
      && d.verdict === finding.verdict
      && d.tiers.includes(finding.tier));
    if (!dev) { unexpected.push(finding); continue; }
    expected.push({ finding, deviation: dev });
    const limit = shortfallLimits?.[`${dev.id}:${finding.tier}`] ?? dev.maxShortfall;
    const actual = shortfallOf(finding);
    if (limit != null && actual != null && actual > limit) {
      worsened.push({ finding, deviation: dev, limit, actual });
    }
  }
  return { unexpected, expected, expired, worsened };
}

/**
 * Hvor meget mangler der? Altid i ETAPER (eller i LØB for en reservation), aldrig i
 * procentpoint — et heltal er nemmere at låse i en test og at følge over tid.
 */
export function shortfallOf(finding) {
  if (finding.verdict === "contested") return finding.contestedWith?.shortfall ?? null;
  if (finding.verdict === "luck-dependent") {
    if (finding.bestGuaranteed == null || finding.requirement == null) return null;
    return finding.requirement - finding.bestGuaranteed;
  }
  if (finding.verdict !== "impossible") return null;
  if (finding.kind === "reservation") {
    if (finding.supplyInWindow == null || finding.requirement == null) return null;
    return finding.requirement - finding.supplyInWindow;
  }
  if (finding.kind === "cap") {
    if (finding.worstAchievable == null || finding.requirement == null) return null;
    return finding.worstAchievable - finding.requirement;
  }
  if (finding.bestAchievable == null || finding.requirement == null) return null;
  return finding.requirement - finding.bestAchievable;
}

export const VERDICT_LABELS = Object.freeze({
  reachable: "kan nås",
  "luck-dependent": "kan kun nås hvis det tilfældige filler-træk spiller med",
  contested: "kan kun nås på bekostning af en anden division",
  impossible: "kan ikke nås",
});

// Domme der ALTID skal fælde en test, uanset om nogen har skrevet en afvigelse for dem.
// En ny umulighed eller en ny bestridt gruppe er ikke noget nogen må registrere sig ud af —
// den skal lukkes ved at tilføje løb til kataloget (§5b).
export const BLOCKING_VERDICTS = Object.freeze(["impossible", "contested"]);
