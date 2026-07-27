// backend/lib/riderSeasonAge.js
// SSOT for rytter-alder. Bevidst DEPENDENCY-FRI (ingen imports, ingen DB, ingen
// Date.now()), så selv de reneste libs kan importere den uden at trække I/O med.
//
// Hvorfor filen findes (#2905-oprydning efter #3071 + #3081):
// Formlen lå i riderProgressionEngine.js, som importerer supabasePagination,
// notificationService og — via riderValuation — node:fs. Libs med en eksplicit
// renheds-kontrakt (peakSuggestions.js, squadRiskGuard.js) kunne derfor ikke
// importere SSOT'en og duplikerede den i stedet, hver med en pæn begrundelse i
// en kommentar. Resultatet var FIRE kopier af det samme tal, og to bugs af
// præcis den grund:
//
//   #3071 — frontend regnede alder på wall-clock, backend på sæsonen. Identiske
//           i sæson 1, divergerende fra sæson 2. Ramte al alders-visning,
//           U23/U25-badges og pensionsrisiko.
//   #3081 — peak-assistenten havde sin egen wall-clock-variant. 121 ryttere på
//           ægte hold fik 1 peak i stedet for 2.
//
// En duplikat med en god begrundelse er stadig en duplikat. Den rigtige løsning
// er at gøre importen billig nok til at ingen har en grund til at kopiere.
//
// Frontend har nødvendigvis sin egen kopi (frontend/src/lib/riderAge.js) — den
// kan ikke importere over ledningen. Ændres LAUNCH_REFERENCE_YEAR her, SKAL den
// også ændres dér; riderAge.js peger tilbage på denne fil.

/**
 * Kalenderåret sæson 1 svarer til. Rytternes fødselsår er skrevet mod dette år,
 * så sæson N regnes som LAUNCH_REFERENCE_YEAR + (N − 1).
 */
export const LAUNCH_REFERENCE_YEAR = 2026;

/**
 * Sæson-alder: cykelsportens konvention, hvor en rytter er "den alder han fylder
 * i sæsonens kalenderår", uafhængigt af fødselsdag. Wall-clock må ALDRIG bruges
 * som kilde — se filens topkommentar for de to bugs det har kostet.
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} seasonNumber  1-baseret sæsonnummer
 * @returns {number|null}  null ved manglende/ugyldigt input (aldrig et gæt)
 */
export function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

/**
 * Referenceåret for en sæson — samme formel, men uden en fødselsdato. Bruges hvor
 * et årstal skal videregives (fx academyTransfer's p_season_start_year).
 *
 * @param {number|null|undefined} seasonNumber
 * @returns {number|null}
 */
export function seasonReferenceYear(seasonNumber) {
  if (!Number.isFinite(seasonNumber)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1);
}
