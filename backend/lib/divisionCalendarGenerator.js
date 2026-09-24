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
//   pensioneret pulje (league_divisions.retired_at sat, #4592 spor A2) → ALDRIG en kalender.
//   tier 1 + 2  → ALTID en kalender (felterne er altid AI-fyldte til POOL_TARGET_SIZE).
//   tier 4      → ALTID en kalender fra S4 (#4592, ejer 24/9: "D4 går fra 8 til 4 puljer,
//                 fyldes med AI-hold fra start og har løb fra dag ét"). De aktive D4-puljer
//                 AI-fyldes uden ægte managers, præcis som tier 1-2.
//   tier 3      → kun puljer med >=1 ægte manager (MANAGER_ENTRY_DIVISION=3).
//   ungdomspulje (squad u23/junior, #2492) → ALTID en kalender: grupperne AI-fyldes til
//                 24 (ejer 24/9, spec-ungdomslob-2026-09-24 "Ejer-valg" pkt. 1), og deres
//                 ægte managers tælles ikke via teams.league_division_id (senior-kolonnen).

// Spejler aiTeamGenerator: tier 1/2/4 altid live; tier 3 kun med >=1 ægte manager.
// (Holdt som lokal kopi for at undgå import af aiTeamGenerator's __testables; samme
//  prædikat — hold dem i sync hvis politikken ændres.)
export function poolHasCalendar(tier, realManagerCount = 0, { retired = false, squad = null } = {}) {
  if (retired) return false;
  if (squad != null && squad !== "senior") return true;
  if (tier === 1 || tier === 2 || tier === 4) return true;
  return (Number(realManagerCount) || 0) >= 1;
}
