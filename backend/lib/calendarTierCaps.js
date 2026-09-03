// backend/lib/calendarTierCaps.js
// SSOT for de to ejer-låste kalender-konstanter pr. division. Udskilt fra
// tierCalendarMaterializer.js i #4161, fordi verifikations-siden (verify-invariants,
// calendarOverlapInvariant.js) skal kunne læse dem UDEN at trække materializerens
// DB-/Sentry-afhængigheder med ind. tierCalendarMaterializer.js re-eksporterer dem
// uændret, så alle eksisterende importstier virker som før.
//
// Tæthed pr. division (= "løbsdage kørt om dagen", ejer-låst). quota = density × realDays.
//
// EJER-BESLUTNING 2026-09-03 (#4270): Division 4 haevet 2 -> 3 etaper om dagen fra saeson 4.
// 56 etaper over 28 dage var spillets tyndeste program, og D4 er den division med flest
// hold. Kvoten foelger automatisk (density x loebsdatoer, CALENDAR_RULES.md §1b):
// D4 3 x 28 = 84 etaper i S4. TIER_STAGE_SLOTS[4] hae­vet tilsvarende til 12/15/18.
//
// FOELGEVIRKNING der ikke maa overses: minGameDaysPerRealDay(4) gaar fra 1 til 2, saa D4's
// game_day-akse og kalenderaksen maa IKKE laengere falde sammen. Foer S4 var D4 den eneste
// division med 1:1 mellem loebsdag og kalenderdag (CALENDAR_RULES.md §0). Kode der antog
// den 1:1 for D4 skal maale, ikke antage - checkCalendarOverlapInvariants haandhaever det
// selv via axisLooksCollapsed, som nu ogsaa gaelder tier 4.
export const TIER_DENSITY = Object.freeze({ 1: 5, 2: 4, 3: 3, 4: 3 });

// Overlap-cap pr. division (ejer-låst 2026-06-28): max antal FORSKELLIGE løb der må binde en rytter
// samtidig (= samtidige løb pr. in-game-dag). Div 1/2 = 3, Div 3/4 = 2. Adskilt fra tæthed: tætheden
// er pacing (etaper/IRL-dag), cap'en er binding-tryk (forskellige løb/game-dag).
export const TIER_OVERLAP_CAP = Object.freeze({ 1: 3, 2: 3, 3: 2, 4: 2 });

// ── Mindste-overlap pr. division (#3329, ejer-beslutning 3/9) ─────────────────────────
//
// TIER_OVERLAP_CAP har vogtet TOPPEN siden 28/6. Bunden har aldrig vaeret maalt, og et loft
// uden gulv er en halv regel: i S2 havde D1 6 af 28 loebsdage med kun ET loeb - dage hvor
// manageren ikke havde noget at vaelge imellem.
//
// TO tal, fordi EET ikke kan baere reglen. MAALT paa S4's 28-dages plan (dry-run 3/9):
//
//   | div | loebsdage | 1 loeb | 2 loeb | 3 loeb | andel med >= 2 |
//   | D1  |    79     |   36   |   25   |   18   |     54,4 %     |
//   | D2  |    58     |   18   |   26   |   14   |     69,0 %     |
//   | D3  |    56     |   28   |   28   |    -   |     50,0 %     |
//   | D4  |    56     |   28   |   28   |    -   |     50,0 %     |
//
// Ejerens eksempel ("D1 >= 2 loeb pr. loebsdag") er STRUKTURELT uopnaaeligt, ikke bare
// stramt: pakkeren lae­gger flere hele loebsdage inden i hver kalenderdag, og et ulige antal
// samtidige etaper efterlader altid en loebsdag med eet loeb. Alle fire divisioner har
// min = 1, i baade S3 og S4-planen. Et absolut gulv paa 2 ville derfor gaa roedt paa en
// KORREKT kalender - samme faelde som #3469 allerede har betalt for én gang.
//
// Derfor:
//   TIER_OVERLAP_MIN            absolut bund pr. loebsdag. Maalt 1 i alle divisioner.
//                               Den vogter at ingen loebsdag falder til nul loeb.
//   TIER_MULTI_RACE_DAY_MIN_SHARE  ANDELEN af divisionens loebsdage der skal have MINDST
//                               2 samtidige loeb. Det er dét tal der baerer ejerens intention
//                               ("der skal vaere noget at vaelge imellem"), og det er
//                               maalbart uden at doemme en korrekt kalender roed.
// Andels-gulvene er sat et godt stykke under det maalte (samme disciplin som
// TIER_TERRAIN_FAMILY_MIN): de er regressionsvagter, ikke kvalitetsmaal.
// Se docs/CALENDAR_RULES.md §1.
export const TIER_OVERLAP_MIN = Object.freeze({ 1: 1, 2: 1, 3: 1, 4: 1 });
export const TIER_MULTI_RACE_DAY_MIN_SHARE = Object.freeze({ 1: 0.45, 2: 0.55, 3: 0.40, 4: 0.40 });

// Game-dage pr. IRL-dag — NEDRE GRAENSE, ikke et facit.
//
// Pakkeren lae­gger flere hele in-game-dage inden i hver kalenderdag, saa density etaper kan
// afvikles uden at nogen game_day bryder overlap-cap'en. I BANDED-layoutet (Div 2-4) er tallet
// praecis ceil(density / cap). I STREAM-layoutet (Div 1, Grand Tours + monumenter) er det
// HOEJERE og varierer fra dag til dag — maalt 3-5 pr. kalenderdag paa pakkerens eget
// Div 1-output, 75-103 game_days i alt over 27-28 kalenderdage.
//
// Brug derfor kun tallet til at afgoere OM in-game-aksen og kalenderen maa falde sammen:
//   1 => de SKAL falde sammen (kun Div 4)
//  >1 => de maa ALDRIG falde sammen, og game_day kan aldrig udledes af scheduled_at.
// Selve cap-overholdelsen verificeres af calendarOverlapInvariant.js, ikke af denne formel.
// Se #4161.
export function minGameDaysPerRealDay(tier) {
  const d = TIER_DENSITY[tier];
  const c = TIER_OVERLAP_CAP[tier];
  if (!d || !c) return null;
  return Math.ceil(d / c);
}
