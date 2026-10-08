// #6199 review findings 2-4 (official_times_v1 only): explicit movement and
// point-delay accounting, cohort lineage through contact, and physical
// contact before the finale's classification pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finaleHook } from './finale.ts';
import { initRiderStates } from './groups.ts';
import { makeHookCtx } from './testUtils/makeHookCtx.ts';
import { RACE_V4_TUNING } from './tuning.ts';
import type { AbilityKey, Entrant, EngineState, RaceGroup, RouteV2, StageIncident } from './types.ts';

const keys: AbilityKey[] = ['climbing','time_trial','flat','tempo','sprint','acceleration','punch','endurance','recovery','durability','descending','cobblestone','positioning','aggression','tactics'];

export function sharedFixture(levels: number[], seed = '6199-accounting') {
  const entrants: Entrant[] = levels.map((value, i) => ({rider_id: 'r'+i,
    abilities: Object.fromEntries(keys.map(k => [k, value])) as Entrant['abilities'],
    role: 'free_role', effort: 'normal', condition: 1}));
  const riders = initRiderStates(entrants, RACE_V4_TUNING, seed);
  for (const r of Object.values(riders)) { r.wprime = 1; r.wprimeMax = 1; }
  const route: RouteV2 = {distance_km: 10, profile_type: 'mountain', finale_type: 'long_climb',
    segments: [{kind: 'climb', from_km: 0, to_km: 10, category: '1', avg_gradient: 8, top_elevation_m: 1000}],
    weather: {kind: 'sun', wind_exposure: 0}, waypoints: []};
  const tuning = structuredClone(RACE_V4_TUNING); tuning.selection.noiseSdBase = 0;
  const ctx = makeHookCtx({segment: route.segments[0], route,
    entrants: Object.fromEntries(entrants.map(e => [e.rider_id, e])), tuning, seed});
  return {riders, ctx, route};
}

function withGroups(riders: EngineState['riders'], groups: RaceGroup[], extra: Partial<EngineState> = {}): EngineState {
  const next = structuredClone(riders);
  for (const g of groups) for (const id of g.rider_ids) next[id].group_id = g.id;
  return {km: 0, groups: structuredClone(groups), riders: next, virtual_gc: {}, ...extra};
}

const loss = (rider_id: string, seconds: number): StageIncident => ({rider_id, km: 5, kind: 'mechanical', severity: null,
  outcome: 'time_loss', time_loss_seconds: seconds, injury_days: null, helper_assist: false});

const gapOf = (state: EngineState, id: string) => state.groups.find(g => g.id === id)?.gap_seconds;

test('a point loss after segment entry is not erased by closing credit already used', () => {
  const {riders, ctx} = sharedFixture([50, 90, 90]);
  const entry: RaceGroup[] = [{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},
    {id:'near',kind:'chase',rider_ids:['r1','r2'],gap_seconds:10000,cohesion:1}];
  const shared = {...ctx, sharedGroupTime: {entryGroups: entry, incidentCursor: 0}};
  const once = finaleHook(withGroups(riders, entry), shared);
  const onceGap = gapOf(once.state, 'near')!;
  assert.ok(onceGap < 10000, 'fixture exercises real closing');
  for (const delay of [0, 20, 100]) {
    const moved = withGroups(riders, [entry[0], {...entry[1], gap_seconds: onceGap + delay}],
      {stage_incidents: delay > 0 ? [loss('r1', delay), loss('r2', delay)] : []});
    const out = finaleHook(moved, shared);
    assert.equal(gapOf(out.state, 'near'), onceGap + delay, `point loss ${delay}s is kept`);
  }
});

test('incidents booked before segment entry are already inside the entry gaps', () => {
  const {riders, ctx} = sharedFixture([50, 90, 90]);
  const entry: RaceGroup[] = [{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},
    {id:'near',kind:'chase',rider_ids:['r1','r2'],gap_seconds:10000,cohesion:1}];
  const plain = finaleHook(withGroups(riders, entry), {...ctx, sharedGroupTime: {entryGroups: entry, incidentCursor: 0}});
  const earlier = finaleHook(withGroups(riders, entry, {stage_incidents: [loss('r1', 100), loss('r2', 100)]}),
    {...ctx, sharedGroupTime: {entryGroups: entry, incidentCursor: 2}});
  assert.equal(gapOf(earlier.state, 'near'), gapOf(plain.state, 'near'));
});
