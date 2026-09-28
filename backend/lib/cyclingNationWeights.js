// backend/lib/cyclingNationWeights.js
// #5844 (ejer 28/9): REALISTISK nationsfordeling for genererede ungdomsryttere.
// Ejeren: "flere nationer i spillet er fint, men fordelingen skal ligne
// virkeligheden, altså mest fra de store cykelnationer".
//
// Vægt ≈ antal professionelle ryttere pr. nation på UCI WorldTeams + ProTeams.
// KILDE: TILNÆRMET, ikke en eksakt optælling. Tallene er et skøn over 2024-
// rosterne (ca. 1.100 ryttere i alt), afrundet. Der ligger ingen verificeret
// optælling i repoet; før den generelle intake (DEFAULT_NATIONALITY_WEIGHTS i
// fictionalRiderGenerator.js) skifter til denne tabel, skal tallene
// kalibreres mod UCI's/ProCyclingStats' rosterlister (separat issue).
//
// Kun ISO2-koder der har en navne-klynge i fictionalRiderNames.js (ellers får
// rytteren generiske navne). Delt konstant: bestyrelsens gave (#5844) bruger den
// nu; den generelle intake kan pege på samme tabel senere.
export const REAL_CYCLING_NATION_WEIGHTS = Object.freeze([
  { value: "BE", weight: 150 },
  { value: "FR", weight: 150 },
  { value: "IT", weight: 110 },
  { value: "ES", weight: 90 },
  { value: "NL", weight: 75 },
  { value: "GB", weight: 45 },
  { value: "DE", weight: 45 },
  { value: "DK", weight: 45 },
  { value: "AU", weight: 35 },
  { value: "CO", weight: 35 },
  { value: "US", weight: 30 },
  { value: "NO", weight: 30 },
  { value: "CH", weight: 25 },
  { value: "AT", weight: 20 },
  { value: "PT", weight: 20 },
  { value: "PL", weight: 15 },
  { value: "SI", weight: 12 },
  { value: "CZ", weight: 12 },
  { value: "CA", weight: 12 },
  { value: "NZ", weight: 12 },
  { value: "IE", weight: 12 },
  { value: "ER", weight: 8 },
  { value: "EC", weight: 8 },
  { value: "KZ", weight: 8 },
  { value: "LU", weight: 6 },
  { value: "SE", weight: 6 },
  { value: "ZA", weight: 6 },
  { value: "MX", weight: 5 },
  { value: "LV", weight: 5 },
  { value: "EE", weight: 5 },
  { value: "JP", weight: 5 },
  { value: "AR", weight: 4 },
  { value: "SK", weight: 4 },
  { value: "UA", weight: 4 },
  { value: "HR", weight: 3 },
  { value: "LT", weight: 3 },
  { value: "VE", weight: 3 },
  { value: "FI", weight: 2 },
  { value: "RW", weight: 2 },
  { value: "BR", weight: 2 },
  { value: "CL", weight: 2 },
  { value: "DZ", weight: 1 },
  { value: "MA", weight: 1 },
  { value: "CN", weight: 1 },
  { value: "KR", weight: 1 },
].map((w) => Object.freeze(w)));
