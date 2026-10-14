// #6574: etapens rute, som road book-billedet tegner den. Kilden er race_stage_profiles via det
// offentlige, read-only backend-endpoint GET /api/public/stage-route/:stageId (backend/routes/
// publicStageRoute.js). Ingen kurve i URL'en, ingen hemmelighed i funktionen.
//
// Hvorfor backenden og ikke Supabase direkte: tabellen har kun authenticated-select (RLS), og
// Vercel-funktionen skal hverken have en service-nøgle eller åbne tabellen for anon. Backenden
// har allerede service-klienten og svarer med et whitelistet udsnit (kun det etapesiden viser).
//
// Alt herfra valideres og begrænses igen (forsvar i dybden): en forkert række må aldrig vælte
// billedet, og tekst er kort og uden kontroltegn.
//
// Mappen _lib/ er bevidst: Vercel behandler filer uden underscore i api/ som endpoints.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Backendens offentlige host (samme som vercel.json's rewrites). Kan overstyres med OG_API_ORIGIN. */
export const DEFAULT_API_ORIGIN = "https://cyclingzone-production.up.railway.app";

export const CATEGORIES = Object.freeze(["4", "3", "2", "1", "HC"]);
export type Category = "4" | "3" | "2" | "1" | "HC";
export type SegmentKind = "flat" | "rolling" | "climb" | "descent" | "cobbles";
const SEGMENT_KINDS: ReadonlySet<string> = new Set(["flat", "rolling", "climb", "descent", "cobbles"]);

export interface Climb { name: string; category: Category; crest_km: number; length_km: number; avg_gradient: number; summit_finish: boolean }
export interface Sector { name: string; start_km: number; length_km: number }
export interface Segment { kind: SegmentKind; from_km: number; to_km: number; avg_gradient?: number; category?: Category }
/** #6594: etapens rigtige højdeprofil, ét punkt pr. step_km, hele meter; h[0] = start, h[sidste] = mål. */
export interface ElevationSeries { step_km: number; h: number[] }
export interface StageRoute {
  /** null for ældre etaper (S1-S4) uden serie: road book tegner da dagens afledte profil. */
  elevation: ElevationSeries | null;
  race: string;
  stage: number;
  stageCount: number;
  type: string;
  distance_km: number;
  elevation_gain_m: number;
  climbs: Climb[];
  /** Kun mellemsprints (km); målstregen er altid ved distance_km. */
  sprints: number[];
  sectors: Sector[];
  segments: Segment[];
}

const MAX_NAME = 40;

/** Kontroltegn ud, whitespace samlet, hard cap. Ingen HTML (satori renderer tekst, ikke markup). */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function num(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  return Number(raw);
}
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const round1 = (n: number) => Math.round(n * 10) / 10;

function category(raw: unknown): Category {
  const c = String(raw ?? "").toUpperCase();
  return (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : "3";
}

/**
 * Højdeserien {v:1, step_km, h[]}. Alt der ikke er en brugbar serie (forkert version, for få punkter,
 * ikke-tal, eller et antal punkter der ikke dækker etapens afstand) giver null, så billedet tegner
 * dagens profil i stedet for at gætte.
 */
export function normalizeElevation(raw: unknown, distanceKm: number): ElevationSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { v?: unknown; step_km?: unknown; h?: unknown };
  const step = num(r.step_km);
  if (r.v !== 1 || !Number.isFinite(step) || step < 0.1 || step > 5 || !Array.isArray(r.h)) return null;
  if (r.h.length < 2 || r.h.length > 1200) return null;
  const h = r.h.map((m) => (m === null || m === "" ? NaN : Number(m)));
  if (!h.every((m) => Number.isFinite(m) && m > -500 && m < 6000)) return null;
  // Serien skal dække [0, D] (± ét skridt); ellers hører den til en anden afstand.
  if (Math.abs((h.length - 1) * step - distanceKm) > step * 1.01) return null;
  return { step_km: step, h: h.map(Math.round) };
}

/**
 * Validerer backendens `stage`-objekt (eller en demo-række i samme form) til en StageRoute.
 * Null når etapen ikke har en tegnbar rute (ingen afstand).
 */
export function normalizeStageRoute(raw: Record<string, unknown> | null | undefined): StageRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const D = num(raw.distance_km);
  if (!Number.isFinite(D) || D <= 0 || D > 400) return null;
  const stageCount = Math.max(1, Math.min(30, Math.round(num(raw.stage_count) || 1)));
  const stage = Math.max(1, Math.min(stageCount, Math.round(num(raw.stage_number) || 1)));
  const gain = num(raw.elevation_gain_m);

  const climbs: Climb[] = arr(raw.climbs)
    .map((c) => ({
      name: cleanText(c.name, MAX_NAME),
      category: category(c.category),
      crest_km: Math.min(num(c.crest_km), D),
      length_km: num(c.length_km),
      avg_gradient: num(c.avg_gradient),
      summit_finish: c.summit_finish === true,
    }))
    .filter((c) => [c.crest_km, c.length_km, c.avg_gradient].every(Number.isFinite) && c.crest_km > 0 && c.length_km > 0 && c.avg_gradient > 0)
    .map((c) => ({ ...c, length_km: Math.min(c.length_km, 40, c.crest_km), avg_gradient: Math.min(c.avg_gradient, 25) }))
    .sort((a, b) => a.crest_km - b.crest_km)
    .slice(0, 12);

  const sprints = arr(raw.sprints)
    .filter((s) => s.kind === "intermediate")
    .map((s) => num(s.km))
    .filter((k) => Number.isFinite(k) && k > 0 && k < D)
    .slice(0, 4);

  const sectors: Sector[] = arr(raw.sectors)
    .map((s) => ({ name: cleanText(s.name, MAX_NAME), start_km: num(s.start_km), length_km: num(s.length_km) }))
    .filter((s) => Number.isFinite(s.start_km) && Number.isFinite(s.length_km) && s.length_km > 0 && s.start_km >= 0 && s.start_km < D)
    .slice(0, 30);

  const segments: Segment[] = arr(raw.segments)
    .filter((s) => SEGMENT_KINDS.has(String(s.kind)))
    .map((s) => {
      const seg: Segment = {
        kind: s.kind as SegmentKind,
        from_km: Math.max(0, Math.min(D, num(s.from_km))),
        to_km: Math.max(0, Math.min(D, num(s.to_km))),
      };
      if (seg.kind === "climb") {
        seg.avg_gradient = Math.min(num(s.avg_gradient), 25);
        seg.category = category(s.category);
      }
      return seg;
    })
    .filter((s) => Number.isFinite(s.from_km) && Number.isFinite(s.to_km) && s.to_km > s.from_km
      && (s.kind !== "climb" || (Number.isFinite(s.avg_gradient) && (s.avg_gradient as number) > 0)))
    .sort((a, b) => a.from_km - b.from_km)
    .slice(0, 80);

  return {
    race: cleanText(raw.race_name, MAX_NAME),
    stage,
    stageCount,
    type: cleanText(raw.profile_type, 32) || "hilly",
    distance_km: round1(D),
    elevation_gain_m: Number.isFinite(gain) ? Math.max(0, Math.min(9000, Math.round(gain))) : 0,
    climbs,
    sprints,
    sectors,
    segments,
    elevation: normalizeElevation(raw.elevation_profile, D),
  };
}

export type FetchResult = { ok: true; route: StageRoute } | { ok: false; status: number; error: string };

/**
 * Henter én etape fra backendens offentlige endpoint. 404 videregives; alt andet (timeout,
 * 5xx, ugyldigt svar) bliver 502, så et billede aldrig caches som "fundet" på en fejl.
 */
export async function fetchStageRoute(
  stageId: string,
  { origin = DEFAULT_API_ORIGIN, fetchImpl = fetch, timeoutMs = 4000 }: { origin?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FetchResult> {
  if (!UUID_RE.test(stageId)) return { ok: false, status: 400, error: "id must be a stage uuid" };
  const url = `${origin.replace(/\/+$/, "")}/api/public/stage-route/${encodeURIComponent(stageId)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, status: 502, error: "stage source unavailable" };
  }
  if (res.status === 404) return { ok: false, status: 404, error: "stage not found" };
  if (!res.ok) return { ok: false, status: 502, error: "stage source unavailable" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: 502, error: "stage source returned invalid data" };
  }
  const stage = (body as { stage?: Record<string, unknown> } | null)?.stage;
  const route = normalizeStageRoute(stage);
  if (!route) return { ok: false, status: 404, error: "stage has no route" };
  return { ok: true, route };
}
