// #5519: ÉN hentning af GET /api/display-flags pr. sideload, delt af alle
// visnings-kontakter.
//
// Endpointet leverer flere kontakter i samme svar (rating-visningen #5435 og
// U23/Junior-siderne #5519). Hentede hver kontakt selv, ville én sideload give
// ét kald pr. kontakt mod samme URL og samme rate-limiter. Her deles ét løfte:
// den første kalder starter kaldet, resten får samme svar.
//
// Fail-safe: fejl, 401, 429 (stille backoff) eller manglende session giver
// `null`, og null CACHES IKKE, næste kalder prøver igen. Kaldstedet beholder
// da sin sidst kendte værdi (default off) i stedet for at blinke til "off".
import { authHeaders } from "./supabase";
import { apiFetch } from "./apiFetch.ts";

export interface DisplayFlags {
  rider_best_role_display?: boolean;
  youth_squad_pages?: boolean;
}

const API: string | undefined = import.meta.env.VITE_API_URL;

let inflight: Promise<DisplayFlags | null> | null = null;

async function fetchDisplayFlags(): Promise<DisplayFlags | null> {
  if (!API) return null;
  const headers = await authHeaders();
  if (!headers) return null;
  const res = await apiFetch(`${API}/api/display-flags`, { headers }, { source: "display-flags" });
  if (!res.ok || res.limited || res.unauthorized) return null;
  const data = res.data;
  return data && typeof data === "object" ? (data as DisplayFlags) : null;
}

export function loadDisplayFlags(): Promise<DisplayFlags | null> {
  if (inflight) return inflight;
  const pending = fetchDisplayFlags().catch(() => null);
  inflight = pending;
  void pending.then((flags) => {
    if (flags === null && inflight === pending) inflight = null;
  });
  return pending;
}
