// #6199 review findings 2-4 (official_times_v1 only): explicit movement and
// point-delay accounting, cohort lineage through contact, and physical
// contact before the finale's classification pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finaleHook } from './finale.ts';
import { initRiderStates, mergeGroupsDetailed, mergedSharedCohorts } from './groups.ts';
import { climbSelectionHook } from './mechanics/climbSelection.ts';
import { reconcileDescentCrossings } from './mechanics/descentCrossing.ts';
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

function cohortContact(markCatcher: boolean) {
  const {riders, ctx} = sharedFixture([90, 50, 20], '6199-cohort-contact');
  for (const r of Object.values(riders)) r.segment_pace = {cp: 0.5, demand: 0.2};
  const before: RaceGroup[] = [{id:'cohort',kind:'chase',rider_ids:['r1','r2'],gap_seconds:0,cohesion:1},
    {id:'catcher',kind:'solo',rider_ids:['r0'],gap_seconds:20,cohesion:1}];
  const state = withGroups(riders, [{...before[1], gap_seconds: 0}, {...before[0], gap_seconds: 10}],
    {shared_grupetto_groups: markCatcher ? {cohort: true, catcher: true} : {cohort: true}});
  const joined = reconcileDescentCrossings(before, state, 10, [], true).state;
  return {joined, ctx};
}

test('cohort lineage survives contact when the catcher keeps its own group id', () => {
  const control = cohortContact(true);
  assert.equal(control.joined.groups.length, 1);
  const controlNext = climbSelectionHook(control.joined, {...control.ctx, sharedGroupTime: {entryGroups: control.joined.groups}});
  assert.equal(controlNext.state.groups.length, 1, 'control: a marked adopted line stays together');
  const {joined, ctx} = cohortContact(false);
  assert.equal(joined.groups.length, 1);
  assert.equal(joined.shared_grupetto_groups?.[joined.groups[0].id], true, 'merged physical line inherits the cohort mark');
  const next = climbSelectionHook(joined, {...ctx, sharedGroupTime: {entryGroups: joined.groups}});
  assert.equal(next.state.groups.length, 1, 'riders who sustain the actual pace are not re-split after a catch');
});

test('contact keeps the canonical merged kind: a caught peloton stays the peloton', () => {
  const {riders} = sharedFixture([90, 50, 20], '6199-peloton-contact');
  const before: RaceGroup[] = [{id:'peloton-0',kind:'peloton',rider_ids:['r1','r2'],gap_seconds:0,cohesion:1},
    {id:'chase-1',kind:'chase',rider_ids:['r0'],gap_seconds:20,cohesion:1}];
  const state = withGroups(riders, [{...before[1], gap_seconds: 0}, {...before[0], gap_seconds: 10}]);
  const joined = reconcileDescentCrossings(before, state, 10, [], true).state;
  assert.equal(joined.groups.length, 1);
  assert.equal(joined.groups[0].kind, 'peloton');
});

test('generic merge carries the cohort mark to the surviving group id', () => {
  const groups: RaceGroup[] = [{id:'a',kind:'chase',rider_ids:['r0'],gap_seconds:0,cohesion:1},
    {id:'b',kind:'chase',rider_ids:['r1','r2'],gap_seconds:0,cohesion:1},
    {id:'c',kind:'gruppetto',rider_ids:['r3'],gap_seconds:50,cohesion:1}];
  const merged = mergeGroupsDetailed(groups, 1e-7);
  assert.deepEqual(mergedSharedCohorts({b: true}, groups, merged.merges), {a: true});
  assert.deepEqual(mergedSharedCohorts({x: true}, groups, merged.merges), {x: true}, 'unrelated marks are untouched');
  assert.equal(mergedSharedCohorts(undefined, groups, merged.merges), undefined);
});

function threeGroupFinale() {
  const {riders, ctx} = sharedFixture([50, 50, 90], '6199-finale-contact');
  const entry: RaceGroup[] = [{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},
    {id:'middle',kind:'chase',rider_ids:['r1'],gap_seconds:1000,cohesion:1},
    {id:'rear',kind:'chase',rider_ids:['r2'],gap_seconds:1010,cohesion:1}];
  const out = finaleHook(withGroups(riders, entry, {shared_grupetto_groups: {middle: true}}),
    {...ctx, sharedGroupTime: {entryGroups: entry, incidentCursor: 0}});
  return {out};
}

test('the finale cannot move a rear group past a middle group without contact', () => {
  const {out} = threeGroupFinale();
  const lineOf = (id: string) => out.state.groups.find(g => g.rider_ids.includes(id))!;
  assert.equal(lineOf('r1').id, lineOf('r2').id, 'the passing group and the passed group share one physical line');
  const order = out.state.finish_order!;
  assert.ok(order.indexOf('r0') < order.indexOf('r1') && order.indexOf('r0') < order.indexOf('r2'));
  const gaps = order.map(id => out.state.groups.find(g => g.rider_ids.includes(id))!.gap_seconds);
  assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b), 'finish order never contradicts physical arrival');
  assert.ok(out.events.some(e => e.type === 'group_merged' && e.params.group_id === 'middle' && e.params.into_group_id === lineOf('r2').id),
    'contact is reported');
  assert.equal(out.state.shared_grupetto_groups?.[lineOf('r1').id], true, 'cohort lineage follows the joined line');
});

test('a group reaching the front in the finale collects every group it passed', () => {
  const {riders, ctx} = sharedFixture([50, 50, 90], '6199-finale-front');
  const entry: RaceGroup[] = [{id:'front',kind:'peloton',rider_ids:['r0'],gap_seconds:0,cohesion:1},
    {id:'middle',kind:'chase',rider_ids:['r1'],gap_seconds:20,cohesion:1},
    {id:'rear',kind:'chase',rider_ids:['r2'],gap_seconds:30,cohesion:1}];
  const out = finaleHook(withGroups(riders, entry), {...ctx, sharedGroupTime: {entryGroups: entry, incidentCursor: 0}});
  const gapOfRider = (id: string) => out.state.groups.find(g => g.rider_ids.includes(id))!.gap_seconds;
  assert.ok(gapOfRider('r2') <= gapOfRider('r1'), 'no overtaking without contact');
  const order = out.state.finish_order!;
  const gaps = order.map(gapOfRider);
  assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b));
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
