import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function waitForBackendReadiness({
  baseUrl,
  fetchFn = fetch,
  wait = (ms: number) => new Promise<void>(resolveWait => setTimeout(resolveWait, ms)),
  attempts = 6,
  retryDelayMs = 5000,
  timeoutMs = 5000,
}: {
  baseUrl: string;
  fetchFn?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const url = new URL('/health/ready', baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) backend URL required');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6 || timeoutMs <= 0 || timeoutMs > 5000
    || !Number.isFinite(timeoutMs) || retryDelayMs < 0 || retryDelayMs > 5000 || !Number.isFinite(retryDelayMs)) {
    throw new Error('Readiness retry budget exceeds 55 seconds');
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>(resolveDeadline => {
      timer = setTimeout(() => { resolveDeadline(false); controller.abort(); }, timeoutMs);
    });
    const request = (async () => {
      try {
        const response = await fetchFn(url, { signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) { await response.body?.cancel(); return false; }
        const body: unknown = await response.json();
        return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
          && 'db' in body && body.db === 'ok';
      } catch {
        // Transport failures, malformed payloads and redirects cannot pass readiness.
        return false;
      }
    })();
    try {
      if (await Promise.race([request, deadline])) return true;
    } finally {
      clearTimeout(timer);
    }
    if (attempt + 1 < attempts) await wait(retryDelayMs);
  }
  return false;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ready = await waitForBackendReadiness({ baseUrl: process.argv[2] ?? '' });
    console.log(ready ? 'Backend /health/ready = 200' : 'Backend /health/ready unavailable after bounded retries');
    process.exitCode = ready ? 0 : 1;
  } catch {
    console.error('Readiness probe failed: valid backend URL required');
    process.exitCode = 1;
  }
}
