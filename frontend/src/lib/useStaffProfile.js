// useStaffProfile — henter GET /api/club/staff/:id (fuld evne-matrix, EGET staff) +
// udleder hold-roster fra useFacilities til switcher-baren (#2220 A4b). Bruger SAMME
// auth-mønster som useFacilities.js: getSession() → Bearer-token →
// fetch(`${VITE_API_URL}/...`). Der findes ingen delt apiFetch-util i repoet —
// auth-headeren bygges inline.
//
// #2450: 404 fra club/staff/:id betyder "ikke ejet" (kontrakten er UÆNDRET — se
// facilityRoutesHandlers.js:167). I stedet for at vise "not found" falder vi
// tilbage til GET /api/staff/:id/public — candidate-niveau (overall/topSpecialization/
// tier), samme synlighed som staff-kandidater allerede viser før ansættelse. Status
// "public" markerer denne begrænsede visning så UI kan skjule den fulde evne-matrix.
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
        if (res.ok) {
          const body = await res.json();
          if (!alive) return;
          setProfile(body);
          setStatus("ok");
          return;
        }
        if (res.status !== 404) return setStatus("error");
        // Ikke ejet (eller ukendt) — prøv candidate-niveau public-profilen (#2450).
        const pubRes = await fetch(`${API}/api/staff/${staffId}/public`, { headers });
        if (!alive) return;
        if (pubRes.status === 403) return setStatus("forbidden");
        if (pubRes.status === 404) return setStatus("notfound");
        if (!pubRes.ok) return setStatus("error");
        const pubBody = await pubRes.json();
        if (!alive) return;
        // Normaliseret til SAMME profil-shape som owner-svaret (abilities.overall),
        // + topSpecialization på øverste niveau (candidate-niveau — ingen fuld matrix).
        setProfile({
          role: pubBody.role, tier: pubBody.tier, salary: pubBody.salary, name: pubBody.name,
          abilities: { overall: pubBody.overall },
          topSpecialization: pubBody.topSpecialization,
          teamId: pubBody.teamId, teamName: pubBody.teamName, division: pubBody.division,
        });
        setStatus("public");
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
