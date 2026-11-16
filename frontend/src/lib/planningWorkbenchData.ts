// #7535 · Datakald til planlaegningssiden. Siden bygger ikke en parallel datavej: den bruger
// de samme endpoints som Race Hub og udtagelsespanelet.
//   GET /api/races/selection/season   saesonmatrixen: loeb, entries, afmeldinger, loebsdag til dato
//   GET /api/races/:id/selection      ryttere med rute-match, form, traethed, skade og binding
//   PUT /api/races/:id/selection      gem (samme guards som overalt ellers)
//   PUT /api/races/selection/bulk     gem af Handlinger-kladden over flere loeb (samme regler, ét kald)
//   POST /api/races/selection/auto/propose   assistentens forslag til mange loeb (laeser kun)
//   POST /api/races/withdrawals/bulk  afmelding af mange loeb (alt eller intet)
//   GET /api/races/distribution       kun seasonLoadByRider (samme tal som dagvisningens rytter-chip)
//   riders + rider_condition          nation, foedselsdato og skadesdato (som rytter-hoverkortet)
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

/**
 * Gem flere loebs udtagelse i ét kald (PUT /api/races/selection/bulk): samme regler som et enkelt gem,
 * og alt eller intet pr. kald. Bruges af Handlinger-kladden, naar spilleren gemmer den.
 */
export const SELECTION_BULK_MAX = 60; // serverens loft pr. kald
export async function saveRaceSelectionsBulk(changes: Array<Record<string, unknown>>) {
  return authed("/api/races/selection/bulk", { method: "PUT", body: JSON.stringify({ changes }) });
}

/**
 * "Lad assistenten udtage" over mange loeb (POST /api/races/selection/auto/propose): assistentens
 * trup pr. loeb med samme regler som assistenten for ét loeb. Kaldet LAESER kun; forslaget er en
 * kladde, som spilleren selv gemmer med masse-gemmet. `overrides` er kladdens trupper, som assistenten
 * skal regne med (et ryddet loeb binder ingen ryttere).
 */
export async function proposeAssistantSquads(raceIds: string[], overrides: Record<string, Array<{ rider_id: string; race_role: string | null }>>) {
  // Preview-mocken har ingen server: forslaget regnes paa seedet (aldrig i et prod-build).
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { previewAssistantProposals } = await import("../preview/planningWorkbenchMock.ts");
    return { ok: true, status: 200, data: previewAssistantProposals(raceIds, overrides) } as ApiResult;
  }
  return authed("/api/races/selection/auto/propose", { method: "POST", body: JSON.stringify({ race_ids: raceIds, overrides }) });
}

/**
 * "Afmeld" over mange loeb (POST /api/races/withdrawals/bulk): alt eller intet i ét kald, samme guards
 * som afmeldingen af ét loeb. `dryRun` kontrollerer kun (intet skrives).
 */
export async function withdrawRacesBulk(raceIds: string[], dryRun = false) {
  return authed("/api/races/withdrawals/bulk", { method: "POST", body: JSON.stringify({ race_ids: raceIds, dry_run: dryRun }) });
}

/**
 * "Efter loebet" (runde 3): forventet traethed efter sidste etape ved normal indsats, regnet af serveren
 * med motorens model (GET /api/races/:id/after-race-fatigue). Fejl eller slukket model = null (en streg).
 */
export async function loadAfterRaceFatigue(raceId: string): Promise<Record<string, number> | null> {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { previewAfterRace } = await import("../preview/planningWorkbenchMock.ts");
    return previewAfterRace(raceId);
  }
  try {
    const res = await authed(`/api/races/${encodeURIComponent(raceId)}/after-race-fatigue`);
    if (!res.ok || !res.data || res.data.enabled !== true || typeof res.data.riders !== "object") return null;
    return res.data.riders as Record<string, number>;
  } catch {
    return null;
  }
}

/**
 * Formtop (runde 3): samme kald som /planning's Form-fane. Board'et (GET /api/peak-plans/board) giver
 * rytterne med mål, form og traethed; "Apply to selected" er det samme masse-kald som "Accept all"
 * (POST /api/peak-plans/bulk), og "Fjern" det samme som fanens fjern (DELETE /api/peak-plans/:id).
 */
export async function loadPeakBoard(): Promise<ApiResult> {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { previewPeakBoard } = await import("../preview/planningWorkbenchMock.ts");
    return { ok: true, status: 200, data: previewPeakBoard() };
  }
  return authed("/api/peak-plans/board");
}

export async function applyPeaks(pairs: Array<{ riderId: string; raceId: string }>): Promise<ApiResult> {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { previewApplyPeaks } = await import("../preview/planningWorkbenchMock.ts");
    return { ok: true, status: 200, data: previewApplyPeaks(pairs) };
  }
  return authed("/api/peak-plans/bulk", {
    method: "POST",
    body: JSON.stringify({ plans: pairs.map((p) => ({ rider_id: p.riderId, target_race_id: p.raceId })) }),
  });
}

export async function removePeak(planId: string): Promise<ApiResult> {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { previewRemovePeak } = await import("../preview/planningWorkbenchMock.ts");
    return { ok: true, status: 200, data: previewRemovePeak(planId) };
  }
  return authed(`/api/peak-plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
}

/** Afmeld (withdraw = true) eller deltag igen: samme endpoint og samme guards som loebstavlens knap. */
export async function setRaceWithdrawal(raceId: string, withdraw: boolean) {
  return authed(`/api/races/${encodeURIComponent(raceId)}/withdrawal`, { method: withdraw ? "POST" : "DELETE" });
}

/** Rytterens nation, foedselsdato og skade; samme kolonner som rytter-hoverkortet laeser. */
export interface RiderDetail {
  nationality: string | null;
  birthdate: string | null;
  injuredUntil: string | null;
  injuryRaceDaysLeft: number | null;
}

/**
 * Nation-flag, U23 og skadesdato til trup-tabellen. Udtagelses-endpointet sender kun "skadet ja/nej",
 * saa siden laeser det samme som hoverkortet og holdsiden (riders + rider_condition). Fejl giver et tomt
 * kort: tabellen virker uden, den mangler blot flag, U23 og datoen.
 */
export async function loadRiderDetails(riderIds: string[]): Promise<Map<string, RiderDetail>> {
  const out = new Map<string, RiderDetail>();
  if (!riderIds.length) return out;
  try {
    const { data, error } = await (supabase as any)
      .from("riders")
      // pagination-safe: ét holds ryttere (maks ~30), langt under PostgREST's graense.
      .select("id, nationality_code, birthdate, rider_condition(injured_until, injury_race_days_left)")
      .in("id", riderIds);
    if (error) return out;
    for (const row of data ?? []) {
      const embed = row.rider_condition;
      const cond = (Array.isArray(embed) ? embed[0] : embed) ?? null;
      out.set(row.id, {
        nationality: row.nationality_code ?? null,
        birthdate: row.birthdate ?? null,
        injuredUntil: cond?.injured_until ?? null,
        injuryRaceDaysLeft: cond?.injury_race_days_left ?? null,
      });
    }
  } catch {
    // catch-ok: flag, U23 og skadesdato er detaljer oven paa tabellen; mangler de, vises raekken uden.
  }
  return out;
}

/** Saeson-belastning pr. rytter (loeb og loebsdage tilmeldt i saesonen). */
export interface SeasonLoad {
  races: number;
  raceDays: number;
}

/**
 * Samme tal som rytter-chippen paa /planning (dagvisningen): serverens seasonLoadByRider fra
 * GET /api/races/distribution. Det regnes aldrig om i klienten. Fejl giver et tomt kort.
 */
export async function loadSeasonLoad(): Promise<Record<string, SeasonLoad>> {
  try {
    const res = await authed("/api/races/distribution");
    if (!res.ok || !res.data || typeof res.data.seasonLoadByRider !== "object" || !res.data.seasonLoadByRider) return {};
    return res.data.seasonLoadByRider as Record<string, SeasonLoad>;
  } catch {
    return {};
  }
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
