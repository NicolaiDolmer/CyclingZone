// #6570 · Etapeside 2.0: ren logik bag fladen (ingen React, ingen DOM), saa
// `node --test` kan loade modulet direkte.
//
// SANDHEDSPRINCIP (TASTE P11): alt her afledes af rigtige kilder:
//   - race_stage_profiles (elevation_profile naar den findes, ellers samme
//     syntese som dagens graf, stageRouteProfile.buildProfileSeries)
//   - race_results (etape- og dag-klassementer)
//   - GET /races/:id/stage-roles (egne ryttere, rolle, route fit pr. etape)
//   - race_stage_schedule (tider)
// Kan noget ikke afledes aerligt, returneres null/[] og fladen udelader det.

import { buildProfileSeries, hasRouteData } from "../../../lib/stageRouteProfile.js";
import { topDemands } from "../../../lib/stageTerrain.js";
import { stageHasIntention } from "../../../lib/raceOverviewLogic.js";
import { classificationRowsForStage } from "../../../lib/raceStageClassifications.js";
import { parseGapSeconds } from "../../../lib/raceLiveStandings.js";

// ── Typer ──────────────────────────────────────────────────────────────────

export interface Climb {
  name?: string | null;
  category?: string | null;
  crest_km: number;
  length_km: number;
  avg_gradient: number;
  summit_finish?: boolean;
}

export interface Sector { kind?: string; start_km?: number; length_km?: number; name?: string }

export interface StageProfile {
  race_id?: string;
  stage_number?: number | null;
  profile_type?: string | null;
  finale_type?: string | null;
  demand_vector?: Record<string, number> | null;
  distance_km?: number | null;
  elevation_gain_m?: number | null;
  climbs?: Climb[] | null;
  sprints?: Array<{ name?: string; km: number; kind?: string }> | null;
  sectors?: Sector[] | null;
  elevation_profile?: { v?: number; step_km?: number; h?: number[] } | null;
}

export interface ResultRow {
  id?: string | number;
  stage_number?: number | null;
  result_type: string;
  rank?: number | null;
  rider_id?: string | null;
  rider_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  finish_time?: string | null;
  rider?: { id?: string; firstname?: string | null; lastname?: string | null; nationality_code?: string | null; team?: { id?: string; name?: string } | null } | null;
}

export interface RoleRider {
  rider_id: string;
  name: string | null;
  race_role: string | null;
  abandoned?: boolean;
  stage_fit?: Record<string, number> | null;
}

export interface RoleOverride { stage_number: number; rider_id: string; race_role?: string | null; effort?: string | null }

export interface ScheduleRow { stage_number: number; scheduled_at: string }

// ── Hoejdeserie ────────────────────────────────────────────────────────────

export interface ElevationSeries {
  kms: number[];
  hs: number[];
  /** "profile" = rigtig serie pr. 0,5 km (#6594); "synthetic" = dagens tegning. */
  source: "profile" | "synthetic";
}

/** Serien hvis den findes og er gyldig, ellers dagens syntese. null = ingen rutedata. */
export function elevationSeries(profile: StageProfile | null | undefined): ElevationSeries | null {
  if (!profile || !hasRouteData(profile)) return null;
  const ep = profile.elevation_profile;
  const D = Number(profile.distance_km);
  if (ep && Array.isArray(ep.h) && ep.h.length >= 2 && ep.h.every((v) => Number.isFinite(v))) {
    const step = Number(ep.step_km) > 0 ? Number(ep.step_km) : D / (ep.h.length - 1);
    const kms = ep.h.map((_, i) => Math.min(D, +(i * step).toFixed(3)));
    return { kms, hs: ep.h.slice(), source: "profile" };
  }
  const s = buildProfileSeries(profile);
  if (!s) return null;
  return { kms: s.xs.slice(), hs: s.ys.slice(), source: "synthetic" };
}

/** Lineaer interpolation af hoejden ved km. */
export function elevationAt(series: ElevationSeries, km: number): number {
  const { kms, hs } = series;
  if (km <= kms[0]) return hs[0];
  for (let i = 1; i < kms.length; i++) {
    if (km <= kms[i]) {
      const span = kms[i] - kms[i - 1];
      const t = span > 0 ? (km - kms[i - 1]) / span : 1;
      return hs[i - 1] + t * (hs[i] - hs[i - 1]);
    }
  }
  return hs[hs.length - 1];
}

/** Stigning i procent mellem to punkter. */
export function gradePct(km0: number, h0: number, km1: number, h1: number): number {
  const dx = (km1 - km0) * 1000;
  return dx > 0 ? ((h1 - h0) / dx) * 100 : 0;
}

/** Gradient-baandet paa profilen (artifact v7): ned, flad, og fire stigningsbaand. */
export type GradeBand = "down" | "flat" | 2 | 3 | 4 | 5;
export function gradeBand(g: number): GradeBand {
  if (g <= -3) return "down";
  if (g < 3) return "flat";
  if (g < 6) return 2;
  if (g < 8) return 3;
  if (g < 10) return 4;
  return 5;
}

export interface ColouredSegment { km0: number; km1: number; h0: number; h1: number; grade: number; band: GradeBand }

/**
 * Segmenter til farvning. Med den rigtige serie er hvert skridt (0,5 km) et
 * segment; den syntetiske serie samples i 0,5 km-skridt, saa farvningen ser
 * ens ud, men den er kun saa sand som tegningen.
 */
export function colouredSegments(series: ElevationSeries, stepKm = 0.5): ColouredSegment[] {
  const out: ColouredSegment[] = [];
  const end = series.kms[series.kms.length - 1];
  if (series.source === "profile") {
    for (let i = 1; i < series.kms.length; i++) {
      const km0 = series.kms[i - 1], km1 = series.kms[i];
      const h0 = series.hs[i - 1], h1 = series.hs[i];
      const grade = gradePct(km0, h0, km1, h1);
      out.push({ km0, km1, h0, h1, grade, band: gradeBand(grade) });
    }
    return out;
  }
  for (let km0 = 0; km0 < end - 1e-9; km0 += stepKm) {
    const km1 = Math.min(end, km0 + stepKm);
    const h0 = elevationAt(series, km0), h1 = elevationAt(series, km1);
    const grade = gradePct(km0, h0, km1, h1);
    out.push({ km0, km1, h0, h1, grade, band: gradeBand(grade) });
  }
  return out;
}

// ── Stigninger ─────────────────────────────────────────────────────────────

export function sortedClimbs(profile: StageProfile | null | undefined): Climb[] {
  const climbs = Array.isArray(profile?.climbs) ? profile!.climbs! : [];
  return climbs
    .filter((c) => Number.isFinite(Number(c.crest_km)) && Number(c.length_km) > 0)
    .slice()
    .sort((a, b) => Number(a.crest_km) - Number(b.crest_km));
}

export interface ClimbKm { index: number; grade: number; band: GradeBand; fraction: number }
export interface ClimbDetail {
  climb: Climb;
  startKm: number;
  topKm: number;
  topElevation: number | null;
  kmToGo: number;
  /** km-for-km kun med den rigtige serie; ellers []. */
  perKm: ClimbKm[];
  steepest: { grade: number; index: number } | null;
  hardest5: number | null;
}

export function climbDetail(profile: StageProfile, series: ElevationSeries | null, climb: Climb): ClimbDetail {
  const D = Number(profile.distance_km) || 0;
  const topKm = Number(climb.crest_km);
  const len = Number(climb.length_km);
  const startKm = Math.max(0, topKm - len);
  const perKm: ClimbKm[] = [];
  if (series && series.source === "profile") {
    const n = Math.ceil(len - 1e-9);
    for (let i = 0; i < n; i++) {
      const a = startKm + i;
      const b = Math.min(topKm, a + 1);
      if (b - a <= 0.05) continue;
      const grade = gradePct(a, elevationAt(series, a), b, elevationAt(series, b));
      perKm.push({ index: i + 1, grade, band: gradeBand(grade), fraction: b - a });
    }
  }
  let steepest: ClimbDetail["steepest"] = null;
  for (const k of perKm) if (k.fraction >= 0.5 && (!steepest || k.grade > steepest.grade)) steepest = { grade: k.grade, index: k.index };
  let hardest5: number | null = null;
  if (series && series.source === "profile" && len >= 5) {
    for (let a = startKm; a + 5 <= topKm + 1e-9; a += 0.5) {
      const g = gradePct(a, elevationAt(series, a), a + 5, elevationAt(series, a + 5));
      if (hardest5 === null || g > hardest5) hardest5 = g;
    }
  }
  return {
    climb,
    startKm,
    topKm,
    topElevation: series ? Math.round(elevationAt(series, topKm)) : null,
    kmToGo: Math.max(0, Math.round(D - topKm)),
    perKm,
    steepest,
    hardest5,
  };
}

// ── Underlag: kun naar det ikke er asfalt (ejer 14/10) ─────────────────────

export function surfaceOf(profile: StageProfile | null | undefined): { kind: "cobbles" | "gravel"; count: number; km: number } | null {
  const sectors = Array.isArray(profile?.sectors) ? profile!.sectors! : [];
  if (!sectors.length) return null;
  const kind = sectors.some((s) => s?.kind === "gravel") || profile?.profile_type === "gravel" ? "gravel" : "cobbles";
  const km = sectors.reduce((sum, s) => sum + (Number(s?.length_km) || 0), 0);
  return { kind, count: sectors.length, km: Math.round(km * 10) / 10 };
}

// ── "The day demands" i ord ────────────────────────────────────────────────
// Rang, ikke taerskler: den tungeste evne afgoer dagen, de naeste betyder noget.
export type DemandLevel = "decides" | "matters" | "helps";
export function dayDemands(demandVector: Record<string, number> | null | undefined): Array<{ ability: string; level: DemandLevel }> {
  const levels: DemandLevel[] = ["decides", "matters", "matters", "helps"];
  return (topDemands(demandVector, 4) as Array<{ ability: string; weight: number }>).map((d, i) => ({ ability: d.ability, level: levels[i] }));
}

// ── Etaper: i dag, fase, tid ───────────────────────────────────────────────

const CPH_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });
export function copenhagenDay(d: Date): string {
  return CPH_DATE.format(d);
}

/**
 * Den etape siden aabner paa uden ?stage=: etapen der koeres i dag
 * (dansk tid). Ellers den senest koerte, ellers etape 1.
 */
export function defaultStage({ totalStages, stagesCompleted, schedule, now }: { totalStages: number; stagesCompleted: number; schedule: ScheduleRow[]; now: Date }): number {
  const today = copenhagenDay(now);
  const todays = (schedule || [])
    .filter((s) => {
      const d = new Date(s.scheduled_at);
      return !Number.isNaN(d.getTime()) && copenhagenDay(d) === today;
    })
    .map((s) => s.stage_number)
    .filter((n) => n >= 1 && n <= totalStages);
  if (todays.length) return Math.min(...todays);
  if (stagesCompleted > 0) return Math.min(totalStages, stagesCompleted);
  return 1;
}

export function stagePhase(stageNumber: number, stagesCompleted: number): "before" | "after" {
  return stageNumber <= stagesCompleted ? "after" : "before";
}

// ── Navne og tider ─────────────────────────────────────────────────────────

export function shortName(full: string | null | undefined): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function rowName(r: ResultRow): string {
  if (r.rider) {
    const n = `${r.rider.firstname ?? ""} ${r.rider.lastname ?? ""}`.trim();
    if (n) return n;
  }
  return r.rider_name || "";
}

function teamOf(r: ResultRow): string | null {
  const id = r.team_id ?? r.rider?.team?.id ?? null;
  return id == null ? null : String(id);
}

function isMine(r: ResultRow, myTeamId: string | null): boolean {
  return myTeamId != null && teamOf(r) === String(myTeamId);
}

/** "+1:32" fra sekunder. */
export function formatGap(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `+${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `+${m}:${String(x).padStart(2, "0")}`;
}

// ── Etapestriben: dit resultat paa koerte etaper ───────────────────────────

/**
 * Bedste placering for dit hold paa hver koert etape, fra de smalle
 * hele-loebs "stage"-raekker (stagePointsRows). Navnet slaas op i dine egne
 * ryttere (stage-roles), aldrig gaettet.
 */
export function myBestByStage(rows: ResultRow[], myTeamId: string | null, nameById: Map<string, string>): Record<number, { rank: number; name: string }> {
  const out: Record<number, { rank: number; name: string }> = {};
  if (myTeamId == null) return out;
  for (const r of rows || []) {
    if (r.result_type !== "stage" || !isMine(r, myTeamId) || !Number.isFinite(Number(r.rank))) continue;
    const n = r.stage_number ?? 1;
    const rank = Number(r.rank);
    if (!out[n] || rank < out[n].rank) out[n] = { rank, name: nameById.get(String(r.rider_id)) || rowName(r) };
  }
  return out;
}

// ── Your day ───────────────────────────────────────────────────────────────

export interface DayRow { key: string; rank: number | null; riderId: string | null; name: string; nation: string | null; gap: string | null; mine: boolean }

function toDayRow(r: ResultRow, myTeamId: string | null): DayRow {
  return {
    key: String(r.id ?? `${r.rank}-${r.rider_id}`),
    rank: Number.isFinite(Number(r.rank)) ? Number(r.rank) : null,
    riderId: r.rider_id ?? null,
    name: rowName(r),
    nation: r.rider?.nationality_code ?? null,
    gap: r.finish_time ?? null,
    mine: isMine(r, myTeamId),
  };
}

export interface YourDay {
  top3: DayRow[];
  mine: DayRow[];
  bestOverall: { rank: number; name: string; gapToLeader: string | null; leaderName: string } | null;
  winner: DayRow | null;
}

/**
 * "Your day"-kortet for etape N: top 3 og dine ryttere med placering uanset
 * plads, for etapen eller det samlede efter etapen.
 */
export function yourDay(results: ResultRow[], stageNumber: number, myTeamId: string | null, cls: "stage" | "gc"): YourDay {
  const rows = classificationRowsForStage(results, stageNumber, cls) as ResultRow[];
  const gcRows = classificationRowsForStage(results, stageNumber, "gc") as ResultRow[];
  const top3 = rows.slice(0, 3).map((r) => toDayRow(r, myTeamId));
  const mine = rows.filter((r) => isMine(r, myTeamId)).map((r) => toDayRow(r, myTeamId));
  const myGc = gcRows.filter((r) => isMine(r, myTeamId) && Number.isFinite(Number(r.rank)));
  const leader = gcRows[0];
  let bestOverall: YourDay["bestOverall"] = null;
  if (myGc.length && leader) {
    const best = myGc[0];
    bestOverall = {
      rank: Number(best.rank),
      name: rowName(best),
      gapToLeader: Number(best.rank) === 1 ? null : best.finish_time ?? null,
      leaderName: rowName(leader),
    };
  }
  const stageRows = classificationRowsForStage(results, stageNumber, "stage") as ResultRow[];
  return { top3, mine, bestOverall, winner: stageRows[0] ? toDayRow(stageRows[0], myTeamId) : null };
}

/** Etapens margin mellem nr. 1 og nr. 2 i sekunder (null hvis ukendt). */
export function winningMargin(results: ResultRow[], stageNumber: number): number | null {
  const rows = classificationRowsForStage(results, stageNumber, "stage") as ResultRow[];
  if (rows.length < 2 || !rows[1].finish_time) return null;
  return parseGapSeconds(rows[1].finish_time);
}

// ── Opstilling + taktik-status ─────────────────────────────────────────────

export interface LineupRider { riderId: string; name: string; role: string | null; fit: number | null }

/** Dine ryttere til etape N: rollen for netop den etape (override vinder), route fit pr. etape. */
export function lineupFor(riders: RoleRider[], overrides: RoleOverride[], stageNumber: number): LineupRider[] {
  const roleOverride = new Map<string, string>();
  for (const o of overrides || []) if (o.stage_number === stageNumber && o.race_role) roleOverride.set(o.rider_id, o.race_role);
  const order: Record<string, number> = { captain: 0, sprint_captain: 1, hunter: 2, free_role: 3, helper: 4 };
  return (riders || [])
    .filter((r) => !r.abandoned)
    .map((r) => {
      const fitRaw = r.stage_fit ? r.stage_fit[String(stageNumber)] : undefined;
      return {
        riderId: r.rider_id,
        name: r.name || "",
        role: roleOverride.get(r.rider_id) ?? r.race_role ?? null,
        fit: Number.isFinite(Number(fitRaw)) ? Math.round(Number(fitRaw)) : null,
      };
    })
    .sort((a, b) => (order[a.role ?? ""] ?? 5) - (order[b.role ?? ""] ?? 5) || (b.fit ?? -1) - (a.fit ?? -1));
}

/** "x of 3 done": hold udtaget, kaptajn sat, intention sat for etape N. */
export function tacticsProgress(riders: RoleRider[], overrides: RoleOverride[], stageNumber: number): { done: number; total: number } {
  const picked = (riders || []).length > 0;
  const captain = (riders || []).some((r) => r.race_role === "captain");
  const intention = stageHasIntention({
    overrides: (overrides || []).map((o) => ({ stage_number: o.stage_number, rider_id: o.rider_id, effort: o.effort ?? undefined })),
    stageNumber,
  });
  return { done: [picked, captain, intention].filter(Boolean).length, total: 3 };
}

// ── Favoritter: fra loebet indtil nu, uden route fit for andre ─────────────

export interface Favourite { riderId: string; name: string; nation: string | null; mine: boolean; reasons: Array<{ key: "leadsOverall" | "overall" | "wonStage"; params: Record<string, string | number> }> }

/**
 * Favoritter til etape N ud fra loebet indtil nu: top i det samlede efter
 * etape N-1 og etapevindere. Foer foerste etape er der intet aerligt grundlag
 * i loebet, og listen er tom (kortet udelades).
 */
export function favouritesFor(results: ResultRow[], stagePointRows: ResultRow[], stageNumber: number, myTeamId: string | null, limit = 5): Favourite[] {
  const prev = stageNumber - 1;
  if (prev < 1) return [];
  const gc = classificationRowsForStage(results, prev, "gc") as ResultRow[];
  const byRider = new Map<string, Favourite>();
  const names = new Map<string, ResultRow>();
  for (const r of [...(results || []), ...gc]) if (r.rider_id && !names.has(r.rider_id) && rowName(r)) names.set(r.rider_id, r);
  for (const r of gc.slice(0, limit)) {
    if (!r.rider_id) continue;
    const rank = Number(r.rank);
    byRider.set(r.rider_id, {
      riderId: r.rider_id,
      name: rowName(r),
      nation: r.rider?.nationality_code ?? null,
      mine: isMine(r, myTeamId),
      reasons: [rank === 1 ? { key: "leadsOverall", params: {} } : { key: "overall", params: { rank, gap: r.finish_time ?? "" } }],
    });
  }
  const wins = (stagePointRows || [])
    .filter((r) => r.result_type === "stage" && Number(r.rank) === 1 && (r.stage_number ?? 1) <= prev && r.rider_id)
    .sort((a, b) => (b.stage_number ?? 1) - (a.stage_number ?? 1));
  for (const w of wins) {
    const id = w.rider_id as string;
    const known = names.get(id);
    if (!byRider.has(id)) {
      if (!known || byRider.size >= limit + 1) continue;
      byRider.set(id, { riderId: id, name: rowName(known), nation: known.rider?.nationality_code ?? null, mine: isMine(w, myTeamId), reasons: [] });
    }
    byRider.get(id)!.reasons.push({ key: "wonStage", params: { number: w.stage_number ?? 1 } });
  }
  return [...byRider.values()];
}

// ── Tider ──────────────────────────────────────────────────────────────────

export function scheduleFor(schedule: ScheduleRow[], stageNumber: number): Date | null {
  const row = (schedule || []).find((s) => s.stage_number === stageNumber);
  if (!row) return null;
  const d = new Date(row.scheduled_at);
  return Number.isNaN(d.getTime()) ? null : d;
}
