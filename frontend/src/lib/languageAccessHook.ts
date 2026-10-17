// useBetaLanguageAccess — Refs #6802.
//
// Afgoer (asynkront, cachet pr. bruger) om viewer er ejer eller beta-tester, saa
// sprogvaelgeren kan vise skjulte beta-sprog. Returnerer:
//   • false  — der er INGEN registrerede beta-sprog (i dag) => intet netvaerkskald
//   • null   — ikke afgjort endnu (eller ikke logget ind) => behandles som "nej"
//   • true / false — afgjort for den indloggede bruger
// Fail-closed: et fejlet kald giver false, aldrig true.

import { useEffect, useState } from "react";
import { supabase } from "./supabase.ts";
import { apiFetch } from "./apiFetch.ts";
import { useUserProfile } from "./userProfile.jsx";
import { HAS_BETA_LANGS } from "../i18n/languages.js";
import { hasBetaLanguageAccess } from "./languageAccess.ts";

const API = import.meta.env.VITE_API_URL;

// userId -> Promise<boolean | null>. Layout monterer flere vaelgere (sidebar +
// mobil); de skal dele ET opslag.
const cache = new Map<string, Promise<boolean | null>>();

async function fetchAccess(token: string, isAdmin: boolean): Promise<boolean> {
  const headers = { Authorization: `Bearer ${token}` };
  let isBetaTester = false;
  let isOwner = false;
  try {
    const res = await apiFetch(`${API}/api/me/beta-access`, { headers }, { source: "language-beta-access" });
    isBetaTester = res.ok && (res.data as { is_beta_tester?: unknown } | null)?.is_beta_tester === true;
  } catch {
    // best-effort: ingen adgang er den sikre retning
  }
  if (isAdmin && !isBetaTester) {
    try {
      const res = await apiFetch(`${API}/api/admin/owner-check`, { headers }, { source: "language-owner-check" });
      isOwner = res.ok && (res.data as { isOwner?: unknown } | null)?.isOwner === true;
    } catch {
      // best-effort
    }
  }
  return hasBetaLanguageAccess({ isBetaTester, isOwner });
}

export function useBetaLanguageAccess(): boolean | null {
  const { userId, profile } = useUserProfile() as {
    userId: string | null;
    profile: { role?: string } | null;
  };
  const [access, setAccess] = useState<boolean | null>(HAS_BETA_LANGS ? null : false);
  const isAdmin = profile?.role === "admin";
  const profileReady = Boolean(profile);

  useEffect(() => {
    if (!HAS_BETA_LANGS) return undefined;
    if (!userId || !profileReady) {
      setAccess(null);
      return undefined;
    }
    let cancelled = false;
    let pending = cache.get(userId);
    if (!pending) {
      pending = supabase.auth.getSession().then(({ data }) => {
        const token = data?.session?.access_token;
        return token ? fetchAccess(token, isAdmin) : null;
      });
      cache.set(userId, pending);
    }
    pending.then((result) => {
      if (cancelled) return;
      if (result === null) cache.delete(userId);
      setAccess(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, profileReady, isAdmin]);

  return access;
}
