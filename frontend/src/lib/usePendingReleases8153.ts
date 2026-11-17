// #8153: holdets ventende frigivelser (GET /api/me/pending-releases) til maerket
// "Leaves after {race}" paa holdsiden og rytterprofilen. Ikke-kritisk: fejler
// kaldet, falder maerket bare vaek (samme moenster som OwnAuctionBadge).
import { useEffect, useState } from "react";
import { authHeaders } from "./supabase.js";
import { apiFetch } from "./apiFetch.ts";
import { pendingReleasesByRider, type PendingRelease } from "./pendingReleaseModel8153.ts";

const API = import.meta.env.VITE_API_URL;

export async function fetchPendingReleases8153(): Promise<Record<string, PendingRelease>> {
  const headers = await authHeaders();
  if (!headers) return {};
  const res = await apiFetch(`${API}/api/me/pending-releases`, { headers });
  return res.ok ? pendingReleasesByRider(res.data) : {};
}

/** refreshKey: skift vaerdien for at hente igen (fx naar truppen genindlaeses). */
export function usePendingReleases8153(refreshKey: unknown, { enabled = true }: { enabled?: boolean } = {}) {
  const [byRider, setByRider] = useState<Record<string, PendingRelease>>({});
  useEffect(() => {
    if (!enabled) { setByRider({}); return undefined; }
    let cancelled = false;
    fetchPendingReleases8153()
      .then((next) => { if (!cancelled) setByRider(next); })
      .catch(() => { /* non-critical: maerket falder bare vaek */ });
    return () => { cancelled = true; };
  }, [refreshKey, enabled]);
  return byRider;
}
