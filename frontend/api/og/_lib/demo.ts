// #6574: eksempel-etaper til /api/og/stage?demo=<nøgle>. KUN rigtige profildata: hver række er et
// uændret udsnit af en planlagt S4-etape i race_stage_profiles (13/10), i præcis den form det
// offentlige endpoint svarer med. Løbs- og stigningsnavnene er spillets egne (egne løbsnavne, aldrig
// rigtige løbs varemærker). Bruges til at se kortet på en preview og som fast testgrundlag; de
// rigtige delte links bruger ?id=<etape-id> og henter etapen live.
export const DEMO_STAGES: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  // Tour de l'Hexagone, etape 12 af 18: højbjerg, fire stigninger, mål på toppen af en HC.
  high: {
    race_name: "Tour de l'Hexagone", stage_number: 12, stage_count: 18, profile_type: "high_mountain",
    distance_km: 175, elevation_gain_m: 4211,
    climbs: [
      { name: "Col de Aubisque", category: "2", crest_km: 68, length_km: 8.1, avg_gradient: 6.2, summit_finish: false },
      { name: "Côte de la Croix", category: "2", crest_km: 92, length_km: 6.2, avg_gradient: 6.7, summit_finish: false },
      { name: "Côte de Aubisque", category: "1", crest_km: 116, length_km: 10.2, avg_gradient: 7.7, summit_finish: false },
      { name: "Col de Vars", category: "HC", crest_km: 175, length_km: 17.4, avg_gradient: 8.1, summit_finish: true },
    ],
    sprints: [{ km: 175, kind: "finish" }],
    sectors: [],
    segments: [
      { kind: "rolling", from_km: 0, to_km: 59.9 },
      { kind: "climb", from_km: 59.9, to_km: 68, category: "2", avg_gradient: 6.2 },
      { kind: "descent", from_km: 68, to_km: 72.9 },
      { kind: "rolling", from_km: 72.9, to_km: 85.8 },
      { kind: "climb", from_km: 85.8, to_km: 92, category: "2", avg_gradient: 6.7 },
      { kind: "descent", from_km: 92, to_km: 98.6 },
      { kind: "rolling", from_km: 98.6, to_km: 105.8 },
      { kind: "climb", from_km: 105.8, to_km: 116, category: "1", avg_gradient: 7.7 },
      { kind: "descent", from_km: 116, to_km: 127.8 },
      { kind: "rolling", from_km: 127.8, to_km: 157.6 },
      { kind: "climb", from_km: 157.6, to_km: 175, category: "HC", avg_gradient: 8.1 },
    ],
  },
  // Tour de Malaisie, etape 2 af 5: kuperet, fire stigninger og en mellemsprint.
  hilly: {
    race_name: "Tour de Malaisie", stage_number: 2, stage_count: 5, profile_type: "hilly",
    distance_km: 210, elevation_gain_m: 1997,
    climbs: [
      { name: "Col de Saint-Roch", category: "3", crest_km: 81, length_km: 2.2, avg_gradient: 6.2, summit_finish: false },
      { name: "Mont Aubisque", category: "3", crest_km: 110, length_km: 4.3, avg_gradient: 4.9, summit_finish: false },
      { name: "Mont la Croix", category: "2", crest_km: 139, length_km: 7.4, avg_gradient: 6.5, summit_finish: false },
      { name: "Côte de Beauregard", category: "2", crest_km: 199, length_km: 6.9, avg_gradient: 6.8, summit_finish: false },
    ],
    sprints: [{ km: 113, kind: "intermediate" }, { km: 210, kind: "finish" }],
    sectors: [],
    segments: [
      { kind: "rolling", from_km: 0, to_km: 78.8 },
      { kind: "climb", from_km: 78.8, to_km: 81, category: "3", avg_gradient: 6.2 },
      { kind: "descent", from_km: 81, to_km: 82.6 },
      { kind: "rolling", from_km: 82.6, to_km: 105.7 },
      { kind: "climb", from_km: 105.7, to_km: 110, category: "3", avg_gradient: 4.9 },
      { kind: "descent", from_km: 110, to_km: 114.2 },
      { kind: "rolling", from_km: 114.2, to_km: 131.6 },
      { kind: "climb", from_km: 131.6, to_km: 139, category: "2", avg_gradient: 6.5 },
      { kind: "descent", from_km: 139, to_km: 146.9 },
      { kind: "rolling", from_km: 146.9, to_km: 192.1 },
      { kind: "climb", from_km: 192.1, to_km: 199, category: "2", avg_gradient: 6.8 },
      { kind: "descent", from_km: 199, to_km: 205 },
      { kind: "rolling", from_km: 205, to_km: 210 },
    ],
  },
  // Tour de l'Hexagone, etape 2 af 18: flad, én kat. 4 sent og en mellemsprint.
  flat: {
    race_name: "Tour de l'Hexagone", stage_number: 2, stage_count: 18, profile_type: "flat",
    distance_km: 185, elevation_gain_m: 290,
    climbs: [{ name: "Côte de Beauregard", category: "4", crest_km: 173, length_km: 2.2, avg_gradient: 4.1, summit_finish: false }],
    sprints: [{ km: 87, kind: "intermediate" }, { km: 185, kind: "finish" }],
    sectors: [],
    segments: [
      { kind: "flat", from_km: 0, to_km: 170.8 },
      { kind: "climb", from_km: 170.8, to_km: 173, category: "4", avg_gradient: 4.1 },
      { kind: "descent", from_km: 173, to_km: 174.6 },
      { kind: "flat", from_km: 174.6, to_km: 185 },
    ],
  },
  // Ronde van Zeeland, etape 2 af 3: brosten, seks sektorer og en mellemsprint.
  cobbles: {
    race_name: "Ronde van Zeeland", stage_number: 2, stage_count: 3, profile_type: "cobbles",
    distance_km: 155, elevation_gain_m: 400,
    climbs: [],
    sprints: [{ km: 74, kind: "intermediate" }, { km: 155, kind: "finish" }],
    sectors: [
      { name: "Pavé Stretch 1", start_km: 70, length_km: 1.2 },
      { name: "Cobbled Sector 2", start_km: 78, length_km: 2.5 },
      { name: "Pavé Stretch 3", start_km: 89, length_km: 2.6 },
      { name: "Cobbled Sector 4", start_km: 103, length_km: 2.2 },
      { name: "Cobbled Sector 5", start_km: 116, length_km: 2 },
      { name: "Cobbled Sector 6", start_km: 147, length_km: 1.6 },
    ],
    segments: [
      { kind: "flat", from_km: 0, to_km: 70 },
      { kind: "cobbles", from_km: 70, to_km: 71.2 },
      { kind: "flat", from_km: 71.2, to_km: 78 },
      { kind: "cobbles", from_km: 78, to_km: 80.5 },
      { kind: "flat", from_km: 80.5, to_km: 89 },
      { kind: "cobbles", from_km: 89, to_km: 91.6 },
      { kind: "flat", from_km: 91.6, to_km: 103 },
      { kind: "cobbles", from_km: 103, to_km: 105.2 },
      { kind: "flat", from_km: 105.2, to_km: 116 },
      { kind: "cobbles", from_km: 116, to_km: 118 },
      { kind: "flat", from_km: 118, to_km: 147 },
      { kind: "cobbles", from_km: 147, to_km: 148.6 },
      { kind: "flat", from_km: 148.6, to_km: 155 },
    ],
  },
});
