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

/** @returns {Promise<{ ok: boolean, status?: number, data?: any }>} */
async function authed(path, init = {}) {
  const headers = await authHeaders();
  if (!headers) return { ok: false, status: 401 };
  return apiFetch(`${API}${path}`, { ...init, headers });
}

export async function loadSeasonOverview() {
  return authed("/api/races/selection/season");
}

export async function loadRaceSelection(raceId) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/selection`);
}

export async function saveRaceSelection(raceId, body) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/selection`, { method: "PUT", body: JSON.stringify(body) });
}

// Etapeprofilerne aendrer sig ikke mens siden er aaben; ét opslag pr. loeb er nok.
/** @type {Map<string, Promise<any[]>>} */
const profileCache = new Map();

/** Alle etapers profil for ét loeb (inkl. hoejdeserie og stigninger). Fejl giver en tom liste. */
export function loadStageProfiles(raceId) {
  let hit = profileCache.get(raceId);
  if (!hit) {
    hit = Promise.resolve(fetchStageProfiles(supabase, raceId))
      .then((res) => (res.error ? [] : /** @type {any[]} */ (res.data ?? [])))
      .catch(() => []);
    hit.then((rows) => {
      if (!rows.length) profileCache.delete(raceId); // prøv igen næste gang, hvis opslaget fejlede
    });
    profileCache.set(raceId, hit);
  }
  return hit;
}

const TERRAIN_CHUNK = 25; // 25 loeb x op til 21 etaper holder sig under PostgREST's 1000-raekkers graense

/**
 * Rutetyperne (profile_type pr. etape) for en liste loeb, til etape-striben i listen og ugeoversigten.
 * @returns {Promise<Map<string, string[]>>} loeb-id -> typer i etape-orden
 */
export async function loadRaceTerrain(raceIds) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
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
