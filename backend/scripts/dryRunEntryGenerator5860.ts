// Read-only diagnostic. There is deliberately no apply mode.
// infisical run --env=dev --silent -- node backend/scripts/dryRunEntryGenerator5860.ts --season=<uuid> --now=<ISO>
import { createClient } from '@supabase/supabase-js';
import { runRaceEntryGenerator } from '../lib/raceEntryGenerator.js';

export function readOnlyGeneratorClient(client: { from: (table: string) => any }) {
  const mutations = new Set(['insert', 'upsert', 'update', 'delete']);
  const wrap = (query: any): any => new Proxy(query, {
    get(target, property) {
      if (mutations.has(String(property))) return () => { throw new Error('Dry-run refuses database mutation'); };
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (['then', 'catch', 'finally'].includes(String(property))) return value.bind(target);
      return (...args: any[]) => wrap(value.apply(target, args));
    },
  });
  return {
    from: (table: string) => wrap(client.from(table)),
    rpc: () => { throw new Error('Dry-run refuses RPC execution'); },
  };
}

async function main() {
  const seasonId = process.argv.find(arg => arg.startsWith('--season='))?.slice(9);
  const nowText = process.argv.find(arg => arg.startsWith('--now='))?.slice(6);
  const now = new Date(nowText ?? 'invalid');
  if (!seasonId || !/^[0-9a-f-]{36}$/i.test(seasonId) || !Number.isFinite(now.getTime()) || process.argv.includes('--apply')) {
    throw new Error('Supply --season=<uuid> and --now=<ISO>; no apply mode exists');
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Run through Infisical with Supabase credentials');
  const supabase = readOnlyGeneratorClient(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  const result = await runRaceEntryGenerator({ supabase, seasonId, now: now.getTime(), dryRun: true, notify: async () => { throw new Error('Dry-run refuses notifications'); } });
  console.log(JSON.stringify({ seasonId, now: now.toISOString(), ...result }, null, 2));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/dryRunEntryGenerator5860.ts')) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Dry-run failed'); process.exitCode = 1; });
}
