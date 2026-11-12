// #7535 · Planlaegningssiden (Planning Workbench), trin 1: ren model.
//
// Alt her er rene funktioner uden React og uden netvaerk, saa de kan testes med
// `node --test`. Siden bygger paa de EKSISTERENDE datakald (sæsonmatrixen
// GET /api/races/selection/season og udtagelsen GET/PUT /api/races/:id/selection);
// modellen finder aldrig paa sine egne tal. Rute-match, form og traethed kommer
// fra serveren, og rollereglerne genbruger raceSelectionLogic.js.
import { pickFallbackCaptain, resolveBoardRoles } from "./raceSelectionLogic.js";

// ── Typer (spejler wire-formen fra de eksisterende endpoints) ───────────────

export interface SeasonRace {
  id: string;
  name: string;
  raceClass: string | number | null;
  stages: number;
  status: string;
  stagesCompleted: number;
  lineupLocked: boolean;
  gameDayStart: number;
  gameDayEnd: number;
  sizeMin: number;
  sizeMax: number;
}

export interface SeasonEntry {
  raceId: string;
  riderId: string;
  raceRole: string | null;
}

export interface DayDate {
  gameDay: number;
  date: string;
}

/** Udtagelsens lokale form (samme som RaceSelectionPanel's state). */
export interface Selection {
  riderIds: string[];
  captainId: string | null;
  sprintCaptainId: string | null;
  hunterId: string | null;
  freeRoleIds: string[];
  coCaptainId: string | null;
  luxuryHelperId: string | null;
}

export type RoleKey =
  | "captain"
  | "co_captain"
  | "sprint_captain"
  | "hunter"
  | "free_role"
  | "luxury_helper"
  | "rider";

export const EMPTY_SELECTION: Selection = Object.freeze({
  riderIds: [],
  captainId: null,
  sprintCaptainId: null,
  hunterId: null,
  freeRoleIds: [],
  coCaptainId: null,
  luxuryHelperId: null,
}) as Selection;

// ── Datoer (alle datoer er Europe/Copenhagen-datoer som YYYY-MM-DD) ─────────

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function formatDateParts(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateParts(d);
}

/** Mandag i ugen datoen ligger i. */
export function mondayOf(date: string): string {
  const d = parseDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = mandag
  return addDays(date, -dow);
}

/** ISO-ugenummer. */
export function isoWeekNumber(date: string): number {
  const d = parseDate(date);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // torsdagen i ugen
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

/** Dagens dato i Europe/Copenhagen. */
export function copenhagenToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dateIndex(dayDates: DayDate[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of dayDates ?? []) {
    if (Number.isFinite(row.gameDay) && typeof row.date === "string") map.set(row.gameDay, row.date);
  }
  return map;
}

export function raceStartDate(race: SeasonRace, dates: Map<number, string>): string | null {
  return dates.get(race.gameDayStart) ?? null;
}

export function raceEndDate(race: SeasonRace, dates: Map<number, string>): string | null {
  return dates.get(race.gameDayEnd) ?? dates.get(race.gameDayStart) ?? null;
}

/**
 * Loebsdags-aksen (PLANNING_CENTER_RULES §3): "41" eller "41-43". Vises altid sammen med
 * kalenderdatoen, for en loebsdag kan ikke udledes af datoen.
 */
export function gameDaySpan(from: number, to: number = from): string {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  return a === b ? String(a) : `${a}-${b}`;
}

/** Oversaettelsesnoeglen til et loebs loebsdage: ental for en enkelt dag, ellers spaendet. */
export function raceDayLabelKey(race: SeasonRace): "raceList.raceDay" | "raceList.raceDays" {
  return race.gameDayEnd > race.gameDayStart ? "raceList.raceDays" : "raceList.raceDay";
}

/** Loebsdagene der ligger paa en kalenderdato, som spaend ("41-42"), eller null. */
export function gameDaysOnDate(dates: Map<number, string>, date: string): string | null {
  const days = [...dates].filter(([, d]) => d === date).map(([day]) => day).sort((x, y) => x - y);
  return days.length ? gameDaySpan(days[0], days[days.length - 1]) : null;
}

// ── Loeb: overlap, status, uger ─────────────────────────────────────────────

/** Et loeb er forbi, naar det ikke laengere er planlagt (kørende loeb er stadig "scheduled"). */
export function isRacePast(race: SeasonRace): boolean {
  return race.status !== "scheduled";
}

export function sharesRaceDays(a: SeasonRace, b: SeasonRace): boolean {
  return a.id !== b.id && a.gameDayStart <= b.gameDayEnd && b.gameDayStart <= a.gameDayEnd;
}

/** De andre kommende loeb der deler loebsdage med dette (afmeldte loeb binder ingen ryttere). */
export function overlappingRaces(race: SeasonRace, races: SeasonRace[], withdrawn: Set<string> = new Set()): SeasonRace[] {
  return races.filter((o) => !isRacePast(o) && !withdrawn.has(o.id) && sharesRaceDays(race, o));
}

export function pickedCounts(entries: SeasonEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries ?? []) counts.set(e.raceId, (counts.get(e.raceId) ?? 0) + 1);
  return counts;
}

export type ReadinessState = "ready" | "missing" | "locked" | "withdrawn";

export interface Readiness {
  state: ReadinessState;
  picked: number;
  target: number;
  missing: number;
}

/** "Klar" = fuld trup (samme kontrakt som Dashboard-nudgen og Race Hub: valgte >= size.max). */
export function raceReadiness(race: SeasonRace, picked: number, withdrawn: Set<string> = new Set()): Readiness {
  const target = Math.max(0, Number(race.sizeMax) || 0);
  const missing = Math.max(0, target - picked);
  if (withdrawn.has(race.id)) return { state: "withdrawn", picked, target, missing };
  if (race.lineupLocked) return { state: "locked", picked, target, missing };
  return { state: missing === 0 && target > 0 ? "ready" : "missing", picked, target, missing };
}

export interface WeekGroup {
  key: string;
  monday: string;
  week: number;
  races: SeasonRace[];
}

/** Grupperer loeb efter ISO-uge (startdatoen afgoer ugen). Loeb uden kendt dato udelades. */
export function groupRacesByWeek(races: SeasonRace[], dates: Map<number, string>): WeekGroup[] {
  const groups = new Map<string, WeekGroup>();
  for (const race of races) {
    const start = raceStartDate(race, dates);
    if (!start) continue;
    const monday = mondayOf(start);
    let g = groups.get(monday);
    if (!g) {
      g = { key: monday, monday, week: isoWeekNumber(monday), races: [] };
      groups.set(monday, g);
    }
    g.races.push(race);
  }
  return [...groups.values()].sort((a, b) => a.monday.localeCompare(b.monday));
}

export type RaceScope = "next7" | "season";

/** Hvilke loeb listen viser. Forbi-loeb er skjult som standard (de bor i Resultater). */
export function visibleRaces(
  races: SeasonRace[],
  dates: Map<number, string>,
  opts: { scope: RaceScope; showPast: boolean; today: string },
): SeasonRace[] {
  const horizon = addDays(opts.today, 7);
  return races.filter((race) => {
    if (!opts.showPast && isRacePast(race)) return false;
    if (opts.scope === "season") return true;
    const start = raceStartDate(race, dates);
    // Ukendt dato: vis hellere end at skjule et loeb der mangler en trup.
    if (!start) return true;
    return start <= horizon;
  });
}

// ── Ugeoversigt (week board) ────────────────────────────────────────────────

export interface WeekBar {
  race: SeasonRace;
  lane: number;
  /** 0-6, kolonnen i ugen (begge ender er inklusive). */
  startCol: number;
  endCol: number;
}

export interface WeekLayout {
  days: string[];
  bars: WeekBar[];
  laneCount: number;
}

/**
 * Banerne i en uge: loeb der deler LOEBSDAGE lægges i hver sin bane, saa overlap er synligt
 * med det samme. Banerne tildeles efter loebsdag (samme sandhed som bindingen), placeringen
 * i bredden efter kalenderdato.
 */
export function layoutWeek(races: SeasonRace[], dates: Map<number, string>, monday: string): WeekLayout {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6];
  const inWeek = races
    .map((race) => ({ race, start: raceStartDate(race, dates), end: raceEndDate(race, dates) }))
    .filter((r): r is { race: SeasonRace; start: string; end: string } => !!r.start && !!r.end && r.end >= monday && r.start <= sunday)
    .sort((a, b) => a.race.gameDayStart - b.race.gameDayStart || a.race.gameDayEnd - b.race.gameDayEnd || a.race.name.localeCompare(b.race.name));

  // En bane er kun fri, naar baade loebsdagen og kalenderkolonnen er ledig: to loeb paa forskellige
  // loebsdage men samme kalenderdato (komprimerede dage) maa ikke ligge oven paa hinanden.
  const laneEnds: Array<{ gameDay: number; col: number }> = [];
  const bars: WeekBar[] = [];
  for (const r of inWeek) {
    const startCol = Math.max(0, days.indexOf(r.start < monday ? monday : r.start));
    const endDate = r.end > sunday ? sunday : r.end;
    const endCol = Math.max(startCol, days.indexOf(endDate));
    let lane = laneEnds.findIndex((end) => end.gameDay < r.race.gameDayStart && end.col < startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push({ gameDay: r.race.gameDayEnd, col: endCol });
    } else {
      laneEnds[lane] = { gameDay: r.race.gameDayEnd, col: endCol };
    }
    bars.push({ race: r.race, lane, startCol, endCol });
  }
  return { days, bars, laneCount: laneEnds.length };
}

// ── Roller og udtagelse ─────────────────────────────────────────────────────

export function roleOf(sel: Selection, riderId: string): RoleKey {
  if (sel.captainId === riderId) return "captain";
  if (sel.coCaptainId === riderId) return "co_captain";
  if (sel.sprintCaptainId === riderId) return "sprint_captain";
  if (sel.hunterId === riderId) return "hunter";
  if (sel.luxuryHelperId === riderId) return "luxury_helper";
  if (sel.freeRoleIds.includes(riderId)) return "free_role";
  return "rider";
}

/** Vaelgbare roller i et loeb. Delt kaptajn og luksushjaelper findes kun hvor serveren tillader dem. */
export function availableRoles(sprintLeaderAllowed: boolean): RoleKey[] {
  const base: RoleKey[] = ["captain", "sprint_captain", "hunter", "free_role", "rider"];
  return sprintLeaderAllowed ? ["captain", "co_captain", "sprint_captain", "luxury_helper", "hunter", "free_role", "rider"] : base;
}

/** Saetter en rytters rolle. Enkeltroller har kun en indehaver; free_role er additiv. */
export function setRiderRole(sel: Selection, riderId: string, role: RoleKey): Selection {
  if (!sel.riderIds.includes(riderId)) return sel;
  const next: Selection = {
    ...sel,
    captainId: sel.captainId === riderId ? null : sel.captainId,
    coCaptainId: sel.coCaptainId === riderId ? null : sel.coCaptainId,
    sprintCaptainId: sel.sprintCaptainId === riderId ? null : sel.sprintCaptainId,
    hunterId: sel.hunterId === riderId ? null : sel.hunterId,
    luxuryHelperId: sel.luxuryHelperId === riderId ? null : sel.luxuryHelperId,
    freeRoleIds: sel.freeRoleIds.filter((id) => id !== riderId),
  };
  if (role === "captain") next.captainId = riderId;
  else if (role === "co_captain") next.coCaptainId = riderId;
  else if (role === "sprint_captain") next.sprintCaptainId = riderId;
  else if (role === "hunter") next.hunterId = riderId;
  else if (role === "luxury_helper") next.luxuryHelperId = riderId;
  else if (role === "free_role") next.freeRoleIds = [...next.freeRoleIds, riderId];
  return next;
}

/** Serverens udtagelse (GET /selection) som lokal tilstand. */
export function selectionFromServer(server: {
  rider_ids?: string[];
  captain_id?: string | null;
  sprint_captain_id?: string | null;
  hunter_id?: string | null;
  free_role_ids?: string[];
  co_captain_id?: string | null;
  luxury_helper_id?: string | null;
} | null | undefined): Selection {
  if (!server) return { ...EMPTY_SELECTION, riderIds: [], freeRoleIds: [] };
  return {
    riderIds: [...(server.rider_ids ?? [])],
    captainId: server.captain_id ?? null,
    sprintCaptainId: server.sprint_captain_id ?? null,
    hunterId: server.hunter_id ?? null,
    freeRoleIds: [...(server.free_role_ids ?? [])],
    coCaptainId: server.co_captain_id ?? null,
    luxuryHelperId: server.luxury_helper_id ?? null,
  };
}

function sortedKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

/** Er den lokale udtagelse forskellig fra den gemte? */
export function selectionDirty(draft: Selection, saved: Selection): boolean {
  return (
    sortedKey(draft.riderIds) !== sortedKey(saved.riderIds) ||
    sortedKey(draft.freeRoleIds) !== sortedKey(saved.freeRoleIds) ||
    draft.captainId !== saved.captainId ||
    draft.sprintCaptainId !== saved.sprintCaptainId ||
    draft.hunterId !== saved.hunterId ||
    draft.coCaptainId !== saved.coCaptainId ||
    draft.luxuryHelperId !== saved.luxuryHelperId
  );
}

/** Body til PUT /api/races/:id/selection (samme form som udtagelsespanelet sender). */
export function toPutBody(sel: Selection, sprintLeaderAllowed: boolean): Record<string, unknown> {
  const inSquad = (id: string | null) => (id != null && sel.riderIds.includes(id) ? id : null);
  return {
    rider_ids: sel.riderIds,
    captain_id: inSquad(sel.captainId),
    sprint_captain_id: inSquad(sel.sprintCaptainId),
    hunter_id: inSquad(sel.hunterId),
    free_role_ids: sel.freeRoleIds.filter((id) => sel.riderIds.includes(id)),
    co_captain_id: inSquad(sel.coCaptainId),
    ...(sprintLeaderAllowed ? { luxury_helper_id: inSquad(sel.luxuryHelperId) } : {}),
  };
}

const ENTRY_ROLE: Record<RoleKey, string | null> = {
  captain: "captain",
  co_captain: "co_captain",
  sprint_captain: "sprint_captain",
  hunter: "hunter",
  free_role: "free_role",
  luxury_helper: "luxury_helper",
  rider: null,
};

/** De entries en gemt udtagelse efterlader i sæsonmatrixen (til lokal opdatering efter Gem). */
export function entriesFromSelection(raceId: string, sel: Selection): SeasonEntry[] {
  return sel.riderIds.map((riderId) => ({ raceId, riderId, raceRole: ENTRY_ROLE[roleOf(sel, riderId)] }));
}

export function replaceRaceEntries(entries: SeasonEntry[], raceId: string, next: SeasonEntry[]): SeasonEntry[] {
  return [...entries.filter((e) => e.raceId !== raceId), ...next];
}

const ROLE_FROM_ENTRY: Record<string, RoleKey> = {
  captain: "captain",
  co_captain: "co_captain",
  sprint_captain: "sprint_captain",
  hunter: "hunter",
  free_role: "free_role",
  luxury_helper: "luxury_helper",
};

// ── Trup-tabellen (Squad) ───────────────────────────────────────────────────

export interface SquadRow {
  id: string;
  name: string;
  /** Ledig til udtagelse? Falsk for skadet, for gammel, optaget i et overlappende loeb eller laast af Train now. */
  selectable: boolean;
  injured: boolean;
  overAge: boolean;
  outgoing: boolean;
  trainNowLocked: boolean;
  /** Navnet paa det overlappende loeb rytteren er udtaget til. */
  busyIn: string | null;
  rating: number | null;
  ratingRole: string | null;
  form: number | null;
  fatigue: number | null;
  routeMatch: number | null;
  /** Rute-match pr. rutetype (profile_type) i loebet. */
  byProfile: Record<string, number | null>;
}

export interface ProfileColumn {
  profileType: string;
  count: number;
}

/** En kolonne pr. rutetype i loebet, i den rækkefølge typerne foerst optraeder. */
export function profileColumns(stageTypes: string[]): ProfileColumn[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const type of stageTypes) {
    if (!type) continue;
    if (!counts.has(type)) order.push(type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return order.map((profileType) => ({ profileType, count: counts.get(profileType) ?? 0 }));
}

/** Gennemsnittet af rytterens etape-rute-match pr. rutetype (etape-tal kommer fra serveren). */
export function routeMatchByProfile(stageSuitability: Array<number | null> | null | undefined, stageTypes: string[]): Record<string, number | null> {
  const sums = new Map<string, { sum: number; n: number }>();
  stageTypes.forEach((type, i) => {
    if (!type) return;
    const v = stageSuitability?.[i];
    const acc = sums.get(type) ?? { sum: 0, n: 0 };
    if (typeof v === "number" && Number.isFinite(v)) {
      acc.sum += v;
      acc.n += 1;
    }
    sums.set(type, acc);
  });
  const out: Record<string, number | null> = {};
  for (const [type, acc] of sums) out[type] = acc.n ? Math.round(acc.sum / acc.n) : null;
  return out;
}

/** Rytter-raekken som GET /api/races/:id/selection sender den (kun de felter siden bruger). */
export interface SelectionRider {
  id: string;
  name: string;
  primaryType?: string | null;
  secondaryType?: string | null;
  suitability?: number | null;
  stageSuitability?: Array<number | null> | null;
  form?: number | null;
  fatigue?: number | null;
  injured?: boolean;
  outgoing?: boolean;
  overAge?: boolean;
  abilities?: Record<string, number | null> | null;
}

export interface SelectionPayload {
  riders?: SelectionRider[];
  bound_riders?: Array<{ rider_id: string; bound_race_name?: string | null }>;
  trainNowLock?: { riderIds?: string[] } | null;
}

/**
 * Raekkerne til trup-tabellen. Rute-match, form, traethed og skade kommer rent fra serveren;
 * ratingen er rytterens bedste rolle lige nu (samme beregning som resten af spillet).
 */
export function buildSquadRows(
  payload: SelectionPayload,
  stageTypes: string[],
  bestRole: (flat: Record<string, unknown>) => { rating: number | null; role: string | null },
): SquadRow[] {
  const bound = new Map((payload.bound_riders ?? []).map((b) => [b.rider_id, b.bound_race_name ?? ""]));
  const locked = new Set(payload.trainNowLock?.riderIds ?? []);
  return (payload.riders ?? []).map((r) => {
    const busyIn = bound.has(r.id) ? bound.get(r.id) || "-" : null;
    const trainNowLocked = locked.has(r.id);
    const injured = r.injured === true;
    const overAge = r.overAge === true;
    const outgoing = r.outgoing === true;
    const best = r.abilities ? bestRole({ ...r.abilities, primary_type: r.primaryType ?? null, secondary_type: r.secondaryType ?? null }) : null;
    return {
      id: r.id,
      name: r.name,
      selectable: !injured && !overAge && !outgoing && !busyIn && !trainNowLocked,
      injured,
      overAge,
      outgoing,
      trainNowLocked,
      busyIn,
      rating: best?.rating ?? null,
      ratingRole: best?.role ?? null,
      form: r.form ?? null,
      fatigue: r.fatigue ?? null,
      routeMatch: r.suitability ?? null,
      byProfile: routeMatchByProfile(r.stageSuitability, stageTypes),
    };
  });
}

export type SquadSortKey =
  | "pick"
  | "name"
  | "status"
  | "role"
  | "rating"
  | "form"
  | "fatigue"
  | "routeMatch"
  | `profile:${string}`;

export interface SquadSort {
  key: SquadSortKey;
  dir: "asc" | "desc";
}

/** Standard: rute-match for hele loebet, bedst foerst (ejer 2/11). */
export const DEFAULT_SQUAD_SORT: SquadSort = { key: "routeMatch", dir: "desc" };

/** Naturlig foerste retning: tekst stigende, tal faldende. */
export function defaultSortDir(key: SquadSortKey): "asc" | "desc" {
  return key === "name" || key === "status" || key === "role" ? "asc" : "desc";
}

export function nextSort(current: SquadSort, key: SquadSortKey): SquadSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultSortDir(key) };
}

function sortValue(row: SquadRow, key: SquadSortKey, sel: Selection): number | string | null {
  switch (key) {
    case "pick":
      return sel.riderIds.includes(row.id) ? 1 : 0;
    case "name":
      return row.name;
    case "status":
      return row.busyIn ? `1 ${row.busyIn}` : row.injured ? "2" : row.overAge ? "3" : row.trainNowLocked ? "4" : "0";
    case "role":
      return sel.riderIds.includes(row.id) ? roleOf(sel, row.id) : null;
    case "rating":
      return row.rating;
    case "form":
      return row.form;
    case "fatigue":
      return row.fatigue;
    case "routeMatch":
      return row.routeMatch;
    default:
      return row.byProfile[key.slice("profile:".length)] ?? null;
  }
}

/** Stabil sortering; manglende tal ender altid nederst uanset retning. */
export function sortSquadRows(rows: SquadRow[], sort: SquadSort, sel: Selection): SquadRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: sortValue(row, sort.key, sel) }))
    .sort((a, b) => {
      const av = a.v;
      const bv = b.v;
      if (av == null && bv == null) return a.index - b.index;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
      return cmp !== 0 ? sign * cmp : a.index - b.index;
    })
    .map((x) => x.row);
}

/** Bedste vaerdi pr. kolonne blandt ledige ryttere (til fremhaevning). */
export function bestOf(rows: SquadRow[], pick: (row: SquadRow) => number | null): number | null {
  let best: number | null = null;
  for (const row of rows) {
    if (!row.selectable) continue;
    const v = pick(row);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * Forslag til en trup: de ledige ryttere med bedst rute-match for hele loebet (derefter form),
 * op til feltstoerrelsen. Kaptajnen vælges som i resten af spillet (resolveBoardRoles).
 * Forslaget GEMMES ALDRIG: det er en kladde spilleren gennemgaar og selv gemmer.
 */
export function suggestSquad(args: {
  rows: SquadRow[];
  max: number;
  sprintLeaderAllowed: boolean;
  current?: Selection;
}): Selection {
  const { rows, max, sprintLeaderAllowed } = args;
  // Ryttere laast af Train now kan hverken tages ind eller ud (serveren afviser begge): de bliver.
  const lockedIds = lockedPicks(rows, args.current);
  const pool = rows
    .filter((r) => r.selectable)
    .sort((a, b) => (b.routeMatch ?? -1) - (a.routeMatch ?? -1) || (b.form ?? -1) - (a.form ?? -1) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max - lockedIds.length));
  const riderIds = [...lockedIds, ...pool.map((r) => r.id)];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Codex P2 (#8056): de laaste rytteres roller afgoeres FOER resten, saa en laast jaeger med
  // hoejest rute-match ikke bliver kaptajn og derefter faar sin rolle tilbage uden kaptajn.
  const lockedRole = new Map<string, RoleKey>();
  if (args.current) {
    for (const id of lockedIds) {
      const role = roleOf(args.current, id);
      if (role !== "rider") lockedRole.set(id, role);
    }
  }
  const lockedWith = (role: RoleKey) => [...lockedRole].find(([, r]) => r === role)?.[0] ?? null;
  const suitabilityOf = (id: string) => (lockedRole.has(id) ? null : byId.get(id)?.routeMatch ?? null);
  const roles = resolveBoardRoles({
    riderIds,
    sprintLeaderAllowed,
    captainId: lockedWith("captain"),
    coCaptainId: lockedWith("co_captain"),
    sprintCaptainId: lockedWith("sprint_captain"),
    hunterId: lockedWith("hunter"),
    freeRoleIds: [...lockedRole].filter(([, r]) => r === "free_role").map(([id]) => id),
    suitabilityOf,
    ...(sprintLeaderAllowed ? { luxuryHelperId: null } : {}),
  });
  let proposal: Selection = {
    riderIds,
    captainId: roles.captain_id ?? null,
    sprintCaptainId: roles.sprint_captain_id ?? null,
    hunterId: roles.hunter_id ?? null,
    freeRoleIds: roles.free_role_ids ?? [],
    coCaptainId: roles.co_captain_id ?? null,
    luxuryHelperId: null,
  };
  for (const [id, role] of lockedRole) proposal = setRiderRole(proposal, id, role);
  // Fik en laast rolle alligevel kaptajnen fjernet (fx en laast delt kaptajn, der rykkede op),
  // vaelges kaptajnen igen blandt rytterne uden rolle, som resolveBoardRoles ville.
  if (!proposal.captainId && proposal.riderIds.length && !(proposal.sprintCaptainId && sprintLeaderAllowed)) {
    const plain = proposal.riderIds.filter((id) => roleOf(proposal, id) === "rider");
    const captain = pickFallbackCaptain({ riderIds: plain, suitabilityOf });
    if (captain != null) proposal = setRiderRole(proposal, captain, "captain");
  }
  return proposal;
}

/** De allerede valgte ryttere der er laast af Train now (de maa hverken tages ind eller ud). */
function lockedPicks(rows: SquadRow[], current?: Selection): string[] {
  if (!current) return [];
  const locked = new Set(rows.filter((r) => r.trainNowLocked).map((r) => r.id));
  return current.riderIds.filter((id) => locked.has(id));
}

/**
 * Kopierer en anden udtagelse ind som kladde. Ryttere der er optaget i et overlappende
 * loeb, skadede, for gamle eller laaste springes over (JeppeK 2/11). Roller foelger med
 * for de ryttere der bliver.
 */
export function copySquadFrom(args: {
  source: SeasonEntry[];
  rows: SquadRow[];
  max: number;
  sprintLeaderAllowed: boolean;
  current?: Selection;
}): { selection: Selection; skipped: number } {
  const { source, rows, max, sprintLeaderAllowed } = args;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lockedIds = lockedPicks(rows, args.current);
  const candidates = source.filter((e) => !lockedIds.includes(e.riderId));
  const kept = candidates.filter((e) => byId.get(e.riderId)?.selectable).slice(0, Math.max(0, max - lockedIds.length));
  let sel: Selection = { ...EMPTY_SELECTION, riderIds: [...lockedIds, ...kept.map((e) => e.riderId)], freeRoleIds: [] };
  if (args.current) {
    for (const id of lockedIds) {
      const role = roleOf(args.current, id);
      if (role !== "rider") sel = setRiderRole(sel, id, role);
    }
  }
  for (const e of kept) {
    const role = e.raceRole ? ROLE_FROM_ENTRY[e.raceRole] : undefined;
    if (!role) continue;
    if (role === "co_captain" && !sprintLeaderAllowed) continue;
    if (role === "luxury_helper" && !sprintLeaderAllowed) continue;
    sel = setRiderRole(sel, e.riderId, role);
  }
  return { selection: sel, skipped: candidates.length - kept.length };
}
