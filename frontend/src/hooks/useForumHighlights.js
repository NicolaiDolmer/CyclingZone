import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { selectForumHighlights } from "../lib/forumHighlights.js";

// Forum-synlighed (#3199, variant B): data-hentning for dashboardets
// "From the forum"-kort. SELVSTÆNDIG hook, samme selv-hentende arkitektur
// som useTodayStages.js (#3915) / useHeroAgonyMoment.js (#3397) — kortet er
// derfor kun 1 import-linje + 1 render-linje på DashboardPage.
//
// Genbrug (ingen nyt backend-endpoint, ingen ny data-logik): samme
// GET /api/forum/posts som ForumPage/#4238 allerede kalder (backend/lib/
// forum.js#listForumPosts) — ÉT HTTP-kald, limit=2 på hovedlisten. Pinnede
// opslag kommer i en separat bounded blok (maks 20, backend-side) i samme
// svar; de to lister flettes og sorteres HER efter samme aktivitets-nøgle
// som backenden allerede bruger (last_reply_at || created_at), fordi
// "de to tråde med nyeste aktivitet" (design-låst) IKKE er det samme som
// "pinned altid øverst" — et gammelt pinnet opslag skal ikke fortrænge en
// tråd med et splinternyt svar på dette kort (i modsætning til selve
// forumsiden, hvor pins bevidst altid ligger øverst).
//
// Fejler kaldet (netværk, 401, manglende session) → status "error", kortet
// renderer INTET (se ForumHighlightsCard) — dashboardet må aldrig vise en
// fejl-tilstand på grund af forummet.
const API = import.meta.env.VITE_API_URL;
const HIGHLIGHT_COUNT = 2;

export default function useForumHighlights() {
  const [state, setState] = useState({ status: "loading", threads: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const headers = await authHeaders({ json: false }); // ren GET, ingen body
      if (!headers || !API) throw new Error("no session");
      const res = await fetch(`${API}/api/forum/posts?limit=${HIGHLIGHT_COUNT}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const highlights = selectForumHighlights(data.pinned, data.items, HIGHLIGHT_COUNT);
      setState({ status: "ready", threads: highlights });
    } catch (e) {
      // Kortet fejler bevidst stille på UI'en (se kommentarblok ovenfor).
      // console.warn, ikke console.error: e2e-suitens collectBrowserErrors
      // (fixtures.js) eskalerer console.error til hård test-fejl, så en
      // harmløs netværksfejl her gjorde en flaky mobile-webkit-fejl til en
      // falsk rød suite. Refs #4309/#4305.
      console.warn("useForumHighlights failed:", e?.message || e);
      setState({ status: "error", threads: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return state;
}
