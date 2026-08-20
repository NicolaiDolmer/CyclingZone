// vk-movement-signals — trajektorie-sparkline i rytter-heroen:
// rating-udvikling DENNE SÆSON, udledt af rider_derived_ability_history
// (evne-snapshots, samme tabel Udvikling-fanens historik allerede bruger).
//
// Datakilde-verifikation (før bygning): rider_derived_ability_history findes
// og har reelle rækker i prod (52.626 rækker / 5.290 ryttere, verificeret
// 18/8) — { rider_id, snapshot_date, season_number, abilities }. `abilities`
// rummer KUN de 15 synlige CZ-evner (samme sæt som rider_derived_abilities'
// klient-grant) — hverken hidden_potential eller ability_caps er med, så der
// er intet loft/potentiale at lække her.
//
// Rating pr. snapshot udledes med SAMME opskrift som den allerede viste hero-
// rating (riderOverallRating → ratingForRole(abilities, rider.primary_type)),
// så trajektoriets slutpunkt matcher det tal spilleren allerede ser — ingen ny
// skala, intet opfundet tal.
import { ratingForRole } from "./generated/displayRecipes.js";

/**
 * Filtrerer historik-rækker til rytterens SENESTE kendte sæson (højeste
 * season_number blandt rækkerne) og udleder en rating pr. snapshot.
 *
 * @param {Array<{snapshot_date: string, season_number: number, abilities: object}>} rows
 * @param {string|null} primaryType - rider.primary_type
 * @returns {Array<{date: string, rating: number}>} sorteret kronologisk (ASC)
 */
export function buildRatingTrajectory(rows, primaryType) {
  if (!Array.isArray(rows) || !rows.length || !primaryType) return [];
  const latestSeason = rows.reduce((mx, r) => Math.max(mx, Number(r.season_number) || 0), 0);
  return rows
    .filter((r) => Number(r.season_number) === latestSeason && r.abilities)
    .map((r) => ({ date: r.snapshot_date, rating: ratingForRole(r.abilities, primaryType) }))
    .filter((r) => r.rating != null && r.date != null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Under dette (point på 0-99-skalaen) mellem første og sidste punkt = "steady",
// så små udsving i den daglige træningsstøj ikke fejlagtigt læses som en trend.
const TREND_THRESHOLD = 2;

/**
 * Kvalitativ label ud fra første vs. sidste punkt i trajektoriet.
 *
 * @param {Array<{rating: number}>} trajectory
 * @returns {"rising"|"declining"|"steady"|null} null hvis < 2 punkter (intet
 *   trend at vise — sparklinen kræver mindst to punkter for at tegne en linje).
 */
export function trajectoryTrend(trajectory) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) return null;
  const delta = trajectory[trajectory.length - 1].rating - trajectory[0].rating;
  if (delta >= TREND_THRESHOLD) return "rising";
  if (delta <= -TREND_THRESHOLD) return "declining";
  return "steady";
}
