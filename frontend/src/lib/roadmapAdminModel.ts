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
  // #7789: admins egen kategori (roadmap_items.category), se mergeCategories.
  category?: string | null;
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

// Optimistisk opdatering på stedet (#7971): læg ændringen oven på de rækker, der
// allerede står på skærmen, så en række ikke skifter plads, mens skrivningen
// kører. Kun de nævnte rækker får en ny værdi; resten er det samme objekt.
export function patchRows<T extends ScoreRow>(rows: T[], patches: ({ item_id: string } & Partial<ScoreRow>)[]): T[] {
  if (patches.length === 0) return rows;
  const byId = new Map(patches.map((p) => [p.item_id, p]));
  return rows.map((r) => {
    const p = byId.get(r.item_id);
    return p ? { ...r, ...p } : r;
  });
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

// Samlet vurdering som i spørgeskemaet (prioritetsscoren): gennemsnitlig God idé
// gange gennemsnitlig Vigtighed, på 1 decimal. Mangler den ene, er der ingen
// samlet vurdering (null, som sorteres sidst og vises som tankestreg).
export function totalScore(idea: Num, importance: Num): number | null {
  const a = num(idea), b = num(importance);
  if (a === null || b === null) return null;
  return Math.round(a * b * 10) / 10;
}

// Standardsortering pr. fane: det samme som tabellerne havde før fanerne.
export const DEFAULT_SORT: Record<AdminTab, SortState> = {
  ideas: { key: "total", dir: "desc" },
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
  total: (r) => totalScore(r.avg_idea as Num, r.avg_importance as Num),
  own: numAcc("sort_order"),
  status: strAcc("status"),
  horizon: strAcc("horizon"),
  area: (r) => strAcc("engine")(r) ?? strAcc("area")(r),
  issue: numAcc("issue_ref"),
  sd: numAcc("sd_importance"),
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

// ---------------------------------------------------------------------------
// Grafen (#7789): vigtighed mod idé-score, boble efter antal stemmere
// ---------------------------------------------------------------------------
//
// Samme spørgsmål som spørgeskema-panelets kvadrant (SurveyIdeasTab): hvad skal
// bygges først? Tallene kommer fra roadmap_admin_vote_rows() (én stemme pr.
// række, ingen user_id), så filtrene på aktive managere og division kan regnes
// her. Findes RPC'en ikke endnu (migrationen applies efter merge), bruger
// grafen viewets snit, og filtrene er slået fra med en forklaring.

// Skalaen på Stem (1-6 på begge akser, CHECK i roadmap_votes).
export const SCORE_MIN = 1;
export const SCORE_MAX = 6;

export type VoterTuple = [number | null, boolean];
export type VoteTuple = [string, number, number | null, number | null];

export interface VotePayload {
  voters: VoterTuple[];
  votes: VoteTuple[];
}

// Svaret fra /api/admin/roadmap/votes. Alt andet end den forventede form giver
// null, så grafen hellere falder tilbage til viewet end tegner et forkert tal.
export function parseVotePayload(raw: unknown): VotePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { voters?: unknown; votes?: unknown };
  if (!Array.isArray(r.voters) || !Array.isArray(r.votes)) return null;
  const score = (v: unknown) => (v === null || (typeof v === "number" && Number.isFinite(v)));
  const voters = r.voters.filter((v): v is VoterTuple => Array.isArray(v)
    && (v[0] === null || typeof v[0] === "number") && typeof v[1] === "boolean");
  if (voters.length !== r.voters.length) return null;
  const votes = r.votes.filter((v): v is VoteTuple => Array.isArray(v)
    && typeof v[0] === "string" && Number.isInteger(v[1]) && v[1] >= 0 && v[1] < voters.length
    && score(v[2]) && score(v[3]));
  if (votes.length !== r.votes.length) return null;
  return { voters, votes };
}

export const UNKNOWN_DIVISION = "unknown";

export interface VoterFilters {
  activeOnly?: boolean;
  // "" = alle, ellers divisionsnummeret som tekst eller UNKNOWN_DIVISION.
  division?: string;
}

function divisionKey(d: number | null): string {
  return d === null ? UNKNOWN_DIVISION : String(d);
}

// Divisionerne blandt stemmerne, i rækkefølge; ukendt sidst.
export function voterDivisions(payload: VotePayload | null): string[] {
  if (!payload) return [];
  const keys = new Set(payload.voters.map((v) => divisionKey(v[0])));
  return [...keys].sort((a, b) => {
    if (a === UNKNOWN_DIVISION) return 1;
    if (b === UNKNOWN_DIVISION) return -1;
    return Number(a) - Number(b);
  });
}

export function filterVotes(payload: VotePayload, f: VoterFilters): VoteTuple[] {
  const division = clean(f.division);
  return payload.votes.filter(([, voter]) => {
    const [d, active] = payload.voters[voter];
    return (!f.activeOnly || active) && (!division || divisionKey(d) === division);
  });
}

// Løbende summer, så både et punkt og en kategori regnes på samme måde.
interface Acc {
  voters: Set<number>;
  n: number;
  sumImp: number;
  sumImpSq: number;
  ideaN: number;
  sumIdea: number;
  dontKnow: number;
}

const newAcc = (): Acc => ({ voters: new Set(), n: 0, sumImp: 0, sumImpSq: 0, ideaN: 0, sumIdea: 0, dontKnow: 0 });

function addVote(acc: Acc, [, voter, imp, idea]: VoteTuple) {
  if (imp === null) { acc.dontKnow += 1; return; }
  acc.voters.add(voter);
  acc.n += 1;
  acc.sumImp += imp;
  acc.sumImpSq += imp * imp;
  if (idea !== null) { acc.ideaN += 1; acc.sumIdea += idea; }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// Stikprøve-spredning som i viewet (STDDEV_SAMP): kræver mindst to tal.
function sampleSd(acc: Acc): number | null {
  if (acc.n < 2) return null;
  const variance = (acc.sumImpSq - (acc.sumImp * acc.sumImp) / acc.n) / (acc.n - 1);
  return round2(Math.sqrt(Math.max(0, variance)));
}

export interface ChartPoint {
  key: string;
  label: string;
  // Idé-score (x) og vigtighed (y); null = kan ikke tegnes.
  x: number | null;
  y: number | null;
  // Antal stemmere med et tal: boblens størrelse.
  voters: number;
  dontKnow: number;
  sd: number | null;
  split: boolean;
  category: string;
  // Kun for punkter.
  item?: ScoreRow;
  // Kun for kategorier: hvor mange punkter der ligger i den.
  items?: number;
}

function pointFromAcc(key: string, label: string, category: string, acc: Acc): ChartPoint {
  const sd = sampleSd(acc);
  return {
    key, label, category,
    x: acc.ideaN > 0 ? round2(acc.sumIdea / acc.ideaN) : null,
    y: acc.n > 0 ? round2(acc.sumImp / acc.n) : null,
    voters: acc.voters.size,
    dontKnow: acc.dontKnow,
    sd,
    split: isSplit(sd),
  };
}

// De faste kategorier (#7971, ejer 10/11). Der gemmes den stabile nøgle i
// roadmap_items.category (fritekst-kolonnen, 1-40 tegn); admin viser dansk navn.
export const ROADMAP_CATEGORIES: { key: string; label: string }[] = [
  { key: "race_film", label: "Løbsfilm & løbsside" },
  { key: "race_engine", label: "Race engine" },
  { key: "tactics", label: "Taktik" },
  { key: "selection", label: "Holdudtagelse & planlægning" },
  { key: "training", label: "Træning" },
  { key: "development", label: "Udvikling" },
  { key: "form", label: "Form, træthed & skader" },
  { key: "academy", label: "Akademi & ungdom" },
  { key: "scouting", label: "Scouting" },
  { key: "market", label: "Transfermarked" },
  { key: "club", label: "Klub & økonomi" },
  { key: "rider_profile", label: "Rytterprofil & historik" },
  { key: "calendar", label: "Kalender & mesterskaber" },
  { key: "social", label: "Socialt & forum" },
  { key: "messages", label: "Beskeder" },
  { key: "onboarding", label: "Onboarding & hjælp" },
  { key: "app", label: "App & navigation" },
];
export const NO_CATEGORY = "Ingen kategori";

const CATEGORY_LABELS = new Map(ROADMAP_CATEGORIES.map((c) => [c.key, c.label]));

export function isCategoryKey(value: unknown): value is string {
  return typeof value === "string" && CATEGORY_LABELS.has(value);
}

// Gammel fritekst eller tom værdi = ingen kategori.
export function categoryLabel(value: string | null | undefined): string {
  return (isCategoryKey(value) ? CATEGORY_LABELS.get(value) : undefined) ?? NO_CATEGORY;
}

// Kategorien på grafen og i tabellerne: det faste navn, ellers "Ingen kategori".
export function categoryOf(row: ScoreRow): string {
  return categoryLabel(row.category);
}

export function mergeCategories<T extends ScoreRow>(
  rows: T[], items: { id: string; category: string | null }[],
): (T & { category: string | null })[] {
  const byId = new Map(items.map((i) => [i.id, i.category]));
  return rows.map((r) => ({ ...r, category: byId.get(r.item_id) ?? null }));
}

const titleOf = (r: ScoreRow) => r.title_da || r.title_en;

// Ét punkt pr. række. Med stemme-rækker regnes snittene på de filtrerede
// stemmer; uden dem bruges viewets tal (ufiltreret).
export function itemPoints(rows: ScoreRow[], votes: VoteTuple[] | null): ChartPoint[] {
  if (!votes) {
    return rows.map((r) => {
      const sd = num(r.sd_importance);
      return {
        key: r.item_id, label: titleOf(r), category: categoryOf(r), item: r,
        x: num(r.avg_idea), y: num(r.avg_importance),
        voters: num(r.votes) ?? 0, dontKnow: num(r.dont_know) ?? 0, sd, split: isSplit(sd),
      };
    });
  }
  const accs = new Map<string, Acc>();
  for (const v of votes) {
    const acc = accs.get(v[0]) ?? newAcc();
    addVote(acc, v);
    accs.set(v[0], acc);
  }
  return rows.map((r) => ({
    ...pointFromAcc(r.item_id, titleOf(r), categoryOf(r), accs.get(r.item_id) ?? newAcc()),
    item: r,
  }));
}

// Ét punkt pr. kategori. Snittet er over stemmerne (et punkt med mange
// stemmer vejer mere end et med få), og stemmere tælles én gang pr. kategori.
// Uden stemme-rækker vægtes viewets snit med punktets antal stemmer, og
// stemmerne lægges sammen (samme manager kan da tælle flere gange).
export function categoryPoints(rows: ScoreRow[], votes: VoteTuple[] | null): ChartPoint[] {
  const cats = new Map<string, { rows: ScoreRow[]; acc: Acc }>();
  for (const r of rows) {
    const c = categoryOf(r);
    const entry = cats.get(c) ?? { rows: [], acc: newAcc() };
    entry.rows.push(r);
    cats.set(c, entry);
  }
  if (votes) {
    const catByItem = new Map(rows.map((r) => [r.item_id, categoryOf(r)]));
    for (const v of votes) {
      const c = catByItem.get(v[0]);
      if (c !== undefined) addVote(cats.get(c)!.acc, v);
    }
    return [...cats.entries()].map(([c, { rows: rs, acc }]) => ({ ...pointFromAcc(c, c, c, acc), items: rs.length }));
  }
  return [...cats.entries()].map(([c, { rows: rs }]) => {
    let n = 0, imp = 0, ideaN = 0, idea = 0, dontKnow = 0;
    for (const r of rs) {
      const k = num(r.votes) ?? 0, ki = num(r.idea_votes) ?? k;
      const ai = num(r.avg_importance), ad = num(r.avg_idea);
      if (ai !== null && k > 0) { n += k; imp += ai * k; }
      if (ad !== null && ki > 0) { ideaN += ki; idea += ad * ki; }
      dontKnow += num(r.dont_know) ?? 0;
    }
    return {
      key: c, label: c, category: c, items: rs.length,
      x: ideaN > 0 ? round2(idea / ideaN) : null,
      y: n > 0 ? round2(imp / n) : null,
      voters: n, dontKnow, sd: null, split: false,
    };
  });
}

export function plottable(points: ChartPoint[]): ChartPoint[] {
  return points.filter((p) => p.x !== null && p.y !== null && p.voters > 0);
}

// Hvilke punkter grafen viser. "open" = alt, der endnu ikke er færdigt.
export type ChartScope = "open" | "ideas" | "planned";
export const CHART_SCOPES: { key: ChartScope; label: string }[] = [
  { key: "open", label: "Alle åbne" },
  { key: "ideas", label: "Idéer" },
  { key: "planned", label: "Planlagt" },
];

export function chartRows<T extends ScoreRow>(rows: T[], scope: ChartScope | string): T[] {
  if (scope === "ideas") return rows.filter((r) => r.status === "active");
  if (scope === "planned") return rows.filter((r) => r.status === "planned");
  return rows.filter((r) => !DONE_STATUSES.includes(r.status));
}

// Bobler med præcis samme snit ville ligge oven i hinanden, så kun den øverste
// kunne klikkes. Hver boble får sit nummer blandt dem på samme sted (0 = står
// stille); grafen skubber de øvrige lidt ud til siden.
export function coincidentIndex(points: ChartPoint[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const p of [...points].sort((a, b) => a.key.localeCompare(b.key))) {
    const spot = `${p.x}|${p.y}`;
    const i = seen.get(spot) ?? 0;
    seen.set(spot, i + 1);
    out.set(p.key, i);
  }
  return out;
}

// De stemmer, der hører til punkterne på grafen lige nu (scope og kategori),
// så "N stemmere" i overskriften ikke tæller stemmer på andre punkter med.
export function votesForItems(votes: VoteTuple[], itemIds: Iterable<string>): VoteTuple[] {
  const ids = new Set(itemIds);
  return votes.filter((v) => ids.has(v[0]));
}

export function distinctVoters(votes: VoteTuple[]): number {
  return new Set(votes.filter((v) => v[2] !== null).map((v) => v[1])).size;
}

// Boblens radius i viewBox-enheder. Den vokser med kvadratroden af antal
// stemmere, så arealet (det øjet læser) følger antallet og en stor boble ikke
// dækker hele grafen. Mindsteradius holder en enkelt stemme klikbar.
export function bubbleRadius(voters: number, maxVoters: number, minR = 1.2, maxR = 4.2): number {
  if (!(maxVoters > 0) || !(voters > 0)) return minR;
  return round2(minR + (maxR - minR) * Math.sqrt(Math.min(voters, maxVoters) / maxVoters));
}
