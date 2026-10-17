// useBetaLanguageAccess — Refs #6802.
//
// Afgoer (asynkront, cachet pr. bruger) om viewer er ejer eller beta-tester, saa
// sprogvaelgeren kan vise skjulte beta-sprog. Returnerer:
//   • false  — der er INGEN registrerede beta-sprog (i dag) => intet netvaerkskald
//   • null   — ikke afgjort endnu (eller ikke logget ind) => behandles som "nej"
//   • true / false — afgjort for den indloggede bruger
// Fail-closed: et fejlet kald giver null (skjuler beta-valg), aldrig true og
// aldrig false (false ruller et beta-sprog tilbage og overskriver det gemte sprog).

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

// null = opslaget fejlede (429/5xx/netvaerk) og siger INTET om adgangen. Det maa
// aldrig laeses som "afvist": sprogvaelgeren ruller et beta-sprog tilbage ved
// false, og det skriver spillerens gemte sprog. null skjuler blot beta-valgene
// og proever igen ved naeste mount (cachen rydes, se hooken).
async function fetchAccess(token: string, isAdmin: boolean): Promise<boolean | null> {
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const res = await apiFetch(`${API}/api/me/beta-access`, { headers }, { source: "language-beta-access" });
    if (!res.ok) return null;
    if ((res.data as { is_beta_tester?: unknown } | null)?.is_beta_tester === true) {
      return hasBetaLanguageAccess({ isBetaTester: true });
    }
    if (!isAdmin) return hasBetaLanguageAccess({ isBetaTester: false });
    const owner = await apiFetch(`${API}/api/admin/owner-check`, { headers }, { source: "language-owner-check" });
    if (!owner.ok) return null;
    return hasBetaLanguageAccess({
      isBetaTester: false,
      isOwner: (owner.data as { isOwner?: unknown } | null)?.isOwner === true,
    });
  } catch {
    return null;
  }
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
