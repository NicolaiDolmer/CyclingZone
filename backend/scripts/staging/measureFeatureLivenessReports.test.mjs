import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const marker = 'DO_NOT_PRINT_SYNTHETIC_PAYLOAD';
const cli = fileURLToPath(new URL('./measureFeatureLivenessReports.mjs', import.meta.url));
for (const mode of ['mismatch', 'network', 'invalid']) {
  test(`measurement fails without exposing raw payload: ${mode}`, () => {
    const prefix = join(tmpdir(), 'liveness-measure-test-');
    const dir = mkdtempSync(prefix);
    try {
      mkdirSync(join(dir, 'docs', 'audits'), { recursive: true });
      const preload = join(dir, 'fake-fetch.mjs');
      writeFileSync(preload, `let calls = 0;
        globalThis.fetch = async (url) => {
          if (String(url).includes('/rpc/')) {
            calls++; console.log("RPC_PROBE_REACHED");
            if (${JSON.stringify(mode)} === 'network') throw Error(${JSON.stringify(marker)});
            if (${JSON.stringify(mode)} === 'invalid') return Response.json({ private: ${JSON.stringify(marker)} });
            return Response.json([{ table_name: ${JSON.stringify(marker)}, row_count: calls === 1 ? 1 : 2, rls_enabled: true, estimated: false }]);
          }
          return new Response(null, { status: 200, headers: { 'content-range': String(url).includes('/app_config?') ? '*/1' : '*/0' } });
        };`);
      const env = {};
      for (const key of ['SystemRoot','windir','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE','HOME','APPDATA','LOCALAPPDATA']) {
        if (process.env[key]) env[key] = process.env[key];
      }
      Object.assign(env, { SUPABASE_URL: 'https://pywxpnynzmbukdvoiazp.supabase.co',
        SUPABASE_SERVICE_KEY: 'synthetic-test-key', CZ_TARGET_ENV: 'loadtest-staging' });
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, cli], { cwd: dir, env, encoding: 'utf8' });
      assert.ok(result.stdout.includes("RPC_PROBE_REACHED"), result.stderr);
      assert.notEqual(result.status, 0);
      assert.ok(!(result.stdout + result.stderr).includes(marker), 'raw payload leaked');
    } finally {
      assert.ok(resolve(dir).startsWith(resolve(prefix)), 'cleanup outside owned test directory');
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
