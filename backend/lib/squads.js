// backend/lib/squads.js
// SSOT for TRUPPER (#4619, slice 1 af epic #2492). Bevidst DEPENDENCY-LET:
// importerer KUN riderSeasonAge.js, som selv er dependency-fri. Det er hele
// pointen — enhver konsument (lib, script, migration-hjælper, sim) skal kunne
// importere trup-reglerne uden at trække DB, fs eller notifikationer med, så
// ingen får en "god grund" til at kopiere aldersgrænserne. Præcis samme lektie
// som #3071/#3081 kostede på selve aldersformlen: en duplikat med en pæn
// begrundelse er stadig en duplikat.
//
// Aldersformlen bor ÉT sted: riderSeasonAge.js (`ageForSeason`,
// `ageForReferenceYear`, `LAUNCH_REFERENCE_YEAR`). Denne fil oversætter en
// SÆSONALDER til en trup — den regner aldrig selv en alder ud af en birthdate,
// og den må ALDRIG gøre det i SQL (spec §3.2).
//
// Regelkilde: docs/YOUTH_RULES.md §2.1 (trup-aldre), §2.2 (flyt + det tvungne
// valg rykker fra 22 til 23), §2.4 (loft pr. trup erstatter den flade 8-cap),
// og docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md
// §3.2 + §10.6.

import { ageForSeason, ageForReferenceYear } from "./riderSeasonAge.js";

/** Trup-værdierne, ordnet fra yngst til ældst. Spejler CHECK-constrainten på
 *  `riders.squad` (database/2026-09-15-4619-riders-squad.sql). */
export const SQUADS = Object.freeze(["junior", "u23", "senior"]);

/** Default-truppen — kolonnens DEFAULT og den værdi enhver ukendt rytter får. */
export const DEFAULT_SQUAD = "senior";

/**
 * Øvre sæsonalder pr. ungdomstrup (ejer 2/9, YOUTH_RULES §2.1):
 *   Junior team  sæsonalder 16-18 — bliver han 19, skal han ud
 *   U23 team     sæsonalder 19-22 — bliver han 23, skal han ud
 *   Senior team  ingen øvre grænse
 * Grænserne er STRUKTURregler (ikke balance-følsomme tal) og står derfor ordret
 * både her og i YOUTH_RULES §2.1, hard rule 17.
 */
export const SQUAD_MAX_AGE = Object.freeze({ junior: 18, u23: 22, senior: null });

/**
 * Loft pr. trup — SIM-STARTPUNKT, ikke et endeligt balance-tal.
 *
 * U23 = 12: EJER-VALGT 15/9 2026 (spec §10.6, svar A): "U23 = 12 pladser som
 * SIM-STARTPUNKT (migration + dry-run-diff bygges på det), kalibreres efter S4's
 * første økonomidata sammen med facilitetstrinnene (D-032)."
 * Junior = 10: forslaget i YOUTH_RULES §2.4 / issue #4619, samme kalibrerings-
 * forbehold. Begge tal er GRUNDloftet: D-032 (ejer 10/9) siger samme grundloft
 * pr. trup for ALLE klubber, ekstra pladser købes som facilitetstrin med stigende
 * drift — aldrig af division, aldrig af resultater. Facilitetstrinnene findes
 * ikke endnu; når de gør, lægges de oven på disse tal, de erstatter dem ikke.
 *
 * Senior har bevidst INGEN værdi her: seniortruppens 30-cap kommer fra holdets
 * division (`squad_limits.max` via marketUtils.getTeamMarketState) og er uændret
 * (GAME_INVARIANTS.md). At lægge et tal for senior ind her ville skabe kopi nr.
 * to af den cap.
 */
export const SQUAD_CAPS = Object.freeze({ u23: 12, junior: 10 });

/**
 * Gyldig trup-værdi?
 * @param {unknown} squad
 * @returns {boolean}
 */
export function isSquad(squad) {
  return typeof squad === "string" && SQUADS.includes(squad);
}

/**
 * Er truppen en UNGDOMStrup (dvs. under akademi-paraplyen)?
 *
 * Dette er præcis det prædikat den gamle `riders.is_academy` bar: `is_academy`
 * bliver stående som afledt kolonne (`squad <> 'senior'`) i overgangsperioden,
 * fordi 35+ kaldsteder og RLS-funktionen `is_offered_intake_rider()` læser den
 * (spec §3.2). Skriv ALTID begge felter konsistent når squad sættes.
 *
 * @param {unknown} squad
 * @returns {boolean}
 */
export function isYouthSquad(squad) {
  return isSquad(squad) && squad !== "senior";
}

/**
 * Truppen en rytter hører til ud fra sin SÆSONALDER (ikke wall-clock alder).
 *
 * junior ≤ 18 · u23 19-22 · senior ≥ 23.
 *
 * @param {number|null|undefined} seasonAge  sæsonalder fra riderSeasonAge.js
 * @returns {"junior"|"u23"|"senior"|null}  null ved manglende/ugyldig alder
 *          (aldrig et gæt — kalderen afgør selv hvad en ukendt fødselsdato skal
 *          betyde; backfill'en lader den blive i 'senior')
 */
export function squadForSeasonAge(seasonAge) {
  if (!Number.isFinite(seasonAge)) return null;
  if (seasonAge <= SQUAD_MAX_AGE.junior) return "junior";
  if (seasonAge <= SQUAD_MAX_AGE.u23) return "u23";
  return "senior";
}

/**
 * Truppen ud fra fødselsdato + sæsonnummer. Tynd delegering til SSOT'en, så
 * kalderen slipper for at kombinere to imports (og dermed slipper for fristelsen
 * til at skrive `year - birthYear` selv).
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} seasonNumber  1-baseret sæsonnummer
 * @returns {"junior"|"u23"|"senior"|null}
 */
export function squadForSeason(birthdate, seasonNumber) {
  return squadForSeasonAge(ageForSeason(birthdate, seasonNumber));
}

/**
 * Truppen ud fra fødselsdato + kalenderår (referenceår). Samme delegering som
 * ageForReferenceYear — scripts og snapshots arbejder i årstal, ikke i
 * sæsonnumre.
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} referenceYear
 * @returns {"junior"|"u23"|"senior"|null}
 */
export function squadForReferenceYear(birthdate, referenceYear) {
  return squadForSeasonAge(ageForReferenceYear(birthdate, referenceYear));
}

/**
 * Pladsloftet for en trup, eller `null` hvis truppen ikke har et eget loft
 * (senior styres af divisionens `squad_limits.max`).
 *
 * @param {string} squad
 * @returns {number|null}
 */
export function capForSquad(squad) {
  if (!isSquad(squad)) return null;
  return Object.prototype.hasOwnProperty.call(SQUAD_CAPS, squad) ? SQUAD_CAPS[squad] : null;
}

/**
 * Er truppen fuld hvis vi lægger `adding` ryttere til en nuværende bestand på
 * `currentCount`? En trup UDEN eget loft (senior) er aldrig "fuld" efter denne
 * funktion — den cap håndhæves et andet sted og må ikke duplikeres her.
 *
 * @param {{squad:string, currentCount:number, adding?:number}} args
 * @returns {boolean}
 */
export function wouldExceedSquadCap({ squad, currentCount, adding = 1 } = {}) {
  const cap = capForSquad(squad);
  if (cap === null) return false;
  return Number(currentCount ?? 0) + Number(adding) > cap;
}

// ── Graduering: de TO overgange (YOUTH_RULES §2.1 + §2.2) ────────────────────
//
// Tidligere fandtes ÉN overgang: akademi → senior ved sæsonalder 22
// (`GRADUATION.GRADUATE_AGE`). Med tre trupper er der to:
//
//   junior → u23   ved sæsonalder 19  (han er vokset ud af junior ved 18)
//   u23    → senior ved sæsonalder 23  (han er vokset ud af U23 ved 22)
//
// Bevidst REGELÆNDRING, ikke en bug-fix: YOUTH_RULES §2.2 "Det tvungne valg
// flytter fra 22 til 23" og §7 modsigelse 6. En 22-årig er stadig U23 (samme
// grænse som UCIs egen U23-kategori og `isU23ForSeason`).
export const SQUAD_TRANSITIONS = Object.freeze([
  Object.freeze({ from: "junior", to: "u23", atSeasonAge: SQUAD_MAX_AGE.junior + 1 }),
  Object.freeze({ from: "u23", to: "senior", atSeasonAge: SQUAD_MAX_AGE.u23 + 1 }),
]);

/**
 * Er rytteren vokset UD af sin trup i den givne sæson?
 *
 * Ét prædikat begge overgange deler, så sæson-transitionen, det løbende sweep og
 * en evt. vagt ikke kan blive uenige om hvem der skal flyttes (samme
 * "prædikatet låses sammen"-disciplin som academyGraduationPredicate.test.js).
 *
 * @param {{squad:string, seasonAge:number|null|undefined}} args
 * @returns {boolean}  false ved ukendt alder eller ukendt trup (aldrig et gæt)
 */
export function hasOutgrownSquad({ squad, seasonAge } = {}) {
  if (!isYouthSquad(squad) || !Number.isFinite(seasonAge)) return false;
  return seasonAge > SQUAD_MAX_AGE[squad];
}

/**
 * Overgangen en rytter skal igennem, eller `null` hvis han ikke er vokset ud.
 * Returnerer altid ÉT trin op — en 25-årig i junior-truppen (kun muligt via en
 * fejl eller et manuelt flyt) sendes til u23, ikke direkte til senior, så
 * default-kæden og Graduation Day behandler ham som en almindelig overgang.
 *
 * @param {{squad:string, seasonAge:number|null|undefined}} args
 * @returns {{from:string, to:string, atSeasonAge:number}|null}
 */
export function transitionForRider({ squad, seasonAge } = {}) {
  if (!hasOutgrownSquad({ squad, seasonAge })) return null;
  return SQUAD_TRANSITIONS.find((t) => t.from === squad) ?? null;
}
