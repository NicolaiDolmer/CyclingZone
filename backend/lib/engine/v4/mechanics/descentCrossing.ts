import type { EngineState, RaceGroup, SegmentHookResult, TimelineEvent } from '../types.ts';
import { mergedPhysicalGroup, mergedSharedCohorts } from '../groups.ts';
import { contactFractionInInterval } from '../groupClock.ts';

/**
 * #6329 (official_times_v2): the movement interval the contact happened in.
 * `entryGroups` are the groups at the interval start (segment entry), with gaps
 * relative to the same front at that checkpoint.
 */
export type ContactInterval = Readonly<{ fromKm: number; entryGroups: readonly RaceGroup[] }>;

/**
 * #6329: the contact point inside the interval from the same movement basis as
 * the group clock. The target must exist as a line at the interval start (an
 * attack born inside the interval has no defined entry, so the checkpoint
 * stays); the chaser line is its front-most rider at entry. Anything the
 * endpoints cannot describe falls back to the checkpoint (contact A, #6327).
 */
function contactKm(interval: ContactInterval | undefined, toKm: number, catcherBefore: RaceGroup, target: RaceGroup, catcherIds: readonly string[], targetIds: readonly string[]): number {
  const checkpoint = Math.round(toKm * 100) / 100;
  if (!interval || !(toKm > interval.fromKm)) return checkpoint;
  const targetEntry = interval.entryGroups.find(group => group.id === target.id);
  if (!targetEntry) return checkpoint;
  const entryByRider = new Map(interval.entryGroups.flatMap(group => group.rider_ids.map(id => [id, group.gap_seconds] as const)));
  const targetSet = new Set(targetIds);
  let catcherEntry = Infinity;
  for (const id of catcherIds) if (!targetSet.has(id)) catcherEntry = Math.min(catcherEntry, entryByRider.get(id) ?? Infinity);
  const fraction = contactFractionInInterval(catcherEntry - targetEntry.gap_seconds, catcherBefore.gap_seconds - target.gap_seconds);
  if (fraction === null) return checkpoint;
  return Math.round((interval.fromKm + fraction * (toKm - interval.fromKm)) * 100) / 100;
}

/**
 * Reconcile an observed order reversal, not proximity at the end alone.
 * Called only by the future revision's loop. No pace/work is charged here.
 * Contact is reported at the existing checkpoint; the endpoints do not prove
 * a particular instant within a segment containing several distinct hooks.
 */
export function reconcileDescentCrossings(before: readonly RaceGroup[], state: EngineState, km: number, reported: readonly TimelineEvent[] = [], allPhysicalContacts = false, interval?: ContactInterval): SegmentHookResult {
  const previous = new Map(before.map(group => [group.id, group]));
  const knownCatches = new Map<string,string>();
  for (const event of reported) if (event.type === 'breakaway_caught'
    && typeof event.params.group_id === 'string' && typeof event.params.chase_group_id === 'string') {
    knownCatches.set(event.params.group_id, event.params.chase_group_id);
  }
  const targets = before.filter(group => allPhysicalContacts || group.origin === 'descent')
    .sort((a,b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  let groups = state.groups;
  let riders = state.riders;
  let cohorts = state.shared_grupetto_groups;
  const events: TimelineEvent[] = [];
  for (const oldTarget of targets) {
    const target = groups.find(group => group.id === oldTarget.id && (allPhysicalContacts || group.origin === 'descent'));
    if (!target || !Number.isFinite(target.gap_seconds) || !Number.isFinite(oldTarget.gap_seconds)) continue;
    const knownCatcher = knownCatches.get(target.id);
    const candidates = groups.filter(group => {
      const old = previous.get(group.id);
      if (group.id === target.id || group.kind === 'breakaway' || group.origin || !Number.isFinite(group.gap_seconds)) return false;
      if (knownCatcher) return group.id === knownCatcher;
      return old && old.kind !== 'breakaway' && !old.origin && Number.isFinite(old.gap_seconds)
        && old.gap_seconds > oldTarget.gap_seconds && group.gap_seconds <= target.gap_seconds;
    }).sort((a,b) => previous.get(a.id)!.gap_seconds - previous.get(b.id)!.gap_seconds
      || b.gap_seconds - a.gap_seconds || a.id.localeCompare(b.id));
    const catcher = knownCatcher ? candidates.find(group => group.id === knownCatcher) : candidates[0];
    if (!catcher) continue;
    const mergedIds = [...new Set([...catcher.rider_ids, ...target.rider_ids])];
    const contactGap = Math.min(catcher.gap_seconds, target.gap_seconds);
    // #6199: every physical contact uses the canonical merge (kind/origin) and
    // carries cohort lineage to the id the joined line keeps. The descent-only
    // default keeps its original catcher-kind rule.
    const combined: RaceGroup = allPhysicalContacts ? mergedPhysicalGroup(catcher, target, contactGap)
      : {...catcher, kind: catcher.kind === 'solo' ? 'chase' : catcher.kind,
        gap_seconds: contactGap, rider_ids: mergedIds, cohesion: Math.min(catcher.cohesion, target.cohesion)};
    if (allPhysicalContacts) cohorts = mergedSharedCohorts(cohorts, [catcher, target],
      [{absorbed_group_id: target.id, into_group_id: catcher.id, rider_ids: [...target.rider_ids]}]);
    groups = groups.filter(group => group.id !== target.id).map(group => group.id === catcher.id ? combined : group);
    if (riders === state.riders) riders = {...riders};
    for (const id of mergedIds) if (riders[id]) riders[id] = {...riders[id], group_id: catcher.id};
    const checkpoint = contactKm(interval, km, catcher, target, state.groups.find(group => group.id === catcher.id)?.rider_ids ?? catcher.rider_ids, target.rider_ids);
    if (!knownCatcher && target.origin) events.push({km:checkpoint,type:'breakaway_caught',params:{group_id:target.id,rider_ids:[...target.rider_ids],
      chase_group_id:catcher.id,chase_group_kind:catcher.kind}});
    events.push({km:checkpoint,type:'group_merged',params:{group_id:target.id,into_group_id:catcher.id,rider_ids:[...target.rider_ids]}});
  }
  if (events.length === 0) return {state,events};
  return {state:{...state,groups:[...groups].sort((a,b)=>a.gap_seconds-b.gap_seconds||a.id.localeCompare(b.id)),riders,
    ...(cohorts !== state.shared_grupetto_groups ? {shared_grupetto_groups: cohorts} : {})},events};
}
