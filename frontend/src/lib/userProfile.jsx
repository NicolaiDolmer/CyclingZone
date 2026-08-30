// UserProfileProvider — Refs #3034.
//
// Samler de spredte enkeltvise `users`-opslag (language, role, username,
// consent_preferences) i ÉT Supabase-kald pr. session, cachet i context.
// LanguageProvider, ConsentProvider og Layout læser herfra i stedet for hver
// at lave sit eget opslag ved hver sideload.
//
// Skal ligge OVER både ConsentProvider og LanguageProvider i AppProviders.jsx
// (de to læser fra denne context — omvendt rækkefølge giver en kreds).
//
// NB: #3034-scope dækker kun disse tre forbrugere. Seks andre steder
// (ProfilePage, ForumPage, ForumPostPage, AdminFairplayPage, AdminGrowthPage,
// AdminValueTransitionPage) har stadig deres egne isolerede `role`-opslag —
// bevidst efterladt urørt i denne PR (se PR-beskrivelsen for begrundelse).
//
// Invalidering:
//   - login/logout/token-refresh: onAuthStateChange nedenfor refetcher. Ved
//     logout ryddes cachen SYNKRONT (shouldClearProfileOnAuthChange), så en
//     ny bruger på samme faneblad aldrig kan nå at se forrige brugers
//     rolle/username i et stale render mens den nye fetch afventer (krav 4).
//   - eksplicitte ændringer (sprogskift i language.jsx, consent-gem i
//     consent.jsx): forbrugeren skriver til DB som hidtil og kalder derefter
//     updateProfile(patch) for at opdatere cachen optimistisk uden en ekstra
//     DB-læsning (krav 3).
//
// Rolle-ændringer skrives IKKE af klienten selv i dag (kun backendens
// admin/users/:id-endpoint skriver andre brugeres role — se PR-body for
// sikkerheds-fundet). Cachen for den nuværende bruger opdateres derfor kun
// via auth-events (fx TOKEN_REFRESHED efter en admin-handling), ikke via en
// dedikeret "rolle ændret"-skrivesti i denne klient.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { PROFILE_COLUMNS, shouldClearProfileOnAuthChange, mergeProfilePatch } from "./userProfileCache.js";

// Re-eksporteret for bagudkompatibilitet/bekvemmelighed for forbrugere der
// allerede importerer fra "./userProfile.jsx" — selve logikken bor i
// userProfileCache.js (ren, .js — importerbar af node:test uden JSX-transform).
export { PROFILE_COLUMNS, shouldClearProfileOnAuthChange, mergeProfilePatch };

const UserProfileContext = createContext(null);

export function UserProfileProvider({ children }) {
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select(PROFILE_COLUMNS)
      .eq("id", uid)
      .single();
    setLoading(false);
    if (!error) setProfile(data || null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      fetchProfile(uid);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      // #3034 krav 4: ryd cachen SYNKRONT (samme tick som setUserId) i stedet
      // for at vente på at fetchProfile(uid)'s "uid mangler"-gren rammer samme
      // resultat asynkront — ellers kunne et render nå at ske imellem med
      // forrige brugers profile stadig i state.
      if (shouldClearProfileOnAuthChange(uid)) setProfile(null);
      fetchProfile(uid);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  const updateProfile = useCallback((patch) => {
    setProfile((prev) => mergeProfilePatch(prev, patch));
  }, []);

  const refreshProfile = useCallback(() => fetchProfile(userId), [fetchProfile, userId]);

  const value = { userId, profile, loading, updateProfile, refreshProfile };

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}
