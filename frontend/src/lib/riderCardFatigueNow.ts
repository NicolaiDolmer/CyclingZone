// #7801 · Rytterkortets traethed lige nu (egne ryttere), bag kontakten fatigue_now_7801.
//
// Kontakten laeses paa klienten fra det flag-svar, kortets ikon allerede henter
// (RiderNameIcon.tsx, fetchPlayerFeatureFlags). Derfor:
//   - Slukket: intet ekstra kald, og kortet viser rider_condition praecis som foer.
//   - Taendt: ét kald til GET /api/riders/:id/fatigue-now. ENHVER fejl (netvaerk, 429,
//     5xx, tom eller ugyldig krop) giver null = "-", aldrig morgenens tal.
// Kortet tegnes foerst og venter ikke paa kaldet; indtil svaret er der, staar "-".
import type { ApiFetchResult } from "./apiFetch.ts";

export type FatigueNowFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<ApiFetchResult>;

/** undefined = brug rider_condition (kontakten slukket ifoelge serveren). Ellers tallet eller null. */
export type FatigueNowResult = { fatigue: number | null } | undefined;

export async function fetchRiderCardFatigueNow({ riderId, enabled, apiBase, getHeaders, fetcher }: {
  riderId: string;
  enabled: boolean;
  apiBase: string;
  getHeaders: () => Promise<Record<string, string> | null | undefined>;
  fetcher: FatigueNowFetcher;
}): Promise<FatigueNowResult> {
  if (!enabled) return undefined;
  try {
    const headers = await getHeaders();
    if (!headers) return { fatigue: null };
    const res = await fetcher(`${apiBase}/api/riders/${riderId}/fatigue-now`, { headers });
    const body = (res?.ok ? res.data : null) as { enabled?: unknown; own?: unknown; fatigue?: unknown } | null;
    if (!body || typeof body !== "object") return { fatigue: null };
    // Serveren siger slukket (kontakten er slukket siden siden blev hentet): som foer.
    if (body.enabled === false) return undefined;
    if (body.enabled !== true || body.own !== true) return { fatigue: null };
    return { fatigue: typeof body.fatigue === "number" && Number.isFinite(body.fatigue) ? body.fatigue : null };
  } catch {
    // catch-ok: taendt og intet svar = "-", aldrig morgenens tal.
    return { fatigue: null };
  }
}

/** Det tal kortet viser. pending = kaldet koerer endnu (kun med kontakten taendt). */
export function riderCardFatigue(openingFatigue: number | null, live: boolean, result: FatigueNowResult | "pending"): number | null {
  if (!live) return openingFatigue;
  if (result === "pending") return null;
  if (result === undefined) return openingFatigue;
  return result.fatigue;
}
