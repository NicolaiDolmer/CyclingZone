// #6110 / #8521: potentiale P (1-99), omregnet fra stjerner og trukket for akademiet.
//
// Spec: docs/superpowers/specs/2026-11-20-6110-potentiale-p-og-udvikling-g3a-design.md
// §2 (Potentiale P) og §6.2 (byggeplanens trin 2).
//
// P er den rating for rytterens bedste ryttertype, vi forventer han ender på. Den er
// fast fra fødslen og gemmes i riders.base_talent (og riders.talent_ceiling, som har
// samme tal, fordi loftet ikke længere lever sit eget liv).
//
// ═══ OMREGNINGEN (stjerner -> P) ═════════════════════════════════════════════
//  - Hvert halve stjernetrin (1-6) har sit eget ankerinterval på 1-99-skalaen.
//    Intervallerne ligger i stigende orden og overlapper ikke, så en rytter med flere
//    stjerner aldrig får lavere P end en med færre (rækkefølgen bevares).
//  - Inden for et trin spredes rytterne jævnt over intervallet i en fast rækkefølge,
//    der kun afhænger af rytter-id (ikke af den rækkefølge rækkerne kommer i).
//  - Hvor toppen presses ned, er en egenskab ved de private ankre, ikke ved koden.
//  - Står rytterens rating for bedste type over hans nye P, hæves P til ratingen.
//    Ingen rating ændres: funktionen læser kun ratingen.
//
// ═══ AKADEMIET (søndagens årgang) ════════════════════════════════════════════
//  Stjernerne trækkes som i dag, men vægten for hvert halve trin ganges med en privat
//  faktor, så tilgangen får samme fordeling som bestanden. P trækkes derefter jævnt i
//  trinnets ankerinterval. Det sker kun bag XP-kontakten (loadAcademyPotentialP);
//  slukket er akademiet bit-identisk med i dag.
//
// ═══ TALLENE ═════════════════════════════════════════════════════════════════
//  Ankerintervallerne og faktorerne er PRIVATE (hard rule 17). Der findes med vilje
//  ingen standardværdier her. Dry-runnet læser dem fra en lokal privat fil; akademiet
//  læser dem fra private_config (nøglen POTENTIAL_P_PARAMS_KEY). Testene bruger en
//  fixture med opdigtede tal.

// Ingen statiske imports: modulet er rent, og akademi-generatoren (og dens sim-scripts)
// importerer det. Kontakt- og private_config-læserne hentes først i loadAcademyPotentialP.

/** Skalaens ender. Strukturelle, ikke kalibrering. */
export const P_MIN = 1;
export const P_MAX = 99;

/** Stjerneskalaen: 1-6 i halve trin (strukturel definition). */
export const STAR_STEPS = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);

/** Nøglen i private_config for P-parametrene. */
export const POTENTIAL_P_PARAMS_KEY = "potential_p_params";

const LOG_TAG = "[potential-p]";

/**
 * @typedef {object} PotentialPParams
 * @property {Record<string, [number, number]>} anchors  ankerinterval [lo, hi] pr. halvt trin (nøgle "1", "1.5", ... "6")
 * @property {Record<string, number>} [academyFactors]  akademiets faktor pr. halvt trin (samme nøgler)
 */

/** @param {number} stars */
export function starKey(stars) {
  return String(stars);
}

/** @param {unknown} v @returns {v is number} */
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Afviser params der ikke kan give en rangbevarende omregning. Kaster med en
 * værdi-fri besked. Ingen værdi gættes eller udfyldes.
 * @param {unknown} raw
 * @returns {PotentialPParams}
 */
export function validatePotentialPParams(raw) {
  if (!raw || typeof raw !== "object") throw new Error("potentialP: params missing");
  const params = /** @type {any} */ (raw);
  const anchors = params.anchors;
  if (!anchors || typeof anchors !== "object") throw new Error("potentialP: anchors missing");
  let prevHi = -Infinity;
  for (const step of STAR_STEPS) {
    const a = anchors[starKey(step)];
    if (!Array.isArray(a) || a.length !== 2) throw new Error(`potentialP: anchors missing step ${step}`);
    const [lo, hi] = a;
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < P_MIN || hi > P_MAX || lo > hi) {
      throw new Error(`potentialP: anchors for ${step} must be integers with ${P_MIN} <= lo <= hi <= ${P_MAX}`);
    }
    // Rangbevarelse: et trin må aldrig nå under trinnet før.
    if (lo < prevHi) throw new Error(`potentialP: anchors for ${step} overlap the step below (order would flip)`);
    prevHi = hi;
  }
  if (params.academyFactors !== undefined) {
    const f = params.academyFactors;
    if (!f || typeof f !== "object") throw new Error("potentialP: academyFactors must be an object");
    let positive = 0;
    for (const step of STAR_STEPS) {
      const v = f[starKey(step)];
      if (!isFiniteNumber(v) || v < 0) throw new Error(`potentialP: academyFactors for ${step} must be a number >= 0`);
      if (v > 0) positive++;
    }
    if (positive === 0) throw new Error("potentialP: at least one academyFactor must be above 0");
  }
  return params;
}

/** @param {PotentialPParams} params @param {number} stars @returns {[number, number]} */
export function anchorFor(params, stars) {
  return params.anchors[starKey(stars)];
}

// ── Deterministisk rækkefølge ──────────────────────────────────────────────

/** FNV-1a til [0,1). Samme hash som potentialeScale99.idHashUnit. */
export function idHashUnit(key) {
  const s = String(key ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** @param {{id: string, potentiale: number}} a @param {{id: string, potentiale: number}} b */
function compareRank(a, b) {
  return (
    a.potentiale - b.potentiale ||
    idHashUnit(a.id) - idHashUnit(b.id) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ── Omregning ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} StarsInput
 * @property {string} id
 * @property {number|null|undefined} potentiale  stjerner (1-6 i halve trin)
 * @property {number|null|undefined} [rating]    rytterens rating for bedste type lige nu
 */

/**
 * @typedef {object} ConvertedP
 * @property {number} p        endeligt P (efter evt. hævning til ratingen)
 * @property {number} pBase    P fra ankrene alene
 * @property {number} stars
 * @property {number|null} rating
 * @property {boolean} lifted  true når P blev hævet til ratingen
 */

/**
 * Rang-ordnet jævn spredning over [lo, hi] via (i + 0,5)/n-kvantiler. Afrunding er
 * monoton, så rækkefølgen bevares; resultatet bliver aldrig uden for intervallet.
 * @param {number} i @param {number} n @param {number} lo @param {number} hi
 */
function spreadValue(i, n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(lo + ((i + 0.5) / n) * (hi - lo))));
}

/**
 * Omregner stjerner til P for en hel bestand. Ren: ingen DB, ingen fil-I/O, ingen tid.
 * @param {StarsInput[]} riders
 * @param {PotentialPParams} params
 * @returns {{ byId: Map<string, ConvertedP>, skipped: { id: string, reason: "invalid_potentiale" }[] }}
 */
export function convertStarsToP(riders, params) {
  validatePotentialPParams(params);
  /** @type {Map<string, ConvertedP>} */
  const byId = new Map();
  /** @type {{ id: string, reason: "invalid_potentiale" }[]} */
  const skipped = [];
  /** @type {Map<number, {id: string, potentiale: number, rating: number|null}[]>} */
  const byStep = new Map(STAR_STEPS.map((s) => [s, []]));
  const seen = new Set();
  for (const r of riders) {
    if (seen.has(r.id)) throw new Error(`potentialP: duplicate rider id (${r.id})`);
    seen.add(r.id);
    const stars = Number(r.potentiale);
    const bucket = r.potentiale == null ? undefined : byStep.get(stars);
    if (!bucket) { skipped.push({ id: r.id, reason: "invalid_potentiale" }); continue; }
    const rating = isFiniteNumber(r.rating) ? r.rating : null;
    bucket.push({ id: r.id, potentiale: stars, rating });
  }
  for (const step of STAR_STEPS) {
    const group = /** @type {{id: string, potentiale: number, rating: number|null}[]} */ (byStep.get(step)).sort(compareRank);
    const [lo, hi] = anchorFor(params, step);
    group.forEach((r, i) => {
      const pBase = spreadValue(i, group.length, lo, hi);
      const ratingP = r.rating == null ? null : Math.max(P_MIN, Math.min(P_MAX, Math.round(r.rating)));
      const lifted = ratingP != null && ratingP > pBase;
      byId.set(r.id, { p: lifted ? /** @type {number} */ (ratingP) : pBase, pBase, stars: step, rating: r.rating, lifted });
    });
  }
  return { byId, skipped };
}

/**
 * Kontrol, ikke antagelse: gået igennem i rang-orden (stjerner, så id-hash) må P fra
 * ankrene aldrig falde. Hævningen til rating er bevidst undtaget (spec §2).
 * @param {Map<string, ConvertedP>} byId
 * @returns {{ prevId: string, curId: string }[]}
 */
export function findRankViolations(byId) {
  const rows = [...byId.entries()].map(([id, v]) => ({ id, potentiale: v.stars, pBase: v.pBase })).sort(compareRank);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].pBase < rows[i - 1].pBase) out.push({ prevId: rows[i - 1].id, curId: rows[i].id });
  }
  return out;
}

/**
 * Fordelingen af en liste P-værdier: antal, median, p90, p99, antal >= 80 og >= 90,
 * og et histogram pr. tier (1-9, 10-19, ... 90-99).
 * @param {number[]} values
 */
export function summarizeP(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  /** @param {number} q */
  const at = (q) => (n ? s[Math.min(n - 1, Math.floor(q * n))] : null);
  /** @type {Record<string, number>} */
  const histogram = {};
  for (let lo = 0; lo < 100; lo += 10) histogram[`${Math.max(P_MIN, lo)}-${lo + 9}`] = 0;
  for (const v of s) {
    const lo = Math.floor(v / 10) * 10;
    histogram[`${Math.max(P_MIN, lo)}-${lo + 9}`]++;
  }
  return {
    n,
    median: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    atOrAbove80: s.filter((v) => v >= 80).length,
    atOrAbove90: s.filter((v) => v >= 90).length,
    histogram,
  };
}

// ── Akademiet ──────────────────────────────────────────────────────────────

/**
 * Stjernetrækket med akademiets private faktorer ganget på dagens vægte. `baseWeights`
 * er dagens vægt pr. trin (samme rækkefølge som STAR_STEPS), så faktorer på 1 giver
 * dagens fordeling. minStars > 1 betinger trækket på trin >= minStars (bestyrelsens
 * garanterede talent).
 * @param {() => number} rng
 * @param {PotentialPParams} params
 * @param {readonly number[]} baseWeights
 * @param {number} [minStars]
 */
export function drawStarsWithFactors(rng, params, baseWeights, minStars = STAR_STEPS[0]) {
  const factors = params.academyFactors;
  if (!factors) throw new Error("potentialP: academyFactors missing (required by the academy)");
  const steps = [];
  let sum = 0;
  for (let k = 0; k < STAR_STEPS.length; k++) {
    if (STAR_STEPS[k] < minStars) continue;
    const w = baseWeights[k] * factors[starKey(STAR_STEPS[k])];
    if (w > 0) { steps.push({ k, w }); sum += w; }
  }
  if (!steps.length) return STAR_STEPS[STAR_STEPS.length - 1];
  let roll = rng() * sum;
  for (const { k, w } of steps) {
    roll -= w;
    if (roll <= 0) return STAR_STEPS[k];
  }
  return STAR_STEPS[steps[steps.length - 1].k];
}

/**
 * P trukket jævnt (heltal) i trinnets ankerinterval. Ét rng()-kald.
 * @param {() => number} rng
 * @param {PotentialPParams} params
 * @param {number} stars
 */
export function drawPForStars(rng, params, stars) {
  const anchor = anchorFor(params, stars);
  if (!anchor) throw new Error(`potentialP: no anchor interval for ${stars}`);
  const [lo, hi] = anchor;
  return Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1)));
}

/**
 * Akademiets P-params, når XP-kontakten er tændt og talfilen er gyldig og har
 * academyFactors. Ellers null = dagens akademi, bit-identisk. Logger aldrig tallene.
 * @param {{ supabase: { from(table: string): any }, log?: Pick<Console, "warn">, now?: () => number }} args
 * @returns {Promise<PotentialPParams|null>}
 */
export async function loadAcademyPotentialP({ supabase, log = console, now = Date.now }) {
  const { isDevelopmentXpEnabled } = await import("./developmentXpFlag.ts");
  if (!(await isDevelopmentXpEnabled(supabase))) return null;
  const { readPrivateConfigEntry } = await import("./privateConfig.ts");
  const entry = await readPrivateConfigEntry(supabase, POTENTIAL_P_PARAMS_KEY, {
    log, now, schema: validatePotentialPParams,
  });
  const params = entry.status === "ok" ? /** @type {PotentialPParams} */ (entry.value) : null;
  if (!params || !params.academyFactors) {
    log?.warn?.(`${LOG_TAG} development_xp_model is on, but ${POTENTIAL_P_PARAMS_KEY} is ${params ? "missing academyFactors" : entry.status} - academy keeps today's stars only`);
    return null;
  }
  return params;
}
