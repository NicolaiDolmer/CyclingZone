// useStaffProfile — henter GET /api/club/staff/:id + udleder hold-roster fra
// useFacilities til switcher-baren (#2220 A4b). Bruger SAMME auth-mønster som
// useFacilities.js: getSession() → Bearer-token → fetch(`${VITE_API_URL}/...`).
// Der findes ingen delt apiFetch-util i repoet — auth-headeren bygges inline.
import { useState, useEffect } from "react";
import { getSession } from "./supabase.js";
import { useFacilities } from "./useFacilities.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useStaffProfile(staffId) {
  const facs = useFacilities(); // giver roster (facilities[].staff) til switcher
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      const headers = await authHeaders();
      if (!alive) return;
      if (!headers) return setStatus("forbidden");
      try {
        const res = await fetch(`${API}/api/club/staff/${staffId}`, { headers });
        if (!alive) return;
        if (res.status === 403) return setStatus("forbidden");
        if (res.status === 404) return setStatus("notfound");
        if (!res.ok) return setStatus("error");
        const body = await res.json();
        if (!alive) return;
        setProfile(body);
        setStatus("ok");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [staffId]);

  // Roster = holdets besatte staff (til ‹ forrige · næste ›), i facilitets-rækkefølge.
  const roster = (facs.facilities || [])
    .map((f) => f.staff && { id: f.staff.id, role: f.track, name: f.staff.name })
    .filter(Boolean);

  return { profile, roster, status, facilitiesLoading: facs.loading };
}
