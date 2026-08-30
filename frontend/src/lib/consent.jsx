// ConsentProvider — Refs #3034.
//
// #3034: userId og consent_preferences kommer nu fra UserProfileProvider
// (delt context, ét Supabase-kald pr. session, se lib/userProfile.jsx) i
// stedet for providerens egen `.from("users").select("consent_preferences")`-
// opslag + egen onAuthStateChange-lytter. Skrivningerne (saveConsent, samt
// "upload local til DB"-grenen nedenfor) sker stadig direkte til DB som før,
// men opdaterer bagefter den delte cache via updateProfile() så andre
// forbrugere ikke sidder med en stale værdi.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { useUserProfile } from "./userProfile.jsx";

const STORAGE_KEY = "cz_consent_v1";
const CONSENT_VERSION = 1;

export const CONSENT_CATEGORIES = ["necessary", "analytics", "marketing", "email_marketing"];

const DEFAULT_DENIED = Object.freeze({
  version: CONSENT_VERSION,
  necessary: true,
  analytics: false,
  marketing: false,
  email_marketing: false,
  updated_at: null,
});

function nowIso() {
  return new Date().toISOString();
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    version: CONSENT_VERSION,
    necessary: true,
    analytics: raw.analytics === true,
    marketing: raw.marketing === true,
    email_marketing: raw.email_marketing === true,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return null;
    return normalize(JSON.parse(v));
  } catch {
    return null;
  }
}

function writeStored(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode / quota — runtime state still authoritative */ }
}

const ConsentContext = createContext(null);

export function ConsentProvider({ children }) {
  const [consent, setConsent] = useState(readStored);
  const [bannerOpen, setBannerOpen] = useState(() => readStored() === null);
  // #3034: userId + consent_preferences kommer fra den delte
  // UserProfileProvider i stedet for providerens egen session-lytter og eget
  // users-opslag (se filens toppe-kommentar).
  const { userId, profile, updateProfile } = useUserProfile();

  useEffect(() => {
    if (!userId) return;
    const remote = normalize(profile?.consent_preferences);
    const local = readStored();
    if (remote) {
      setConsent(remote);
      writeStored(remote);
      setBannerOpen(false);
    } else if (local) {
      let cancelled = false;
      (async () => {
        const { error } = await supabase
          .from("users")
          .update({ consent_preferences: local })
          .eq("id", userId);
        if (!cancelled && !error) updateProfile({ consent_preferences: local });
      })();
      return () => { cancelled = true; };
    }
  }, [userId, profile?.consent_preferences, updateProfile]);

  const saveConsent = useCallback(async (partial) => {
    const next = normalize({ ...(consent || DEFAULT_DENIED), ...partial, updated_at: nowIso() });
    setConsent(next);
    writeStored(next);
    setBannerOpen(false);
    if (userId) {
      const { error } = await supabase
        .from("users")
        .update({ consent_preferences: next })
        .eq("id", userId);
      // #3034 krav 3: eksplicit ændring — invalidér den delte cache med det
      // samme i stedet for at vente på næste auth-event/refetch.
      if (!error) updateProfile({ consent_preferences: next });
    }
    return next;
  }, [consent, userId, updateProfile]);

  const acceptAll = useCallback(() => saveConsent({ analytics: true, marketing: true, email_marketing: true }), [saveConsent]);
  const rejectAll = useCallback(() => saveConsent({ analytics: false, marketing: false, email_marketing: false }), [saveConsent]);

  const hasConsent = useCallback((category) => {
    if (category === "necessary") return true;
    if (!consent) return false;
    return consent[category] === true;
  }, [consent]);

  const value = useMemo(() => ({
    consent: consent || DEFAULT_DENIED,
    hasResponded: consent !== null,
    bannerOpen,
    openBanner: () => setBannerOpen(true),
    closeBanner: () => setBannerOpen(false),
    saveConsent,
    acceptAll,
    rejectAll,
    hasConsent,
  }), [consent, bannerOpen, saveConsent, acceptAll, rejectAll, hasConsent]);

  return (
    <ConsentContext.Provider value={value}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
