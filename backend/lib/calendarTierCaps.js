// backend/lib/calendarTierCaps.js
// SSOT for de to ejer-låste kalender-konstanter pr. division. Udskilt fra
// tierCalendarMaterializer.js i #4161, fordi verifikations-siden (verify-invariants,
// calendarOverlapInvariant.js) skal kunne læse dem UDEN at trække materializerens
// DB-/Sentry-afhængigheder med ind. tierCalendarMaterializer.js re-eksporterer dem
// uændret, så alle eksisterende importstier virker som før.
//
// Tæthed pr. division (= "løbsdage kørt om dagen", ejer-låst). quota = density × realDays.
export const TIER_DENSITY = Object.freeze({ 1: 5, 2: 4, 3: 3, 4: 2 });

// Overlap-cap pr. division (ejer-låst 2026-06-28): max antal FORSKELLIGE løb der må binde en rytter
// samtidig (= samtidige løb pr. in-game-dag). Div 1/2 = 3, Div 3/4 = 2. Adskilt fra tæthed: tætheden
// er pacing (etaper/IRL-dag), cap'en er binding-tryk (forskellige løb/game-dag).
export const TIER_OVERLAP_CAP = Object.freeze({ 1: 3, 2: 3, 3: 2, 4: 2 });

// Game-dage pr. IRL-dag. Pakkeren (raceCalendarLanePacker.js) lægger K HELE in-game-dage
// inden i hver kalenderdag, netop så density etaper kan afvikles uden at nogen game_day
// bryder overlap-cap'en. K = 1 betyder at in-game-dagen og kalenderdagen falder sammen
// (kun Div 4); for Div 1-3 gør de det IKKE, og game_day kan derfor ALDRIG udledes af
// scheduled_at. Se #4161.
export function gameDaysPerRealDay(tier) {
  const d = TIER_DENSITY[tier];
  const c = TIER_OVERLAP_CAP[tier];
  if (!d || !c) return null;
  return Math.ceil(d / c);
}
