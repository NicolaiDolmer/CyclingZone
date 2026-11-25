import { apiFetch } from "./apiFetch.ts";

type PlayerFlags = Record<string, boolean>;

type Headers = Record<string, string>;

let generation = 0;

export function invalidatePlayerReads() {
  generation += 1;
}

function authorizationScope(authorization: string): string {
  // This only identifies the cache. The server independently verifies the bearer.
  const token = authorization.match(/^Bearer ([^ ]+)$/i)?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return authorization;
  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(base64)) as { iss?: string; sub?: string; session_id?: string; role?: string };
    if (claims.iss && claims.sub && claims.session_id) {
      return JSON.stringify([claims.iss, claims.sub, claims.session_id, claims.role]);
    }
  } catch {
    // catch-ok: malformed or opaque credentials stay isolated by exact bearer.
    return authorization;
  }
  return authorization;
}

function sessionRead<T>(read: (headers: Headers) => Promise<T | null>) {
  let entries = new Map<string, Promise<T | null>>();
  let entriesGeneration = -1;
  let previousAuthorization = "";
  return (headers: Headers): Promise<T | null> => {
    const authorization = authorizationScope(headers.Authorization ?? headers.authorization ?? "");
    if (authorization && authorization !== previousAuthorization) {
      if (previousAuthorization) entries.delete(previousAuthorization);
      previousAuthorization = authorization;
    }
    if (entriesGeneration !== generation) {
      entries = new Map();
      entriesGeneration = generation;
    }
    const cache = entries;
    const existing = cache.get(authorization);
    if (existing) return existing;

    // catch-ok: a failed network read is unknown and is removed from the cache.
    const request = read(headers).catch(() => null).then((result) => {
      if (result === null && cache.get(authorization) === request) cache.delete(authorization);
      // A role or account switch can leave a request for the old viewer in flight.
      return cache === entries && entriesGeneration === generation ? result : null;
    });
    cache.set(authorization, request);
    return request;
  };
}

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

/** Share in-flight work and successful reads inside the current authorization scope. */
export const readPlayerFeatureFlags = sessionRead(requestFlags);

export const readAcademyMenuVisibility = sessionRead(async (headers) => {
  const response = await apiFetch("/api/academy/visibility", { headers }, { source: "academy-visibility" });
  const body = response.data as { visible?: boolean } | null;
  if (response.ok && typeof body?.visible === "boolean") return body.visible;
  if (response.status !== 404) return null;

  // A Vercel preview can reach the previous Railway release during rollout.
  const legacy = await apiFetch("/api/academy/me", { headers }, { source: "academy-me" });
  if (legacy.status === 409) return false;
  const legacyBody = legacy.data as { enabled?: boolean } | null;
  return legacy.ok && typeof legacyBody?.enabled === "boolean" ? legacyBody.enabled : null;
});
