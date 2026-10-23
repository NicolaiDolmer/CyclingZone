// #6570 · Loebssidens etapeprofiler fra race_stage_profiles, inkl. den rigtige
// hoejdeserie (elevation_profile, #6594). Uden kolonnen i projektionen falder
// etapeside 2.0 altid tilbage til syntesen, ogsaa naar serien findes.
//
// Samme udrulnings-fallback som backend/routes/publicStageRoute.js: findes
// kolonnen endnu ikke (Postgres 42703 undefined_column), laeses profilerne uden
// serien, og fladen viser syntesen som foer. En tom kolonne (null) er ikke en
// fejl: elevationSeries() vaelger selv syntesen for den etape.
//
// #6993: weather (det vejr v4-motoren laeser) vises paa etapesiden; reglerne
// for hvornaar staar i stageWeather.ts.

import type { supabase as appSupabase } from "../../../lib/supabase.ts";

export const STAGE_PROFILE_BASE_COLUMNS =
  "race_id, stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors, weather";

export const STAGE_PROFILE_COLUMNS = `${STAGE_PROFILE_BASE_COLUMNS}, elevation_profile`;

interface QueryResult { data: unknown[] | null; error: { code?: string; message?: string } | null }

// Den del af supabase-js-klienten der bruges her (goer testens falske klient enkel).
interface ProfilesClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: unknown): { order(col: string): PromiseLike<QueryResult> };
    };
  };
}

// Appens typede klient staar direkte i parametertypen: saa slipper tsc for at
// sammenligne hele SupabaseClient<Database> strukturelt med ProfilesClient, en
// kontrol der giver TS2589 ("excessively deep") i RaceDetailPage.jsx, afhaengigt
// af hvilken fil tsc tjekker foerst (#2806).
export async function fetchStageProfiles(client: typeof appSupabase | ProfilesClient, raceId: string): Promise<QueryResult> {
  const supabase = client as unknown as ProfilesClient;
  // pagination-safe: filtreret paa eet race_id, hoejst een raekke pr. etape (et loeb har faa etaper).
  const read = (cols: string) => supabase.from("race_stage_profiles").select(cols).eq("race_id", raceId).order("stage_number");
  const res = await read(STAGE_PROFILE_COLUMNS);
  if (res.error?.code === "42703") return read(STAGE_PROFILE_BASE_COLUMNS);
  return res;
}
