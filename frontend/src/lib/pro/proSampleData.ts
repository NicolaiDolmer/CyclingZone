// #2806 · Eksempeldata til /pro-siden (design-go 13/10: "tydeligt maerkede
// eksempeldata"). Tallene er opdigtede til illustration og vises altid under
// et "Example data"-maerke. De er IKKE en gratis spillers personlige historik og
// kommer aldrig fra databasen. Formen er den samme som GET
// /api/pro/rider-history/:riderId returnerer, saa eksemplet tegnes af praecis de
// samme komponenter som den rigtige fane.

export interface SampleSeason {
  season_number: number | null;
  live?: boolean;
  abilities: Record<string, number>;
}

// Fire evner er nok til at vise ideen paa en telefon uden at fylde skaermen.
export const PRO_SAMPLE_ABILITIES = ["climbing", "tempo", "time_trial", "endurance"] as const;

export const PRO_SAMPLE_SEASONS: readonly SampleSeason[] = [
  { season_number: 1, abilities: { climbing: 54, tempo: 50, time_trial: 48, endurance: 57 } },
  { season_number: 2, abilities: { climbing: 61, tempo: 55, time_trial: 51, endurance: 60 } },
  { season_number: 3, abilities: { climbing: 67, tempo: 58, time_trial: 53, endurance: 64 } },
  { season_number: null, live: true, abilities: { climbing: 70, tempo: 60, time_trial: 52, endurance: 66 } },
];

// Navnene paa eksempel-filtrene staar i pro.json (benefits.filters.examples.*).
export const PRO_SAMPLE_FILTER_KEYS = ["youngClimbers", "sprintersU25", "cheapTimeTrial"] as const;
