// useStaffRelease — #2649: opsig EGET staff mod severance (4×ugentlig løn) fra
// staff-profil/-oversigt. Samme auth-mønster som useFacilities.js/useStaffProfile.js
// (getSession() → Bearer-token, ingen delt apiFetch-util i repoet).
import { useCallback, useState } from "react";
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi

const API = import.meta.env.VITE_API_URL;

export function useStaffRelease() {
  const [busy, setBusy] = useState(false);

  const release = useCallback(async (staffId) => {
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) return { ok: false, error: "auth" };
      const res = await fetch(`${API}/api/club/staff/${staffId}/release`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed", severance: data.severance, balance: data.balance };
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, []);

  return { release, busy };
}
