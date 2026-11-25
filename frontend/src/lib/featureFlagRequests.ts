import { apiFetch } from "./apiFetch.ts";

type PlayerFlags = Record<string, boolean>;

const pending = new Map<string, Promise<PlayerFlags | null>>();

async function requestFlags(headers: Record<string, string>): Promise<PlayerFlags | null> {
  try {
    const response = await apiFetch("/api/feature-flags", { headers });
    const body = response.data as { flags?: PlayerFlags; degraded?: boolean } | null;
    if (!response.ok || !body?.flags || body.degraded === true) return null;
    if (typeof body.flags !== "object" || Array.isArray(body.flags)) return null;
    return body.flags;
  } catch {
    // catch-ok: flag readers handle unknown values by failing closed.
    return null;
  }
}

/** Coalesce only concurrent reads under the same authorization. */
export function readPlayerFeatureFlags(headers: Record<string, string>): Promise<PlayerFlags | null> {
  const authorization = headers.Authorization ?? headers.authorization ?? "";
  const existing = pending.get(authorization);
  if (existing) return existing;

  const request = requestFlags(headers).finally(() => pending.delete(authorization));
  pending.set(authorization, request);
  return request;
}
