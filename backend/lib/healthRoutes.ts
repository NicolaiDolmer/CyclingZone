import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type HealthClient = Pick<SupabaseClient, 'from'>;

export async function probeHealthDatabase(supabase: HealthClient, dbTimeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>(resolve => {
    timer = setTimeout(() => { resolve(false); controller.abort(); }, dbTimeoutMs);
  });
  try {
    const probe = (async () => {
      try {
        const { error } = await supabase.from('app_config').select('key', { head: true })
          .limit(1).abortSignal(controller.signal).retry(false);
        return !error;
      } catch {
        // A failed probe is an expected readiness failure, never a successful deployment check.
        return false;
      }
    })();
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthRouter({
  supabase,
  now = () => new Date(),
  dbTimeoutMs = 3000,
}: {
  supabase: HealthClient;
  now?: () => Date;
  dbTimeoutMs?: number;
}) {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', timestamp: now().toISOString() });
  });
  router.get('/health/ready', async (_req, res) => {
    const ready = await probeHealthDatabase(supabase, dbTimeoutMs);
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503)
      .json({ status: ready ? 'ok' : 'degraded', db: ready ? 'ok' : 'error', timestamp: now().toISOString() });
  });
  return router;
}
