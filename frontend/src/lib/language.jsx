// LanguageProvider — Refs #410.
//
// Centraliserer brugerens UI-sprog: les fra DB (users.language) ved login,
// persisterer i localStorage så pre-login (Login/Signup) sider også
// husker valget, og holder i18next i sync.
//
// Sprog-prioritet (initial mount):
//   1. DB users.language (hvis logged in)
//   2. localStorage 'cz_lang'
//   3. navigator.language (browser-detect via i18next)
//   4. fallbackLng 'en'
//
// setLanguage(lng):
//   • Skriver DB hvis logged in (Postgres-trigger synker til auth-meta)
//   • Skriver localStorage (overlever logout)
//   • i18n.changeLanguage(lng) (live, ingen reload)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabase";

const STORAGE_KEY = "cz_lang";
const SUPPORTED = ["en", "da"];
const DEFAULT = "en";

const LanguageContext = createContext(null);

// i18next er kilden til det aktive UI-sprog: LanguageDetector har allerede
// resolvet localStorage(cz_lang) → navigator → fallback ved init, så vi afleder
// providerens sprog fra i18n.language i stedet for at læse cz_lang igen (dobbelt-
// læsning kunne divergere fra i18n under landing-hydrationens tvungne EN-vindue).
function normalizeLang(lng) {
  const base = (lng || "").split("-")[0];
  return SUPPORTED.includes(base) ? base : DEFAULT;
}

function writeStored(lng) {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* localStorage may be unavailable (private mode, quota) — sprog persisterer
       stadig i DB hvis bruger er logged in */
  }
}

export function LanguageProvider({ children, deferredLanguage = null }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState(() => normalizeLang(i18n.language));
  const [userId, setUserId] = useState(null);

  // Hold providerens sprog i sync med i18next — også når skiftet kommer udefra
  // (main.jsx's deferred switch, pseudo-locale, direkte i18n.changeLanguage). Så
  // følger både <LanguageToggle> (aria-pressed) og <html lang> altid det aktive
  // sprog uden at hvert kald skal huske at opdatere provider-state manuelt.
  // Registreres FØR den deferrede switch nedenfor, så listeneren er på plads når
  // dét skift emitter 'languageChanged' (ellers ville provideren misse eventet og
  // vise EN-toggle mens teksten er dansk).
  useEffect(() => {
    const onLanguageChanged = (lng) => setLanguageState(normalizeLang(lng));
    i18n.on("languageChanged", onLanguageChanged);
    return () => i18n.off("languageChanged", onLanguageChanged);
  }, [i18n]);

  // Post-hydration sprog-skift (#landing-hydration): main.jsx tvinger EN under
  // landing-hydrationen (matcher den EN-prerendrede index.html) og beder os
  // skifte til den besøgendes sprog HER. Effekten kører FØRST efter hydrationen
  // er committet → et normalt re-render, ikke en hydration → ingen #418/#422/#425.
  // Kun mount: hint'et er en engangsværdi fra boot.
  useEffect(() => {
    if (deferredLanguage && i18n.language !== deferredLanguage) {
      i18n.changeLanguage(deferredLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncFromSession() {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      if (!uid) return;

      const { data: row } = await supabase
        .from("users")
        .select("language")
        .eq("id", uid)
        .single();
      if (cancelled) return;
      const dbLang = row?.language;
      if (dbLang && SUPPORTED.includes(dbLang) && dbLang !== language) {
        setLanguageState(dbLang);
        writeStored(dbLang);
        i18n.changeLanguage(dbLang);
      }
    }

    syncFromSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) syncFromSession();
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [i18n, language]);

  // #2039: bind <html lang> til det aktive UI-sprog APP-BREDT. Uden dette beholdt
  // app-ruterne (som ikke kalder useDocumentHead) index.html's statiske default
  // mens indholdet er engelsk → Chrome auto-oversætter mismatchet → DOM-mutation →
  // React insertBefore/removeChild-crash (CYCLINGZONE-1P m.fl.). Sætter lang ved
  // hvert sprogskift, så translate-triggeren forsvinder for hele appen.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback(
    async (lng) => {
      if (!SUPPORTED.includes(lng)) return;
      setLanguageState(lng);
      writeStored(lng);
      i18n.changeLanguage(lng);
      if (userId) {
        const { error } = await supabase
          .from("users")
          .update({ language: lng })
          .eq("id", userId);
        if (error && import.meta.env.DEV) {
          console.warn("[language] DB-update failed:", error.message);
        }
      }
    },
    [i18n, userId]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, supported: SUPPORTED }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
