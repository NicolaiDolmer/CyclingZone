// #6574: faste eksempel-etaper til /api/og/stage?demo=<nøgle>. Bruges til at se kortet på en preview
// uden rigtige løbsdata, og som eksempel i tests. Alle løbs- og stigningsnavne er opfundet
// (egne løbsnavne, aldrig rigtige løbs varemærker).
export const DEMO_STAGES = Object.freeze({
  mountain: {
    race: "Ruta Cantabrica", route: "Cangas del Sil – Alto de Portelo", stage: 2, stageCount: 5,
    type: "mountain", lang: "en", distance_km: 180, elevation_gain_m: 3400, seedKey: "demo-ruta-cantabrica",
    climbs: [
      { name: "Collado de Cordal", category: "3", crest_km: 75, length_km: 5, avg_gradient: 5.1 },
      { name: "Alto de Covella", category: "2", crest_km: 108, length_km: 6, avg_gradient: 6.1 },
      { name: "Alto de Portelo", category: "1", crest_km: 180, length_km: 15.5, avg_gradient: 7.4 },
    ],
    sprints: [82],
  },
  hilly: {
    race: "Grand Prix des Falaises", route: "Aubel-sur-Roc – Vireux", stage: 1, stageCount: 1,
    type: "hilly", lang: "en", distance_km: 198, elevation_gain_m: 3100, seedKey: "demo-gp-falaises",
    climbs: [
      { name: "Côte de Marlet", category: "4", crest_km: 112, length_km: 2.6, avg_gradient: 6.4 },
      { name: "Côte de la Verrerie", category: "3", crest_km: 150, length_km: 2.1, avg_gradient: 8.9 },
      { name: "Mur de Brunel", category: "4", crest_km: 168, length_km: 1.3, avg_gradient: 9.6 },
      { name: "Côte de Saulnay", category: "3", crest_km: 186, length_km: 1.0, avg_gradient: 11.2 },
    ],
    sprints: [],
  },
  flat: {
    race: "Nordsee Rundfahrt", route: "Esbjerg – Ribe", stage: 3, stageCount: 4,
    type: "flat", lang: "en", distance_km: 168, elevation_gain_m: 420, seedKey: "demo-nordsee",
    climbs: [],
    sprints: [74, 121],
  },
  high: {
    race: "Tour des Hauts Cols", route: "Bourg – Col du Loup", stage: 4, stageCount: 6,
    type: "high_mountain", lang: "da", distance_km: 160, elevation_gain_m: 5200, seedKey: "demo-hauts-cols",
    climbs: [
      { name: "Col du Faucon", category: "1", crest_km: 52, length_km: 12.2, avg_gradient: 7.5 },
      { name: "Col de la Brèche", category: "1", crest_km: 84, length_km: 15.4, avg_gradient: 7.2 },
      { name: "Col des Loups", category: "HC", crest_km: 160, length_km: 14.0, avg_gradient: 9.0 },
    ],
    sprints: [68],
  },
});
