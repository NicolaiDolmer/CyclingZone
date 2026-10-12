import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch.ts";
import { authHeaders } from "../lib/supabase";
import { readFirstRacePreviewParam, normalizeFirstRaceCardPayload } from "../lib/firstRaceCardPayload.js";

// #1140 · server-afgjort svar paa "skal dashboardet vise 'Your first race'-kortet,
// og hvad maa det sige?" (GET /api/me/first-race-card). Flag, beta-status,
// preview og resultat-gate afgoeres ALLE paa serveren: klienten sender kun
// ?preview=first-race videre, og serveren ignorerer den for alle undtagen
// admin/beta-testere.
//
// Aldrig blokerende og aldrig kastende: fejl/ukendt svar = null = intet kort
// (dashboardet er uaendret). null betyder ogsaa "ikke hentet endnu".
export default function useFirstRaceCard(teamId) {
  const [card, setCard] = useState(null);

  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const preview = readFirstRacePreviewParam(typeof window !== "undefined" ? window.location.search : "");
        const headers = (await authHeaders({ json: false })) ?? {};
        const qs = preview ? `?preview=${preview}` : "";
        const res = await apiFetch(`/api/me/first-race-card${qs}`, { headers });
        if (cancelled) return;
        setCard(res.ok && !res.limited && !res.unauthorized ? normalizeFirstRaceCardPayload(res.data) : null);
      } catch {
        if (!cancelled) setCard(null);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  return card;
}
