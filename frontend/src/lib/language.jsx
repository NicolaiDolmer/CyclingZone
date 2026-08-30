// LanguageProvider — Refs #410, #3034.
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
//
// #3034: DB-værdien og userId kommer nu fra UserProfileProvider (delt
// context, ét Supabase-kald pr. session, se lib/userProfile.jsx) i stedet
// for et selvstændigt `.from("users").select("language")`-opslag + egen
// onAuthStateChange-lytter her. setLanguage() skriver stadig direkte til DB
// (uændret), men opdaterer bagefter den delte cache via updateProfile() så
// andre forbrugere af contexten ikke sidder med en stale værdi.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
// #2045: importerer den DELTE i18next-SINGLETON direkte (samme objekt som
// main.jsx/entry-server.jsx initialiserer) i stedet for at læse `i18n` via
// react-i18next's useTranslation()-hook. react-i18next v17's useTranslation
// returnerer et NYT wrapper-objekt (Object.create-kopi) hver gang
// i18n.language ændrer sig (se node_modules/react-i18next/dist/es/
// useTranslation.js: `createI18nWrapper`) — bevidst, til andre formål, men det
// gør hook-returnerede `i18n` USTABIL som dependency-array-værdi. Enhver
// effekt der har den hook-returnerede `i18n` i sine deps genstarter derfor
// ved ETHVERT sprogskift, inklusive skift EFFEKTEN SELV forårsagede →
// selv-udløst løkke. Det direkte modul-import er den ÆGTE, permanent stabile
// instans, så deps-arrays der refererer til den opfører sig som forventet
// (aldrig som skjult proxy for `language`-state). Se sync-effekten nedenfor.
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "./supabase";
import { useUserProfile } from "./userProfile.jsx";

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
  // #2045: useTranslation() kaldes STADIG — men kun for dens ABONNEMENT, ikke
  // for dens `i18n`-reference. Hooken tilmelder komponenten react-i18next's
  // interne re-render ved 'languageChanged'; fjernes den, mister provideren sit
  // re-render i samme commit som i18next selv skifter sprog, og landing-
  // hydrationen brækker (React #418/#422/#425 — verificeret: testen fejler
  // deterministisk uden dette kald og passerer med det).
  //
  // Identiteten tages derimod fra modul-singletonen ovenfor, som er permanent
  // stabil. Det er den kombination der loeser #2045 UDEN at genindfoere
  // hydration-fejlen: stabil identitet i deps-arrays, bevaret abonnement.
  useTranslation();
  const [language, setLanguageState] = useState(() => normalizeLang(i18n.language));
  // #3034: userId + DB-sprogværdi kommer fra den delte UserProfileProvider
  // (ét Supabase-kald + én onAuthStateChange-lytter for hele app-træet) i
  // stedet for providerens egen session-lytter og eget users-opslag.
  const { userId, profile, updateProfile } = useUserProfile();

  // Hold providerens sprog i sync med i18next — også når skiftet kommer udefra
  // (main.jsx's deferred switch, pseudo-locale, direkte i18n.changeLanguage). Så
  // følger både <LanguageToggle> (aria-pressed) og <html lang> altid det aktive
  // sprog uden at hvert kald skal huske at opdatere provider-state manuelt.
  // Registreres FØR den deferrede switch nedenfor, så listeneren er på plads når
  // dét skift emitter 'languageChanged' (ellers ville provideren misse eventet og
  // vise EN-toggle mens teksten er dansk).
  //
  // #2045: `i18n` er nu det stabile modul-import (se import-kommentaren
  // ovenfor), så denne effekt kører reelt kun ved MOUNT — ikke ved hvert
  // sprogskift som den hook-returnerede `i18n` ville have forårsaget.
  useEffect(() => {
    const onLanguageChanged = (lng) => setLanguageState(normalizeLang(lng));
    i18n.on("languageChanged", onLanguageChanged);
    return () => i18n.off("languageChanged", onLanguageChanged);
  }, []);

  // Post-hydration sprog-skift (#landing-hydration): main.jsx tvinger EN under
  // landing-hydrationen (matcher den EN-prerendrede index.html) og beder os
  // skifte til den besøgendes sprog HER. Effekten kører FØRST efter hydrationen
  // er committet → et normalt re-render, ikke en hydration → ingen #418/#422/#425.
  // Kun mount: hint'et er en engangsværdi fra boot.
  useEffect(() => {
    if (deferredLanguage && i18n.language !== deferredLanguage) {
      i18n.changeLanguage(deferredLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bevidst engangs-hint fra boot; må ikke genkøre ved sprogskift (se #2045-noten nedenfor)
  }, []);

  // #2045 (in-app sprog-flimmer — rod-årsag): denne effekt kørte FØR med
  // `[i18n, language]` som dependency-array. To uafhængige mekanismer fik den
  // til at genstarte sig selv ved ETHVERT sprogskift — inklusive brugerens
  // EGET klik i <LanguageSwitcher>, som allerede skriver DB'en nedenfor i
  // setLanguage():
  //
  //   1. `language`-state ændrede sig ved skiftet → i deps-arrayet → effekten
  //      genstartede.
  //   2. Selv UDEN `language` i deps ville den hook-returnerede `i18n` fra
  //      react-i18next's useTranslation() OGSÅ ændre identitet ved hvert
  //      sprogskift (se import-kommentaren) → samme selv-udløste genstart.
  //
  // Hver genstart kaldte syncFromSession() PÅ NY — et helt uafhængigt
  // HTTP-opslag på users.language, uden nogen garanti for rækkefølge overfor
  // DB-skrivningen der lige var undervejs fra det samme klik. Landede
  // læsningen FØR skrivningen var committed (målt: ~32ms efter klikket),
  // læste den den GAMLE værdi og flippede UI'et tilbage til det forrige sprog
  // — synligt som "sprog skifter flere gange". Værre: den fejlagtige lokale
  // revert skrev IKKE til DB igen, så localStorage endte varigt i disharmoni
  // med DB → samme flip gentog sig ved NÆSTE sideload også.
  //
  // Fix: (a) importér den ÆGTE stabile i18n-singleton (ovenfor) i stedet for
  // hookens wrapper, og (b) lad denne effekt afhænge af den DB-værdi den
  // faktisk bruger — den skal kun køre ved mount og ved faktiske ændringer i
  // den delte profil-cache (login/logout/token-refresh, eller en anden
  // fanes/kildes sprogskift bagefter afspejlet via updateProfile), aldrig som
  // reaktion på sit eget resultat.
  //
  // #3034: DB-opslaget selv (og auth-lytningen der udløser det) er flyttet
  // til UserProfileProvider — denne effekt reagerer nu blot på
  // `profile.language`, som er den samme værdi som `row?.language` var før.
  useEffect(() => {
    if (!userId) return;
    const dbLang = profile?.language;
    if (dbLang && SUPPORTED.includes(dbLang) && dbLang !== normalizeLang(i18n.language)) {
      setLanguageState(dbLang);
      writeStored(dbLang);
      i18n.changeLanguage(dbLang);
    }
  }, [userId, profile?.language]);

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
        } else if (!error) {
          // #3034 krav 3: eksplicit ændring — invalidér den delte cache med
          // det samme i stedet for at vente på næste auth-event/refetch.
          updateProfile({ language: lng });
        }
      }
    },
    [userId, updateProfile]
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
