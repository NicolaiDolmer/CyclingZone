// #6199 (PR #6330 follow-up, KUN official_times_v2): the exact place of every
// timeline event, so a new stage reads like a race followed live instead of
// "somewhere before the next checkpoint".
//
// The engine moves in segments; most hooks report at the segment's checkpoint
// (`event.km` = segment.to_km, the engine's ordering key, unchanged). Under the
// shared group clock every rider has an absolute arrival time at the segment
// entry and at its exit, and each line moves at a constant pace across the
// interval (the same movement basis as #6329's contact point, groupClock.ts).
// From that:
//   - a separation (split/selection, a rider dropped from the break, an
//     attack, the decisive move) happened where the gap between the two lines
//     first reached a visible gap (the engine's own "same group" window,
//     tuning.groups.mergeThresholdSeconds);
//   - a contact (catch, merge) happened where the gap reached zero; the
//     pursuit model reports its own catch point (breakaway.ts) and #6329's
//     descent crossings already carry theirs in `event.km`;
//   - point events (start, formation, passages, incidents, gap reports, team
//     decisions, the finish) already sit on their exact km.
// `params.exact_km` is that place (2 decimals, inside the segment, never past
// the checkpoint). `params.exact_time` is the arrival time in seconds since the
// stage start of the riders the event is about at that place, where the event
// names riders or a group (not for incidents: the rider's own time includes the
// incident's stop). When the endpoints cannot describe the moment (the lines
// were already apart at entry, or never visibly apart at exit), the checkpoint
// is the honest answer and `exact_km` = `event.km`.
//
// REN: ingen IO, input muteres aldrig. Old revisions never call this module.
import type { TimelineEvent } from "./types.ts";
import { round2 } from "./timeline.ts";

export type ExactPlaceContext = Readonly<{
  fromKm: number;
  toKm: number;
  /** Absolute arrival (s since start) at fromKm per rider racing at segment entry. */
  entryTime: ReadonlyMap<string, number>;
  /** Absolute arrival at toKm per rider still in a group at segment exit. */
  exitTime: ReadonlyMap<string, number>;
  /** Riders per group id at segment entry. */
  entryGroups: ReadonlyMap<string, readonly string[]>;
  /** Riders per group id at segment exit. */
  exitGroups: ReadonlyMap<string, readonly string[]>;
  /** Smallest gap that is visible on the road (the engine's same-group window). */
  visibleGapSeconds: number;
}>;

const KM_EPSILON = 1e-6;

/** Separation events: the place a visible gap opened between two lines. */
const SEPARATION_TYPES: ReadonlySet<string> = new Set(["peloton_splits", "breakaway_dropped", "favorite_crack", "finale_attack"]);
/** Contact events: the place two lines met. */
const CONTACT_TYPES: ReadonlySet<string> = new Set(["breakaway_caught", "group_merged"]);

/**
 * Fraction (0, 1] of the interval where a linearly changing gap (`entryGap` at
 * the entry, `exitGap` at the exit) first reaches `visible` in size, or null
 * when it was already that large at the entry or never gets there.
 */
export function separationFraction(entryGap: number, exitGap: number, visible: number): number | null {
  if (![entryGap, exitGap, visible].every(Number.isFinite) || !(visible > 0)) return null;
  if (!(Math.abs(entryGap) < visible) || !(Math.abs(exitGap) >= visible)) return null;
  const target = Math.sign(exitGap) * visible;
  const fraction = (target - entryGap) / (exitGap - entryGap);
  return Number.isFinite(fraction) ? Math.min(1, Math.max(Number.EPSILON, fraction)) : null;
}

/**
 * Fraction (0, 1] where a linearly changing gap reaches zero (two lines meet),
 * or null when it does not cross zero inside the interval.
 */
export function contactFraction(entryGap: number, exitGap: number, epsilon = 1e-7): number | null {
  if (!Number.isFinite(entryGap) || !Number.isFinite(exitGap) || !(Math.abs(entryGap) > epsilon)) return null;
  if (Math.abs(exitGap) > epsilon && Math.sign(exitGap) === Math.sign(entryGap)) return null;
  const fraction = entryGap / (entryGap - (Math.abs(exitGap) > epsilon ? exitGap : 0));
  return Number.isFinite(fraction) ? Math.min(1, Math.max(Number.EPSILON, fraction)) : null;
}

/**
 * #6199: where the pursuit model's chase met the break. The chase runs over the
 * last `chaseKm` of the segment (the let-go phase comes first): first its own
 * closing over `chaseKm - floorKm`, then the field's floor over the final
 * `floorKm`, both scaled to the closing actually applied (`closingSeconds`, a
 * cap may bind). Contact is where the closing reaches the separation at the
 * chase start. Null when the chase does not close it inside the segment.
 */
export function pursuitContactKm(input: {
  toKm: number;
  chaseKm: number;
  floorKm: number;
  netClosingSeconds: number;
  floorClosingSeconds: number;
  closingSeconds: number;
  separationSeconds: number;
}): number | null {
  const { toKm, chaseKm, netClosingSeconds, floorClosingSeconds, closingSeconds, separationSeconds } = input;
  const floorKm = Math.min(Math.max(0, input.floorKm), Math.max(0, chaseKm));
  const values = [toKm, chaseKm, floorKm, netClosingSeconds, floorClosingSeconds, closingSeconds, separationSeconds];
  if (!values.every(Number.isFinite) || !(chaseKm > 0)) return null;
  const chaseStartKm = toKm - chaseKm;
  if (separationSeconds <= 0) return round2(chaseStartKm);
  const planned = Math.max(0, netClosingSeconds) + Math.max(0, floorClosingSeconds);
  if (!(planned > 0) || !(closingSeconds >= separationSeconds)) return null;
  const scale = Math.min(1, closingSeconds / planned);
  const netKm = chaseKm - floorKm;
  const net = Math.max(0, netClosingSeconds) * scale;
  if (net >= separationSeconds && netKm > 0) return round2(chaseStartKm + netKm * (separationSeconds / net));
  const floor = Math.max(0, floorClosingSeconds) * scale;
  if (!(floor > 0) || !(floorKm > 0)) return null;
  return round2(Math.min(toKm, chaseStartKm + netKm + floorKm * ((separationSeconds - net) / floor)));
}

type Line = { entry: number; exit: number };

/** The front-most rider of a set at entry and at exit (a group shares one time). */
function lineOf(riderIds: readonly string[], ctx: ExactPlaceContext): Line | null {
  let entry = Infinity;
  let exit = Infinity;
  for (const id of riderIds) {
    const a = ctx.entryTime.get(id);
    const b = ctx.exitTime.get(id);
    if (a === undefined || b === undefined) continue;
    entry = Math.min(entry, a);
    exit = Math.min(exit, b);
  }
  return Number.isFinite(entry) && Number.isFinite(exit) ? { entry, exit } : null;
}

const timeAt = (line: Line, fraction: number) => line.entry + fraction * (line.exit - line.entry);

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** The riders an event is about: rider_ids, a single rider, or its group at exit. */
function subjectRiders(event: TimelineEvent, ctx: ExactPlaceContext): string[] {
  const p = event.params ?? {};
  const ids = stringIds(p.rider_ids);
  if (ids.length > 0) return ids;
  for (const key of ["rider_id", "winner_rider_id"]) if (typeof p[key] === "string") return [p[key] as string];
  return typeof p.group_id === "string" ? [...(ctx.exitGroups.get(p.group_id) ?? [])] : [];
}

/** The line an event's riders separated from or met. */
function referenceRiders(event: TimelineEvent, subject: readonly string[], ctx: ExactPlaceContext): string[] {
  const p = event.params ?? {};
  const own = new Set(subject);
  const named = event.type === "peloton_splits" ? p.source_group_id
    : event.type === "breakaway_dropped" ? p.from_group_id
      : event.type === "group_merged" ? p.into_group_id
        : event.type === "breakaway_caught" ? p.chase_group_id : undefined;
  if (typeof named === "string") {
    const members = (ctx.exitGroups.get(named) ?? []).filter((id) => !own.has(id));
    if (members.length > 0) return members;
  }
  // The group the subject's front-most rider rode in at the entry.
  let lead: string | null = null;
  for (const id of subject) {
    const t = ctx.entryTime.get(id);
    if (t !== undefined && (lead === null || t < (ctx.entryTime.get(lead) as number))) lead = id;
  }
  if (lead === null) return [];
  for (const members of ctx.entryGroups.values()) {
    if (members.includes(lead)) return members.filter((id) => !own.has(id));
  }
  return [];
}

function fractionOfKm(km: number, ctx: ExactPlaceContext): number {
  const span = ctx.toKm - ctx.fromKm;
  return span > 0 ? Math.min(1, Math.max(0, (km - ctx.fromKm) / span)) : 1;
}

/**
 * Annotates one segment's events with `exact_km` and, where it exists,
 * `exact_time`. `contactKmByGroup` carries a catch point already known for a
 * caught group (so its `group_merged` agrees with its `breakaway_caught`).
 */
export function annotateExactPlaces(events: readonly TimelineEvent[], ctx: ExactPlaceContext): TimelineEvent[] {
  const caughtAt = new Map<string, number>();
  for (const event of events) {
    const exact = event.params?.exact_km;
    if (event.type === "breakaway_caught" && typeof event.params?.group_id === "string" && typeof exact === "number") caughtAt.set(event.params.group_id, exact);
  }
  return events.map((event) => {
    const params = event.params ?? {};
    let exactKm: number = typeof params.exact_km === "number" && Number.isFinite(params.exact_km) ? params.exact_km : event.km;
    const subject = event.type === "stage_start" || event.type === "weather" ? [] : subjectRiders(event, ctx);
    const atCheckpoint = Math.abs(event.km - ctx.toKm) < KM_EPSILON && ctx.toKm > ctx.fromKm;
    if (typeof params.exact_km !== "number" && atCheckpoint) {
      if (event.type === "group_merged" && typeof params.group_id === "string" && caughtAt.has(params.group_id)) {
        exactKm = caughtAt.get(params.group_id) as number;
      } else if (SEPARATION_TYPES.has(event.type) || CONTACT_TYPES.has(event.type)) {
        const a = lineOf(subject, ctx);
        const b = lineOf(referenceRiders(event, subject, ctx), ctx);
        if (a && b) {
          const entryGap = a.entry - b.entry;
          const exitGap = a.exit - b.exit;
          const fraction = SEPARATION_TYPES.has(event.type)
            ? separationFraction(entryGap, exitGap, ctx.visibleGapSeconds)
            : contactFraction(entryGap, exitGap);
          if (fraction !== null) exactKm = round2(ctx.fromKm + fraction * (ctx.toKm - ctx.fromKm));
        }
      }
    }
    exactKm = round2(Math.min(event.km, Math.max(Math.min(ctx.fromKm, event.km), exactKm)));
    const next: Record<string, unknown> = { ...params, exact_km: exactKm };
    if (typeof params.exact_time !== "number" && event.type !== "incident") {
      const fraction = fractionOfKm(exactKm, ctx);
      if (event.type === "stage_start") next.exact_time = 0;
      else {
        const line = subject.length > 0 ? lineOf(subject, ctx)
          : event.type === "weather" ? lineOf([...ctx.entryTime.keys()], ctx) : null;
        if (line) next.exact_time = round2(timeAt(line, fraction));
      }
    }
    return { ...event, params: next };
  });
}

/** exact_km on an event that has none (events placed after the segment loop sit on their km). */
export function withPointPlace(event: TimelineEvent, exactTime?: number): TimelineEvent {
  if (typeof event.params?.exact_km === "number") return event;
  return { ...event, params: { ...event.params, exact_km: round2(event.km), ...(exactTime !== undefined && Number.isFinite(exactTime) ? { exact_time: round2(exactTime) } : {}) } };
}
