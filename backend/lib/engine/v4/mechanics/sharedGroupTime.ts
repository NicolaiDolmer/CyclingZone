import type { Entrant, RaceGroup } from '../types.ts';
import { regroupOnDescentV3 } from './descent.ts';

type DescentTravelInput = {
  groups: readonly RaceGroup[];
  durations: ReadonlyMap<string, number>;
  minimumDurations: ReadonlyMap<string, number>;
  entrants: Readonly<Record<string, Entrant>>;
  lengthKm: number;
  technicality: 1 | 2 | 3;
  isFinish: boolean;
  incidentChasers?: Readonly<Record<string, unknown>>;
};

/** One effective traversal from the real summit; never a second descent debit. */
export function planSharedDescentTravel(input: DescentTravelInput): Map<string, number> {
  const out = new Map(input.durations);
  const incident = (group: RaceGroup) => group.rider_ids.length > 0
    && group.rider_ids.every(id => input.incidentChasers?.[id] !== undefined);
  const eligible = input.groups.filter(group => !incident(group))
    .sort((a,b) => a.gap_seconds-b.gap_seconds || a.id.localeCompare(b.id));
  if (eligible.length < 2) return out;
  const desired = new Map(regroupOnDescentV3(eligible, input.entrants,
    input.lengthKm, input.technicality, input.isFinish).map(group => [group.id,group]));
  const frontDuration = input.durations.get(eligible[0].id);
  if (frontDuration === undefined) throw new Error('shared descent: missing front duration');
  let reference: RaceGroup | undefined;
  for (const group of eligible) {
    const own = input.durations.get(group.id);
    if (own === undefined || !Number.isFinite(own) || own < 0) throw new Error('shared descent: invalid duration');
    if (group.origin === 'breakaway') continue;
    const target = desired.get(group.id)!;
    let duration = own;
    if (input.isFinish) {
      // Opening drift may remain; every closing estimate shares the summit cap.
      duration = Math.max(own,frontDuration) + target.gap_seconds-group.gap_seconds;
    } else if (reference) {
      const referenceTarget = desired.get(reference.id)!;
      const changeToReference = target.gap_seconds-referenceTarget.gap_seconds
        -(group.gap_seconds-reference.gap_seconds);
      duration = out.get(reference.id)! + changeToReference;
    }
    const minimum = input.minimumDurations.get(group.id) ?? 0;
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error('shared descent: invalid physical minimum');
    out.set(group.id,Math.max(minimum,duration));
    reference = group;
  }
  return out;
}
