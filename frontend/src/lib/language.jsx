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

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(lng) {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* localStorage may be unavailable (private mode, quota) — sprog persisterer
       stadig i DB hvis bruger er logged in */
  }
}

export function LanguageProvider({ children }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState(
    () => readStored() || i18n.language?.split("-")[0] || DEFAULT
  );
  const [userId, setUserId] = useState(null);

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
