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
