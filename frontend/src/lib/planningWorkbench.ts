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

/**
 * "Ryd udtagelse" som kladde: alle ryttere ud, undtagen dem der ikke maa flyttes (Train now-laast),
 * som beholder baade plads og rolle. Intet gemmes, foer spilleren selv trykker Gem.
 */
export function clearSquad(sel: Selection, keepIds: Iterable<string> = []): Selection {
  const keep = new Set(keepIds);
  let next: Selection = sel;
  for (const id of sel.riderIds) {
    if (!keep.has(id)) next = setRiderRole(next, id, "rider");
  }
  const riderIds = sel.riderIds.filter((id) => keep.has(id));
  return { ...next, riderIds, freeRoleIds: next.freeRoleIds.filter((id) => keep.has(id)) };
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

/**
 * #8306 · Har arbejdsfladen noget ugemt? En ugemt trup ELLER en ugemt taktik-kladde. Siden bruger svaret
 * til browserens luk-advarsel, saa en taktik-kladde ikke forsvinder tavst ved genindlaes eller luk af fanen.
 */
export function workbenchUnsaved({ squadDirty, tacticsDraft }: { squadDirty: boolean; tacticsDraft: boolean }): boolean {
  return squadDirty || tacticsDraft;
}

export interface UnloadEventLike {
  preventDefault: () => void;
  returnValue: unknown;
}
export interface UnloadTarget {
  addEventListener: (type: "beforeunload", handler: (e: UnloadEventLike) => void) => void;
  removeEventListener: (type: "beforeunload", handler: (e: UnloadEventLike) => void) => void;
}

/**
 * Browserens egen advarsel ved luk/genindlaes, saa intet ugemt forsvinder tavst. Returnerer oprydningen
 * (til en effect), eller undefined naar der intet er at vogte.
 */
export function guardUnload(target: UnloadTarget, active: boolean): (() => void) | undefined {
  if (!active) return undefined;
  const handler = (e: UnloadEventLike) => {
    e.preventDefault();
    e.returnValue = "";
  };
  target.addEventListener("beforeunload", handler);
  return () => target.removeEventListener("beforeunload", handler);
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

// ── "Handlinger" over mange loeb (kladde, ejer 14/11 variant B) ─────────────
// Tre handlinger ("Lad assistenten udtage", "Fjern udtagelser", "Afmeld") over et valgt omfang af
// loeb. Alt lander som en KLADDE: intet gemmes, foer spilleren trykker Gem, og alle kald gaar gennem
// sidens ene skrive-laas. Gem er alt eller intet pr. kald (PLANNING_CENTER_RULES §1).

/** Train now-laaste ryttere pr. loeb, som saesonmatrixen sender dem (trainNowLockByRace). */
export type TrainNowLocks = Record<string, { riderIds?: string[] } | undefined>;

export type BulkKind = "auto" | "clear" | "withdraw";
export type BulkScope = "next" | "checked" | "shown" | "season";
export const BULK_SCOPES: BulkScope[] = ["next", "checked", "shown", "season"];
export const BULK_KINDS: BulkKind[] = ["auto", "clear", "withdraw"];

/** Kladden: hvad hver handling goer ved hvert loeb (sidste handling paa et loeb vinder). */
export interface BulkDraft {
  kinds: Map<string, BulkKind>;
  /** Assistentens trup pr. loeb (serverens forslag), som den saa ud, da handlingen blev valgt. */
  auto: Map<string, SeasonEntry[]>;
}

export const EMPTY_DRAFT: BulkDraft = Object.freeze({ kinds: new Map(), auto: new Map() }) as BulkDraft;

/**
 * De loeb "Fjern udtagelser" kan rydde: kommende, ikke laaste, ikke afmeldte, med mindst én rytter
 * der kan tages ud (Train now-laaste bliver staaende, saa et loeb med kun dem er ikke ryddeligt).
 */
export function clearableRaceIds(
  races: SeasonRace[],
  entries: SeasonEntry[],
  withdrawn: Set<string> = new Set(),
  locks: TrainNowLocks = {},
): string[] {
  return races
    .filter((race) => !isRacePast(race) && !race.lineupLocked && !withdrawn.has(race.id))
    .filter((race) => {
      const locked = new Set(locks[race.id]?.riderIds ?? []);
      const own = entries.filter((e) => e.raceId === race.id);
      if (!own.some((e) => !locked.has(e.riderId))) return false;
      // Det der bliver tilbage, skal kunne gemmes: serveren kraever en kaptajn, saa snart truppen ikke
      // er tom. Bliver der laaste ryttere uden en laast kaptajn, ville hele det atomiske kald afvises;
      // saadan et loeb ryddes derfor ikke (spilleren rydder det selv paa fladen).
      const kept = own.filter((e) => locked.has(e.riderId));
      return kept.length === 0 || kept.some((e) => e.raceRole === "captain");
    })
    .map((race) => race.id);
}

/** Entries efter en rydning: de ryddede loeb beholder kun deres Train now-laaste ryttere (med rolle). */
export function entriesAfterClear(entries: SeasonEntry[], raceIds: Set<string>, locks: TrainNowLocks = {}): SeasonEntry[] {
  if (!raceIds.size) return entries;
  return entries.filter((e) => !raceIds.has(e.raceId) || (locks[e.raceId]?.riderIds ?? []).includes(e.riderId));
}

/** En udtagelse bygget af saesonmatrixens entries for ét loeb (roller foelger med). */
export function selectionFromEntries(entries: SeasonEntry[]): Selection {
  let sel: Selection = { ...EMPTY_SELECTION, riderIds: entries.map((e) => e.riderId), freeRoleIds: [] };
  for (const e of entries) {
    const role = e.raceRole ? ROLE_FROM_ENTRY[e.raceRole] : undefined;
    if (role) sel = setRiderRole(sel, e.riderId, role);
  }
  return sel;
}

/** Entries som kladden viser dem: ryddede loeb uden ryttere (Train now-laaste bliver), afmeldte tomme, assistentens trupper sat ind. */
export function entriesWithDraft(entries: SeasonEntry[], draft: BulkDraft, locks: TrainNowLocks = {}): SeasonEntry[] {
  if (!draft.kinds.size) return entries;
  const cleared = new Set([...draft.kinds].filter(([, k]) => k === "clear").map(([id]) => id));
  const replaced = new Set([...draft.kinds].filter(([, k]) => k !== "clear").map(([id]) => id));
  const kept = entriesAfterClear(entries, cleared, locks).filter((e) => !replaced.has(e.raceId));
  const added = [...draft.kinds].filter(([, k]) => k === "auto").flatMap(([id]) => draft.auto.get(id) ?? []);
  return [...kept, ...added];
}

/** Afmeldte loeb som kladden viser dem (de gemte plus kladdens afmeldinger). */
export function withdrawnWithDraft(withdrawn: Set<string>, draft: BulkDraft): Set<string> {
  const ids = [...draft.kinds].filter(([, k]) => k === "withdraw").map(([id]) => id);
  return ids.length ? new Set([...withdrawn, ...ids]) : withdrawn;
}

const byCalendar = (a: SeasonRace, b: SeasonRace) => a.gameDayStart - b.gameDayStart || a.name.localeCompare(b.name);

/** De loeb et omfang daekker, i kalenderens raekkefoelge. Kun kommende loeb kan aendres. */
export function scopeRaces(
  scope: BulkScope,
  ctx: { allRaces: SeasonRace[]; listRaces: SeasonRace[]; checked: Set<string>; withdrawn: Set<string> },
): SeasonRace[] {
  const open = ctx.allRaces.filter((r) => !isRacePast(r));
  if (scope === "season") return [...open].sort(byCalendar);
  if (scope === "shown") return ctx.listRaces.filter((r) => !isRacePast(r));
  if (scope === "checked") return open.filter((r) => ctx.checked.has(r.id)).sort(byCalendar);
  // "Naeste loeb": det foerste kommende loeb, holdet stadig kan aendre i.
  const next = [...open].sort(byCalendar).find((r) => !r.lineupLocked && !ctx.withdrawn.has(r.id));
  return next ? [next] : [];
}

/** De loeb i omfanget, som handlingen faktisk aendrer (taelleren ved knappen). `entries`/`withdrawn` er kladdens visning. */
export function actionTargets(
  kind: BulkKind,
  races: SeasonRace[],
  ctx: { entries: SeasonEntry[]; withdrawn: Set<string>; locks?: TrainNowLocks },
): SeasonRace[] {
  if (kind === "clear") {
    const ids = new Set(clearableRaceIds(races, ctx.entries, ctx.withdrawn, ctx.locks));
    return races.filter((r) => ids.has(r.id));
  }
  const counts = pickedCounts(ctx.entries);
  return races.filter((race) => {
    if (isRacePast(race) || race.lineupLocked || ctx.withdrawn.has(race.id)) return false;
    if (kind === "withdraw") return true;
    // Assistenten fylder kun tomme pladser; et afmeldt loeb (gemt eller i kladden) faar aldrig en trup.
    return raceReadiness(race, counts.get(race.id) ?? 0, ctx.withdrawn).missing > 0;
  });
}

/**
 * Kladden gemmes altid i ÉT atomisk kald pr. slags (masse-gem og masse-afmeld), og serveren tager
 * hoejst `max` loeb pr. kald. Nye loeb laegges derfor kun i kladden op til loftet; loeb der allerede
 * er i kladden, fylder ikke mere. `capped` siger aerligt, at der var flere, end loftet gav plads til.
 */
export function capToRoom(ids: string[], draft: BulkDraft, max: number): { ids: string[]; capped: boolean } {
  const fresh = ids.filter((id) => !draft.kinds.has(id));
  const room = Math.max(0, max - draft.kinds.size);
  const allowed = new Set(fresh.slice(0, room));
  return { ids: ids.filter((id) => draft.kinds.has(id) || allowed.has(id)), capped: fresh.length > room };
}

/** Laegger en handling oven i kladden for de givne loeb (ny kladde; den gamle roeres ikke). */
export function addToDraft(draft: BulkDraft, kind: BulkKind, raceIds: string[], auto?: Map<string, SeasonEntry[]>): BulkDraft {
  const kinds = new Map(draft.kinds);
  const nextAuto = new Map(draft.auto);
  for (const id of raceIds) {
    if (kind === "auto" && !auto?.has(id)) continue;
    kinds.set(id, kind);
    if (kind === "auto") nextAuto.set(id, auto!.get(id)!);
    else nextAuto.delete(id);
  }
  return { kinds, auto: nextAuto };
}

/** Tager loeb ud af kladden (spilleren har selv aendret, gemt eller afmeldt dem paa fladen). */
export function dropFromDraft(draft: BulkDraft, raceIds: Iterable<string>): BulkDraft {
  const drop = [...raceIds].filter((id) => draft.kinds.has(id));
  if (!drop.length) return draft;
  const kinds = new Map(draft.kinds);
  const auto = new Map(draft.auto);
  for (const id of drop) {
    kinds.delete(id);
    auto.delete(id);
  }
  return { kinds, auto };
}

/** Bjaelkens resume: antal loeb pr. handling og hvor mange ryttere assistenten satte ind. */
export function draftSummary(draft: BulkDraft, entries: SeasonEntry[]): { auto: number; added: number; clear: number; withdraw: number } {
  let auto = 0;
  let clear = 0;
  let withdraw = 0;
  let added = 0;
  for (const [id, kind] of draft.kinds) {
    if (kind === "auto") {
      auto += 1;
      const before = new Set(entries.filter((e) => e.raceId === id).map((e) => e.riderId));
      added += (draft.auto.get(id) ?? []).filter((e) => !before.has(e.riderId)).length;
    } else if (kind === "clear") clear += 1;
    else withdraw += 1;
  }
  return { auto, added, clear, withdraw };
}

export interface ProposalEntry {
  rider_id: string;
  race_role: string | null;
}

/**
 * Kladdens trupper, som assistenten skal regne med (POST /races/selection/auto/propose, `overrides`):
 * ryddede og assistent-udtagne loeb i kladden. Afmeldinger i kladden er ikke med; deres ryttere
 * binder stadig, til afmeldingen er gemt.
 */
export function draftOverrides(entries: SeasonEntry[], draft: BulkDraft, locks: TrainNowLocks = {}): Record<string, ProposalEntry[]> {
  const view = entriesWithDraft(entries, draft, locks);
  const out: Record<string, ProposalEntry[]> = {};
  for (const [raceId, kind] of draft.kinds) {
    if (kind === "withdraw") continue;
    out[raceId] = view.filter((e) => e.raceId === raceId).map((e) => ({ rider_id: e.riderId, race_role: e.raceRole }));
  }
  return out;
}

/** Serverens forslag som kladde-trupper. Et afmeldt loeb (gemt eller i kladden) springes altid over. */
export function proposalsToDraft(
  proposals: Array<{ race_id?: unknown; entries?: unknown }> | null | undefined,
  skip: Set<string> = new Set(),
): Map<string, SeasonEntry[]> {
  const out = new Map<string, SeasonEntry[]>();
  for (const p of proposals ?? []) {
    const raceId = typeof p?.race_id === "string" ? p.race_id : null;
    if (!raceId || skip.has(raceId) || !Array.isArray(p.entries) || !p.entries.length) continue;
    out.set(
      raceId,
      (p.entries as ProposalEntry[])
        .filter((e) => e && typeof e.rider_id === "string")
        .map((e) => ({ raceId, riderId: e.rider_id, raceRole: e.race_role && e.race_role !== "helper" ? e.race_role : null })),
    );
  }
  return out;
}

/**
 * Det et Gem af kladden SENDER: masse-gemmets aendringer (assistent og rydning) og afmeldingerne,
 * plus pr. loeb den udtagelse serveren gemmer. Svaret afstemmes mod dette oejebliksbillede.
 */
export function draftSubmission(
  entries: SeasonEntry[],
  draft: BulkDraft,
  locks: TrainNowLocks = {},
): { changes: Array<Record<string, unknown>>; selections: Map<string, Selection>; withdrawIds: string[] } {
  const view = entriesWithDraft(entries, draft, locks);
  const selections = new Map<string, Selection>();
  const changes: Array<Record<string, unknown>> = [];
  const withdrawIds: string[] = [];
  for (const [raceId, kind] of draft.kinds) {
    if (kind === "withdraw") {
      withdrawIds.push(raceId);
      continue;
    }
    const sel = selectionFromEntries(view.filter((e) => e.raceId === raceId));
    selections.set(raceId, sel);
    changes.push({ raceId, ...toPutBody(sel, sel.luxuryHelperId != null) });
  }
  return { changes, selections, withdrawIds };
}

/**
 * Et gemt masse-kald afstemmes mod det loeb og den udtagelse der blev SENDT. Et andet loeb end det
 * fladen viser roeres ikke. Var fladen ren (den viste den gemte trup), viser den nu det sendte, saa en
 * gammel trup aldrig bliver staaende som en ugemt kladde, der kan overskrive gemmet (Codex P1).
 * Spillerens egne ugemte aendringer bliver staaende som ugemte (dirty).
 */
export function settleBulkSave(
  view: { raceId: string; sel: Selection; saved: Selection },
  submitted: { raceId: string; sel: Selection },
): { mine: false } | { mine: true; saved: Selection; sel: Selection; dirty: boolean } {
  if (view.raceId !== submitted.raceId) return { mine: false };
  const sel = selectionDirty(view.sel, view.saved) ? view.sel : submitted.sel;
  return { mine: true, saved: submitted.sel, sel, dirty: selectionDirty(sel, submitted.sel) };
}

/** Svaret fra et af kladdens kald (samme form som planningWorkbenchData's ApiResult). */
export interface BulkCallResult {
  ok: boolean;
  data?: any;
}

/** De tre kald kladden bruger. Siden giver de rigtige; proeverne giver styrede loefter. */
export interface BulkApi {
  propose: (raceIds: string[], overrides: Record<string, ProposalEntry[]>) => Promise<BulkCallResult>;
  saveSelections: (changes: Array<Record<string, unknown>>) => Promise<BulkCallResult>;
  withdraw: (raceIds: string[], dryRun: boolean) => Promise<BulkCallResult>;
}

/** En fejl fra et af kladdens kald: hvad der gik galt, og hvad der eventuelt alligevel blev gemt. */
export interface BulkFailure {
  step: "assist" | "save" | "withdraw";
  /** Trupperne blev gemt, men afmeldingerne ikke (de ligger stadig i kladden). */
  partial: boolean;
  body: any;
}

export interface BulkState {
  /** Kladden efter hver handling; den sidste er den gaeldende. Fortryd fjerner den sidste. */
  stack: BulkDraft[];
  failure: BulkFailure | null;
  /** Assistenten fandt ingen ledige ryttere til loebene (intet er aendret). */
  emptyAssist: boolean;
}

export interface BulkSaved {
  selections: Map<string, Selection>;
  withdrawn: string[];
}

/**
 * Kladdens tilstand og de tre handlinger, uden React. Alle kald gaar gennem sidens skrive-laas:
 * mens et kald koerer (et gem, en afmelding, assistenten), kan hverken en handling, Fortryd eller
 * Gem sendes, og intet anvendes paa kladden imens.
 */
export function createBulkStore({ gate, api }: { gate: WriteGate; api: BulkApi }) {
  let state: BulkState = { stack: [], failure: null, emptyAssist: false };
  const listeners = new Set<() => void>();
  const set = (next: Partial<BulkState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };
  const draft = () => state.stack[state.stack.length - 1] ?? EMPTY_DRAFT;
  const push = (next: BulkDraft) => set({ stack: [...state.stack, next], failure: null, emptyAssist: false });

  return {
    get: () => state,
    draft,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * En handling paa de givne loeb (allerede afgraenset af omfanget og loftet). "Lad assistenten
     * udtage" spoerger serveren (laeser kun) og laegger svaret i kladden.
     */
    async run(
      kind: BulkKind,
      raceIds: string[],
      ctx: { entries: SeasonEntry[]; locks?: TrainNowLocks; withdrawn?: Set<string> },
    ): Promise<"done" | "busy" | "empty" | "failed"> {
      if (!raceIds.length) return "empty";
      if (gate.current()) return "busy";
      if (kind !== "auto") {
        push(addToDraft(draft(), kind, raceIds));
        return "done";
      }
      const result = await gate.run("assist", () => api.propose(raceIds, draftOverrides(ctx.entries, draft(), ctx.locks)));
      if (!result.ran) return "busy";
      const res = result.value;
      if (!res.ok) {
        set({ failure: { step: "assist", partial: false, body: res.data ?? {} }, emptyAssist: false });
        return "failed";
      }
      // Et loeb afmeldt imens (gemt eller i kladden) faar aldrig assistentens trup.
      const out = withdrawnWithDraft(ctx.withdrawn ?? new Set(), draft());
      const auto = proposalsToDraft(res.data?.proposals, out);
      if (!auto.size) {
        set({ emptyAssist: true, failure: null });
        return "empty";
      }
      push(addToDraft(draft(), "auto", [...auto.keys()], auto));
      return "done";
    },
    /** Fortryd: kladden som den var foer den seneste handling. Venter, mens et kald koerer. */
    undo(): boolean {
      if (gate.current() || !state.stack.length) return false;
      set({ stack: state.stack.slice(0, -1), failure: null, emptyAssist: false });
      return true;
    },
    /** Loebene forlader kladden helt (ogsaa i Fortryd-historikken): spilleren har selv taget over. */
    drop(raceIds: Iterable<string>) {
      const ids = [...raceIds];
      if (!state.stack.some((d) => ids.some((id) => d.kinds.has(id)))) return;
      set({ stack: state.stack.map((d) => dropFromDraft(d, ids)).filter((d) => d.kinds.size > 0) });
    },
    /**
     * Gem: foerst kontrolleres afmeldingerne (uden at skrive), saa gemmes trupperne i ét atomisk kald,
     * og til sidst afmeldingerne i ét atomisk kald. `onSaved` koerer inden for laasen, saa siden kan
     * afstemme fladen, foer noget andet kan ske.
     */
    async save(
      ctx: { entries: SeasonEntry[]; locks?: TrainNowLocks },
      onSaved?: (saved: BulkSaved) => Promise<void> | void,
    ): Promise<"saved" | "busy" | "failed" | "partial" | "empty"> {
      const current = draft();
      if (!current.kinds.size) return "empty";
      const sub = draftSubmission(ctx.entries, current, ctx.locks);
      const result = await gate.run("bulk", async () => {
        if (sub.withdrawIds.length && sub.changes.length) {
          const check = await api.withdraw(sub.withdrawIds, true);
          if (!check.ok) {
            set({ failure: { step: "withdraw", partial: false, body: check.data ?? {} } });
            return "failed" as const;
          }
        }
        if (sub.changes.length) {
          const res = await api.saveSelections(sub.changes);
          if (!res.ok) {
            set({ failure: { step: "save", partial: false, body: res.data ?? {} } });
            return "failed" as const;
          }
        }
        if (sub.withdrawIds.length) {
          const res = await api.withdraw(sub.withdrawIds, false);
          if (!res.ok) {
            const savedSquads = sub.changes.length > 0;
            // Trupperne er gemt; kun afmeldingerne bliver i kladden, saa intet gemt ser ugemt ud.
            const rest = addToDraft(EMPTY_DRAFT, "withdraw", sub.withdrawIds);
            set({ stack: savedSquads ? [rest] : state.stack, failure: { step: "withdraw", partial: savedSquads, body: res.data ?? {} } });
            if (savedSquads) await onSaved?.({ selections: sub.selections, withdrawn: [] });
            return savedSquads ? ("partial" as const) : ("failed" as const);
          }
        }
        set({ stack: [], failure: null, emptyAssist: false });
        await onSaved?.({ selections: sub.selections, withdrawn: sub.withdrawIds });
        return "saved" as const;
      });
      return result.ran ? result.value : "busy";
    },
  };
}

export type BulkStore = ReturnType<typeof createBulkStore>;

// ── Skrive-laasen: ÉT sted ejer "der er et skrivekald i gang" ───────────────

/**
 * Hvilket kald der koerer: fladens gem, en afmelding/deltag igen, sidens masse-gem, eller assistentens
 * forslag til kladden (det laeser kun, men kladden maa ikke aendres, mens et gem er undervejs).
 */
export type WriteKind = "save" | "withdraw" | "bulk" | "assist" | "peak";

export type WriteResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Siden har én skrive-laas for alle sine skrivekald (gem, afmeld, masse-gem). Laasen tages synkront
 * (et dobbeltklik kan aldrig sende to kald), og den slippes KUN af det kald, der tog den, naar det er
 * faerdigt (ogsaa ved fejl). Intet andet kan slippe den: hverken en kladde, der anvendes, en
 * fortrydelse eller fladens visnings-tilstand. Alle veje, der sender eller anvender noget, laeser den.
 */
export interface WriteGate {
  /** Det kald, der holder laasen lige nu, eller null. */
  current: () => WriteKind | null;
  /** Til useSyncExternalStore: kaldes hver gang laasen tages eller slippes. */
  subscribe: (listener: () => void) => () => void;
  /** Koer `task` med laasen. Holdes den allerede, sendes intet (`ran: false`). */
  run: <T>(kind: WriteKind, task: () => Promise<T>) => Promise<WriteResult<T>>;
}

export function createWriteGate(): WriteGate {
  let held: WriteKind | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    current: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(kind, task) {
      if (held) return { ran: false };
      held = kind;
      notify();
      try {
        return { ran: true, value: await task() };
      } finally {
        held = null;
        notify();
      }
    },
  };
}

/**
 * Et klik paa et andet loeb. Mens et skrivekald koerer, saettes skiftet i koe og udfoeres, naar
 * kaldet er faerdigt (saa et svar aldrig lander paa en flade, der er skiftet imens). Ugemte
 * aendringer aabner bjaelken i stedet for at gaa tabt.
 */
export function raceSwitchStep({
  same,
  writing,
  dirty,
}: {
  same: boolean;
  writing: WriteKind | null;
  dirty: boolean;
}): "none" | "queue" | "ask" | "go" {
  if (same) return "none";
  if (writing) return "queue";
  return dirty ? "ask" : "go";
}

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
  /** Rytterens naturlige type (riders.primary_type), kolonnen Type. */
  type?: string | null;
  /** Forventet belastning af loebet som ord (serveren sender kun ordet); null = ukendt. */
  load?: LoadWord | null;
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
      type: r.primaryType ?? null,
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
  | "load"
  | "type"
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
  return key === "name" || key === "status" || key === "role" || key === "type" ? "asc" : "desc";
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
    case "load":
      return row.load ? LOAD_WORDS.indexOf(row.load) : null;
    case "type":
      return row.type ?? null;
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

// ── Runde 3: visningerne Trup | Taktik | Formtop, "Efter loebet" og mobil-arket ──

export const WORKBENCH_VIEWS = ["squad", "tactics", "peak"] as const;
export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

export function isWorkbenchView(value: unknown): value is WorkbenchView {
  return typeof value === "string" && (WORKBENCH_VIEWS as readonly string[]).includes(value);
}

/**
 * Hovedets ene guld-knap gemmer det, spilleren ser (ejervalg 16/11, punkt 8 B): Trup = "Gem trup",
 * Taktik = "Gem taktik", Taktik med en ugemt trup = "Gem trup og saet taktik", Formtop = "Anvend paa valgte".
 */
export function saveLabelKey(view: WorkbenchView, { squadDirty = false }: { squadDirty?: boolean } = {}): string {
  if (view === "tactics") return squadDirty ? "race.saveSquadAndTactics" : "race.saveTactics";
  return view === "peak" ? "race.savePeaks" : "race.save";
}

// ── Ejervalg 16/11: belastning i ord, kolonnevalg paa mobil, formtop i trup og liste ──

/** Forventet belastning som ord (punkt 5). Raekkefoelgen er sorteringens: let foerst. */
export const LOAD_WORDS = ["light", "medium", "hard"] as const;
export type LoadWord = (typeof LOAD_WORDS)[number];

export function isLoadWord(value: unknown): value is LoadWord {
  return typeof value === "string" && (LOAD_WORDS as readonly string[]).includes(value);
}

/** Saet serverens ord paa raekkerne; alt andet end et kendt ord er ukendt (null). */
export function withLoad(rows: SquadRow[], byRider: Record<string, unknown> | null | undefined): SquadRow[] {
  if (!byRider) return rows;
  return rows.map((row) => {
    const v = byRider[row.id];
    return { ...row, load: isLoadWord(v) ? v : null };
  });
}

/** Mobilens kolonnevalg (punkt 2): navnet staar altid, plus op til tre tal-kolonner. */
export const MOBILE_COLUMNS = ["routeMatch", "form", "fatigue", "load", "rating"] as const;
export type MobileColumn = (typeof MOBILE_COLUMNS)[number];
export const MOBILE_COLUMN_MAX = 3;
export const DEFAULT_MOBILE_COLUMNS: MobileColumn[] = ["routeMatch", "form", "fatigue"];

/** Gyldige, unikke kolonner i den viste raekkefoelge; tomt eller ugyldigt giver standarden. */
export function normalizeMobileColumns(value: unknown): MobileColumn[] {
  if (!Array.isArray(value)) return DEFAULT_MOBILE_COLUMNS;
  const picked = MOBILE_COLUMNS.filter((c) => value.includes(c)).slice(0, MOBILE_COLUMN_MAX);
  return picked.length ? picked : DEFAULT_MOBILE_COLUMNS;
}

/** Slaa en kolonne til eller fra. Mindst én og hoejst tre; en fjerde skubber den aeldste ud. */
export function toggleMobileColumn(current: MobileColumn[], column: MobileColumn): MobileColumn[] {
  if (current.includes(column)) return current.length > 1 ? current.filter((c) => c !== column) : current;
  const next = [...current, column];
  const kept = next.length > MOBILE_COLUMN_MAX ? next.slice(next.length - MOBILE_COLUMN_MAX) : next;
  return MOBILE_COLUMNS.filter((c) => kept.includes(c));
}

/** Rytterens naeste formtop (punkt 7): hvornaar han topper, vist ved Form, aldrig i Status. */
export interface PeakNext {
  name: string;
  date: string;
  days: number;
}

export function nextPeakByRider(rows: PeakRow[]): Map<string, PeakNext> {
  const out = new Map<string, PeakNext>();
  for (const row of rows) if (row.next) out.set(row.id, row.next);
  return out;
}

/** Antal ryttere med en formtop mod hvert loeb (punkt 3, loebslistens formtop-maerke). */
export function peakCountsByRace(riders: PeakBoardRider[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of riders ?? []) {
    const races = new Set((r.peaks ?? []).filter((p) => !p.isSuggestion && p.targetRaceId).map((p) => String(p.targetRaceId)));
    for (const id of races) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/**
 * Formtop-visningen med udtagne ryttere oeverst (punkt 6 B): "I truppen" og "Ikke udtaget", hver i sin
 * egen sortering. `warn` = formtoppen rammer det aabne loeb, men rytteren er ikke udtaget.
 */
export function groupPeakRows(rows: PeakRow[], selectedIds: readonly string[]): { inSquad: PeakRow[]; outside: PeakRow[]; warn: Set<string> } {
  const picked = new Set(selectedIds);
  const inSquad = rows.filter((r) => picked.has(r.id));
  const outside = rows.filter((r) => !picked.has(r.id));
  const warn = new Set(outside.filter((r) => r.here != null).map((r) => r.id));
  return { inSquad, outside, warn };
}

/** Forrige eller naeste loeb i listen (mobil-arkets pile). Null i enderne. */
export function adjacentRace<T extends { id: string }>(races: T[], id: string | null | undefined, dir: -1 | 1): T | null {
  const i = races.findIndex((r) => r.id === id);
  if (i < 0) return null;
  return races[i + dir] ?? null;
}

/** Hele dage fra `from` til `to` (YYYY-MM-DD); negativ naar `to` er passeret. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

// Formtop: samme data og samme kald som /planning's Form-fane (GET /api/peak-plans/board, POST /bulk).
export interface PeakPlan {
  id?: string | null;
  targetRaceId: string | null;
  targetRaceName?: string | null;
  isSuggestion?: boolean;
  locked?: boolean;
  windowStart?: string | null;
  windowEnd?: string | null;
  [key: string]: unknown;
}

export interface PeakBoardRider {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  nationality?: string | null;
  squad?: string | null;
  rating?: number | null;
  form?: number | null;
  fatigue?: number | null;
  peaks?: PeakPlan[];
  [key: string]: unknown;
}

export interface PeakBoardRace {
  id: string;
  name: string;
  date?: string | null;
  isMine?: boolean;
  started?: boolean;
  [key: string]: unknown;
}

export type PeakRowState = "here" | "open" | "full" | "notSenior";

export interface PeakRow {
  id: string;
  name: string;
  nationality: string | null;
  rating: number | null;
  form: number | null;
  fatigue: number | null;
  /** Rytterens rigtige formtop-mål (assistentens forslag er ikke et mål). */
  targets: PeakPlan[];
  /** Formtoppen mod det aabne loeb, hvis den findes. */
  here: PeakPlan | null;
  /** Det naermeste kommende mål: navn, startdato og dage til start. */
  next: { name: string; date: string; days: number } | null;
  state: PeakRowState;
}

export function peakRiderName(r: PeakBoardRider): string {
  return [r.firstname, r.lastname].filter(Boolean).join(" ") || r.id;
}

/** Raekkerne i Formtop-visningen for det aabne loeb. Kun seniortruppen kan planlaegge (som Form-fanen). */
export function buildPeakRows(args: { riders: PeakBoardRider[]; races: PeakBoardRace[]; raceId: string; maxPerRider: number; today: string }): PeakRow[] {
  const raceById = new Map(args.races.map((r) => [r.id, r]));
  return (args.riders ?? []).map((r) => {
    const targets = (r.peaks ?? []).filter((p) => !p.isSuggestion && p.targetRaceId);
    const here = targets.find((p) => p.targetRaceId === args.raceId) ?? null;
    const upcoming = targets
      .map((p) => {
        const race = raceById.get(p.targetRaceId as string);
        const date = race?.date ?? null;
        return date ? { name: race?.name ?? p.targetRaceName ?? "", date, days: daysBetween(args.today, date) } : null;
      })
      .filter((x): x is { name: string; date: string; days: number } => x != null && x.days >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const senior = (r.squad ?? "senior") === "senior";
    const state: PeakRowState = here ? "here" : !senior ? "notSenior" : targets.length >= args.maxPerRider ? "full" : "open";
    return {
      id: r.id,
      name: peakRiderName(r),
      nationality: r.nationality ?? null,
      rating: r.rating ?? null,
      form: r.form ?? null,
      fatigue: r.fatigue ?? null,
      targets,
      here,
      next: upcoming[0] ?? null,
      state,
    };
  });
}

/** Kan det aabne loeb vaelges som formtop-mål? Kun holdets egne loeb, der ikke er startet (som Form-fanen). */
export function peakTargetOpen(race: PeakBoardRace | null | undefined, today: string): boolean {
  if (!race || race.isMine === false || race.started === true) return false;
  return !race.date || race.date >= today;
}

/** De afkrydsede ryttere, der faktisk kan faa en formtop mod loebet ("Apply to selected"). */
export function peakApplyPairs(rows: PeakRow[], checked: Set<string>, raceId: string): Array<{ riderId: string; raceId: string }> {
  return rows.filter((r) => checked.has(r.id) && r.state === "open").map((r) => ({ riderId: r.id, raceId }));
}

export type PeakSortKey = "name" | "rating" | "form" | "fatigue" | "target" | "start";

export function sortPeakRows(rows: PeakRow[], sort: { key: PeakSortKey; dir: "asc" | "desc" }): PeakRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (r: PeakRow): number | string | null => {
    switch (sort.key) {
      case "name":
        return r.name;
      case "rating":
        return r.rating;
      case "form":
        return r.form;
      case "fatigue":
        return r.fatigue;
      case "target":
        return r.here ? 2 : r.targets.length ? 1 : 0;
      case "start":
        return r.next ? r.next.days : null;
      default:
        return null;
    }
  };
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.index - b.index;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const cmp = typeof a.v === "string" || typeof b.v === "string" ? String(a.v).localeCompare(String(b.v)) : a.v - b.v;
      return cmp !== 0 ? sign * cmp : a.index - b.index;
    })
    .map((x) => x.row);
}
