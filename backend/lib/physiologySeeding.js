// Race Engine V1 (#676) — seed fysiologi-profil fra legacy 0-99 stats.
//
// Ren, deterministisk transformation: samme input → identisk output, ingen DB,
// ingen Math.random. Kaldt af backend/scripts/backfillRacePhysiology.js.
// Formler er forankret i ADR docs/decisions/race-engine-architecture-v1.md
// §"Migration and seeding plan" + §"Database schema proposal" og versioneret som
// FORMULA_VERSION. Bump versionen hvis formlerne ændres, så vi kan regenerere.
//
// Princip: hver fysiologisk værdi er en ikke-negativt vægtet sum af normaliserede
// legacy-stats lineært interpoleret ind i et realistisk elite-cykel-range → output
// er MONOTONT i hver primær driver (højere stat_bj sænker aldrig ftp_wkg) og let
// at teste. Power-duration-kurven håndhæves til sidst (5s ≥ 15s ≥ 1m ≥ 5m ≥ ftp)
// på en måde der bevarer monotonien.

export const FORMULA_VERSION = 1;

// Defaults for manglende rytter-data. 180 cm / 70 kg = neutral WorldTour-krop;
// 60 = mid-pack stat (samme tier-baseline som fictionalRiderGenerator).
export const DEFAULTS = Object.freeze({ height_cm: 180, weight_kg: 70, stat: 60 });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Normalisér en legacy 0-99 stat til 0..1. Null/udefineret → DEFAULTS.stat.
const norm = (s) => clamp((s ?? DEFAULTS.stat), 0, 99) / 99;
const lerp = (lo, hi, t) => lo + (hi - lo) * clamp(t, 0, 1);
const round = (x, dp) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

// Seed en fuld physiology-profil fra én rytter-record.
// riderRow: { id, stat_fl, stat_bj, ... , height, weight } (legacy felter).
// Returnerer en upsert-klar payload (uden DB-genererede id/created_at/updated_at).
export function seedPhysiologyFromLegacy(riderRow = {}) {
  const s = (key) => norm(riderRow[key]);
  const bj = s("stat_bj");   // bjerg
  const kb = s("stat_kb");   // mellembjerg
  const bk = s("stat_bk");   // bakke
  const tt = s("stat_tt");   // enkeltstart
  const sp = s("stat_sp");   // sprint
  const acc = s("stat_acc"); // acceleration
  const udh = s("stat_udh"); // udholdenhed
  const mod = s("stat_mod"); // modstandsdygtighed
  const res = s("stat_res"); // restituering
  const ftr = s("stat_ftr"); // fighter

  const height_cm = round(clamp(Number(riderRow.height) || DEFAULTS.height_cm, 150, 210), 2);
  const weight_kg = round(clamp(Number(riderRow.weight) || DEFAULTS.weight_kg, 45, 110), 2);

  // ── Sustained power ──────────────────────────────────────────────────────
  const ftp_wkg = round(lerp(3.0, 6.8, 0.55 * bj + 0.2 * kb + 0.15 * udh + 0.1 * res), 2);
  const ftp_watts = Math.round(ftp_wkg * weight_kg);
  // VO2max-power og 5-min-power deler driver (bk/bj) men gulves til ftp (du kan
  // altid holde mere i 3-5 min end ved FTP).
  const vo2max_power_wkg = round(Math.max(lerp(4.2, 7.5, 0.6 * bk + 0.4 * bj), ftp_wkg), 2);
  const zone2_power_wkg = round(ftp_wkg * lerp(0.6, 0.75, udh), 2);

  // ── Short-duration / neuromuscular ───────────────────────────────────────
  const pmax_watts = Math.round(lerp(14.0, 24.0, 0.55 * sp + 0.45 * acc) * weight_kg);
  // Rå power-curve — håndhæves monotont aftagende nedenfor.
  let power_5s_wkg = lerp(13.0, 22.0, 0.5 * sp + 0.5 * acc);
  let power_15s_wkg = lerp(9.0, 17.0, 0.7 * sp + 0.3 * res);
  let power_1m_wkg = lerp(7.0, 11.5, 0.5 * bk + 0.3 * acc + 0.2 * ftr);
  let power_5m_wkg = lerp(5.0, 7.8, 0.6 * bk + 0.4 * bj);

  // Power-duration invariant: kortere varighed ⇒ mindst lige så høj W/kg.
  // Clamp NED ad kæden (loft = forrige, kortere effort) + gulv 5m til ftp.
  // min(f(x), konstant-loft) og max(f(x), konstant-gulv) bevarer monotoni i x.
  power_15s_wkg = Math.min(power_15s_wkg, power_5s_wkg);
  power_1m_wkg = Math.min(power_1m_wkg, power_15s_wkg);
  power_5m_wkg = clamp(power_5m_wkg, ftp_wkg, power_1m_wkg); // ftp ≤ 5m ≤ 1m

  // ── Capacity / durability ────────────────────────────────────────────────
  const high_intensity_energy_kj = round(lerp(10.0, 30.0, 0.5 * ftr + 0.3 * acc + 0.2 * bk), 1);
  const time_to_exhaustion_ftp_min = Math.round(lerp(30, 75, 0.6 * tt + 0.4 * udh));
  const fatigue_resistance = round(lerp(0.4, 0.95, 0.5 * res + 0.3 * udh + 0.2 * mod), 3);
  const recovery_rate = round(lerp(0.4, 0.95, 0.7 * res + 0.3 * mod), 3);

  return {
    rider_id: riderRow.id,
    ftp_wkg,
    ftp_watts,
    vo2max_power_wkg,
    zone2_power_wkg,
    pmax_watts,
    power_5s_wkg: round(power_5s_wkg, 2),
    power_15s_wkg: round(power_15s_wkg, 2),
    power_1m_wkg: round(power_1m_wkg, 2),
    power_5m_wkg: round(power_5m_wkg, 2),
    high_intensity_energy_kj,
    time_to_exhaustion_ftp_min,
    fatigue_resistance,
    recovery_rate,
    height_cm,
    weight_kg,
    source: "seeded_from_legacy",
    version: FORMULA_VERSION,
  };
}
