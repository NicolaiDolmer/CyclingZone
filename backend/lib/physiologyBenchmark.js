// Divisions-fysiologi-benchmark (#2000 Fysiologi-fane).
//
// Snit af fysiologi-felterne over en divisions ryttere — driver "vs division"-
// bjælkerne + watt-kurve-overlayet på Fysiologi-fanen. Ren funktion (node --test);
// route'n i api.js henter rækkerne (population = ikke-pensionerede ryttere på
// ikke-bank-hold i divisionen) og cacher resultatet pr. division. Read-only
// aggregat — påvirker ikke spillet, så ingen balance-harness nødvendig.

// De numeriske fysiologi-felter der midles. Spejler de felter Fysiologi-fanen
// benchmarker (headline-kort + watt-profil + watt-kurve). weight_kg er med, så
// klienten kan regne divisionens W·kg ↔ watt med et repræsentativt snit.
export const BENCHMARK_FIELDS = Object.freeze([
  "ftp_watts", "ftp_wkg", "vo2max_power_wkg", "zone2_power_wkg", "pmax_watts",
  "power_5s_wkg", "power_15s_wkg", "power_1m_wkg", "power_5m_wkg",
  "high_intensity_energy_kj", "weight_kg",
]);

// Snit pr. felt over rækkerne; ikke-numeriske værdier ignoreres pr. felt (et felt
// kan have null på enkelte rækker uden at vælte snittet). Tom/ugyldig input → null.
export function meanPhysiology(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sums = {};
  const counts = {};
  for (const f of BENCHMARK_FIELDS) { sums[f] = 0; counts[f] = 0; }
  for (const row of rows) {
    for (const f of BENCHMARK_FIELDS) {
      const raw = row?.[f];
      // null/undefined/boolean/tom-streng = manglende felt → ikke 0 (Number coercer
      // dem alle til en finite 0). NUMERIC-felter (ftp_wkg, power_*_wkg …) kommer som
      // tal-strenge ("4.95") fra PostgREST, så ægte tal-strenge SKAL stadig accepteres.
      if (raw == null || typeof raw === "boolean") continue;
      if (typeof raw === "string" && raw.trim() === "") continue;
      const v = Number(raw);
      if (Number.isFinite(v)) { sums[f] += v; counts[f] += 1; }
    }
  }
  const mean = {};
  for (const f of BENCHMARK_FIELDS) mean[f] = counts[f] > 0 ? sums[f] / counts[f] : null;
  return mean;
}
