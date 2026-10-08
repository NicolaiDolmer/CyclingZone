import test from 'node:test';
import assert from 'node:assert/strict';
import { generatorBindingLocks, indexGeneratorBindings, loadRegenerateBindingLocks } from './raceEntryGeneratorBindings.ts';

// #6132: minimal Supabase double for the regenerate loader.
function loaderDb({ spent = [] as Array<Record<string, unknown>>, rpcError = null as null | Record<string, unknown>, entries = [] as Array<Record<string, unknown>> } = {}) {
  const calls: Array<[string, unknown]> = [];
  const q: Record<string, any> = {
    select: (cols: string) => { calls.push(['select', cols]); return q; },
    eq: (col: string, v: unknown) => { calls.push(['eq', [col, v]]); return q; },
    neq: (col: string, v: unknown) => { calls.push(['neq', [col, v]]); return q; },
    not: (col: string) => { calls.push(['not', col]); return q; },
    in: (col: string, ids: unknown[]) => { calls.push(['in', [col, ids]]); return q; },
    order: () => q,
    range: () => Promise.resolve({ data: entries, error: null }),
  };
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push(['rpc', [name, args.p_race_id]]); return { data: spent, error: rpcError }; },
    from: (table: string) => { calls.push(['from', table]); return q; },
  };
}

test('#6132 loader: one spent-day lookup per target, deduped exact days, other owners bind, own entries are left to the caller', async () => {
  const db = loaderDb({
    spent: [{ race_id: 'done', rider_id: 'r1', game_day: 29 }],
    entries: [{ race_id: 'ext', rider_id: 'r2', team_id: 'seller', binding_span: '[29,31)', races: {} }],
  });
  const locks = await loadRegenerateBindingLocks({ supabase: db, seasonId: 'S', teamId: 'buyer', targetRaceIds: ['a', 'b'], riderIds: ['r1', 'r2'] });
  assert.deepEqual(locks, [{ window: { start: 29, end: 29 }, riderIds: ['r1'] }, { window: { start: 29, end: 30 }, riderIds: ['r2'] }]);
  assert.deepEqual(db.calls.filter(([k]) => k === 'rpc').map(([, v]) => v), [['find_spent_race_days', 'a'], ['find_spent_race_days', 'b']]);
  assert.ok(db.calls.some(([k, v]) => k === 'eq' && JSON.stringify(v) === '["races.season_id","S"]'));
  assert.ok(db.calls.some(([k, v]) => k === 'neq' && JSON.stringify(v) === '["team_id","buyer"]'));
});

test('#6132 loader: no target or no riders queries nothing; a failed lookup fails closed', async () => {
  const idle = loaderDb();
  assert.deepEqual(await loadRegenerateBindingLocks({ supabase: idle, seasonId: 'S', teamId: 't', targetRaceIds: [], riderIds: ['r'] }), []);
  assert.deepEqual(await loadRegenerateBindingLocks({ supabase: idle, seasonId: 'S', teamId: 't', targetRaceIds: ['a'], riderIds: [] }), []);
  assert.equal(idle.calls.length, 0);
  const broken = loaderDb({ rpcError: { code: 'XX000', message: 'boom' } });
  await assert.rejects(loadRegenerateBindingLocks({ supabase: broken, seasonId: 'S', teamId: 't', targetRaceIds: ['a'], riderIds: ['r'] }), /spent race-day lookup failed/);
});

test('canonical spans bind through the final stage; participation remains exact days', () => {
  const bindings = indexGeneratorBindings([{ race_id: 'stage', rider_id: 'r1', team_id: 'seller', binding_span: '[27,32)' }],
    [{ race_id: 'completed', rider_id: 'r2', game_day: 29 }, { race_id: 'completed', rider_id: 'r2', game_day: 31 }]);
  const locks = generatorBindingLocks({ bindings, riderIds: ['r1', 'r2'], teamId: 'buyer', regeneratingRaceIds: new Set(['next']) });
  assert.deepEqual(locks.map(lock => lock.window), [{ start: 27, end: 31 }, { start: 29, end: 29 }, { start: 31, end: 31 }]);
});

test('replanning releases only the target owner, and never releases participation', () => {
  const bindings = indexGeneratorBindings([
    { race_id: 'target', rider_id: 'mine', team_id: 'buyer', binding_span: '[29,30)' },
    { race_id: 'target', rider_id: 'other-owner', team_id: 'seller', binding_span: '[29,30)' },
    { race_id: 'outside', rider_id: 'outside', team_id: 'buyer', binding_span: '[29,30)' },
  ], [{ race_id: 'target', rider_id: 'spent', game_day: 29 }]);
  const locks = generatorBindingLocks({ bindings, riderIds: ['mine', 'other-owner', 'outside', 'spent'],
    teamId: 'buyer', regeneratingRaceIds: new Set(['target']) });
  assert.deepEqual(locks.flatMap(lock => lock.riderIds), ['other-owner', 'outside', 'spent']);
});

test('malformed canonical data fails closed', () => {
  for (const binding_span of ['empty', '[29,29)', '[29,)', '(29,31]', 'unexpected']) {
    assert.throws(() => indexGeneratorBindings([{ race_id: 'race', rider_id: 'r', team_id: 'team', binding_span }], []), /Invalid canonical/);
  }
  assert.throws(() => indexGeneratorBindings([], [{ race_id: 'race', rider_id: 'r', game_day: NaN }]), /integer race day/);
});
