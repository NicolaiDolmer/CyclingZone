import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import {
  defaultEndWallClock,
  gameWallClockToUTC,
  getEndTimeIssue,
  windowHoursForWallClock,
} from "./auctionEndTime.js";

// #2884 + #3786: delt sluttidspunkt-vælger til BEGGE auktions-opstartsflows —
// holdsidens RiderActionModal (TeamPage.jsx) og rytterprofilens AuctionButton
// (RiderStatsPage.jsx). #3786 opstod netop fordi vælgeren kun blev bygget ind
// i ét af de to flows ("Right now it could be its only in here, will put into
// profiles soon" — ejeren i Discord-tråden 14/8). Ét hook, to renderere, ingen
// tredje kopi der kan drifte fra reglerne (samme mønster som useAuctionBidding.js
// — kalderen renderer selv sin JSX, men bruger denne til state + validering).
//
// active=false undlader at fetche vinduet — bruges af RiderStatsPage's
// AuctionButton så et lukket/uåbnet auktions-panel ikke laver et netværkskald
// ingen ser. TeamPage's modal er altid "aktiv" fra mount (default true).
export function useAuctionEndTimeSelector({ active = true } = {}) {
  const [auctionWindow, setAuctionWindow] = useState(null);
  const [endWall, setEndWall] = useState("");

  // Fejler kaldet (eller aldrig aktiveret), forbliver auctionWindow null →
  // vælgeren skjules og auktionen oprettes med serverens globale varighed i
  // stedet for at blokere salget (samme fallback som før #3786).
  useEffect(() => {
    if (!active || auctionWindow) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions/window`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const cfg = await res.json();
        if (cancelled) return;
        setAuctionWindow(cfg);
        setEndWall(defaultEndWallClock(new Date(), cfg));
      } catch { /* stille — auktionen kan stadig oprettes med den globale varighed */ }
    })();
    return () => { cancelled = true; };
  }, [active, auctionWindow]);

  const endTimeIssue = auctionWindow && endWall
    ? getEndTimeIssue(endWall, new Date(), auctionWindow)
    : null;
  const endHours = endWall ? windowHoursForWallClock(endWall, auctionWindow || {}) : null;
  // null når feltet endnu ikke er klar/gyldigt — kalderen sender da IKKE
  // ends_at med, og serveren falder tilbage til sin globale varighed.
  const endsAtIso = endWall && !endTimeIssue ? gameWallClockToUTC(endWall).toISOString() : null;

  return { auctionWindow, endWall, setEndWall, endTimeIssue, endHours, endsAtIso };
}
