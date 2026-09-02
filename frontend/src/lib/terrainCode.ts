// Sprog-neutral bogstavkode pr. terræn-bucket til de tætte kalender-/planlægger-
// grids (#4143 — afklaring af #2791: kalenderen og planlæggeren henter INGEN
// rutedata (climbs/elevation_gain_m) pr. race, så StageProfileGraph tier="mini"
// kan ikke bruges der uden en query-udvidelse; en bogstavkode kræver kun den
// terræn-bucket begge flader allerede har). #2791's ejer-citat (Discord,
// thelamba 20/7): "F for flat stage / sprint race and C for cobbles or
// something like that".
//
// SPROGVALG (dokumenteret FØR implementering, #2791 acceptkriterie): koderne er
// BEVIDST ikke oversat. De er 3-bogstavs cykel-domæne-forkortelser i samme sprog
// som "ITT"/"TTT" allerede bruges untranslated overalt i appen (fx
// stageProfileConfig.js, planner.json's terrain.itt="ITT") — EN og DA viser
// samme kode. Et bogstav pr. sprog (fx dansk "F" for "flad" vs engelsk "F" for
// "flat") ville tilfældigt ramme rigtigt for nogle buckets og forkert for andre
// (fx "cobbles"/"brosten" deler ikke forbogstav) — én sproguafhængig kode undgår
// den fælde helt, jf. issuets egen advarsel.
//
// FARVE: monokrom (currentColor), ingen bucket-specifik farve — samme
// restriktion som StageProfileGraph tier="mini"'s egen rute-streg (altid
// var(--text-1)/ink; farve er reserveret til cykel-specifik betydning som
// stignings-gradientbånd, ikke til at kode terræn-TYPE). TerrainCodeGlyph.tsx
// bruger denne fil til selve koden.

export const TERRAIN_BUCKETS = ["sprint", "cobbles", "hilly", "mountain", "itt", "ttt"] as const;
export type TerrainBucket = (typeof TERRAIN_BUCKETS)[number];

// MasterCanvas' terrainKey() (backend/lib/plannerBoard.js) kalder flad/sprint-
// bucketen "flat", ikke "sprint" — samme vokabular-uoverensstemmelse
// dashboardTodayStages.js's terrainGlyphBucket() allerede løser for
// TodayStagesStrip. Her løses den ved at pege begge nøgler på samme kode i
// stedet for at kræve at hver kalder normaliserer selv.
export const TERRAIN_CODE: Record<string, string> = Object.freeze({
  sprint: "SPR",
  flat: "SPR",
  cobbles: "COB",
  hilly: "HIL",
  mountain: "MTN",
  itt: "ITT",
  ttt: "TTT",
});

export const DEFAULT_TERRAIN_CODE = TERRAIN_CODE.sprint;

/** Koden for en terræn-bucket (ukendt/manglende → sprint-koden, samme graceful-degrade som stageProfileConfig.js's profileShape). */
export function terrainCodeFor(bucket: string | null | undefined): string {
  if (!bucket) return DEFAULT_TERRAIN_CODE;
  return TERRAIN_CODE[bucket] ?? DEFAULT_TERRAIN_CODE;
}
