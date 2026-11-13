// #7535 · Datakald til planlaegningssiden. Siden bygger ikke en parallel datavej: den bruger
// de samme endpoints som Race Hub og udtagelsespanelet.
//   GET /api/races/selection/season   saesonmatrixen: loeb, entries, afmeldinger, loebsdag til dato
//   GET /api/races/:id/selection      ryttere med rute-match, form, traethed, skade og binding
//   PUT /api/races/:id/selection      gem (samme guards som overalt ellers)
// Etape-profiler (ruteprofil og etapetyper) laeses som paa loebssiden fra race_stage_profiles.
import { authHeaders } from "./supabase";
import { apiFetch } from "./apiFetch.ts";
import { supabase } from "./supabase";
import { fetchStageProfiles } from "../components/race/stagePageV2/stageProfilesQuery.ts";

const API = import.meta.env.VITE_API_URL;

// Svarets krop er serverens JSON; siden laeser kun de felter den kender.
export interface ApiResult {
  ok: boolean;
  status?: number;
  data?: any;
}

async function authed(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, status: 401 };
  return apiFetch(`${API}${path}`, { ...init, headers }) as unknown as Promise<ApiResult>;
}

export async function loadSeasonOverview() {
  return authed("/api/races/selection/season");
}

export async function loadRaceSelection(raceId: string) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/selection`);
}

export async function saveRaceSelection(raceId: string, body: unknown) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/selection`, { method: "PUT", body: JSON.stringify(body) });
}

/** Afmeld (withdraw = true) eller deltag igen: samme endpoint og samme guards som loebstavlens knap. */
export async function setRaceWithdrawal(raceId: string, withdraw: boolean) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/withdrawal`, { method: withdraw ? "POST" : "DELETE" });
}

// Etapeprofilerne aendrer sig ikke mens siden er aaben; ét opslag pr. loeb er nok.
const profileCache = new Map<string, Promise<StageProfileRow[]>>();

/** Alle etapers profil for ét loeb (inkl. hoejdeserie og stigninger). Fejl giver en tom liste. */
export interface StageProfileRow {
  stage_number?: number | null;
  profile_type?: string | null;
  [key: string]: unknown;
}

export function loadStageProfiles(raceId: string): Promise<StageProfileRow[]> {
  let hit = profileCache.get(raceId);
  if (!hit) {
    hit = Promise.resolve(fetchStageProfiles(supabase, raceId))
      .then((res) => (res.error ? [] : ((res.data ?? []) as StageProfileRow[])))
      .catch(() => []);
    void hit.then((rows) => {
      if (!rows.length) profileCache.delete(raceId); // prøv igen næste gang, hvis opslaget fejlede
    });
    profileCache.set(raceId, hit);
  }
  return hit;
}

const TERRAIN_CHUNK = 25; // 25 loeb x op til 21 etaper holder sig under PostgREST's 1000-raekkers graense

/**
 * Rutetyperne (profile_type pr. etape) for en liste loeb, til etape-striben i listen og ugeoversigten.
 */
export async function loadRaceTerrain(raceIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < raceIds.length; i += TERRAIN_CHUNK) {
    const chunk = raceIds.slice(i, i + TERRAIN_CHUNK);
    try {
      const { data, error } = await supabase
        .from("race_stage_profiles")
        .select("race_id, stage_number, profile_type")
        .in("race_id", chunk)
        .order("race_id")
        .order("stage_number")
        .range(0, 999);
      if (error) continue;
      for (const row of data ?? []) {
        if (!row.profile_type) continue;
        const list = out.get(row.race_id) ?? [];
        list.push(row.profile_type);
        out.set(row.race_id, list);
      }
    } catch {
      // catch-ok: etape-striben er pynt oven paa listen; mangler den, vises loebet uden.
    }
  }
  return out;
}
