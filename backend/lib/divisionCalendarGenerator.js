// Pulje-liveness-prædikat (launch-checklist #2).
//
// Historisk husede denne fil også generateDivisionCalendars — den gamle per-pulje-
// udvælgelses-algoritme. Den er fjernet i #2449 (unify): tierCalendarMaterializer.js +
// selectTierRaceSet er den kanoniske generator (sætter game_day/game_day_start så løbene
// er synlige i kalenderen, og håndhæver prestige-kaskade + GT-invarianterne, #2276/#2251).
// poolHasCalendar er beholdt her fordi tierCalendarMaterializer importerer den.
//
// Pulje-liveness spejler aiTeamGenerator.targetAiCountForPool (#1688) — så vi aldrig
// materialiserer løb til en pulje uden et felt at køre dem i:
//   tier 1 + 2  → ALTID en kalender (felterne er altid AI-fyldte til POOL_TARGET_SIZE).
//   tier 3 + 4  → kun puljer med >=1 ægte manager (MANAGER_ENTRY_DIVISION=3).

// Spejler aiTeamGenerator: tier 1/2 altid live; tier 3/4 kun med >=1 ægte manager.
// (Holdt som lokal kopi for at undgå import af aiTeamGenerator's __testables; samme
//  prædikat — hold dem i sync hvis politikken ændres.)
export function poolHasCalendar(tier, realManagerCount = 0) {
  if (tier === 1 || tier === 2) return true;
  return (Number(realManagerCount) || 0) >= 1;
}
