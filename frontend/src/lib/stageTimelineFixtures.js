// #3859 (bølge 2 — løbsfilm-afspiller): håndplukkede fixture-tidslinjer der
// følger spec §2.2's event-taksonomi og §2.3's konsistensregler (km monotont
// ikke-faldende, gap-kurvens slutpunkt matcher persisteret virkelighed).
// Bruges af: unit-tests (kurations-logik + scrubber-tidsmapning) og Playwright
// (mocket `/api/races/:raceId/timeline`-endpoint — se
// frontend/tests/e2e/race-timeline-film.spec.js). Kald ALDRIG det ægte endpoint
// fra disse tests — backend-API'et (#3860) bygges parallelt.
//
// Rytter-id'erne matcher navnene i ROSTER nedenfor, så describeEvent()-testene
// og e2e-assertions kan slå navne op på samme måde som riderNameById i
// RaceDetailPage.jsx (id → "Fornavn Efternavn").
export const ROSTER = {
  "rider-1": "Ada Pedersen",
  "rider-2": "Mikkel Hansen",
  "rider-3": "Sofie Lund",
  "rider-4": "Jonas Berg",
  "rider-5": "Elin Aas",
};

export function riderNameByIdFixture() {
  return new Map(Object.entries(ROSTER));
}

// 1) Bjergetape m. hentet udbrud — udbrud dannet tidligt, to KOM'er, gab der
// vokser og falder, indhentet før finalen, favoritten cracker på sidste
// stigning, vinderen afgøres i finale-angrebet.
export const MOUNTAIN_TIMELINE = {
  timeline_version: 1,
  stage_number: 3,
  events: [
    { km: 0, type: "stage_start", params: { field_count: 142, profile_type: "mountain", distance_km: 168 } },
    { km: 8, type: "breakaway_formed", params: { rider_ids: ["rider-2", "rider-3"] } },
    { km: 45, type: "gap_update", params: { gap_seconds: 90 } },
    { km: 62, type: "kom_passage", params: { name: "Col du Test", category: "1", top: [{ rider_id: "rider-2", points: 10 }] } },
    { km: 80, type: "gap_update", params: { gap_seconds: 240 } },
    { km: 110, type: "gap_update", params: { gap_seconds: 150 } },
    { km: 128, type: "kom_passage", params: { name: "Mont Fixture", category: "HC", top: [{ rider_id: "rider-3", points: 20 }] } },
    { km: 140, type: "gap_update", params: { gap_seconds: 30 } },
    { km: 146, type: "gap_update", params: { gap_seconds: 0 } },
    { km: 146, type: "breakaway_caught", params: { rider_ids: ["rider-2", "rider-3"] } },
    { km: 158, type: "favorite_crack", params: { rider_id: "rider-4", reason: "jour_sans" } },
    { km: 163, type: "finale_attack", params: { rider_id: "rider-1" } },
    {
      km: 168,
      type: "finish",
      params: { top: [{ rider_id: "rider-1", rank: 1, gap: "+0:00" }, { rider_id: "rider-5", rank: 2, gap: "+0:18" }], win_type: "solo_win" },
    },
  ],
};

// 2) Udbrudssejr m. gc_change — udbruddet overlever hele vejen, vinderen
// overtager den samlede føring.
export const BREAKAWAY_WIN_TIMELINE = {
  timeline_version: 1,
  stage_number: 7,
  events: [
    { km: 0, type: "stage_start", params: { field_count: 138, profile_type: "hilly", distance_km: 182 } },
    { km: 12, type: "breakaway_formed", params: { rider_ids: ["rider-3", "rider-4", "rider-5"] } },
    { km: 40, type: "gap_update", params: { gap_seconds: 180 } },
    { km: 70, type: "intermediate_sprint", params: { name: "Sprint Fixture", top: [{ rider_id: "rider-4", points: 12, bonus_seconds: 3 }] } },
    { km: 95, type: "gap_update", params: { gap_seconds: 320 } },
    { km: 130, type: "kom_passage", params: { name: "Cote Fixture", category: "3", top: [{ rider_id: "rider-3", points: 4 }] } },
    { km: 150, type: "gap_update", params: { gap_seconds: 260 } },
    { km: 178, type: "gap_update", params: { gap_seconds: 210 } },
    { km: 179, type: "breakaway_survived", params: { rider_ids: ["rider-3", "rider-4", "rider-5"], final_gap: 210 } },
    {
      km: 182,
      type: "finish",
      params: { top: [{ rider_id: "rider-3", rank: 1, gap: "+0:00" }, { rider_id: "rider-4", rank: 2, gap: "+0:08" }], win_type: "close_win" },
    },
    { km: 182, type: "gc_change", params: { new_leader_id: "rider-3", previous_leader_id: "rider-1" } },
  ],
};

// 3) Massespurt — kort morgenudbrud fanget hurtigt, ingen bjerge, fotofinish.
export const BUNCH_SPRINT_TIMELINE = {
  timeline_version: 1,
  stage_number: 12,
  events: [
    { km: 0, type: "stage_start", params: { field_count: 135, profile_type: "flat", distance_km: 174 } },
    { km: 5, type: "breakaway_formed", params: { rider_ids: ["rider-5"] } },
    { km: 20, type: "gap_update", params: { gap_seconds: 180 } },
    { km: 60, type: "intermediate_sprint", params: { name: "Sprint By Fixture", top: [{ rider_id: "rider-2", points: 15, bonus_seconds: 3 }] } },
    { km: 95, type: "gap_update", params: { gap_seconds: 40 } },
    { km: 118, type: "breakaway_caught", params: { rider_ids: ["rider-5"] } },
    { km: 120, type: "gap_update", params: { gap_seconds: 0 } },
    { km: 173, type: "sprint_decided", params: { rider_ids: ["rider-2", "rider-1"], photo_finish: true } },
    {
      km: 174,
      type: "finish",
      params: { top: [{ rider_id: "rider-2", rank: 1, gap: "+0:00" }, { rider_id: "rider-1", rank: 2, gap: "+0:00" }], win_type: "sprint_win" },
    },
  ],
};

export const TIMELINE_FIXTURES = {
  mountain: MOUNTAIN_TIMELINE,
  breakawayWin: BREAKAWAY_WIN_TIMELINE,
  bunchSprint: BUNCH_SPRINT_TIMELINE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ejer-fix 17/8: scrubberen skal tegne den ÆGTE ruteprofil-silhuet
// (stageRouteProfile.buildProfileSeries), ikke en flad skema-linje. Disse er
// `race_stage_profiles`-formede fixtures (samme felter StageProfileGraph.jsx
// bruger: distance_km, climbs[].{crest_km, category, avg_gradient, length_km,
// name, summit_finish}, elevation_gain_m) — PARRET med tidslinjerne ovenfor,
// så en kom_passage-events km matcher en ægte crest_km i profilen (samme
// waypoint set som backend racePassages.js ville udlede fra samme profil).
export const MOUNTAIN_STAGE_PROFILE = {
  race_id: "fixture-race", stage_number: 3, distance_km: 168, elevation_gain_m: 3400,
  profile_type: "mountain", finale_type: "descent",
  climbs: [
    { crest_km: 62, category: "1", avg_gradient: 6.8, length_km: 9.5, name: "Col du Test", summit_finish: false },
    { crest_km: 128, category: "HC", avg_gradient: 7.9, length_km: 14.2, name: "Mont Fixture", summit_finish: false },
  ],
  sprints: [], sectors: [],
};

export const BREAKAWAY_WIN_STAGE_PROFILE = {
  race_id: "fixture-race", stage_number: 7, distance_km: 182, elevation_gain_m: 1450,
  profile_type: "hilly", finale_type: "rolling",
  climbs: [
    { crest_km: 130, category: "3", avg_gradient: 4.8, length_km: 3.6, name: "Cote Fixture", summit_finish: false },
  ],
  sprints: [], sectors: [],
};

// Massespurt: fladt, INGEN stigninger — stadig ægte rutedata (silhuetten er
// bare rullende terræn uden kategoriserede kamme), til forskel fra en helt
// legacy etape uden profil overhovedet (som falder tilbage til den simple
// km-akse, se STAGE_PROFILE_FIXTURES.legacy).
export const BUNCH_SPRINT_STAGE_PROFILE = {
  race_id: "fixture-race", stage_number: 12, distance_km: 174, elevation_gain_m: 320,
  profile_type: "flat", finale_type: "bunch_sprint",
  climbs: [], sprints: [], sectors: [],
};

export const STAGE_PROFILE_FIXTURES = {
  mountain: MOUNTAIN_STAGE_PROFILE,
  breakawayWin: BREAKAWAY_WIN_STAGE_PROFILE,
  bunchSprint: BUNCH_SPRINT_STAGE_PROFILE,
  // Legacy/PCM-løb uden rutedata (`hasRouteData` false) — scrubberen falder
  // tilbage til den simple km-akse.
  legacy: null,
};
