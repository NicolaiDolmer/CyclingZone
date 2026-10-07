import type { RaceGroup } from './types.ts';

export type GroupClockEntry = Readonly<{
  group: RaceGroup;
  entrySeconds: number;
  traversalSeconds: number;
  pointDelaySeconds: number;
}>;

/** One physical distance interval. Estimates of traversal replace, delays add. */
export type GroupClock = Readonly<{
  fromKm: number;
  toKm: number;
  initialFrontSeconds: number;
  entries: readonly GroupClockEntry[];
}>;

export type GroupClockProjection = {
  frontTimeSeconds: number;
  groups: RaceGroup[];
  arrivals: Record<string, number>;
};

function nonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`group clock: invalid ${label}`);
}

/** Capture absolute entry arrivals before any movement on this interval. */
export function beginGroupClock(input: {
  groups: readonly RaceGroup[];
  frontTimeSeconds: number;
  fromKm: number;
  toKm: number;
}): GroupClock {
  nonnegative(input.frontTimeSeconds, 'front time');
  nonnegative(input.fromKm, 'start distance');
  nonnegative(input.toKm - input.fromKm, 'interval');
  const groupIds = new Set<string>();
  const riderIds = new Set<string>();
  const entries = input.groups.map(group => {
    if (groupIds.has(group.id)) throw new Error('group clock: duplicate group');
    groupIds.add(group.id);
    nonnegative(group.gap_seconds, 'entry gap');
    for (const id of group.rider_ids) {
      if (riderIds.has(id)) throw new Error('group clock: duplicate rider');
      riderIds.add(id);
    }
    return {
      group: {...group, rider_ids: [...group.rider_ids]},
      entrySeconds: input.frontTimeSeconds + group.gap_seconds,
      traversalSeconds: 0,
      pointDelaySeconds: 0,
    };
  });
  return {fromKm: input.fromKm, toKm: input.toKm, initialFrontSeconds: input.frontTimeSeconds, entries};
}

function updateEntry(clock: GroupClock, groupId: string, update: (entry: GroupClockEntry) => GroupClockEntry): GroupClock {
  if (!clock.entries.some(entry => entry.group.id === groupId)) throw new Error(`group clock: unknown group ${groupId}`);
  return {...clock, entries: clock.entries.map(entry => entry.group.id === groupId ? update(entry) : entry)};
}

/** Replace an overlapping estimate of the same physical traversal. */
export function replaceTraversal(clock: GroupClock, groupId: string, durationSeconds: number): GroupClock {
  nonnegative(durationSeconds, 'duration');
  return updateEntry(clock, groupId, entry => ({...entry, traversalSeconds: durationSeconds}));
}

/** A genuine stopped-time incident is separate from distance travelled. */
export function addPointDelay(clock: GroupClock, groupId: string, delaySeconds: number): GroupClock {
  nonnegative(delaySeconds, 'delay');
  return updateEntry(clock, groupId, entry => ({...entry, pointDelaySeconds: entry.pointDelaySeconds + delaySeconds}));
}

/** Relative gaps are a projection; changing the front never discards time. */
export function projectGroupClock(clock: GroupClock): GroupClockProjection {
  const arrivals = clock.entries.map(entry => ({entry,
    seconds: entry.entrySeconds + entry.traversalSeconds + entry.pointDelaySeconds,
  })).sort((a,b) => a.seconds - b.seconds || a.entry.group.id.localeCompare(b.entry.group.id));
  const frontTimeSeconds = arrivals[0]?.seconds ?? clock.initialFrontSeconds;
  return {
    frontTimeSeconds,
    groups: arrivals.map(({entry,seconds}) => ({...entry.group,
      rider_ids: [...entry.group.rider_ids], gap_seconds: seconds - frontTimeSeconds,
    })),
    arrivals: Object.fromEntries(arrivals.map(({entry,seconds}) => [entry.group.id, seconds])),
  };
}

/** Commit a mechanism's relative proposal through the same absolute reference. */
export function projectRelativeArrivals(groups: readonly RaceGroup[], referenceSeconds: number): GroupClockProjection {
  const arrivals = groups.map(group => ({group, seconds: referenceSeconds + group.gap_seconds}))
    .sort((a,b) => a.seconds-b.seconds || a.group.id.localeCompare(b.group.id));
  for (const arrival of arrivals) nonnegative(arrival.seconds, 'absolute arrival');
  const frontTimeSeconds = arrivals[0]?.seconds ?? referenceSeconds;
  return {frontTimeSeconds,
    groups: arrivals.map(({group,seconds}) => ({...group,rider_ids:[...group.rider_ids],gap_seconds:seconds-frontTimeSeconds})),
    arrivals: Object.fromEntries(arrivals.map(({group,seconds})=>[group.id,seconds])),
  };
}
