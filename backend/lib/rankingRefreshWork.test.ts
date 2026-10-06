import test from 'node:test';
import assert from 'node:assert/strict';
import { runRankingRefreshWork } from './rankingRefreshWork.ts';

const now = new Date('2026-10-06T12:00:00Z');
const token = '00000000-0000-4000-8000-000000000001';
function client(claim: unknown, finish = true) {
  const calls: { name: string; args: unknown }[] = [];
  return { calls, async rpc(name: string, args?: unknown) {
    calls.push({ name, args });
    return { data: name === 'claim_ranking_refresh_work' ? claim : finish, error: null };
  } };
}
const options = { testNowFn: () => now, tokenFn: () => token };

test('clean coordinator state performs no full refresh and writes no completion heartbeat', async () => {
  const db = client({ status: 'clean' });
  let passes = 0;
  assert.equal(await runRankingRefreshWork(db, async () => { passes++; return true; }, options), true);
  assert.equal(passes, 0);
  assert.deepEqual(db.calls.map(call => call.name), ['claim_ranking_refresh_work']);
});

test('a successful pass acknowledges the captured version, not a later arrival', async () => {
  const db = client({ status: 'claimed', target_version: '2', token });
  assert.equal(await runRankingRefreshWork(db, async () => true, options), true);
  assert.deepEqual(db.calls.at(-1), { name: 'finish_ranking_refresh_work', args: {
    p_token: token, p_target_version: '2', p_success: true, p_now: now.toISOString(),
  } });
});

test('another process owns the pass, so the caller does not duplicate it', async () => {
  const db = client({ status: 'busy' });
  assert.equal(await runRankingRefreshWork(db, async () => { throw new Error('Must not refresh'); }, options), 'coalesced');
});

test('failure retains dirtiness and failed token fencing cannot report success', async () => {
  const db = client({ status: 'claimed', target_version: '2', token });
  assert.equal(await runRankingRefreshWork(db, async () => false, options), false);
  assert.equal((db.calls.at(-1)?.args as { p_success: boolean }).p_success, false);
  const fenced = client({ status: 'claimed', target_version: '2', token }, false);
  assert.equal(await runRankingRefreshWork(fenced, async () => true, options), false);
});

test('malformed admission or a mismatched token fails closed before heavy work', async () => {
  for (const admission of [null, {}, { status: 'unknown' }, { status: 'claimed', target_version: 'invalid', token },
    { status: 'claimed', target_version: '2', token: 'foreign-owner' }]) {
    assert.equal(await runRankingRefreshWork(client(admission), async () => { throw new Error('Must not refresh'); }, options), false);
  }
});

test('production lease operations omit caller time and heavy pass receives captured owner/version', async () => {
  const db = client({ status: 'claimed', target_version: '2', token });
  const seen: [string, string][] = [];
  assert.equal(await runRankingRefreshWork(db, async (renew, owner, version) => {
    seen.push([owner,version]); await renew(); return true;
  }, { tokenFn: () => token }), true);
  assert.deepEqual(seen, [[token,'2']]);
  for (const call of db.calls) assert.equal(Object.hasOwn(call.args as object,'p_now'),false);
});
