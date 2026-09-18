import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";

/**
 * Læs admin-svarets JSON-krop, uanset om kaldstedet brugte et rå `fetch()` eller
 * `apiFetch` (#5242).
 *
 * Helperen kaldes 50+ steder på admin-fladen, og migreringen til apiFetch sker i
 * skiver — så den skal kunne tage BEGGE former mens de to eksisterer side om
 * side. Et apiFetch-resultat er et almindeligt objekt (`{ ok, status, data }`)
 * uden `json()`-metode og har ALLEREDE parset kroppen; den giver `data: null`
 * ved 401/429, transportfejl og ved et tomt eller ikke-JSON svar — nøjagtig de
 * tilfælde `.catch(() => ({}))` dækkede for det rå Response. Tilstedeværelsen af
 * `json` er derfor den eneste skelnen der behøves, og begge veje ender i det
 * samme: et objekt, aldrig en kastet parse-fejl.
 */
export async function readAdminJson(res) {
  if (res && typeof res.json !== "function") return res.data ?? {};
  return res.json().catch(() => ({}));
}

export function adminErrorMessage(data, res, fallback = "Forbindelsen fejlede") {
  return data?.error || data?.message || (res?.status ? `HTTP ${res.status}` : fallback);
}

export function useAdminAuth() {
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const timeoutRef = useRef(null);

  const getAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  }, []);

  const showMsg = useCallback((text, type = "success") => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMsg({ text, type });
    timeoutRef.current = setTimeout(() => {
      setMsg({ text: "", type: "success" });
      timeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { getAuth, showMsg, msg };
}
