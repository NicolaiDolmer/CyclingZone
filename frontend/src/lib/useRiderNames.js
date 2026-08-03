// useRiderNames — lazy batch-opslag af rytternavne ud fra rider_id-referencer
// (POST /api/riders/names), cached for hookens levetid. Udtrukket fra
// ScoutingCentralPage (#2244 Fase 3 Slice C) til en delt hook (#3203) så
// StaffScoutHistoryTab (spejder-historik) kan genbruge samme opslag uden
// duplikeret fetch-logik.
//
// Bruges hvor en flade kun kender rider_id (aldrig potentiale) og skal vise
// et visningsnavn — samme mønster begge steder: samlet unikt id-array ind,
// { [id]: name|null } ud, ny-tilkomne id'er hentes lazily uden at gen-fetche
// allerede-kendte.
import { useState, useEffect, useRef } from "react";
import { getSession } from "./supabase";

const API = import.meta.env.VITE_API_URL;

export function useRiderNames(ids) {
  const [names, setNames] = useState({});
  const requestedRef = useRef(new Set());

  useEffect(() => {
    const toFetch = (ids ?? []).filter((id) => id && !requestedRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => requestedRef.current.add(id));
    (async () => {
      const { data } = await getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const fetched = Object.fromEntries(toFetch.map((id) => [id, null]));
      try {
        const res = await fetch(`${API}/api/riders/names`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toFetch }),
        });
        if (res.ok) {
          const { riders } = await res.json();
          for (const r of riders ?? []) fetched[r.id] = r.name ?? null;
        }
      } catch {
        // navne forbliver null → UI viser fallback-label
      }
      setNames((prev) => ({ ...prev, ...fetched }));
    })();
  }, [ids]);

  return names;
}
