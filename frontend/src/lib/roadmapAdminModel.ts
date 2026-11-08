// Roadmap-hub, admin-fanen (#6151, spec §4): ren logik bag
// /admin/growth?tab=roadmap. Ingen React, ingen Supabase, så alt her kan testes
// med node --test.
//
// De fire delte typer ejes af spillersiden (lib/roadmapModel.ts, #6150, planens
// "Fælles kontrakt") og gen-eksporteres her, så admin-fladens importer er uændrede.
import type { RoadmapStatus, RoadmapHorizon, IssueStatus, IssueArea } from "./roadmapModel.ts";
import { HORIZON_ORDER, UNSCHEDULED, parseHorizon } from "./roadmapModel.ts";
export type { RoadmapStatus, RoadmapHorizon, IssueStatus, IssueArea };

// Standardafvigelse på vigtighed, hvor "Deler spillerne" vises (spec §4).
export const SPLIT_SD = 1.75;
// Ca. så mange idéer står synlige på Vote ad gangen (spec §2 punkt 9).
export const IDEA_TARGET = 30;
export const SORT_STEP = 10;

export const ROADMAP_STATUSES: RoadmapStatus[] = ["active", "planned", "in_progress", "shipped", "archived"];
export const ISSUE_STATUSES: IssueStatus[] = ["checking", "confirmed", "fixing", "fixed", "dismissed"];
export const ISSUE_AREAS: IssueArea[] = ["races", "training", "youth", "market", "club", "other"];
const CLOSED_ISSUE: IssueStatus[] = ["fixed", "dismissed"];

type Num = number | string | null | undefined;

// En række fra roadmap_item_scores, evt. beriget med kontakt-felterne fra
// roadmap_items (viewet har dem ikke, se mergeItemRows).
export interface ScoreRow {
  item_id: string;
  status: RoadmapStatus | string;
  title_en: string;
  title_da?: string;
  engine?: string;
  approved?: boolean;
  votes?: Num;
  avg_idea?: Num;
  avg_importance?: Num;
  steering_score?: Num;
  sort_order?: Num;
  horizon?: RoadmapHorizon | string;
  issue_ref?: number | null;
  idea_votes?: Num;
  sd_importance?: Num;
  // #7788: svar uden tal. Tæller hverken i votes eller i snittene.
  dont_know?: Num;
  flag_key?: string | null;
  beta_since?: string | null;
  beta_soon?: boolean;
  live_soon?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
}

export interface IssueScoreRow {
  issue_id: string;
  status: IssueStatus | string;
  reports?: Num;
  [key: string]: unknown;
}

export interface ItemFlagRow {
  id: string;
  flag_key: string | null;
  beta_since: string | null;
  beta_soon: boolean;
  live_soon: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
}

export interface IssueUpdateRow {
  issue_id: string;
  created_at: string;
  [key: string]: unknown;
}

// PostgREST sender numeric som tal, men en tekst må ikke vælte sorteringen.
function num(value: Num): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Faldende, null sidst.
function desc(a: Num, b: Num): number {
  const x = num(a), y = num(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

const byOwnOrder = (a: ScoreRow, b: ScoreRow) =>
  (num(a.sort_order) ?? 0) - (num(b.sort_order) ?? 0) || a.title_en.localeCompare(b.title_en);

export function rankPlan<T extends ScoreRow>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "planned")
    .sort((a, b) => desc(a.avg_importance, b.avg_importance) || byOwnOrder(a, b));
}

// Synlige idéer (på Vote). Skjulte idéer står i ideaPool.
export function rankIdeas<T extends ScoreRow>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "active" && r.approved !== false)
    .sort((a, b) => desc(a.steering_score, b.steering_score) || desc(a.votes, b.votes));
}

export function ideaPool<T extends ScoreRow>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "active" && r.approved === false)
    .sort((a, b) => desc(a.votes, b.votes) || a.title_en.localeCompare(b.title_en));
}

export function visibleIdeaCount(rows: ScoreRow[]): number {
  return rows.filter((r) => r.status === "active" && r.approved !== false).length;
}

export function isSplit(sd: Num): boolean {
  const n = num(sd);
  return n !== null && n >= SPLIT_SD;
}

export function rankIssues<T extends IssueScoreRow>(rows: T[]) {
  const open = rows.filter((r) => !CLOSED_ISSUE.includes(r.status as IssueStatus));
  const byReports = (a: T, b: T) => desc(a.reports, b.reports);
  return {
    confirmed: open.filter((r) => r.status === "confirmed" || r.status === "fixing").sort(byReports),
    checking: open.filter((r) => r.status === "checking").sort(byReports),
  };
}

export function nextSortOrder(planned: ScoreRow[]): number {
  const max = planned.reduce((m, r) => Math.max(m, num(r.sort_order) ?? 0), 0);
  return max + SORT_STEP;
}

export function statusPatch(status: RoadmapStatus, now: string) {
  return { status, shipped_at: status === "shipped" ? now : null };
}

export function issueStatusPatch(status: IssueStatus, now: string) {
  return { status, closed_at: CLOSED_ISSUE.includes(status) ? now : null, updated_at: now };
}

// Ejerens rækkefølge (1, 2, 3 ...) for de planlagte punkter.
export function ownOrder(rows: ScoreRow[]): Map<string, number> {
  const planned = rows.filter((r) => r.status === "planned").sort(byOwnOrder);
  return new Map(planned.map((r, i) => [r.item_id, i + 1]));
}

// Flyt et punkt én plads op (-1) eller ned (+1) i ejerens rækkefølge. Har
// naboerne forskellig sort_order, byttes de to. Ellers nummereres hele planen om
// i trin af 10. Kun rækker hvis sort_order faktisk ændres, kommer med.
export function movePatches(planned: ScoreRow[], itemId: string, dir: -1 | 1) {
  const list = planned.filter((r) => r.status === "planned").sort(byOwnOrder);
  const i = list.findIndex((r) => r.item_id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const a = list[i], b = list[j];
  const sa = num(a.sort_order) ?? 0, sb = num(b.sort_order) ?? 0;
  if (sa !== sb) {
    return [{ item_id: a.item_id, sort_order: sb }, { item_id: b.item_id, sort_order: sa }];
  }
  const moved = [...list];
  moved[i] = b; moved[j] = a;
  return moved
    .map((r, k) => ({ item_id: r.item_id, sort_order: (k + 1) * SORT_STEP, before: num(r.sort_order) ?? 0 }))
    .filter((p) => p.sort_order !== p.before)
    .map(({ item_id, sort_order }) => ({ item_id, sort_order }))
    // Det flyttede punkt først, så rækkefølgen i patch-listen er forudsigelig.
    .sort((x, y) => (x.item_id === itemId ? -1 : y.item_id === itemId ? 1 : 0));
}

export function mergeItemRows<T extends ScoreRow>(rows: T[], items: ItemFlagRow[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => {
    const i = byId.get(r.item_id);
    return {
      ...r,
      flag_key: i?.flag_key ?? null,
      beta_since: i?.beta_since ?? null,
      beta_soon: i?.beta_soon ?? false,
      live_soon: i?.live_soon ?? false,
      created_at: i?.created_at ?? null,
      updated_at: i?.updated_at ?? null,
      shipped_at: i?.shipped_at ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Faner, filtre og sortering (#6204)
// ---------------------------------------------------------------------------

export type AdminTab = "ideas" | "planned" | "in_progress" | "shipped" | "issues" | "y2027" | "votes";

export const ADMIN_TABS: { key: AdminTab; label: string }[] = [
  { key: "ideas", label: "Idéer" },
  { key: "planned", label: "Planlagt" },
  { key: "in_progress", label: "I gang" },
  { key: "shipped", label: "Færdigt" },
  { key: "issues", label: "Kendte fejl" },
  { key: "y2027", label: "2027" },
  { key: "votes", label: "Stemmer" },
];

export const DEFAULT_ADMIN_TAB: AdminTab = "planned";

export function isAdminTab(value: unknown): value is AdminTab {
  return ADMIN_TABS.some((t) => t.key === value);
}

// Horisonter, som vælgeren tilbyder (#7895): planens rækkefølge + "uden tid"
// til idéer. Ny sæson/kvartal tilføjes i HORIZON_ORDER i roadmapModel.ts.
export const HORIZONS: readonly string[] = [...HORIZON_ORDER, UNSCHEDULED];
export type AdminHorizon = string;

/** Dansk navn på en horisont til admin ("Sæson 5", "Q1 2027"). */
export function horizonLabel(horizon: string | null | undefined): string {
  const h = parseHorizon(horizon);
  switch (h.kind) {
    case "week": return h.key === "this_week" ? "Denne uge" : "Næste uge";
    case "season": return `Sæson ${h.season}`;
    case "quarter": return `Q${h.quarter} ${h.year}`;
    case "year": return String(h.year);
    default: return "Uden tid";
  }
}

export const HORIZON_LABELS: Record<string, string> = Object.fromEntries(HORIZONS.map((h) => [h, horizonLabel(h)]));

const isYear2027 = (horizon: string | null | undefined): boolean => {
  const h = parseHorizon(horizon);
  return (h.kind === "quarter" || h.kind === "year") && h.year === 2027;
};

const DONE_STATUSES = ["shipped", "archived"];

// Hvilke rækker hører til en fane. 2027 går på tværs af status (alt, der endnu
// ikke er færdigt, og som er sat til 2027); Planlagt tager resten af de planlagte.
export function tabRows<T extends ScoreRow>(rows: T[], tab: AdminTab): T[] {
  switch (tab) {
    case "ideas": return rows.filter((r) => r.status === "active");
    case "planned": return rows.filter((r) => r.status === "planned" && !isYear2027(r.horizon));
    case "in_progress": return rows.filter((r) => r.status === "in_progress");
    case "shipped": return rows.filter((r) => r.status === "shipped");
    case "y2027": return rows.filter((r) => isYear2027(r.horizon) && !DONE_STATUSES.includes(r.status));
    // Et punkt med lutter Ved ikke er også et svar, admin skal kunne finde.
    case "votes": return rows.filter((r) => (num(r.votes) ?? 0) > 0 || (num(r.dont_know) ?? 0) > 0);
    default: return [];
  }
}

// Summen over punkterne. RPC'en har ikke tallet, så dens signatur kunne blive stående.
export function dontKnowTotal(rows: ScoreRow[]): number {
  return rows.reduce((sum, r) => sum + (num(r.dont_know) ?? 0), 0);
}

export interface RowFilters {
  area?: string;
  status?: string;
  horizon?: string;
  issue?: string;
}

const clean = (v: string | undefined) => (v ?? "").trim();

// Tomt filter = ingen begrænsning. Issue-filteret matcher et nummer (med eller
// uden #) som begyndelsen af issue-nummeret.
function matchesIssue(ref: number | null | undefined, query: string): boolean {
  const q = query.replace(/^#/, "").trim();
  if (!q) return true;
  return ref !== null && ref !== undefined && String(ref).startsWith(q);
}

export function filterItems<T extends ScoreRow>(rows: T[], f: RowFilters): T[] {
  const area = clean(f.area), status = clean(f.status), horizon = clean(f.horizon), issue = clean(f.issue);
  return rows.filter((r) =>
    (!area || r.engine === area)
    && (!status || r.status === status)
    && (!horizon || r.horizon === horizon)
    && matchesIssue(r.issue_ref, issue));
}

export function filterIssueRows<T extends IssueScoreRow>(rows: T[], f: RowFilters): T[] {
  const area = clean(f.area), status = clean(f.status), issue = clean(f.issue);
  return rows.filter((r) =>
    (!area || r.area === area)
    && (!status || r.status === status)
    && matchesIssue(r.issue_ref as number | null | undefined, issue));
}

export type SortDir = "asc" | "desc";
export interface SortState { key: string; dir: SortDir }

// Standardsortering pr. fane: det samme som tabellerne havde før fanerne.
export const DEFAULT_SORT: Record<AdminTab, SortState> = {
  ideas: { key: "score", dir: "desc" },
  planned: { key: "importance", dir: "desc" },
  in_progress: { key: "own", dir: "asc" },
  shipped: { key: "date", dir: "desc" },
  issues: { key: "reports", dir: "desc" },
  y2027: { key: "own", dir: "asc" },
  votes: { key: "votes", dir: "desc" },
};

type Accessor = (r: Record<string, unknown>) => string | number | null;
const numAcc = (field: string): Accessor => (r) => num(r[field] as Num);
const strAcc = (field: string): Accessor => (r) => {
  const v = r[field];
  return typeof v === "string" && v ? v : null;
};

// Én værdi pr. sorteringsnøgle. Punkter og fejl deler nøglerne, hvor de findes
// i begge ("title", "date", "status").
const ACCESSORS: Record<string, Accessor> = {
  title: (r) => String(r.title_da || r.title_en || "").toLowerCase() || null,
  votes: numAcc("votes"),
  dontKnow: numAcc("dont_know"),
  importance: numAcc("avg_importance"),
  idea: numAcc("avg_idea"),
  score: numAcc("steering_score"),
  own: numAcc("sort_order"),
  status: strAcc("status"),
  horizon: strAcc("horizon"),
  area: (r) => strAcc("engine")(r) ?? strAcc("area")(r),
  issue: numAcc("issue_ref"),
  reports: numAcc("reports"),
  days: numAcc("days_open"),
  // Færdigt-datoen, ellers sidst ændret, ellers oprettet.
  date: (r) => strAcc("shipped_at")(r) ?? strAcc("updated_at")(r) ?? strAcc("created_at")(r) ?? strAcc("closed_at")(r),
  beta: strAcc("beta_since"),
  flag: strAcc("flag_key"),
};

export const SORT_KEYS = Object.keys(ACCESSORS);

// Ved lighed gælder ejerens rækkefølge og så titlen, som tabellerne altid har
// gjort, så visningen stemmer med positionsnumrene og flyt-knapperne.
function tieBreak(a: object, b: object): number {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return (num(x.sort_order as Num) ?? 0) - (num(y.sort_order as Num) ?? 0)
    || String(x.title_en ?? "").localeCompare(String(y.title_en ?? ""));
}

// Stabil sortering; tomme værdier står altid sidst, uanset retning.
export function sortRows<T extends object>(rows: T[], sort: SortState): T[] {
  const acc = ACCESSORS[sort.key];
  if (!acc) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: acc(row as Record<string, unknown>) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return tieBreak(a.row, b.row) || a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const cmp = typeof a.value === "number" && typeof b.value === "number"
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), "da");
      return cmp * sign || tieBreak(a.row, b.row) || a.index - b.index;
    })
    .map((x) => x.row);
}

// Klik på en kolonne: samme nøgle vender retningen, ny nøgle starter stigende
// for tekst og faldende for tal (højeste først er det, man leder efter).
const TEXT_KEYS = ["title", "status", "horizon", "area", "flag", "beta"];
export function nextSort(current: SortState, key: string): SortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: TEXT_KEYS.includes(key) ? "asc" : "desc" };
}

export function tabCounts(rows: ScoreRow[], issues: IssueScoreRow[]): Record<AdminTab, number> {
  const openIssues = issues.filter((r) => !CLOSED_ISSUE.includes(r.status as IssueStatus)).length;
  const out = {} as Record<AdminTab, number>;
  for (const t of ADMIN_TABS) out[t.key] = t.key === "issues" ? openIssues : tabRows(rows, t.key).length;
  return out;
}

export function latestUpdateByIssue<T extends IssueUpdateRow>(updates: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const u of updates) {
    const prev = out.get(u.issue_id);
    if (!prev || u.created_at > prev.created_at) out.set(u.issue_id, u);
  }
  return out;
}

export function validateTitles(en: string | null | undefined, da: string | null | undefined): boolean {
  return Boolean(en && en.trim() && da && da.trim());
}

export function fmtScore(value: Num, digits = 2): string {
  const n = num(value);
  if (n === null) return "–";
  return n.toFixed(digits).replace(".", ",");
}
