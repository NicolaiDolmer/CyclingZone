// #6364 (S5-etapeprofiler, spec §1/§6): etapekortets data. Ren TypeScript, ingen React.
//
// To ting bor her:
//   1. De tre akser (terraen, afslutning, underlag) for en etape, laest fra raekkens gamle
//      etiketter. Det er en BEVIDST kopi af backend/lib/stageProfileLegacyMapping.js (browser-
//      koden kan ikke importere backend), og stageAxes.test.ts deepEqual'er den mod den ægte
//      funktion for alle kombinationer. Fejler testen, ret DENNE fil.
//   2. "Her afgoeres etapen" og "dagen kraever": afledt af etapens EGNE data (stigninger og
//      den gemte demand_vector), aldrig opfundet (TASTE P11).

import { topDemands } from "./stageTerrain.js";

export type TerrainAxis = "flat" | "rolling" | "hilly" | "medium_mountain" | "mountain" | "high_mountain";
export type FinishAxis =
  | "flat_sprint" | "uphill_sprint" | "punch" | "wall_finish" | "long_climb" | "descent" | "solo_tt" | "ttt";
export type SurfaceAxis = "asphalt" | "cobbles" | "gravel";
export type SectorKind = "cobbles" | "gravel";

export interface StageAxesInput {
  profile_type?: string | null;
  finale_type?: string | null;
  sectors?: Array<{ kind?: string; length_km?: number | string }> | null;
}

export interface StageAxes {
  terrain: TerrainAxis;
  finish: FinishAxis;
  surface: SurfaceAxis;
  sectors: Record<SectorKind, { count: number; km: number }>;
  inferred: { terrain: boolean; finish: boolean };
}

const TERRAIN_BY_PROFILE_TYPE: Readonly<Record<string, TerrainAxis>> = Object.freeze({
  flat: "flat",
  rolling: "rolling",
  hilly: "hilly",
  medium_mountain: "medium_mountain",
  mountain: "mountain",
  high_mountain: "high_mountain",
  itt: "flat",
  itt_hilly: "hilly",
  ttt: "flat",
  cobbles: "flat",
  gravel: "hilly",
  classic: "hilly",
});
const TERRAIN_LABELLED_DIRECTLY: readonly string[] = [
  "flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain",
];

const SURFACE_BY_PROFILE_TYPE: Readonly<Record<string, SurfaceAxis>> = Object.freeze({
  cobbles: "cobbles", gravel: "gravel",
});

// Finale-typer en raekke kan baere. `breakaway` er ikke en afslutning i S5 og falder
// tilbage til geometrien den gamle rutegenerator gav etapen.
const FINISH_BY_FINALE_TYPE: Readonly<Record<string, FinishAxis>> = Object.freeze({
  bunch_sprint: "flat_sprint",
  reduced_sprint: "flat_sprint",
  flat_sprint: "flat_sprint",
  uphill_sprint: "uphill_sprint",
  punch: "punch",
  wall_finish: "wall_finish",
  long_climb: "long_climb",
  descent: "descent",
  solo_tt: "solo_tt",
});
const FALLBACK_FINISH_BY_TERRAIN: Readonly<Record<TerrainAxis, FinishAxis>> = Object.freeze({
  flat: "flat_sprint",
  rolling: "flat_sprint",
  hilly: "descent",
  medium_mountain: "descent",
  mountain: "descent",
  high_mountain: "descent",
});

const SECTOR_KINDS: readonly SectorKind[] = ["cobbles", "gravel"];
const round1 = (n: number): number => Math.round(n * 10) / 10;

function isSectorKind(kind: unknown): kind is SectorKind {
  return typeof kind === "string" && (SECTOR_KINDS as readonly string[]).includes(kind);
}

export function summarizeSectors(sectors: StageAxesInput["sectors"]): StageAxes["sectors"] {
  const out: StageAxes["sectors"] = { cobbles: { count: 0, km: 0 }, gravel: { count: 0, km: 0 } };
  if (!Array.isArray(sectors)) return out;
  for (const s of sectors) {
    if (!s || !isSectorKind(s.kind)) continue;
    const km = Number(s.length_km);
    out[s.kind].count += 1;
    if (Number.isFinite(km) && km > 0) out[s.kind].km = round1(out[s.kind].km + km);
  }
  return out;
}

function surfaceOf(row: StageAxesInput): SurfaceAxis {
  const km: Record<SectorKind, number> = { cobbles: 0, gravel: 0 };
  const count: Record<SectorKind, number> = { cobbles: 0, gravel: 0 };
  for (const s of Array.isArray(row.sectors) ? row.sectors : []) {
    if (!s || !isSectorKind(s.kind)) continue;
    const len = Number(s.length_km);
    if (!Number.isFinite(len) || len <= 0) continue;
    km[s.kind] += len;
    count[s.kind] += 1;
  }
  if (count.cobbles > 0 || count.gravel > 0) {
    return count.gravel > 0 && km.gravel >= km.cobbles ? "gravel" : "cobbles";
  }
  return SURFACE_BY_PROFILE_TYPE[row.profile_type ?? ""] ?? "asphalt";
}

/**
 * En etape-raekke (S1-S4 eller S5) -> de tre akser. Ukendt profile_type -> null, saa
 * kortet viser intet frem for noget forkert.
 */
export function stageAxes(row: StageAxesInput | null | undefined): StageAxes | null {
  const profileType = row?.profile_type ?? "";
  const terrain = TERRAIN_BY_PROFILE_TYPE[profileType];
  if (!terrain || !row) return null;

  let finish: FinishAxis;
  let finishInferred = false;
  if (profileType === "ttt") {
    finish = "ttt";
  } else if (profileType === "itt" || profileType === "itt_hilly") {
    finish = "solo_tt";
  } else {
    const fromFinale = FINISH_BY_FINALE_TYPE[row.finale_type ?? ""];
    if (fromFinale) {
      finish = fromFinale;
    } else {
      finish = FALLBACK_FINISH_BY_TERRAIN[terrain];
      finishInferred = true;
    }
  }

  return {
    terrain,
    finish,
    surface: surfaceOf(row),
    sectors: summarizeSectors(row.sectors),
    inferred: { terrain: !TERRAIN_LABELLED_DIRECTLY.includes(profileType), finish: finishInferred },
  };
}

// ── Her afgoeres etapen ─────────────────────────────────────────────────────────

export interface ClimbInput {
  name?: string | null;
  category?: string | null;
  crest_km?: number | string;
  length_km?: number | string;
  avg_gradient?: number | string;
  summit_finish?: boolean | null;
}

export interface DecisiveClimb {
  name: string | null;
  category: string;
  crestKm: number;
  lengthKm: number;
  avgGradient: number;
  /** Km fra toppen til maal (0 ved bjergtop). */
  kmToGo: number;
  summit: boolean;
}

// UCI-kategori -> haardhed. Kat. 4 afgoer aldrig en etape (spec §2: tael ikke mod kuperet).
const CATEGORY_RANK: Readonly<Record<string, number>> = Object.freeze({ HC: 5, "1": 4, "2": 3, "3": 2, "4": 1 });
const MIN_DECISIVE_RANK = 2;

/**
 * Den afgoerende stigning: den hardeste kategori etapen har (kat. 3 eller haardere), og
 * blandt dem den der kommer SIDST. Tidskoersler afgoeres af uret og har ingen. Ingen
 * kategoriseret stigning -> null, saa kortet ikke paastaar noget.
 */
export function decisiveClimb(
  profile: { distance_km?: number | string; climbs?: ClimbInput[] | null; profile_type?: string | null } | null | undefined,
): DecisiveClimb | null {
  const distance = Number(profile?.distance_km);
  if (!profile || !Number.isFinite(distance) || distance <= 0) return null;
  if (profile.profile_type === "itt" || profile.profile_type === "itt_hilly" || profile.profile_type === "ttt") return null;
  const climbs = (Array.isArray(profile.climbs) ? profile.climbs : [])
    .filter((c) => (CATEGORY_RANK[String(c?.category)] ?? 0) >= MIN_DECISIVE_RANK && Number.isFinite(Number(c?.crest_km)))
    .slice()
    .sort((a, b) => Number(a.crest_km) - Number(b.crest_km));
  if (!climbs.length) return null;
  const hardest = Math.max(...climbs.map((c) => CATEGORY_RANK[String(c.category)]));
  const pick = climbs.filter((c) => CATEGORY_RANK[String(c.category)] === hardest).at(-1);
  if (!pick) return null;
  const crestKm = Number(pick.crest_km);
  const kmToGo = Math.max(0, distance - crestKm);
  return {
    name: pick.name ?? null,
    category: String(pick.category),
    crestKm,
    lengthKm: Number(pick.length_km),
    avgGradient: Number(pick.avg_gradient),
    kmToGo,
    summit: !!pick.summit_finish || kmToGo < 0.5,
  };
}

// ── Dagen kraever ──────────────────────────────────────────────────────────────

export type DemandLevel = "high" | "mid" | "low";
export interface DayDemand { ability: string; level: DemandLevel }

// Niveauet er en evnes vaegt MOD den stoerste vaegt paa etapen: mindst 60 % af den
// stoerste = hoej, mindst 25 % = mid, resten lav. Ord, ikke procenter (spec §6).
const HIGH_SHARE = 0.6;
const MID_SHARE = 0.25;

/**
 * "Dagen kraever": de fire evner etapen belønner mest, som hoej/mid/lav. Kilden er etapens
 * gemte demand_vector, dvs. NØJAGTIG det motoren regner paa (randomness er ikke en evne og
 * er udeladt). Tom/ulaeselig vektor -> tom liste (kortet skjuler blokken).
 */
export function dayDemands(demandVector: Record<string, number> | null | undefined, max = 4): DayDemand[] {
  const top = topDemands(demandVector, max) as Array<{ ability: string; weight: number }>;
  if (!top.length) return [];
  const lead = top[0].weight;
  return top.map(({ ability, weight }) => {
    const share = weight / lead;
    const level: DemandLevel = share >= HIGH_SHARE ? "high" : share >= MID_SHARE ? "mid" : "low";
    return { ability, level };
  });
}
