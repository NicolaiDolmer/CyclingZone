// #4649 · Oenskeliste-loft-status (Pro v1.1, ejer-valg 2/9, del C).
//
// Selve haandhaevelsen af loftet ligger i databasen (BEFORE INSERT-trigger,
// database/2026-09-03-4649-watchlist-pro-cap.sql) -- ALLE fire frontend-
// indsaettelsesveje (RidersPage/AuctionsPage/RiderStatsPage/WatchlistPage)
// skriver direkte til rider_watchlist, og der fandtes ingen enkelt backend-
// rute at goere Pro-tjekket i (verificeret: grep "limit" mod api.js's
// watchlist-kode gav nul hits foer denne PR).
//
// Denne rute er UI-lag: isPro()-tjekket (entitlement.js) + et count, saa
// fladerne kan vise "N of M" og laase "Save"-knappen foer et fejlende insert.
// Loftet selv (20 fri / 100 pro) er den SAMME konstant som triggerens --
// aendres den ene, skal den anden foelge med (samme disciplin som
// PRO_GRACE_AFTER_PERIOD_END_MS i entitlement.js's kommentar).

import { isProOrFounder } from "./entitlement.js";
import { captureException } from "./sentry.js";

export const WATCHLIST_FREE_CAP = 20;
export const WATCHLIST_PRO_CAP = 100;

export function createWatchlistLimitHandler({ supabase }) {
  return async function watchlistLimit(req, res) {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      // #4649: isProOrFounder — samme kombination triggeren i
      // database/2026-09-03-4649-watchlist-pro-cap.sql håndhæver.
      const [proResult, countResult] = await Promise.all([
        isProOrFounder(supabase, req.team.id),
        supabase.from("rider_watchlist").select("*", { count: "exact", head: true }).eq("user_id", req.user.id),
      ]);
      if (countResult.error) throw new Error(countResult.error.message);
      const pro = Boolean(proResult);
      res.json({
        count: countResult.count ?? 0,
        cap: pro ? WATCHLIST_PRO_CAP : WATCHLIST_FREE_CAP,
        isPro: pro,
      });
    } catch (err) {
      captureException(err, { tags: { flow: "pro", stage: "watchlist-limit" }, teamId: req.team.id });
      res.status(500).json({ error: err.message });
    }
  };
}

export default createWatchlistLimitHandler;
