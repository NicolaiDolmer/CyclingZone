import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminRoadmapRouter } from './adminRoadmap.js';

async function withApp(run, rpc = async () => ({ data: [], error: null }), extra = {}) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api/admin/roadmap', createAdminRoadmapRouter({
    supabase: { rpc: async (...args) => { calls.push(args); return rpc(...args); } },
    ...extra,
    requireAdmin: (req, res, next) => req.headers.authorization === 'admin'
      ? next() : res.status(req.headers.authorization ? 403 : 401).json({ error: 'Admin only' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/admin/roadmap`, calls); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

const split = { source: '00000000-0000-0000-0000-000000000001', title_en: 'Next', title_da: 'Næste', status: 'planned', horizon: 'season_5', issue_ref: 123 };

test('all roadmap RPC routes reject anonymous and non-admin callers before the database', async () => {
  await withApp(async (base, calls) => {
    for (const authorization of [undefined, 'player']) for (const [path, method] of [['/stats', 'GET'], ['/votes', 'GET'], ['/split', 'POST'], ['/resync', 'POST']]) {
      const res = await fetch(base + path, { method, headers: authorization ? { authorization } : {} });
      assert.equal(res.status, authorization ? 403 : 401);
    }
    assert.deepEqual(calls, []);
  });
});

test('admin stats and writes call only their fixed service RPCs', async () => {
  await withApp(async (base, calls) => {
    assert.equal((await fetch(base + '/stats', { headers: { authorization: 'admin' } })).status, 200);
    assert.equal((await fetch(base + '/split', { method: 'POST', headers: { authorization: 'admin', 'Content-Type': 'application/json' }, body: JSON.stringify(split) })).status, 200);
    assert.equal((await fetch(base + '/resync', { method: 'POST', headers: { authorization: 'admin' } })).status, 200);
    assert.deepEqual(calls, [
      ['roadmap_admin_stats'],
      ['roadmap_split_item', { p_source: split.source, p_title_en: split.title_en, p_title_da: split.title_da, p_status: split.status, p_horizon: split.horizon, p_issue_ref: split.issue_ref }],
      ['roadmap_resync_flags'],
    ]);
  });
});

test('admin vote rows pass the single jsonb object through unchanged (#7789)', async () => {
  const votes = { voters: [[2, true]], votes: [[split.source, 0, 5, 4]] };
  await withApp(async (base, calls) => {
    const res = await fetch(base + '/votes', { headers: { authorization: 'admin' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { votes });
    assert.deepEqual(calls, [['roadmap_admin_vote_rows']]);
  }, async () => ({ data: votes, error: null }));
});

test('split accepts every player-facing horizon pattern (#7895)', async () => {
  const horizons = ['this_week', 'next_week', 'season_5', 'season_12', 'q1_2027', 'q4_2028', 'y2027', 'unscheduled'];
  await withApp(async (base, calls) => {
    for (const horizon of horizons) {
      const res = await fetch(base + '/split', { method: 'POST', headers: { authorization: 'admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...split, horizon }) });
      assert.equal(res.status, 200, horizon);
    }
    assert.deepEqual(calls.map(([, args]) => args.p_horizon), horizons);
  });
});

test('invalid split input is rejected before calling the writer', async () => {
  await withApp(async (base, calls) => {
    for (const body of [[], {}, { ...split, source: 'invalid' }, { ...split, title_da: '' }, { ...split, status: 'invalid' }, { ...split, horizon: 'invalid' }, { ...split, horizon: 'next' }, { ...split, horizon: 'later' }, { ...split, horizon: 'q5_2027' }, { ...split, issue_ref: -1 }]) {
      const res = await fetch(base + '/split', { method: 'POST', headers: { authorization: 'admin', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(res.status, 400);
    }
    assert.deepEqual(calls, []);
  });
});

test('database failures and transport failures return fixed errors without raw payloads', async () => {
  for (const rpc of [async () => ({ data: null, error: { message: 'PRIVATE_DB_DETAIL' } }), async () => { throw new Error('PRIVATE_TRANSPORT_DETAIL'); }]) {
    await withApp(async base => {
      const res = await fetch(base + '/stats', { headers: { authorization: 'admin' } });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'Roadmap request failed' });
    }, rpc);
  }
});

test('notify-delivered is admin only and returns the sweep summary (#7792)', async () => {
  let runs = 0;
  const runDelivered = async () => { runs += 1; return { items: 1, sent: 2 }; };
  await withApp(async base => {
    assert.equal((await fetch(base + '/notify-delivered', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/notify-delivered', { method: 'POST', headers: { authorization: 'player' } })).status, 403);
    assert.equal(runs, 0);
    const res = await fetch(base + '/notify-delivered', { method: 'POST', headers: { authorization: 'admin' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { items: 1, sent: 2 });
    assert.equal(runs, 1);
  }, undefined, { runDelivered });
});

test('notify-delivered failures return a fixed error (#7792)', async () => {
  await withApp(async base => {
    const res = await fetch(base + '/notify-delivered', { method: 'POST', headers: { authorization: 'admin' } });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Roadmap request failed' });
  }, undefined, { runDelivered: async () => { throw new Error('PRIVATE_DETAIL'); } });
});
