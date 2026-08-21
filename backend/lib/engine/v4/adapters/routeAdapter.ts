// backend/lib/engine/v4/adapters/routeAdapter.ts
// Race Engine v4 F2 (#4030), Fase B4: oversaettelseslag race_stage_profiles-
// raekke -> RouteV2 (kerne-kontrakten, types.ts), med synthesizeSegments-
// fallback for legacy-etaper uden gemte segmenter.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md
//   §3 modul-layout ("adapters/routeAdapter.ts race_stage_profiles-række →
//   RouteV2 (synthesizeSegments-fallback for legacy)").
// Waypoint-konstruktionen (kom/sprint/finish) spejler backend/lib/racePassages.js
// (samme kontrakt, #2410 §2.2's forankring).
//
// UDENFOR renheds-graensen (designdoc §1): denne fil MAA importere backend-
// moduler (routeSegments.js). Funktionerne er stadig RENE (raekke-objekt ind,
// type ud — INGEN DB-kald her, det er kaldstedets ansvar at hente raekken).

import { buildWeather, synthesizeSegments } from "../../../routeSegments.js";
import { makeRng } from "../../../fictionalRiderGenerator.js";
import type {
  ClimbCategory,
  FinaleType,
  ProfileType,
  RouteV2,
  Segment,
  Waypoint,
  Weather,
} from "../types.ts";

// Kopi af types.ts's ProfileType-union (samme "duplikering er etableret
// moenster"-begrundelse som types.ts's egen header) — bruges KUN til
// defensivt at falde tilbage til "flat" ved en ukendt/manglende profile_type,
// spejler synthesizeSegments' egen interne DISTANCE_BANDS-gate (ikke eksporteret).
const KNOWN_PROFILE_TYPES = new Set<ProfileType>([
  "flat", "rolling", "hilly", "mountain", "high_mountain",
  "cobbles", "classic", "itt", "itt_hilly", "ttt",
]);

// Lokal FNV-1a 32-bit (samme selvstaendige moenster som routeSegments.js's
// egen lokale stableSeed — undgaar et krydsimport af selve hash-funktionen).
function stableSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Formen paa en race_stage_profiles-DB-raekke (§F1/#3855-migrationen tilfoejede
 * segments/weather som NULLABLE jsonb-kolonner — legacy-raekker har dem null).
 */
export type StageProfileRow = {
  id?: string | number | null;
  race_id?: string | number | null;
  stage_number?: number | null;
  profile_type?: string | null;
  finale_type?: string | null;
  distance_km?: number | null;
  climbs?: Array<{ name: string; crest_km: number; category?: string; summit_finish?: boolean }> | null;
  sprints?: Array<{ name: string; km: number; kind?: string }> | null;
  sectors?: unknown;
  segments?: Segment[] | null;
  weather?: Weather | null;
} & Record<string, unknown>;

function resolveProfileType(raw: unknown): ProfileType {
  return typeof raw === "string" && KNOWN_PROFILE_TYPES.has(raw as ProfileType) ? (raw as ProfileType) : "flat";
}

function resolveFinaleType(raw: unknown): FinaleType | null {
  return typeof raw === "string" && raw.length > 0 ? (raw as FinaleType) : null;
}

function resolveSegments(row: StageProfileRow, profileType: ProfileType, finaleType: FinaleType | null): Segment[] {
  if (Array.isArray(row.segments) && row.segments.length > 0) return row.segments;
  // Legacy-fallback (#3855 F1 punkt 3): deterministisk syntese, selv-afledt
  // seed af raekkens egne felter — INGEN rng-parameter, samme raekke giver
  // samme segmentliste, byte for byte.
  return synthesizeSegments({
    race_id: row.race_id != null ? String(row.race_id) : undefined,
    id: row.id != null ? String(row.id) : undefined,
    stage_number: row.stage_number ?? 1,
    profile_type: profileType,
    finale_type: finaleType,
    distance_km: row.distance_km ?? undefined,
  }) as Segment[];
}

/** distance_km fra raekken hvis gyldig, ellers afledt af segmentlistens sidste graense. */
function resolveDistanceKm(row: StageProfileRow, segments: Segment[]): number {
  const raw = Number(row.distance_km);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const last = segments[segments.length - 1];
  return last ? last.to_km : 0;
}

function resolveWeather(row: StageProfileRow, profileType: ProfileType): Weather {
  if (row.weather && typeof row.weather === "object") return row.weather;
  // Legacy-fallback: egen deterministisk rng-stroem (raekkens identitet + "weather"),
  // adskilt fra segment-syntesens stroem saa de to fallbacks ikke korrelerer kunstigt.
  const identity = row.race_id ?? row.id ?? "adhoc";
  const seedKey = `${String(identity)}:${row.stage_number ?? 1}:weather`;
  const rng = makeRng(stableSeed(seedKey));
  return buildWeather(rng, profileType) as Weather;
}

function resolveWaypoints(row: StageProfileRow, distanceKm: number): Waypoint[] {
  const climbs = Array.isArray(row.climbs) ? row.climbs : [];
  const sprints = Array.isArray(row.sprints) ? row.sprints : [];

  const waypoints: Waypoint[] = [
    ...climbs.map((c, i) => ({
      kind: "kom" as const,
      index: i,
      name: c.name,
      km: c.crest_km,
      category: c.category as ClimbCategory | undefined,
      summit_finish: !!c.summit_finish,
    })),
    ...sprints
      .filter((s) => s.kind === "intermediate")
      .map((s, i) => ({ kind: "sprint" as const, index: i, name: s.name, km: s.km })),
  ].sort((a, b) => a.km - b.km || (a.kind === "kom" ? -1 : 1));

  waypoints.push({ kind: "finish", index: 0, name: "Finish", km: distanceKm });
  return waypoints;
}

/**
 * REN oversaettelse: race_stage_profiles-raekke -> RouteV2 (kerne-kontrakten).
 * INGEN DB-kald — kaldstedet henter raekken. Legacy-raekker uden gemte
 * segments/weather faar en deterministisk synthesizeSegments/buildWeather-
 * fallback (#3855 F1 punkt 3), saa v4 kan simulere ALT fra dag 1.
 */
export function routeFromStageProfileRow(row: StageProfileRow): RouteV2 {
  const profileType = resolveProfileType(row.profile_type);
  const finaleType = resolveFinaleType(row.finale_type);
  const segments = resolveSegments(row, profileType, finaleType);
  const distanceKm = resolveDistanceKm(row, segments);
  const weather = resolveWeather(row, profileType);
  const waypoints = resolveWaypoints(row, distanceKm);

  return {
    distance_km: distanceKm,
    profile_type: profileType,
    finale_type: finaleType,
    segments,
    weather,
    waypoints,
  };
}
