import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const { fetchWatchdogState } = await import(new URL('./stallWatchdog.js', import.meta.url).href);
const now = new Date('2026-10-04T12:00:00Z');
const ids = Array.from({ length: 301 }, (_, i) => `00000000-0000-0000-0000-${(i + 1).toString(16).padStart(12, '0')}`);

test('real SDK serializes candidate arrays as POST and entry URLs stay below 8 KiB', async () => {
  const urls: string[] = [];
  let summaryCalls = 0;
  let resultRequests = 0;
  let summaryRows = 0;
  const supabase = createClient('https://watchdog-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      urls.push(url.href);
      let data: unknown;
      if (url.pathname.endsWith('/rpc/stall_watchdog_result_summary')) {
        assert.equal(init?.method, 'POST');
        const payload = JSON.parse(String(init?.body)) as { p_race_ids: string[] };
        assert.ok(payload.p_race_ids.length <= 300);
        summaryCalls++;
        summaryRows += payload.p_race_ids.length;
        data = payload.p_race_ids.map(race_id => ({ race_id, last_imported_at: now.toISOString(), has_prize: false, stage_numbers: [1] }));
      } else if (url.pathname.endsWith('/rpc/get_ranking_refresh_work_state')) {
        data = { pending: false, pending_age_ms: 0, last_completed_at: now.toISOString() };
      } else {
        const table = url.pathname.split('/').at(-1);
        switch (table) {
          case 'seasons': data = [{ id: 'season' }]; break;
          case 'schema_migrations':
            assert.equal(url.searchParams.get('filename'), 'eq.database/2026-10-07-6102-watchdog-result-summary.sql');
            data = [{ filename: 'database/2026-10-07-6102-watchdog-result-summary.sql' }]; break;
          case 'races': data = ids.map(id => ({ id, name: 'fixture', stages: 1, stages_completed: 0 })); break;
          case 'race_stage_schedule': data = ids.map(race_id => ({ race_id, stage_number: 1, scheduled_at: '2026-10-04T06:00:00Z', races: { name: 'fixture' } })); break;
          case 'race_entries': data = []; break;
          case 'race_results': resultRequests++; assert.equal(url.searchParams.get('limit'), '1'); data = [{ imported_at: now.toISOString() }]; break;
          case 'season_standings': data = [{ updated_at: now.toISOString() }]; break;
          case 'matview_refresh_heartbeat': data = [{ refreshed_at: now.toISOString() }]; break;
          default: throw new Error(`Unexpected test endpoint ${table}`);
        }
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const state = await fetchWatchdogState({ supabase, now });
  assert.equal(state.dueStages.length, 301);
  assert.ok(state.dueStages.every((stage: { has_results: boolean }) => stage.has_results));
  assert.equal(summaryCalls, 2);
  assert.equal(summaryRows, 301);
  assert.equal(resultRequests, 1, 'only the existing single-row global anchor remains');
  assert.ok(urls.every(url => Buffer.byteLength(url, 'utf8') < 8192));
});
