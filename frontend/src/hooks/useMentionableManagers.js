import { useEffect, useState } from "react";
import { authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi

// #5011 — de managernavne der kan @-tagges. Bruges to steder på forummet:
// autocomplete i editoren og den klikbare rendering af @navn i hvert eneste
// indlæg og svar.
//
// MODUL-CACHE, ikke ét kald pr. komponent: en tråd med 30 svar monterer 31
// renderere, og hver af dem har brug for listen. Uden cachen ville ét besøg
// koste 31 identiske HTTP-kald. Listen ændrer sig kun når en ny manager
// tilmelder sig, så én hentning pr. sideindlæsning er rigeligt — en tråd der
// allerede er åben, opdager ikke en manager der tilmelder sig imens, og det er
// den rigtige afvejning (samme accept som forum-listens egen paginering).
//
// Fejler kaldet, står listen tom: teksten rendres da uændret (ingen klikbare
// navne) og editoren foreslår ingenting. Ingen fejl-tilstand på fladen —
// forummet må ikke se i stykker ud fordi en hjælpeliste ikke kom hjem.
const API = import.meta.env.VITE_API_URL;

// Delt referenceværdi: en ny [] pr. render ville få hver forbruger til at
// genberegne sine segmenter ved hver eneste opdatering.
const EMPTY = Object.freeze([]);

let cache = null;
let inflight = null;

/** Kun til test/preview: glem den hentede liste. */
export function resetMentionableManagersCache() {
  cache = null;
  inflight = null;
}

async function fetchMentionableManagers() {
  const headers = await authHeaders({ json: false }); // ren GET, ingen body
  if (!headers || !API) throw new Error("no session");
  const res = await fetch(`${API}/api/forum/mentionable-managers`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.managers) ? data.managers : EMPTY;
}

function loadOnce() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetchMentionableManagers()
      .then((managers) => {
        cache = managers;
        return managers;
      })
      .catch((e) => {
        // console.warn, ikke console.error: e2e-suitens collectBrowserErrors
        // eskalerer console.error til hård test-fejl (#4309/#4305), og en
        // manglende hjælpeliste er ikke en fejl på fladen.
        console.warn("useMentionableManagers failed:", e?.message || e);
        // Cach ALDRIG en fejl: næste montering skal have lov at prøve igen.
        inflight = null;
        return EMPTY;
      });
  }
  return inflight;
}

export default function useMentionableManagers() {
  const [managers, setManagers] = useState(() => cache ?? EMPTY);

  useEffect(() => {
    if (cache) {
      setManagers(cache);
      return undefined;
    }
    let cancelled = false;
    loadOnce().then((list) => {
      if (!cancelled) setManagers(list);
    });
    return () => { cancelled = true; };
  }, []);

  return managers;
}
