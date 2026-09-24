// #5686 · Ren datamodel for ejerens værdi-forhåndsvisning (AdminValuePreviewPage).
//
// Serveren (GET /api/admin/value-preview, backend/lib/adminValuePreview.js)
// regner hele populationen FØR/EFTER én gang og cacher svaret i 5 min. Alt her
// er ren klient-side omformning af det svar: filtre, sortering, totaler og
// fordeling er gratis i browseren, så ejeren kan skifte filter uden at vente på
// en ny beregning af ~7.000 ryttere. Ingen fil her kalder netværket.

export interface PreviewRider {
  id: string;
  name: string;
  teamId: string | null;
  human: boolean;
  isAcademy: boolean;
  age: number | null;
  type: string | null;
  valuationType: string | null;
  before: number;
  after: number;
  cpvBefore: number | null;
  cpvAfter: number | null;
}

export interface PreviewTeam {
  id: string;
  name: string | null;
  division: number | null;
  human: boolean;
}

export interface ValuePreviewPayload {
  from: string;
  to: string;
  step: number;
  steps: number[];
  stepSensitive: boolean;
  wageModel: string;
  modelIds: string[];
  seasonNumber: number | null;
  computedAt: string | null;
  riders: PreviewRider[];
  teams: PreviewTeam[];
  skipped: number;
  liveDrift: number;
  wageControl: { moved: number; movedOnTeams: number };
}

export interface PreviewRow extends PreviewRider {
  teamName: string | null;
  division: number | null;
  deltaKr: number;
  deltaPct: number | null;
}

export type Scope = "managers" | "all";
export type AgeBand = "all" | "u22" | "22-25" | "26-29" | "30+";
export const AGE_BANDS: readonly AgeBand[] = ["u22", "22-25", "26-29", "30+"];

export interface PreviewFilters {
  scope: Scope;
  division: string; // "all" eller divisionsnummeret som tekst
  teamId: string; // "all" eller hold-id
  type: string; // "all" eller typenøgle
  ageBand: AgeBand;
  q: string;
}

export const DEFAULT_FILTERS: PreviewFilters = {
  scope: "managers",
  division: "all",
  teamId: "all",
  type: "all",
  ageBand: "all",
  q: "",
};

export type RowSortKey = "name" | "age" | "before" | "after" | "deltaKr" | "deltaPct";
export type TeamSortKey = "name" | "n" | "before" | "after" | "deltaKr" | "deltaPct";
export type SortDir = "asc" | "desc";

export function deltaPct(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || !(before > 0)) return null;
  return ((after - before) / before) * 100;
}

export function buildRows(payload: Pick<ValuePreviewPayload, "riders" | "teams"> | null | undefined): PreviewRow[] {
  if (!payload) return [];
  const teamById = new Map((payload.teams ?? []).map((t) => [t.id, t]));
  return (payload.riders ?? []).map((r) => {
    const team = r.teamId ? teamById.get(r.teamId) : undefined;
    return {
      ...r,
      teamName: team?.name ?? null,
      division: team?.division ?? null,
      deltaKr: r.after - r.before,
      deltaPct: deltaPct(r.before, r.after),
    };
  });
}

export function ageBandOf(age: number | null): AgeBand | null {
  if (age == null) return null;
  if (age < 22) return "u22";
  if (age <= 25) return "22-25";
  if (age <= 29) return "26-29";
  return "30+";
}

export function filterRows(rows: PreviewRow[], filters: PreviewFilters): PreviewRow[] {
  const q = filters.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.scope === "managers" && !r.human) return false;
    if (filters.division !== "all" && String(r.division ?? "") !== filters.division) return false;
    if (filters.teamId !== "all" && r.teamId !== filters.teamId) return false;
    if (filters.type !== "all" && r.type !== filters.type) return false;
    if (filters.ageBand !== "all" && ageBandOf(r.age) !== filters.ageBand) return false;
    if (q && !r.name.toLowerCase().includes(q) && !(r.teamName ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// null (ukendt ændring) sorteres altid sidst, uanset retning: en rytter uden
// FØR-værdi må ikke skubbe de største fald ned under folden.
function compare(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const c = typeof a === "string" || typeof b === "string"
    ? String(a).localeCompare(String(b))
    : a - b;
  return dir === "asc" ? c : -c;
}

export function sortRows<T extends { id: string }>(rows: T[], key: keyof T & string, dir: SortDir): T[] {
  return [...rows].sort((x, y) => {
    const c = compare(x[key] as number | string | null, y[key] as number | string | null, dir);
    return c !== 0 ? c : x.id.localeCompare(y.id);
  });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface PreviewSummary {
  n: number;
  before: number;
  after: number;
  deltaKr: number;
  deltaPct: number | null;
  up: number;
  down: number;
  same: number;
  drop25: number;
  drop50: number;
  medianPct: number | null;
}

export function summarize(rows: PreviewRow[]): PreviewSummary {
  let before = 0;
  let after = 0;
  let up = 0;
  let down = 0;
  let drop25 = 0;
  let drop50 = 0;
  const pcts: number[] = [];
  for (const r of rows) {
    before += r.before;
    after += r.after;
    if (r.after > r.before) up += 1;
    else if (r.after < r.before) down += 1;
    if (r.deltaPct != null) {
      pcts.push(r.deltaPct);
      if (r.deltaPct <= -25) drop25 += 1;
      if (r.deltaPct <= -50) drop50 += 1;
    }
  }
  return {
    n: rows.length,
    before,
    after,
    deltaKr: after - before,
    deltaPct: deltaPct(before, after),
    up,
    down,
    same: rows.length - up - down,
    drop25,
    drop50,
    medianPct: median(pcts),
  };
}

export interface TeamRow {
  id: string;
  name: string;
  division: number | null;
  human: boolean;
  n: number;
  before: number;
  after: number;
  deltaKr: number;
  deltaPct: number | null;
}

// Totaler pr. hold over de FILTREREDE ryttere (så "kun klatrere" giver
// holdenes klatrer-sum). Ryttere uden hold (fri agenter) har ingen række.
export function teamTotals(rows: PreviewRow[]): TeamRow[] {
  const byTeam = new Map<string, TeamRow>();
  for (const r of rows) {
    if (!r.teamId) continue;
    let t = byTeam.get(r.teamId);
    if (!t) {
      t = { id: r.teamId, name: r.teamName ?? r.teamId, division: r.division, human: r.human, n: 0, before: 0, after: 0, deltaKr: 0, deltaPct: null };
      byTeam.set(r.teamId, t);
    }
    t.n += 1;
    t.before += r.before;
    t.after += r.after;
  }
  return [...byTeam.values()].map((t) => ({ ...t, deltaKr: t.after - t.before, deltaPct: deltaPct(t.before, t.after) }));
}

export interface FilterOptions {
  types: string[];
  divisions: number[];
  teams: { id: string; name: string }[];
}

// Valgmulighederne udledes af rækkerne, ikke af en hårdkodet liste: kommer der
// en ny type eller division, dukker den op af sig selv. Holdlisten følger
// scope, så "kun managerhold" ikke tilbyder 60 AI-hold.
export function filterOptions(rows: PreviewRow[], scope: Scope): FilterOptions {
  const types = new Set<string>();
  const divisions = new Set<number>();
  const teams = new Map<string, string>();
  for (const r of rows) {
    if (scope === "managers" && !r.human) continue;
    if (r.type) types.add(r.type);
    if (r.division != null) divisions.add(r.division);
    if (r.teamId) teams.set(r.teamId, r.teamName ?? r.teamId);
  }
  return {
    types: [...types].sort(),
    divisions: [...divisions].sort((a, b) => a - b),
    teams: [...teams.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Trin-planen: 0 = kørselsdagen, 1-4 = uge 1-4 (#5497). Nøglerne er i18n-nøgler.
export function stepLabelKey(step: number): string {
  return step === 0 ? "valuePreview.steps.runDay" : "valuePreview.steps.week";
}

// Hvor mange rækker tabellen viser før "Vis flere". ~7.000 DOM-rækker på én gang
// gør siden træg uden at give ejeren mere: de største udsving står øverst.
export const ROW_PAGE_SIZE = 200;
