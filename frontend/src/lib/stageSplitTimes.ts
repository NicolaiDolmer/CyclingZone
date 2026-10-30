// #6080: mellemtider og "hvor tabte min rytter tid". Ren afledning af etapens
// tidslinje (race_stage_timelines.events, v4). Ingen ny persistering, intet
// opfundet: alt herunder er events motoren allerede skrev.
//
// Kilderne:
// - gap_update { group_id, gap_seconds }: gruppens afstand til fronten. Motoren
//   skriver kun et nyt tal naar afstanden har flyttet sig nok, og aldrig for
//   fronten selv (gap 0). Seneste tal ved eller foer et punkt er derfor det
//   motoren selv havde paa det tidspunkt.
// - breakaway_formed / peloton_splits / finale_attack (rider_ids + group_id) og
//   group_merged (into_group_id): hvem der sidder i hvilken gruppe.
// - incident: styrt/defekt. Et uheld med tidstab flytter rytteren til en solo-
//   gruppe ("solo-m10-..."), som eventet ikke navngiver; den foerste ukendte
//   solo-gruppe efter uheldet er hans.
// - peloton_splits.cause: den dokumenterede grund til at en gruppe faldt af.
//
// v3-tidslinjer (gap_update uden group_id) har ingen grupper at vise; alt
// returnerer tomt, og fladen viser det samme som foer.

export type TimelineEvent = { km?: number; type?: string; params?: Record<string, unknown> | null } | null | undefined;

export type SplitGroup = {
  groupId: string;
  kind: "breakaway" | "peloton" | "group" | "solo";
  riderCount: number | null;
  soloRiderId: string | null;
  gapSeconds: number;
  ownRiderIds: string[];
};

export type SplitPoint = {
  km: number;
  kind: "kom" | "sprint";
  name: string | null;
  category: string | null;
  groups: SplitGroup[];
  hiddenCount: number;
};

export type DropReason = "climb_deficit" | "wprime_depleted" | "mixed" | "grupetto" | "cobbles_sector" | "unknown";

export type TimeLossEntry =
  | {
    type: "drop";
    km: number;
    riderId: string;
    /** Alle egne ryttere i samme fald (samme km, gruppe og grund). */
    riderIds: string[];
    from: "breakaway" | "peloton" | "group";
    reason: DropReason;
    climbName: string | null;
    sectorName: string | null;
    order: "save" | "grupetto" | null;
    /** #7333: rytteren koerte efter en etapeplan; opgaven han havde paa stedet (ellers null). */
    planTask: string | null;
  }
  | { type: "event"; km: number; riderId: string; event: NonNullable<TimelineEvent> };

const INITIAL_GROUP = "peloton-0";
const MEMBERSHIP_TYPES = new Set(["breakaway_formed", "peloton_splits", "finale_attack"]);
const KNOWN_CAUSES = new Set(["climb_deficit", "wprime_depleted", "mixed", "grupetto", "cobbles_sector"]);
export const DEFAULT_MAX_GROUPS = 5;

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sortedEvents(events: readonly TimelineEvent[] | null | undefined): NonNullable<TimelineEvent>[] {
  // Stabil sortering: events paa samme km beholder motorens raekkefoelge.
  return [...(events || [])]
    .filter((e): e is NonNullable<TimelineEvent> => Boolean(e?.type))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.km ?? 0) - (b.e.km ?? 0) || a.i - b.i)
    .map(({ e }) => e);
}

/** Har tidslinjen v4's gruppe-gab? (v3 og aeldre: nej, og intet vises.) */
export function hasGroupGaps(events: readonly TimelineEvent[] | null | undefined): boolean {
  return (events || []).some((e) => e?.type === "gap_update" && typeof e.params?.group_id === "string");
}

function groupKind(groupId: string): SplitGroup["kind"] {
  if (groupId.startsWith("breakaway")) return "breakaway";
  if (groupId === INITIAL_GROUP) return "peloton";
  if (groupId.startsWith("solo")) return "solo";
  return "group";
}

/**
 * Genafspiller gruppe-medlemskab og gab. `onEvent` kaldes EFTER hvert event er
 * anvendt, saa kalderen kan tage et snapshot ved et waypoint.
 */
function replay(
  events: NonNullable<TimelineEvent>[],
  onEvent: (event: NonNullable<TimelineEvent>, state: ReplayState, before: Map<string, string>) => void,
) {
  const start = events.find((e) => e.type === "stage_start");
  const fieldCount = Number(start?.params?.field_count);
  const state: ReplayState = {
    groupOf: new Map(),
    removed: new Set(),
    gaps: new Map(),
    known: new Set([INITIAL_GROUP]),
    aliases: new Map(),
    fieldCount: Number.isFinite(fieldCount) && fieldCount > 0 ? fieldCount : null,
  };
  let pendingIncidentRider: string | null = null;

  for (const event of events) {
    const p = event.params || {};
    // Hvor rytterne sad FOER eventet (til "faldt af fra hvilken gruppe").
    const before = new Map<string, string>();
    const move = (riderId: string, groupId: string) => {
      before.set(riderId, groupOfRider(state, riderId));
      state.groupOf.set(riderId, groupId);
      state.known.add(groupId);
    };

    if (MEMBERSHIP_TYPES.has(event.type as string)) {
      const groupId = str(p.group_id);
      if (groupId) for (const id of idsOf(p.rider_ids)) move(id, groupId);
    } else if (event.type === "group_merged") {
      const absorbed = str(p.group_id);
      const into = str(p.into_group_id);
      if (into) {
        for (const id of idsOf(p.rider_ids)) move(id, into);
        if (absorbed) {
          state.aliases.set(absorbed, into);
          state.gaps.delete(absorbed);
          // Ryttere vi ikke kendte navnet paa (fx implicit i feltet) foelger med.
          for (const [rider, g] of state.groupOf) if (g === absorbed) state.groupOf.set(rider, into);
        }
      }
    } else if (event.type === "incident") {
      const riderId = str(p.rider_id);
      if (riderId && p.outcome === "abandoned") {
        state.removed.add(riderId);
        state.groupOf.delete(riderId);
      } else if (riderId && p.outcome !== "protected_three_km_rule") {
        pendingIncidentRider = riderId;
      }
    } else if (event.type === "outside_time_limit") {
      for (const id of idsOf(p.rider_ids)) { state.removed.add(id); state.groupOf.delete(id); }
    } else if (event.type === "gap_update") {
      const groupId = str(p.group_id);
      const gap = Number(p.gap_seconds);
      if (groupId && Number.isFinite(gap)) {
        if (!state.known.has(groupId) && groupId.startsWith("solo") && pendingIncidentRider) {
          move(pendingIncidentRider, groupId);
          pendingIncidentRider = null;
        }
        state.gaps.set(groupId, gap);
      }
    }
    onEvent(event, state, before);
  }
}

type ReplayState = {
  groupOf: Map<string, string>;
  removed: Set<string>;
  gaps: Map<string, number>;
  known: Set<string>;
  aliases: Map<string, string>;
  fieldCount: number | null;
};

function groupOfRider(state: ReplayState, riderId: string): string {
  return state.groupOf.get(riderId) ?? INITIAL_GROUP;
}

function resolveAlias(state: ReplayState, groupId: string): string {
  let g = groupId;
  for (let i = 0; i < 50 && state.aliases.has(g); i++) g = state.aliases.get(g) as string;
  return g;
}

function snapshotGroups(state: ReplayState, ownRiderIds: readonly string[]): SplitGroup[] {
  const members = new Map<string, string[]>();
  for (const [rider, g] of state.groupOf) {
    if (!members.has(g)) members.set(g, []);
    (members.get(g) as string[]).push(rider);
  }
  const explicitOutsidePeloton = [...state.groupOf.values()].filter((g) => g !== INITIAL_GROUP).length;
  const implicitPeloton = state.fieldCount == null
    ? null
    : state.fieldCount - explicitOutsidePeloton - [...state.removed].filter((id) => !state.groupOf.has(id)).length;

  const alive: string[] = [];
  for (const g of state.known) {
    if (state.aliases.has(g)) continue;
    const isAlive = g === INITIAL_GROUP
      ? (implicitPeloton == null || implicitPeloton > 0)
      : (members.get(g)?.length ?? 0) > 0;
    if (isAlive) alive.push(g);
  }
  if (!alive.length) return [];
  const rawGap = (g: string) => state.gaps.get(g) ?? 0;
  const minGap = Math.min(...alive.map(rawGap));
  const own = new Set(ownRiderIds);
  // Et "udbrud" bag feltet er ikke laengere et udbrud (fx hentet nedkoersels-
  // angreb): det vises som en almindelig gruppe.
  const pelotonGap = alive.includes(INITIAL_GROUP) ? rawGap(INITIAL_GROUP) : null;
  const groups = alive
    .map((g): SplitGroup => {
      const ids = members.get(g) ?? [];
      const ownIds = g === INITIAL_GROUP
        ? ownRiderIds.filter((id) => !state.groupOf.has(id) && !state.removed.has(id)).concat(ids.filter((id) => own.has(id)))
        : ids.filter((id) => own.has(id));
      const count = g === INITIAL_GROUP ? implicitPeloton : ids.length;
      const soloRiderId = g !== INITIAL_GROUP && ids.length === 1 ? ids[0] : null;
      const kindOf = groupKind(g);
      const base = kindOf === "breakaway" && pelotonGap != null && rawGap(g) > pelotonGap ? "group" : kindOf;
      return {
        groupId: g,
        kind: soloRiderId ? "solo" : (base === "solo" ? "group" : base),
        riderCount: count,
        soloRiderId,
        gapSeconds: Math.max(0, Math.round(rawGap(g) - minGap)),
        ownRiderIds: [...new Set(ownIds)],
      };
    })
    .sort((a, b) => a.gapSeconds - b.gapSeconds || a.groupId.localeCompare(b.groupId));
  // "Feltet" er den stoerste gruppe ved passagen, ikke blot motorens startgruppe
  // (som efter splits kan vaere en lille rest foran en stor gruppe laengere tilbage).
  let largest: SplitGroup | null = null;
  for (const g of groups) {
    if ((g.kind === "peloton" || g.kind === "group") && (g.riderCount ?? 0) > (largest?.riderCount ?? 0)) largest = g;
  }
  return groups.map((g) => {
    if (g === largest) return { ...g, kind: "peloton" };
    return g.kind === "peloton" ? { ...g, kind: "group" } : g;
  });
}

/**
 * Mellemtider ved hver stigning (kom_passage) og mellemsprint: gruppernes
 * afstand til fronten, antal ryttere og hvor holdets egne ryttere sad.
 * Viser de `maxGroups` forreste grupper plus enhver gruppe med egne ryttere.
 */
export function buildSplitTimes(
  events: readonly TimelineEvent[] | null | undefined,
  { ownRiderIds = [], maxGroups = DEFAULT_MAX_GROUPS }: { ownRiderIds?: readonly string[]; maxGroups?: number } = {},
): SplitPoint[] {
  if (!hasGroupGaps(events)) return [];
  const sorted = sortedEvents(events);
  const waypointIdx = new Set(sorted
    .map((e, i) => (e.type === "kom_passage" || e.type === "intermediate_sprint" ? i : -1))
    .filter((i) => i >= 0));
  if (!waypointIdx.size) return [];
  // Snapshot tages efter det SIDSTE event paa waypointets km, saa splits og gab
  // fra samme segment (samme km) er med.
  const lastIdxAtKm = new Map<number, number>();
  sorted.forEach((e, i) => lastIdxAtKm.set(e.km ?? 0, i));
  const pendingAt = new Map<number, NonNullable<TimelineEvent>[]>();
  for (const i of waypointIdx) {
    const last = lastIdxAtKm.get(sorted[i].km ?? 0) as number;
    if (!pendingAt.has(last)) pendingAt.set(last, []);
    (pendingAt.get(last) as NonNullable<TimelineEvent>[]).push(sorted[i]);
  }

  const out: SplitPoint[] = [];
  let idx = -1;
  replay(sorted, (_event, state) => {
    idx += 1;
    const waypoints = pendingAt.get(idx);
    if (!waypoints) return;
    const groups = snapshotGroups(state, ownRiderIds);
    if (groups.length < 2) return; // samlet felt: intet tidsgab at vise
    const shown = groups.filter((g, i) => i < maxGroups || g.ownRiderIds.length > 0);
    for (const w of waypoints) {
      const p = w.params || {};
      out.push({
        km: w.km ?? 0,
        kind: w.type === "kom_passage" ? "kom" : "sprint",
        name: str(p.name),
        category: p.category == null ? null : String(p.category),
        groups: shown,
        hiddenCount: groups.length - shown.length,
      });
    }
  });
  return out;
}

function fromKind(groupId: string): "breakaway" | "peloton" | "group" {
  const kind = groupKind(groupId);
  return kind === "breakaway" || kind === "peloton" ? kind : "group";
}

/**
 * Hvor holdets egne ryttere mistede kontakten, og den dokumenterede grund.
 * - Et fald (peloton_splits) taeller kun hvis rytteren ikke senere kom tilbage
 *   til gruppen han faldt fra (group_merged ind i den). Det foerste fald der
 *   staar ved magt vises.
 * - Styrt/defekt (incident) og favoritknæk vises som deres egne linjer.
 * - `effortByRider`: spillerens egen indsats-ordre for etapen ("save" =
 *   Kør roligt, "grupetto"). Kun en ordre spilleren selv gav, aldrig gaettet.
 */
export function buildOwnTimeLoss(
  events: readonly TimelineEvent[] | null | undefined,
  { ownRiderIds = [], effortByRider = null }: { ownRiderIds?: readonly string[]; effortByRider?: ReadonlyMap<string, string> | null } = {},
): TimeLossEntry[] {
  if (!hasGroupGaps(events) || !ownRiderIds.length) return [];
  const own = new Set(ownRiderIds);
  const sorted = sortedEvents(events);
  const komKms = new Map<number, string>();
  for (const e of sorted) {
    const name = e.type === "kom_passage" ? str(e.params?.name) : null;
    if (name) komKms.set(e.km ?? 0, name);
  }
  const drops = new Map<string, Array<{ entry: Extract<TimeLossEntry, { type: "drop" }>; source: string }>>();
  const other: TimeLossEntry[] = [];

  replay(sorted, (event, state, before) => {
    const p = event.params || {};
    if (event.type === "peloton_splits") {
      for (const riderId of idsOf(p.rider_ids)) {
        if (!own.has(riderId)) continue;
        const source = str(p.source_group_id) ?? before.get(riderId) ?? INITIAL_GROUP;
        const cause = str(p.cause);
        const effort = effortByRider?.get(riderId);
        const planTask = stagePlanTaskAt(effortByRider, sorted, riderId, event.km ?? 0);
        const entry: Extract<TimeLossEntry, { type: "drop" }> = {
          type: "drop",
          km: event.km ?? 0,
          riderId,
          riderIds: [riderId],
          from: fromKind(resolveAlias(state, source)),
          reason: cause && KNOWN_CAUSES.has(cause) ? (cause as DropReason) : "unknown",
          climbName: cause === "cobbles_sector" ? null : (komKms.get(event.km ?? 0) ?? null),
          sectorName: cause === "cobbles_sector" ? str(p.sector_name) : null,
          order: !planTask && (effort === "save" || effort === "grupetto") ? effort : null,
          planTask,
        };
        if (!drops.has(riderId)) drops.set(riderId, []);
        (drops.get(riderId) as Array<{ entry: typeof entry; source: string }>).push({ entry, source });
      }
    } else if (event.type === "group_merged") {
      const into = str(p.into_group_id);
      if (!into) return;
      for (const riderId of idsOf(p.rider_ids)) {
        const list = drops.get(riderId);
        if (!list) continue;
        // Tilbage i gruppen han faldt fra (eller den den siden er gaaet op i).
        const at = list.findIndex((d) => resolveAlias(state, d.source) === into);
        if (at >= 0) list.splice(at);
      }
    } else if ((event.type === "incident" || event.type === "favorite_crack") && own.has(str(p.rider_id) ?? "")) {
      if (event.type === "incident" && p.outcome === "protected_three_km_rule") return;
      other.push({ type: "event", km: event.km ?? 0, riderId: str(p.rider_id) as string, event });
    }
  });

  // Ryttere der faldt af samme sted af samme grund bliver én linje.
  const merged = new Map<string, Extract<TimeLossEntry, { type: "drop" }>>();
  for (const list of drops.values()) {
    if (!list.length) continue;
    const e = list[0].entry;
    const key = [e.km, e.from, e.reason, e.climbName, e.sectorName, e.order, e.planTask].join("|");
    const hit = merged.get(key);
    if (hit) hit.riderIds.push(e.riderId);
    else merged.set(key, { ...e, riderIds: [e.riderId] });
  }
  return [...merged.values(), ...other].sort((a, b) => a.km - b.km || a.riderId.localeCompare(b.riderId));
}

/** Holdets egne ryttere paa etapen (etaperesultatets raekker). */
export function ownRiderIdsForStage(
  results: ReadonlyArray<Record<string, any>> | null | undefined,
  stageNumber: number,
  teamId: unknown,
): string[] {
  if (teamId == null) return [];
  const ids = (results || [])
    .filter((r) => r?.result_type === "stage" && (r.stage_number ?? 1) === stageNumber
      && String(r.team_id ?? r.rider?.team?.id) === String(teamId))
    .map((r) => str(r.rider_id ?? r.rider?.id))
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/** Spillerens egne indsats-ordrer for én etape fra /stage-roles (overrides). */
export function effortByRiderForStage(stageRoles: unknown, stageNumber: number): Map<string, string> {
  const out = new Map<string, string>();
  const overrides = (stageRoles as { overrides?: unknown } | null)?.overrides;
  if (!Array.isArray(overrides)) return out;
  for (const o of overrides as Array<Record<string, unknown>>) {
    if (Number(o?.stage_number) !== stageNumber) continue;
    const rider = str(o?.rider_id);
    const effort = str(o?.effort);
    if (rider && effort) out.set(rider, effort);
  }
  return out;
}

const EFFORTS = new Set(["grupetto", "save", "normal", "protect", "all_out"]);

/**
 * Den indsats motoren faktisk koerte paa, samme forrang som raceRunner
 * (#5580): paa en v4-etape vinder holdets ordre (race_team_orders.riders[].
 * effort); stage-roles-overriden er kun fallback. v3-etaper: kun overriden.
 * #6647: "normal" i en ordre er rollens standard, ikke et valg (backend
 * orderEffortByRiderForStage), saa den overskriver ikke overridens beskyt/spar.
 * Men kun for etaper koert EFTER rettelsen: foer den vandt ordrens "normal"
 * faktisk i motoren, og siden skal vise den indsats rytteren reelt koerte paa.
 * `ranAt` er etapens tidslinje-tidspunkt (race_stage_timelines.created_at).
 */
export const EFFORT_NORMAL_NOT_A_CHOICE_FROM = "2026-10-15T12:58:00.000Z"; // foerste etape-tick efter deploy af #6652 (merget ca. 12:15 UTC)

/** Ren: koerte motoren etapen med #6647-forrangen? Ukendt tidspunkt = ja. */
export function stageUsesEffortFix6647(ranAt: unknown): boolean {
  const t = typeof ranAt === "string" ? Date.parse(ranAt) : NaN;
  return Number.isNaN(t) || t >= Date.parse(EFFORT_NORMAL_NOT_A_CHOICE_FROM);
}

/**
 * #7333: indsatserne, plus de ryttere der koerte efter en etapeplan. En plan er en
 * kaede af opgaver, ikke én indsats: raekkens `effort` er kun foerste leds (afledt for
 * aeldre motorer, legacyOrderFromPlan), saa en plan-rytter staar IKKE i selve mappen
 * (aldrig "Din ordre: Kør roligt" for en plan der skiftede opgave). `plans` har hans
 * opgaver i kaedens orden. Er stadig et Map, saa alle der kun laeser indsatsen virker.
 */
export class StageOrderEfforts extends Map<string, string> {
  readonly plans = new Map<string, string[]>();
}

/**
 * #7333: den opgave en plan-rytter havde ved `km`: det seneste stage_plan_leg-skift ved
 * eller foer km (motoren skriver ét pr. skift), ellers planens foerste opgave. null for
 * en rytter uden plan. Et skift med `at_finish` (advanceStagePlanAtFinish) gaelder kun
 * finalen, der ikke giver fald (peloton_splits): et fald paa sidste segment skete paa
 * det forrige led, selv om skiftets km ligger foer faldets.
 */
export function stagePlanTaskAt(
  efforts: unknown,
  events: readonly TimelineEvent[] | null | undefined,
  riderId: string,
  km: number,
): string | null {
  const tasks = efforts instanceof StageOrderEfforts ? efforts.plans.get(riderId) : undefined;
  if (!tasks?.length) return null;
  let task = tasks[0];
  let atKm = -Infinity;
  for (const e of events ?? []) {
    if (e?.type !== "stage_plan_leg" || e.params?.rider_id !== riderId || e.params?.at_finish === true) continue;
    const at = Number(e.km ?? 0);
    if (at > km || at < atKm) continue;
    const leg = Number(e.params?.leg);
    const next = str(e.params?.task) ?? (Number.isInteger(leg) ? tasks[leg] : null);
    if (next) { task = next; atKm = at; }
  }
  return task;
}

export function effectiveEffortByRider(
  stageRoles: unknown,
  teamOrders: unknown,
  stageNumber: number,
  { v4 = false, ranAt = null }: { v4?: boolean; ranAt?: string | null } = {},
): StageOrderEfforts {
  const out = new StageOrderEfforts(effortByRiderForStage(stageRoles, stageNumber));
  if (!v4) return out;
  const orders = (teamOrders as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(orders)) return out;
  const normalIsNotAChoice = stageUsesEffortFix6647(ranAt);
  for (const row of orders as Array<Record<string, unknown>>) {
    if (Number(row?.stage_number) !== stageNumber || !Array.isArray(row?.riders)) continue;
    for (const r of row.riders as Array<Record<string, unknown>>) {
      const rider = str(r?.rider_id);
      const plan = Array.isArray(r?.plan) ? (r.plan as Array<Record<string, unknown> | null>).map((l) => str(l?.task)) : [];
      if (rider && plan.length && plan.every(Boolean)) { // #7333: planen, ikke foerste leds indsats
        out.plans.set(rider, plan as string[]);
        out.delete(rider);
        continue;
      }
      const effort = str(r?.effort);
      if (effort === "normal" && normalIsNotAChoice) continue; // #6647: ikke et valg
      if (rider && effort && EFFORTS.has(effort)) out.set(rider, effort);
    }
  }
  return out;
}

/** "+1:05" / "+1:02:03". 0 → null (fronten har intet gab). */
export function formatSplitGap(seconds: number): string | null {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `+${h}:${String(m).padStart(2, "0")}:${sec}` : `+${m}:${sec}`;
}
