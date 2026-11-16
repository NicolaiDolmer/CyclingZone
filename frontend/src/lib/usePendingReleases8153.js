// #8153: holdets ventende frigivelser (GET /api/me/pending-releases) til maerket
// "Leaves after {race}" paa holdsiden og rytterprofilen. Ikke-kritisk: fejler
// kaldet, falder maerket bare vaek (samme mønster som OwnAuctionBadge).
import { useEffect, useState } from "react";
import { authHeaders } from "./supabase.js";
import { apiFetch } from "./apiFetch.ts";
import { pendingReleasesByRider } from "./pendingReleaseModel8153.js";

const API = import.meta.env.VITE_API_URL;

/** @returns {Promise<Record<string, { raceId: string|null, raceName: string|null }>>} */
export async function fetchPendingReleases8153() {
  const headers = await authHeaders();
  if (!headers) return {};
  const res = await apiFetch(`${API}/api/me/pending-releases`, { headers });
  return res.ok ? pendingReleasesByRider(res.data) : {};
}

/**
 * @param {unknown} refreshKey skift vaerdien for at hente igen (fx efter en frigivelse)
 * @param {{ enabled?: boolean }} [opts]
 */
export function usePendingReleases8153(refreshKey, { enabled = true } = {}) {
  const [byRider, setByRider] = useState(/** @type {Record<string, { raceId: string|null, raceName: string|null }>} */ ({}));
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
