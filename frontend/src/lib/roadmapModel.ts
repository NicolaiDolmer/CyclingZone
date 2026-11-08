// Roadmap-hub (#5387, spor 2 #6150): ren logik for de fem faner på /roadmap.
// Ingen React, ingen Supabase, så alt her kan testes med node --test.
// Typerne RoadmapStatus/RoadmapHorizon/IssueStatus/IssueArea importeres også af
// admin-fanen (spor 3); alt admin-specifikt bor i dens egen model.
//
// #7666: Plan-fanen grupperes efter horisont (denne uge ... senere), færdige
// punkter kobles til deres patch note, kendte fejl får en dateret tidslinje,
// og en søgning går på tværs af alle fanerne.
import { ENGINE_ORDER, isDontKnow, isValidScore } from "./roadmapVoting.js";

export type RoadmapStatus = "active" | "planned" | "in_progress" | "shipped" | "archived";
// #7895 (ejer 8/11): ingen "Snart"/"Senere". Sæsoner har nummer (season_5 =
// kommer i sæson 5, før sæson 6), derefter kvartaler (q1_2027) og år (y2027).
// "unscheduled" er en idé i afstemningspuljen uden tid. Databasen tillader
// mønsteret, så en ny sæson eller et nyt kvartal kræver kun HORIZON_ORDER her.
export type RoadmapHorizon = string;
export type IssueStatus = "checking" | "confirmed" | "fixing" | "fixed" | "dismissed";
export type IssueArea = "races" | "training" | "youth" | "market" | "club" | "other";
export type RoadmapTab = "plan" | "beta" | "vote" | "issues" | "done";

export const ROADMAP_TABS: RoadmapTab[] = ["plan", "beta", "vote", "issues", "done"];
export const ISSUE_AREA_ORDER: IssueArea[] = ["races", "training", "youth", "market", "club", "other"];
/** De horisonter, admin kan vælge. Opdateres, når en ny sæson starter. */
export const HORIZON_ORDER: RoadmapHorizon[] = [
  "this_week", "next_week", "season_5", "season_6", "q1_2027", "q2_2027", "y2027",
];
export const UNSCHEDULED: RoadmapHorizon = "unscheduled";

const SEASON_RE = /^season_(\d{1,2})$/;
const QUARTER_RE = /^q([1-4])_(20\d{2})$/;
const YEAR_RE = /^y(20\d{2})$/;

export type HorizonKind =
  | { kind: "week"; key: "this_week" | "next_week" }
  | { kind: "season"; season: number }
  | { kind: "quarter"; quarter: number; year: number }
  | { kind: "year"; year: number }
  | { kind: "unscheduled" };

/** Læser en horisont-værdi. Ukendte værdier læses som "uden tid". */
export function parseHorizon(horizon: string | null | undefined): HorizonKind {
  if (horizon === "this_week" || horizon === "next_week") return { kind: "week", key: horizon };
  let m = SEASON_RE.exec(horizon ?? "");
  if (m) return { kind: "season", season: Number(m[1]) };
  m = QUARTER_RE.exec(horizon ?? "");
  if (m) return { kind: "quarter", quarter: Number(m[1]), year: Number(m[2]) };
  m = YEAR_RE.exec(horizon ?? "");
  if (m) return { kind: "year", year: Number(m[1]) };
  return { kind: "unscheduled" };
}

/** Sorteringsnøgle: uger, så sæsoner, så kvartaler og år; uden tid sidst. */
export function horizonRank(horizon: string | null | undefined): number {
  const h = parseHorizon(horizon);
  switch (h.kind) {
    case "week": return h.key === "this_week" ? 0 : 1;
    case "season": return 100 + h.season;
    case "quarter": return h.year * 10 + h.quarter;
    case "year": return h.year * 10 + 9;
    default: return Number.MAX_SAFE_INTEGER;
  }
}

/** i18n-nøgle + værdier til en horisonts overskrift (roadmap.json plan.horizon.*). */
export function horizonLabelKey(horizon: string | null | undefined): { key: string; values: Record<string, number> } {
  const h = parseHorizon(horizon);
  switch (h.kind) {
    case "week": return { key: `plan.horizon.${h.key}`, values: {} };
    case "season": return { key: "plan.horizon.season", values: { season: h.season } };
    case "quarter": return { key: "plan.horizon.quarter", values: { quarter: h.quarter, year: h.year } };
    case "year": return { key: "plan.horizon.year", values: { year: h.year } };
    default: return { key: "plan.horizon.unscheduled", values: {} };
  }
}

/** Horisonter langt ude ligger bag en fold, så planen starter med det nære. */
export function isFoldedHorizon(horizon: string | null | undefined): boolean {
  const kind = parseHorizon(horizon).kind;
  return kind === "quarter" || kind === "year" || kind === "unscheduled";
}
export const RECENTLY_FIXED_DAYS = 14;
export const RECENT_DONE_DAYS = 7;
export const DONE_PAGE_SIZE = 30;
export const SEARCH_MIN_CHARS = 2;
// Fast antal skeleton-rækker pr. kort under loading (CLS, #5177). Afhænger ikke
// af locale-filen længere.
export const SKELETON_ROWS = 4;

const DAY_MS = 86_400_000;
const COPENHAGEN = "Europe/Copenhagen";

export interface RoadmapItem {
  id: string; engine: string; sort_order: number; title_en: string; title_da: string;
  approved: boolean; status: RoadmapStatus; horizon: RoadmapHorizon;
  beta_since: string | null; beta_soon: boolean; live_soon: boolean;
  created_at: string; shipped_at: string | null;
  issue_ref?: number | null;
}
export interface RoadmapVote { item_id: string; idea_score: number | null; importance_score: number | null; }
export interface KnownIssue {
  id: string; area: IssueArea; status: IssueStatus; title_en: string; title_da: string;
  sort_order: number; created_at: string; updated_at: string; closed_at: string | null;
  issue_ref?: number | null;
  // #7666: stemples af databasen ved statusskift. Mangler på ældre rækker.
  confirmed_at?: string | null; fixing_at?: string | null;
}
export interface KnownIssueUpdate { id: string; issue_id: string; body_en: string; body_da: string; created_at: string; }
export interface DoneEntry {
  id: string; kind: "feature" | "fix"; title_en: string; title_da: string; date: string | null;
  issue_ref: number | null;
}

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
    inBeta: list.filter(inBetaNow).sort((a, b) => Number(b.live_soon) - Number(a.live_soon) || byOrder(a, b)),
    comingToBeta: pick((i) => i.beta_soon && !i.beta_since && (i.status === "planned" || i.status === "in_progress")),
    // Plan-fanen: alt besluttet (i gang, i beta, planlagt), grupperet efter horisont.
    planGroups: groupPlan(list),
    ideas: pick((i) => i.status === "active"),
    shipped: list.filter((i) => i.status === "shipped"),
  };
}

/** Hvor langt et besluttet punkt er: bygges/testes nu, eller kun planlagt. */
export type PlanStage = "beta" | "in_progress" | "planned";

export function planStage(item: RoadmapItem): PlanStage {
  if (item.status === "in_progress") return item.beta_since ? "beta" : "in_progress";
  return "planned";
}

const STAGE_RANK: Record<PlanStage, number> = { beta: 0, in_progress: 1, planned: 2 };

/** Gyldig horisont-værdi, ellers "unscheduled". */
export function normalizeHorizon(horizon: string | null | undefined): RoadmapHorizon {
  return parseHorizon(horizon).kind === "unscheduled" ? UNSCHEDULED : (horizon as RoadmapHorizon);
}

export interface PlanGroup { horizon: RoadmapHorizon; items: RoadmapItem[] }

/**
 * Besluttede punkter (planlagt + i gang) pr. horisont i fast rækkefølge. Inden
 * for en horisont står det der bygges først (beta, så i gang), derefter det
 * planlagte i ejerens rækkefølge. Tomme horisonter udelades.
 */
export function groupPlan(items: RoadmapItem[] | null | undefined): PlanGroup[] {
  // Roadmap-hubben (#6160, 4/10): det, der er i beta, står kun på Beta-fanen.
  const decided = (items ?? []).filter((i) => i.status === "planned" || (i.status === "in_progress" && !i.beta_since));
  const horizons = [...new Set(decided.map((i) => normalizeHorizon(i.horizon)))]
    .sort((a, b) => horizonRank(a) - horizonRank(b));
  return horizons.map((horizon) => ({
    horizon,
    items: decided
      .filter((i) => normalizeHorizon(i.horizon) === horizon)
      .sort((a, b) => STAGE_RANK[planStage(a)] - STAGE_RANK[planStage(b)]
        || Number(b.live_soon) - Number(a.live_soon) || byOrder(a, b)),
  }));
}

/** Ejerens nummer pr. planlagt punkt på tværs af de nære horisonter (de foldede får intet). */
export function planRanks(groups: PlanGroup[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const g of groups) {
    if (isFoldedHorizon(g.horizon)) continue;
    for (const item of g.items) if (item.status === "planned") ranks.set(item.id, ranks.size + 1);
  }
  return ranks;
}

/** Spillerens dato i København som "YYYY-MM-DD" (ugen skifter mandag kl. 00 dansk tid). */
export function copenhagenDateKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COPENHAGEN, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Mandag til søndag for denne uge (offset 0) eller næste (offset 1), som datonøgler. */
export function weekRange(now: Date, offsetWeeks: number): { start: string; end: string } {
  const today = new Date(`${copenhagenDateKey(now)}T00:00:00Z`);
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() + (offsetWeeks * 7 - sinceMonday) * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function isRated(item: RoadmapItem, vote: RoadmapVote | undefined): boolean {
  if (isDontKnow(vote)) return true; // #7788: et Ved ikke er også et svar
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
  const cutoff = now.getTime() - RECENTLY_FIXED_DAYS * DAY_MS;
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

export type TimelineKey = "reported" | "confirmed" | "fixing" | "fixed" | "dismissed";
export interface TimelineStep { key: TimelineKey; date: string | null; reached: boolean; current: boolean }

const TIMELINE_RANK: Record<IssueStatus, number> = { checking: 0, confirmed: 1, fixing: 2, fixed: 3, dismissed: 1 };

/**
 * Status-tidslinjen for en kendt fejl (#6923 pkt. 2): meldt, bekræftet, rettes,
 * rettet. Et trin der er nået uden kendt dato (sprunget over, eller fra før
 * datoerne blev gemt) vises uden dato; et trin der ikke er nået har aldrig dato.
 */
export function issueTimeline(issue: KnownIssue): TimelineStep[] {
  const rank = TIMELINE_RANK[issue.status] ?? 0;
  const steps: Array<{ key: TimelineKey; date: string | null | undefined }> = issue.status === "dismissed"
    ? [{ key: "reported", date: issue.created_at }, { key: "dismissed", date: issue.closed_at }]
    : [
      { key: "reported", date: issue.created_at },
      { key: "confirmed", date: issue.confirmed_at },
      { key: "fixing", date: issue.fixing_at },
      { key: "fixed", date: issue.closed_at },
    ];
  return steps.map((s, i) => ({
    key: s.key,
    reached: i <= rank,
    current: i === rank,
    date: i <= rank ? s.date ?? null : null,
  }));
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
    ...shipped.map((i) => ({
      id: i.id, kind: "feature" as const, title_en: i.title_en, title_da: i.title_da,
      date: i.shipped_at, issue_ref: i.issue_ref ?? null,
    })),
    ...issues.filter((k) => k.status === "fixed").map((k) => ({
      id: k.id, kind: "fix" as const, title_en: k.title_en, title_da: k.title_da,
      date: k.closed_at, issue_ref: k.issue_ref ?? null,
    })),
  ];
  // Punkter uden dato (tre gamle shipped-rækker) lægges sidst.
  entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return entries.slice(0, limit);
}

/** "Leveret de sidste 7 dage" øverst på Done (#6923 pkt. 1); resten under. */
export function splitRecentDone(entries: DoneEntry[], now: Date = new Date(), days = RECENT_DONE_DAYS) {
  const cutoff = now.getTime() - days * DAY_MS;
  const isRecent = (e: DoneEntry) => !!e.date && new Date(e.date).getTime() >= cutoff;
  return { recent: entries.filter(isRecent), earlier: entries.filter((e) => !isRecent(e)) };
}

// ── Patch notes (#6923 pkt. 1) ────────────────────────────────────────────
// Kobling via GitHub-issuet: roadmap-punktet og den kendte fejl bærer
// issue_ref, og en patch note bærer refs. Kun spillervendte noter tæller.

export interface PatchNoteRef {
  version: string; date: string;
  title_en: string; title_da: string; body_en: string; body_da: string;
}

interface RawChange {
  audience?: string; refs?: unknown;
  en?: { title?: string; body?: string }; da?: { title?: string; body?: string };
}
interface RawPatch { version?: unknown; date?: unknown; changes?: unknown }

export function patchNotesByIssue(patches: unknown): Map<number, PatchNoteRef[]> {
  const map = new Map<number, PatchNoteRef[]>();
  if (!Array.isArray(patches)) return map;
  for (const p of patches as RawPatch[]) {
    if (typeof p?.date !== "string" || !Array.isArray(p.changes)) continue;
    for (const c of p.changes as RawChange[]) {
      if (c?.audience !== "player" || !Array.isArray(c.refs)) continue;
      const note: PatchNoteRef = {
        version: String(p.version ?? ""), date: p.date,
        title_en: c.en?.title ?? "", title_da: c.da?.title ?? "",
        body_en: c.en?.body ?? "", body_da: c.da?.body ?? "",
      };
      if (!note.title_en && !note.title_da) continue;
      for (const ref of c.refs) {
        if (!Number.isSafeInteger(ref)) continue;
        const list = map.get(ref as number);
        if (list) list.push(note); else map.set(ref as number, [note]);
      }
    }
  }
  return map;
}

/** Den note der ligger tættest på leveringsdatoen; uden dato den nyeste. */
export function pickPatchNote(
  index: Map<number, PatchNoteRef[]>, issueRef: number | null | undefined, deliveredAt: string | null | undefined,
): PatchNoteRef | null {
  if (issueRef == null) return null;
  const notes = index.get(issueRef);
  if (!notes || notes.length === 0) return null;
  const target = deliveredAt ? new Date(deliveredAt.slice(0, 10)).getTime() : NaN;
  const sorted = [...notes].sort((a, b) => a.date.localeCompare(b.date));
  if (Number.isNaN(target)) return sorted[sorted.length - 1];
  const distance = (n: PatchNoteRef) => Math.abs(new Date(n.date).getTime() - target);
  return sorted.reduce((best, n) => (distance(n) < distance(best) ? n : best));
}

// ── Søgning på tværs af faner (#6203) ─────────────────────────────────────

export type SearchWhere = "beta" | "in_progress" | "planned" | "idea" | "issue" | "done_feature" | "done_fix";
export interface SearchHit {
  id: string; where: SearchWhere; tab: RoadmapTab; area: string;
  title_en: string; title_da: string;
}

/** Små bogstaver uden accenter, så "pa" finder "på" og "etape" finder "étape". */
export function normalizeSearch(text: string | null | undefined): string {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

const WHERE_ORDER: SearchWhere[] = ["beta", "in_progress", "planned", "idea", "issue", "done_feature", "done_fix"];

function itemWhere(item: RoadmapItem): { where: SearchWhere; tab: RoadmapTab } | null {
  if (item.status === "shipped") return { where: "done_feature", tab: "done" };
  if (item.status === "active") return { where: "idea", tab: "vote" };
  if (item.status === "planned") return { where: "planned", tab: "plan" };
  if (item.status === "in_progress") return item.beta_since ? { where: "beta", tab: "beta" } : { where: "in_progress", tab: "plan" };
  return null;
}

function issueWhere(issue: KnownIssue): { where: SearchWhere; tab: RoadmapTab } | null {
  if (issue.status === "fixed") return { where: "done_fix", tab: "done" };
  // Afviste fejl står kun på fanen i 14 dage; et hit der fører ingen steder hen udelades.
  if (issue.status === "dismissed") return null;
  return { where: "issue", tab: "issues" };
}

/** Søger i både EN- og DA-titlen, uanset sprog. Under to tegn søges der ikke. */
export function searchRoadmap(
  query: string, items: RoadmapItem[] | null | undefined, issues: KnownIssue[] | null | undefined,
): SearchHit[] {
  const q = normalizeSearch(query);
  if (q.length < SEARCH_MIN_CHARS) return [];
  const matches = (row: { title_en: string; title_da: string }) =>
    normalizeSearch(row.title_en).includes(q) || normalizeSearch(row.title_da).includes(q);
  const hits: SearchHit[] = [];
  for (const item of items ?? []) {
    const at = itemWhere(item);
    if (at && matches(item)) hits.push({ id: item.id, ...at, area: item.engine, title_en: item.title_en, title_da: item.title_da });
  }
  for (const issue of issues ?? []) {
    const at = issueWhere(issue);
    if (at && matches(issue)) hits.push({ id: issue.id, ...at, area: issue.area, title_en: issue.title_en, title_da: issue.title_da });
  }
  return hits.sort((a, b) => WHERE_ORDER.indexOf(a.where) - WHERE_ORDER.indexOf(b.where));
}

// ── Et hit åbnes: punktet skal stå synligt på sin fane (Codex-fund, #7668) ──

/** Det hit spilleren trykkede på. nonce skifter ved hvert tryk, også på samme punkt. */
export interface RoadmapReveal { id: string; tab: RoadmapTab; nonce: number }

/** DOM-id på punktets række. Kun den aktive fane er monteret, så id'et er entydigt. */
export function roadmapRowId(id: string): string {
  return `roadmap-row-${id}`;
}

/** Ligger det valgte punkt i listen? Afgør om dens fold åbner. */
export function holdsItem(list: ReadonlyArray<{ id: string }>, id: string | null | undefined): boolean {
  return id != null && list.some((entry) => entry.id === id);
}

/** Så mange tidligere poster skal Done vise, for at det valgte punkt er med. */
export function doneLimitFor(
  earlier: ReadonlyArray<{ id: string }>, id: string | null | undefined, pageSize = DONE_PAGE_SIZE,
): number {
  return Math.max(pageSize, earlier.findIndex((entry) => entry.id === id) + 1);
}
