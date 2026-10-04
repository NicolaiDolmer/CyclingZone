// Roadmap-hub, admin-fanen (#6151, spec §4): ren logik bag
// /admin/growth?tab=roadmap. Ingen React, ingen Supabase, så alt her kan testes
// med node --test.
//
// De fire delte typer ejes af spor 2 (frontend/src/lib/roadmapModel.ts, #6150).
// Den fil findes ikke i dette spors worktree endnu, så typerne er deklareret
// lokalt her og samles ved merge (importér dem derfra, når spor 2 er på main).
export type RoadmapStatus = "active" | "planned" | "in_progress" | "shipped" | "archived";
export type RoadmapHorizon = "next" | "later";
export type IssueStatus = "checking" | "confirmed" | "fixing" | "fixed" | "dismissed";
export type IssueArea = "races" | "training" | "youth" | "market" | "club" | "other";

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
  flag_key?: string | null;
  beta_since?: string | null;
  beta_soon?: boolean;
  live_soon?: boolean;
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
    };
  });
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
