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

// Dato-KUN-strenge ("YYYY-MM-DD") parses af ECMAScript som UTC-midnat, mens
// `getFullYear()` læser LOKAL tid. Vest for UTC (hele Amerika) ruller 1. januar
// dermed et år tilbage — "2001-01-01" bliver fødselsår 2000, og rytteren står
// et år for gammel. Der er 9 ryttere født 1. januar i prod, og `riders.birthdate`
// er en ren DATE-kolonne uden klokkeslæt, så feltet har ALTID dato-kun-formen.
//
// Året læses derfor direkte ud af strengen. Det er samtidig præcis den adfærd de
// script-varianter #4455 samlede havde (`getUTCFullYear()` og `String(bd).slice(0,4)`
// er begge tidszone-uafhængige), så SSOT'en er nu identisk med dem i ENHVER tidszone
// og ikke længere kun i Europe/Copenhagen og UTC. Alt andet end dato-kun-formen
// falder tilbage på `Date`, så et evt. fuldt timestamp stadig kan læses.
const DATE_ONLY = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * Fødselsåret bag en fødselsdato — tidszone-uafhængigt for dato-kun-strenge.
 * Eksporteret så konsumenter med en ANDEN alders-semantik (fx abilityDerivation's
 * clampede `ageFrom` med fallback 25) kan dele år-udtrækket uden at duplikere det.
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @returns {number|null}  null ved manglende/ugyldigt input (aldrig et gæt)
 */
export function birthYearFrom(birthdate) {
  if (!birthdate) return null;
  const dateOnly = typeof birthdate === "string" ? DATE_ONLY.exec(birthdate.trim()) : null;
  if (dateOnly) return Number(dateOnly[1]);
  const year = new Date(birthdate).getFullYear();
  return Number.isFinite(year) ? year : null;
}

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
  const birthYear = birthYearFrom(birthdate);
  if (birthYear === null) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

/**
 * Sæson-alder ud fra et REFERENCEÅR i stedet for et sæsonnummer. Præcis samme
 * formel — generatorer, snapshots og allokatorer arbejder i årstal, ikke i
 * sæsonnumre, og duplikerede derfor `referenceYear − fødselsår` hver for sig
 * (#4455: balanceSnapshot.js og starterSquadAllocator.js var kopi seks og syv).
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} referenceYear  kalenderåret alderen måles mod
 * @returns {number|null}  null ved manglende/ugyldigt input (aldrig et gæt)
 */
export function ageForReferenceYear(birthdate, referenceYear) {
  if (!Number.isFinite(referenceYear)) return null;
  const birthYear = birthYearFrom(birthdate);
  if (birthYear === null) return null;
  return referenceYear - birthYear;
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
