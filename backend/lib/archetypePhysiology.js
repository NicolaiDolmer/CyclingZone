// Arketype-skæv fysiologi-seeding (Plan 2, #1122 — §0.1 Beslutning 4 "born-in
// specialisering"). Ren + deterministisk: samme (arketype, tier, krop, seed) →
// identisk profil. Ingen DB, ingen Math.random.
//
// Model: hver metric = lerp(eliteLow, eliteHigh, clamp01(tierBase + skew + støj)).
//   tierBase  styrer NIVEAUET (superstar ~0.9, domestique ~0.25).
//   skew      (PHYSIOLOGY_ARCHETYPES) former PROFILEN (hvilke metrics er høje).
//   støj      lille gaussian pr. metric (seeded), så ens arketyper ikke er kloner.
// Elite-ranges + monoton power-kurve genbrugt fra physiologySeeding.js (validerede
// mod prod). Vægt/højde kommer fra generatorens arketype (bmi×højde) → w/kg-vs-watt
// falder gratis ud (let climber = moderate watt; tung rouleur = høje watt).
//
// KOEFFICIENTERNE NEDENFOR ER KANDIDATER — tunes i race:gate-løkken (Task C1).

import { gaussian } from "./fictionalRiderGenerator.js";

export const PHYSIOLOGY_FORMULA_VERSION = 2; // rider_physiology_profiles.version for arketype-seedede

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n) => clamp(n, 0, 1);
const lerp = (lo, hi, t) => lo + (hi - lo) * clamp01(t);
const round = (x, dp) => { const f = 10 ** dp; return Math.round(x * f) / f; };

// Arketype-skew pr. metric-driver (additiv på tierBase-fraktionen, ~[-0.35,+0.35]).
// Drivere: aerob (ftp_wkg/vo2max/zone2/TTE), sprint_power (pmax/5s/15s),
// punch_power (1m/2m), vo2_ceiling (vo2max/10m), aero, durability (fatigue_res/HIE),
// recovery. Positiv = arketypens styrke; negativ = bevidst svaghed (specialisering ON).
export const PHYSIOLOGY_ARCHETYPES = Object.freeze({
  sprinter:       { aerob: -0.22, sprint_power: 0.62, punch_power: -0.14, vo2_ceiling: -0.18, aero: 0.06, durability: -0.12, recovery: 0.04 },
  leadout:        { aerob: -0.10, sprint_power: 0.04, punch_power: -0.06, vo2_ceiling: -0.10, aero: 0.10, durability: 0.10, recovery: 0.04 },
  tt:             { aerob: 0.12,  sprint_power: -0.34, punch_power: -0.20, vo2_ceiling: -0.08, aero: 0.44, durability: 0.12, recovery: 0.02 },
  climber:        { aerob: 0.30,  sprint_power: -0.38, punch_power: -0.24, vo2_ceiling: 0.34, aero: -0.20, durability: 0.06, recovery: 0.08 },
  puncheur:       { aerob: -0.04, sprint_power: -0.14, punch_power: 0.80, vo2_ceiling: 0.12, aero: -0.16, durability: -0.16, recovery: 0.04 },
  brostensrytter: { aerob: -0.10, sprint_power: -0.20, punch_power: 0.08, vo2_ceiling: -0.22, aero: -0.10, durability: 0.30, recovery: 0.02 },
  baroudeur:      { aerob: 0.10,  sprint_power: -0.16, punch_power: 0.00, vo2_ceiling: 0.06, aero: -0.10, durability: 0.26, recovery: 0.12 },
  rouleur:        { aerob: 0.10,  sprint_power: -0.22, punch_power: -0.10, vo2_ceiling: -0.12, aero: 0.14, durability: 0.12, recovery: 0.04 },
  gc:             { aerob: 0.26,  sprint_power: -0.34, punch_power: -0.22, vo2_ceiling: 0.32, aero: 0.14, durability: 0.16, recovery: 0.16 },
});

const SKEW_DEFAULT = Object.freeze({ aerob: 0, sprint_power: 0, punch_power: 0, vo2_ceiling: 0, aero: 0, durability: 0, recovery: 0 });

// Hver metric trækker på én eller flere drivere. f(driver) = clamp01(tierBase + skew + støj).
function buildFracs(tierLevel, skew, rng) {
  const noise = () => gaussian(rng, 0, 0.05); // lille seeded pr.-metric-støj
  const f = (driver) => clamp01(tierLevel + (skew[driver] ?? 0) + noise());
  return {
    aerob: f("aerob"),
    sprint_power: f("sprint_power"),
    punch_power: f("punch_power"),
    vo2_ceiling: f("vo2_ceiling"),
    aero: f("aero"),
    durability: f("durability"),
    recovery: f("recovery"),
  };
}

/**
 * @param {object} args
 *   archetype: en af PHYSIOLOGY_ARCHETYPES-nøglerne (generatorens _meta.archetype)
 *   tierLevel: 0..1 NIVEAU (superstar ~0.9 … domestique ~0.25) — sættes af generatoren
 *   height_cm, weight_kg: krops-snapshot (fra generatorens arketype-bmi×højde)
 *   rng: seeded mulberry32 (fra generatoren — IKKE en ny global)
 * @returns {object} upsert-klar physiology-profil (14 + 3 nye metrics), monoton power-kurve
 */
export function seedArchetypePhysiology({ archetype, tierLevel, height_cm, weight_kg, rng }) {
  const skew = PHYSIOLOGY_ARCHETYPES[archetype] ?? SKEW_DEFAULT;
  const fr = buildFracs(clamp01(tierLevel), skew, rng);
  const weight = round(clamp(Number(weight_kg) || 70, 45, 110), 2);
  const height = round(clamp(Number(height_cm) || 180, 150, 210), 2);

  // ── Sustained power (samme ranges som physiologySeeding.js) ────────────────
  const ftp_wkg = round(lerp(3.0, 6.8, 0.7 * fr.aerob + 0.3 * fr.durability), 2);
  const ftp_watts = Math.round(ftp_wkg * weight);
  // MAP = power ved VO2max (= vo2max_power_wkg). Loftes til ftp.
  const vo2max_power_wkg = round(Math.max(lerp(4.2, 7.5, 0.75 * fr.vo2_ceiling + 0.25 * fr.aerob), ftp_wkg), 2);
  const zone2_power_wkg = round(ftp_wkg * lerp(0.6, 0.75, fr.aerob), 2);

  // ── Short-duration / neuromuscular ─────────────────────────────────────────
  const pmax_watts = Math.round(lerp(14.0, 24.0, fr.sprint_power) * weight);
  let power_5s_wkg  = lerp(13.0, 22.0, fr.sprint_power);
  let power_15s_wkg = lerp(9.0, 17.0, 0.7 * fr.sprint_power + 0.3 * fr.recovery);
  let power_1m_wkg  = lerp(7.0, 11.5, 0.6 * fr.punch_power + 0.4 * fr.sprint_power);
  let power_2m_wkg  = lerp(6.0, 9.5, 0.6 * fr.punch_power + 0.4 * fr.vo2_ceiling);
  let power_5m_wkg  = lerp(5.0, 7.8, 0.6 * fr.vo2_ceiling + 0.4 * fr.aerob); // DEPRECERET (beholdt til kurve-kontinuitet)
  let power_10m_wkg = lerp(4.6, 7.0, 0.6 * fr.aerob + 0.4 * fr.vo2_ceiling);

  // Power-duration invariant: kortere varighed ⇒ mindst lige så høj W/kg (clamp NED
  // ad kæden; gulv 10m til ftp). Bevarer monotoni i hver driver.
  power_15s_wkg = Math.min(power_15s_wkg, power_5s_wkg);
  power_1m_wkg  = Math.min(power_1m_wkg, power_15s_wkg);
  power_2m_wkg  = Math.min(power_2m_wkg, power_1m_wkg);
  power_5m_wkg  = Math.min(power_5m_wkg, power_2m_wkg);
  power_10m_wkg = clamp(power_10m_wkg, ftp_wkg, power_5m_wkg); // ftp ≤ 10m ≤ 5m

  // ── Capacity / durability / aero ────────────────────────────────────────────
  const high_intensity_energy_kj   = round(lerp(10.0, 30.0, 0.6 * fr.durability + 0.4 * fr.punch_power), 1);
  const time_to_exhaustion_ftp_min = Math.round(lerp(30, 75, 0.6 * fr.aerob + 0.4 * fr.durability));
  const fatigue_resistance         = round(lerp(0.4, 0.95, 0.6 * fr.durability + 0.4 * fr.aerob), 3);
  const recovery_rate              = round(lerp(0.4, 0.95, 0.7 * fr.recovery + 0.3 * fr.durability), 3);
  const aero                       = round(lerp(0.4, 0.95, fr.aero), 3);

  return {
    ftp_wkg, ftp_watts, vo2max_power_wkg, zone2_power_wkg,
    pmax_watts,
    power_5s_wkg: round(power_5s_wkg, 2), power_15s_wkg: round(power_15s_wkg, 2),
    power_1m_wkg: round(power_1m_wkg, 2), power_2m_wkg: round(power_2m_wkg, 2),
    power_5m_wkg: round(power_5m_wkg, 2), power_10m_wkg: round(power_10m_wkg, 2),
    high_intensity_energy_kj, time_to_exhaustion_ftp_min, fatigue_resistance, recovery_rate,
    aero, height_cm: height, weight_kg: weight,
    source: "seeded_archetype", version: PHYSIOLOGY_FORMULA_VERSION,
  };
}
