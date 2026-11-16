// #8081 / #6944: aldersfokus i akademiets profil (GET/PUT /api/academy/v2, kun bag kontakten).
//
// Valget gemmes sammen med resten af profilen (én ny række, samme 14-dages ur), så PUT sender
// hele profilen: { origins, types, ageFocus }. Selve vægtningen af ugens kandidater efter alder
// er ikke bygget; her gemmes og vises valget kun.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.ts";
import { authHeaders } from "../../lib/supabase.ts";

const API = import.meta.env.VITE_API_URL;

export interface AgeFocusValue { ageFocus: string | null; effectiveFrom: string }
export interface AgeFocusState {
  tier: number;
  unlocked: boolean;
  active: AgeFocusValue | null;
  pending: AgeFocusValue | null;
  options: string[];
  delayDays: number;
}
export interface ProfileWithAgeFocus { origins: string[]; types: string[]; ageFocus: string | null }
export type SaveResult = { ok: boolean; result?: { effectiveFrom?: string }; error?: string };

export function useAcademyAgeFocus(enabled: boolean): {
  state: AgeFocusState | null;
  loading: boolean;
  error: boolean;
  saveProfile: (profile: ProfileWithAgeFocus) => Promise<SaveResult>;
} {
  const [state, setState] = useState<AgeFocusState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const headers = await authHeaders();
    if (!headers) { setLoading(false); setError(true); return; }
    const res = await apiFetch(`${API}/api/academy/v2/age-focus`, { headers });
    const body = res.data as AgeFocusState | null;
    if (res.ok && body && Array.isArray(body.options)) {
      setState(body);
      setError(false);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = useCallback(async (profile: ProfileWithAgeFocus): Promise<SaveResult> => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    const res = await apiFetch(`${API}/api/academy/v2/profile`, {
      method: "PUT", headers, body: JSON.stringify(profile),
    });
    if (res.networkError) return { ok: false, error: "network" };
    const data = (res.data || {}) as { error?: string; effectiveFrom?: string };
    if (!res.ok) return { ok: false, error: data.error || "failed" };
    await load();
    return { ok: true, result: data };
  }, [load]);

  return { state, loading, error, saveProfile };
}
