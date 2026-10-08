import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminRoadmapRouter } from './adminRoadmap.js';

async function withApp(run, rpc = async () => ({ data: [], error: null })) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api/admin/roadmap', createAdminRoadmapRouter({
    supabase: { rpc: async (...args) => { calls.push(args); return rpc(...args); } },
    requireAdmin: (req, res, next) => req.headers.authorization === 'admin'
      ? next() : res.status(req.headers.authorization ? 403 : 401).json({ error: 'Admin only' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/admin/roadmap`, calls); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

const split = { source: '00000000-0000-0000-0000-000000000001', title_en: 'Next', title_da: 'Næste', status: 'planned', horizon: 'next', issue_ref: 123 };

test('all roadmap RPC routes reject anonymous and non-admin callers before the database', async () => {
  await withApp(async (base, calls) => {
    for (const authorization of [undefined, 'player']) for (const [path, method] of [['/stats', 'GET'], ['/split', 'POST'], ['/resync', 'POST']]) {
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

test('invalid split input is rejected before calling the writer', async () => {
  await withApp(async (base, calls) => {
    for (const body of [[], {}, { ...split, source: 'invalid' }, { ...split, title_da: '' }, { ...split, status: 'invalid' }, { ...split, horizon: 'invalid' }, { ...split, issue_ref: -1 }]) {
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
