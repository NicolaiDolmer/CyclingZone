// Delt terræn-bucket-normalisering (#4143 v2 — ejeren afviste bogstavkoder 3/9:
// "Jeg vil have at vi bruger nogle miniature billeder til dette i stedet. Er
// ikke glad for forkortelserne.").
//
// Kalenderen (pages/CalendarPage.jsx) og planlæggerens master-canvas
// (components/planner/MasterCanvas.jsx) viser nu SAMME miniature-terræn-
// silhuet (components/calendar/TerrainGlyph.jsx — samme tegning som
// StageStripe's MiniSilhouette, se lib/stageProfileConfig.js's profileShape).
// TerrainGlyph forstår kun de 6 kalender-buckets (TERRAIN_BUCKETS nedenfor),
// men de to flader henter deres rå terræn-felt fra hver sin backend-kilde:
//   - Kalenderen: backend/lib/raceCalendar.js's calendarTerrainBucket()
//     emitterer allerede dette vokabular 1:1 (sprint/cobbles/hilly/mountain/
//     itt/ttt).
//   - Planlæggeren: race-objektets terræn-felt kommer i dag fra samme
//     buildCalendarModel-kilde, MEN backend har mindst ét andet terræn-
//     vokabular for samme data (backend/lib/plannerBoard.js's terrainKey(),
//     som kalder flad/sprint-bucketen "flat", ikke "sprint") — en fremtidig
//     omlægning af planlæggerens endpoint kan derfor nemt ende med at sende
//     DET vokabular i stedet, uden at nogen opdager det før glyffen stille
//     falder tilbage til forkert silhuet.
//
// toTerrainBucket() er den defensive, delte normalisering begge flader
// bruger: en allerede-gyldig bucket går igennem uændret; en rå profile_type-
// streng (fx "flat") mappes; alt andet (ukendt/manglende) falder tilbage til
// "sprint" — samme graceful-degrade-filosofi som TerrainGlyph selv
// (BUCKET_TO_PROFILE) og stageProfileConfig.js's profileShape.
export const TERRAIN_BUCKETS = ["sprint", "cobbles", "hilly", "mountain", "itt", "ttt"] as const;
export type TerrainBucket = (typeof TERRAIN_BUCKETS)[number];

// race_stage_profiles.profile_type (+ #3546 D's itt_hilly) → samme 6 buckets.
// Spejler backend/lib/raceCalendar.js's PROFILE_TO_CAL_BUCKET (uden DB-adgang)
// — en ren frontend-fallback for kaldesteder der kun har profile_type, ikke
// den allerede udledte bucket.
const PROFILE_TYPE_TO_BUCKET: Record<string, TerrainBucket> = {
  flat: "sprint",
  rolling: "sprint",
  cobbles: "cobbles",
  hilly: "hilly",
  classic: "hilly",
  mountain: "mountain",
  high_mountain: "mountain",
  itt: "itt",
  itt_hilly: "itt",
  ttt: "ttt",
};

function isTerrainBucket(value: string): value is TerrainBucket {
  return (TERRAIN_BUCKETS as readonly string[]).includes(value);
}

/**
 * Normaliser et rått terræn-/profil-felt til én af TERRAIN_BUCKETS, klar til
 * TerrainGlyph. Allerede en kendt bucket → uændret. Andet (profile_type-
 * strenge, "flat", ukendt eller manglende) → mappet, med "sprint" som sidste
 * fallback.
 */
export function toTerrainBucket(raw: string | null | undefined): TerrainBucket {
  if (!raw) return "sprint";
  if (isTerrainBucket(raw)) return raw;
  return PROFILE_TYPE_TO_BUCKET[raw] ?? "sprint";
}
