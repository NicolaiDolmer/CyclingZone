// Race Engine V1 (#676) — udled 0-99 game-abilities fra physiology.
//
// Ren, deterministisk. Reproducérbar fra rider_physiology_profiles + legacy soft-
// skills + formula_version. Formler forankret i ADR §"Ability derivation model".
//
// Skalering: PERCENTIL mod den nuværende rytter-pool (ADR-anbefaling) frem for
// hardcodede globale antagelser — så balancen overlever youth/fiktive/long-tail-
// ryttere. Pool bygges af buildAbilityPool() og injiceres, så funktionen forbliver
// ren + testbar. Hver formels vægte summerer til 1.0 og hver komponent er 0..1, så
// score = round(sum * 99) ∈ [0,99]. Med fast pool er hver ability monoton i sin
// primære physiology-driver (percentilen vokser når metrikken vokser).

export const FORMULA_VERSION = 1;

// Physiology-metrikker der percentil-skaleres. (Soft skills udledes direkte fra
// legacy 0-99 stats og percentil-skaleres ikke — de er allerede på spil-skalaen.)
export const POOL_METRICS = Object.freeze([
  "ftp_wkg", "ftp_watts", "power_5m_wkg", "power_5s_wkg", "power_15s_wkg",
  "power_1m_wkg", "pmax_watts", "zone2_power_wkg", "time_to_exhaustion_ftp_min",
  "high_intensity_energy_kj", "fatigue_resistance", "recovery_rate",
]);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const norm = (s) => clamp(s ?? 60, 0, 99) / 99;     // legacy 0-99 → 0..1 (neutral 60)
const score = (x) => clamp(Math.round(x * 99), 0, 99);

// Byg percentil-pool: ét sorteret array pr. metrik fra alle physiology-profiler.
export function buildAbilityPool(profiles = []) {
  const pool = {};
  for (const m of POOL_METRICS) {
    pool[m] = profiles
      .map((p) => Number(p[m]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  }
  return pool;
}

// Andel af pool-værdier ≤ value ∈ [0,1]. Monoton ikke-aftagende i value. Tom pool
// → 0.5 (neutral), så en enkelt rytter uden pool stadig får midter-abilities.
function percentile(sortedAsc, value) {
  if (!sortedAsc || sortedAsc.length === 0) return 0.5;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

// physiology: rider_physiology_profiles-række (eller seedet payload).
// riderRow:   legacy stat_*-felter (til soft skills) + weight som fallback.
// pool:       fra buildAbilityPool() — udelades → alle percentiler = 0.5.
export function deriveAbilities(physiology = {}, riderRow = {}, { pool } = {}) {
  const P = (m) => percentile(pool?.[m], Number(physiology[m]) || 0);

  // Soft skills (ikke physiology): udled fra legacy stats, ellers neutral via norm().
  const weight = Number(physiology.weight_kg) || Number(riderRow.weight) || 70;
  const weight_penalty = clamp((weight - 62) / (84 - 62), 0, 1); // 62kg→0, 84kg→1
  const lightness = 1 - weight_penalty;       // klatre-fordel for lette ryttere
  const weight_stability = weight_penalty;    // brosten-fordel for tunge ryttere
  const technical_skill = 0.5 * norm(riderRow.stat_bro) + 0.5 * norm(riderRow.stat_ned);
  const positioning = 0.5 * norm(riderRow.stat_ned) + 0.5 * norm(riderRow.stat_ftr);
  const tactics = 0.5 * norm(riderRow.stat_ftr) + 0.5 * norm(riderRow.stat_mod);
  const aero_proxy = norm(riderRow.stat_tt);

  return {
    rider_id: physiology.rider_id ?? riderRow.id,
    formula_version: FORMULA_VERSION,
    climbing:        score(0.50 * P("ftp_wkg") + 0.20 * P("power_5m_wkg") + 0.15 * P("fatigue_resistance") + 0.15 * lightness),
    time_trial:      score(0.30 * P("ftp_watts") + 0.25 * P("ftp_wkg") + 0.20 * P("time_to_exhaustion_ftp_min") + 0.15 * aero_proxy + 0.10 * positioning),
    sprint:          score(0.35 * P("pmax_watts") + 0.25 * P("power_5s_wkg") + 0.20 * P("power_15s_wkg") + 0.10 * positioning + 0.10 * P("recovery_rate")),
    punch:           score(0.35 * P("power_1m_wkg") + 0.25 * P("power_5m_wkg") + 0.20 * P("high_intensity_energy_kj") + 0.20 * P("recovery_rate")),
    endurance:       score(0.35 * P("zone2_power_wkg") + 0.30 * P("time_to_exhaustion_ftp_min") + 0.25 * P("fatigue_resistance") + 0.10 * P("recovery_rate")),
    cobble_classics: score(0.25 * P("ftp_watts") + 0.20 * P("power_1m_wkg") + 0.20 * P("fatigue_resistance") + 0.20 * technical_skill + 0.15 * weight_stability),
    acceleration:    score(0.60 * P("pmax_watts") + 0.40 * P("power_5s_wkg")),
    recovery:        score(0.60 * P("recovery_rate") + 0.40 * P("fatigue_resistance")),
    tactics:         score(tactics),
    positioning:     score(positioning),
  };
}
