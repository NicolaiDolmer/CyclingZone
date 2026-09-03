// #4649 · Offentligt Founder-maerke (Pro v1.1, del A). Kalder den public-safe
// RPC (database/2026-09-03-4649-founder-public.sql) ÉN gang pr. session og
// deler resultatet mellem alle komponenter, der viser maerket (Stilling,
// holdside, forum) -- ingen af dem skal betale for sin egen rundtur.
//
// Cache er module-scoped med vilje: Founder-listen aendrer sig sjaeldent
// (kun ved nye koeb), saa en enkelt in-memory-cache pr. sideindlaesning er
// rigelig -- ingen realtime-subscription, ingen TTL.

import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

let cachedPromise = null;
// Loftet (FOUNDER_SEAT_CAP=50, backend/lib/founderSeats.js) — samme offentlige
// endpoint ProUpgradePage.jsx allerede bruger til sin seat-counter, genbrugt
// her så "Founder supporter no. N of 50" ikke hardkoder et tal der kan drifte.
let cachedCapPromise = null;

function fetchFounderMap() {
  if (!cachedPromise) {
    cachedPromise = supabase
      .rpc("founder_public_list")
      .then(({ data, error }) => {
        if (error) throw error;
        const map = new Map();
        for (const row of data ?? []) map.set(row.team_id, row.founder_number);
        return map;
      })
      .catch(() => {
        // Fejl må ikke vælte badge-visning — næste mount prøver igen.
        cachedPromise = null;
        return new Map();
      });
  }
  return cachedPromise;
}

function fetchFounderCap() {
  if (!cachedCapPromise) {
    const API = import.meta.env.VITE_API_URL || "";
    cachedCapPromise = fetch(`${API}/api/billing/founder-seats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.cap ?? 50)
      .catch(() => {
        cachedCapPromise = null;
        return 50;
      });
  }
  return cachedCapPromise;
}

// Returnerer { founderMap, founderCap, loading }. founderMap: Map<team_id, founder_number>.
export function useFounderTeams() {
  const [founderMap, setFounderMap] = useState(null);
  const [founderCap, setFounderCap] = useState(50);

  useEffect(() => {
    let cancelled = false;
    fetchFounderMap().then((map) => {
      if (!cancelled) setFounderMap(map);
    });
    fetchFounderCap().then((cap) => {
      if (!cancelled) setFounderCap(cap);
    });
    return () => { cancelled = true; };
  }, []);

  return { founderMap: founderMap ?? new Map(), founderCap, loading: founderMap === null };
}

// Bekvem enkelt-opslags-udgave for komponenter der kun har brug for ét nummer.
export function useFounderNumber(teamId) {
  const { founderMap, founderCap, loading } = useFounderTeams();
  const founderNumber = teamId ? founderMap.get(teamId) ?? null : null;
  return { founderNumber, founderCap, loading };
}
