// Roadmap-hub (#5387, spor 2 #6150): ren logik for de fem faner på /roadmap.
// Ingen React, ingen Supabase, så alt her kan testes med node --test.
// Typerne RoadmapStatus/RoadmapHorizon/IssueStatus/IssueArea importeres også af
// admin-fanen (spor 3); alt admin-specifikt bor i dens egen model.
import { ENGINE_ORDER, isValidScore } from "./roadmapVoting.js";

export type RoadmapStatus = "active" | "planned" | "in_progress" | "shipped" | "archived";
export type RoadmapHorizon = "next" | "later";
export type IssueStatus = "checking" | "confirmed" | "fixing" | "fixed" | "dismissed";
export type IssueArea = "races" | "training" | "youth" | "market" | "club" | "other";
export type RoadmapTab = "plan" | "beta" | "vote" | "issues" | "done";

export const ROADMAP_TABS: RoadmapTab[] = ["plan", "beta", "vote", "issues", "done"];
export const ISSUE_AREA_ORDER: IssueArea[] = ["races", "training", "youth", "market", "club", "other"];
export const RECENTLY_FIXED_DAYS = 14;
export const DONE_PAGE_SIZE = 30;
// Fast antal skeleton-rækker pr. kort under loading (CLS, #5177). Afhænger ikke
// af locale-filen længere.
export const SKELETON_ROWS = 4;

export interface RoadmapItem {
  id: string; engine: string; sort_order: number; title_en: string; title_da: string;
  approved: boolean; status: RoadmapStatus; horizon: RoadmapHorizon;
  beta_since: string | null; beta_soon: boolean; live_soon: boolean;
  created_at: string; shipped_at: string | null;
}
export interface RoadmapVote { item_id: string; idea_score: number | null; importance_score: number | null; }
export interface KnownIssue {
  id: string; area: IssueArea; status: IssueStatus; title_en: string; title_da: string;
  sort_order: number; created_at: string; updated_at: string; closed_at: string | null;
}
export interface KnownIssueUpdate { id: string; issue_id: string; body_en: string; body_da: string; created_at: string; }
export interface DoneEntry { id: string; kind: "feature" | "fix"; title_en: string; title_da: string; date: string | null; }

export function parseTab(param: string | null | undefined): RoadmapTab {
  return ROADMAP_TABS.includes(param as RoadmapTab) ? (param as RoadmapTab) : "plan";
}

const byOrder = (a: RoadmapItem, b: RoadmapItem) =>
  a.sort_order - b.sort_order || a.title_en.localeCompare(b.title_en);

export function partitionItems(items: RoadmapItem[] | null | undefined) {
  const list = items ?? [];
  const pick = (fn: (i: RoadmapItem) => boolean) => list.filter(fn).sort(byOrder);
  const inBetaNow = (i: RoadmapItem) => i.status === "in_progress" && !!i.beta_since;
  return {
    // I gang, men ikke i beta: det, der er i beta, står kun på Beta-fanen.
    inProgress: pick((i) => i.status === "in_progress" && !i.beta_since),
    inBeta: list.filter(inBetaNow).sort((a, b) => Number(b.live_soon) - Number(a.live_soon) || byOrder(a, b)),
    comingToBeta: pick((i) => i.beta_soon && !i.beta_since && (i.status === "planned" || i.status === "in_progress")),
    plannedNext: pick((i) => i.status === "planned" && i.horizon !== "later"),
    plannedLater: pick((i) => i.status === "planned" && i.horizon === "later"),
    ideas: pick((i) => i.status === "active"),
    shipped: list.filter((i) => i.status === "shipped"),
  };
}

export function isRated(item: RoadmapItem, vote: RoadmapVote | undefined): boolean {
  if (!vote || !isValidScore(vote.importance_score)) return false;
  return item.status === "planned" ? true : isValidScore(vote.idea_score);
}

export function countUnrated(items: RoadmapItem[], votes: Map<string, RoadmapVote>) {
  let plan = 0, vote = 0, total = 0;
  for (const item of items) {
    if (item.status !== "planned" && item.status !== "active") continue;
    total += 1;
    if (isRated(item, votes.get(item.id))) continue;
    if (item.status === "planned") plan += 1; else vote += 1;
  }
  return { plan, vote, total, rated: total - plan - vote };
}

export function filterUnrated(items: RoadmapItem[], votes: Map<string, RoadmapVote>, onlyUnrated: boolean) {
  return onlyUnrated ? items.filter((i) => !isRated(i, votes.get(i.id))) : items;
}

function countsInOrder(order: readonly string[], items: Array<{ key: string }>) {
  return order
    .map((key) => ({ key, count: items.filter((i) => i.key === key).length }))
    .filter((e) => e.count > 0);
}

export function engineCounts(items: Array<{ engine: string }>) {
  return countsInOrder(ENGINE_ORDER as string[], items.map((i) => ({ key: i.engine })));
}

export function issueAreaCounts(issues: Array<{ area: string }>) {
  return countsInOrder(ISSUE_AREA_ORDER, issues.map((i) => ({ key: i.area })));
}

/** "Reported, being checked" viser de første 8 (ejerens rækkefølge); resten foldes. */
export const CHECKING_VISIBLE = 8;

export function splitChecking<T>(list: T[], visibleCount: number = CHECKING_VISIBLE): { visible: T[]; folded: T[] } {
  return { visible: list.slice(0, visibleCount), folded: list.slice(visibleCount) };
}

export function splitIssues(issues: KnownIssue[] | null | undefined, now: Date = new Date()) {
  const list = issues ?? [];
  const cutoff = now.getTime() - RECENTLY_FIXED_DAYS * 86_400_000;
  const bySort = (a: KnownIssue, b: KnownIssue) => a.sort_order - b.sort_order;
  const recent = (status: IssueStatus) => list
    .filter((i) => i.status === status && i.closed_at && new Date(i.closed_at).getTime() >= cutoff)
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  return {
    // Bekræftet af ejeren (spec §3.3): "Confirmed"-kortet.
    confirmed: list.filter((i) => i.status === "confirmed" || i.status === "fixing").sort(bySort),
    // Meldt ind af spillere, ikke bekræftet: "Reported, being checked"-kortet.
    checking: list.filter((i) => i.status === "checking").sort(bySort),
    recentlyFixed: recent("fixed"),
    recentlyDismissed: recent("dismissed"),
  };
}

/** Opdateringer pr. fejl, nyeste først (den nyeste vises altid, resten i fold). */
export function latestIssueUpdates(updates: KnownIssueUpdate[] | null | undefined) {
  const map = new Map<string, KnownIssueUpdate[]>();
  const sorted = [...(updates ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const u of sorted) {
    const list = map.get(u.issue_id);
    if (list) list.push(u); else map.set(u.issue_id, [u]);
  }
  return map;
}

export function buildDoneList(shipped: RoadmapItem[], issues: KnownIssue[], limit = DONE_PAGE_SIZE): DoneEntry[] {
  const entries: DoneEntry[] = [
    ...shipped.map((i) => ({ id: i.id, kind: "feature" as const, title_en: i.title_en, title_da: i.title_da, date: i.shipped_at })),
    ...issues.filter((k) => k.status === "fixed")
      .map((k) => ({ id: k.id, kind: "fix" as const, title_en: k.title_en, title_da: k.title_da, date: k.closed_at })),
  ];
  // Punkter uden dato (tre gamle shipped-rækker) lægges sidst.
  entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return entries.slice(0, limit);
}
