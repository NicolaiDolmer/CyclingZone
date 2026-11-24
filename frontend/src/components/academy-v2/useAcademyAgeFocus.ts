// #8081 / #6944: aldersfokus i akademiets profil (GET/PUT /api/academy/v2, kun bag kontakten).
//
// Valget gemmes sammen med resten af profilen (én ny række, samme 14-dages ur), så PUT sender
// hele profilen: { origins, types, ageFocus }. Ugens træk bruger det aktive valg.
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
  refresh: () => Promise<boolean>;
} {
  const [state, setState] = useState<AgeFocusState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  // Returnerer om hentningen lykkedes. `keepOnFailure` (genhentning efter et gemt valg): en
  // fejlet genhentning må ikke skjule profilen bag "intet blev ændret", for gemmet LYKKEDES.
  const load = useCallback(async ({ keepOnFailure = false }: { keepOnFailure?: boolean } = {}): Promise<boolean> => {
    if (!enabled) return false;
    const headers = await authHeaders();
    const res = headers ? await apiFetch(`${API}/api/academy/v2/age-focus`, { headers }) : null;
    const body = (res?.data ?? null) as AgeFocusState | null;
    const ok = Boolean(res?.ok && body && Array.isArray(body.options));
    if (ok) {
      setState(body);
      setError(false);
    } else if (!keepOnFailure) {
      setError(true);
    }
    setLoading(false);
    return ok;
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = useCallback(async (profile: ProfileWithAgeFocus): Promise<SaveResult> => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    const res = await apiFetch(`${API}/api/academy/v2/profile`, {
      method: "PUT", headers, body: JSON.stringify(profile),
    });
    if (res.networkError) return { ok: false, error: "network" };
    const data = (res.data || {}) as { error?: string; effectiveFrom?: string; ageFocus?: string | null };
    if (!res.ok) return { ok: false, error: data.error || "failed" };
    const refreshed = await load({ keepOnFailure: true });
    // Codex-fund: genhentningen fejlede, men gemmet står. Vis det ventende valg fra PUT-svaret.
    if (!refreshed && data.effectiveFrom) {
      const pending: AgeFocusValue = { ageFocus: data.ageFocus ?? null, effectiveFrom: data.effectiveFrom };
      setState((prev) => (prev ? { ...prev, pending } : prev));
    }
    return { ok: true, result: data };
  }, [load]);

  return { state, loading, error, saveProfile, refresh: load };
}
