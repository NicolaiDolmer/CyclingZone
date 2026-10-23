// LanguageSwitcher — Refs #410, #787.
//
// 🇩🇰/🇬🇧 dropdown. Bruger flag-icons (gb/dk). Klik → live-skift via
// useLanguage().setLanguage; ingen reload. Tilgængelighed:
//   • aria-label på button og menupunkter
//   • Escape lukker
//   • aria-haspopup + aria-expanded
//
// Menuen renderes i en portal med position:fixed og flipper opad når der
// ikke er plads nedenfor (fx i sidebar-footeren i bunden af skærmen, #787),
// så begge sprogvalg altid er synlige uanset placering/viewport. max-height +
// scroll er sidste sikkerhedsnet, så menuen aldrig kan vokse ud over skærmen.
//
// Locale-koder: vi mapper 'en' → flag 'gb' (Storbritannien) per UX-konvention.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../lib/language";
import { CheckIcon, ChevronDownIcon } from "./ui/icons/index.jsx";
// #5177 (afløser #2047): switcheren importerer IKKE længere flag-icons' sprite-CSS.
// #2047 flyttede den ud af main.jsx og ind her — men LanguageSwitcher hænger i
// sidehovedet (Layout.jsx, ikke lazy), så importen trak hele spritet (421 KB rå /
// 84,7 KB gzippet, ~260 landes data-URI'er) ind i ENTRY-chunkens CSS-graf og
// blokerede render på HVER side, inkl. `/`, `/login` og `/roadmap` som ikke viser
// et eneste rytter-flag. De to flag switcheren faktisk bruger er nu inline SVG.
// Flag.jsx beholder sprite-CSS'en (alle nationaliteter), og fordi ALLE dens
// forbrugere ligger bag lazy ruter, følger CSS'en nu rute-chunken.
import LanguageSwitcherFlag from "./LanguageSwitcherFlag.jsx";
// #4733: kode + flag kommer nu fra den ene sprog-konfigurationsfil i stedet
// for hardcodet her. LABEL_KEYS mapper code -> den eksisterende
// common.json-nøgle (language.danish/language.english er ordnøgler, ikke
// ISO-koder — et nyt sprog kræver en ny entry her OG en matchende nøgle i
// common.json for alle sprog). DISPLAY_ORDER holder den eksisterende visuelle
// rækkefølge (dansk øverst, engelsk nederst) uændret uanset rækkefølgen i
// LANGUAGES.
import { LANGUAGES } from "../i18n/languages.js";
// #7087: beta-sprog (LANGUAGES[].beta) er synlige for alle, med et Beta-maerke + en kort note.

const LABEL_KEYS = { da: "language.danish", en: "language.english" };
const DISPLAY_ORDER = ["da", "en"];
// Nye sprog uden plads i DISPLAY_ORDER sorteres sidst (#6802).
const orderOf = (code) => {
  const i = DISPLAY_ORDER.indexOf(code);
  return i === -1 ? DISPLAY_ORDER.length : i;
};
const toOptions = (languages) =>
  [...languages]
    .sort((a, b) => orderOf(a.code) - orderOf(b.code))
    .map((l) => ({ code: l.code, flag: l.flag, beta: l.beta === true, labelKey: LABEL_KEYS[l.code] ?? `language.${l.code}` }));
const OPTIONS = toOptions(LANGUAGES);
const HAS_BETA_OPTION = OPTIONS.some((o) => o.beta);

// Estimeret højde pr. valg til at vælge op/ned før menuen er målt; menuen
// vokser med antallet af valg, når beta-sprog vises (Codex #6812).
const MENU_ROW_EST_HEIGHT = 44;
const GAP = 4;

// surface="sidebar": knappen staar paa den moerke sidebar/topbar (ogsaa i lyst tema), saa den
// bruger sidebarens egne tekst-tokens. Lyse flader (login) beholder text-cz-2 (#6681, AA).
export default function LanguageSwitcher({ className = "", surface = "page" }) {
  const { t } = useTranslation("common");
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const estHeight = OPTIONS.length * MENU_ROW_EST_HEIGHT;
    const openUp = spaceBelow < estHeight && r.top > spaceBelow;
    setCoords({
      // Plads til menuen i den valgte retning, så de nederste valg aldrig ender uden for skærmen.
      maxHeight: Math.max(MENU_ROW_EST_HEIGHT, (openUp ? r.top : spaceBelow) - GAP * 2),
      right: Math.max(GAP, window.innerWidth - r.right),
      top: openUp ? null : r.bottom + GAP,
      bottom: openUp ? window.innerHeight - r.top + GAP : null,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    reposition();
    window.addEventListener("resize", reposition);
    // capture: fang også scroll i indre containere (sidebar/main)
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      const inBtn = btnRef.current && btnRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inBtn && !inMenu) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = OPTIONS.find((o) => o.code === language) ?? OPTIONS.find((o) => o.code === "en");

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.switchTooltip")}
        title={t("language.switchTooltip")}
        className={`inline-flex items-center gap-1.5 rounded-cz px-2 py-1 text-sm ${surface === "sidebar" ? "text-cz-sidebar-2 hover:bg-cz-sidebar-hover" : "text-cz-2 hover:bg-cz-subtle"} focus:outline-hidden focus:ring-2 focus:ring-cz-accent`}
      >
        <LanguageSwitcherFlag code={active.flag} />
        <span className="hidden sm:inline uppercase text-xs font-medium">{active.code}</span>
        <ChevronDownIcon className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>
      {open && coords &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label={t("language.label")}
            style={{
              position: "fixed",
              right: coords.right,
              top: coords.top ?? undefined,
              bottom: coords.bottom ?? undefined,
              maxHeight: coords?.maxHeight ? `${coords.maxHeight}px` : `calc(100vh - ${GAP * 2}px)`,
            }}
            // #2880: portaled to document.body, so it competes at the TOP-LEVEL
            // stacking context against everything else — including nav chrome
            // its own trigger button lives inside (desktop sidebar / mobile
            // drawer footer). A page-local z-dropdown isn't enough here: this
            // must always win over nav (z-nav) and any open drawer (z-overlay),
            // so it uses the same tier as a modal (the closest "always on top,
            // no matter what surrounds the trigger" semantic).
            className="z-modal min-w-[140px] max-w-[240px] overflow-y-auto rounded-cz border border-cz-border bg-cz-card shadow-lg py-1"
          >
            {OPTIONS.map((opt) => {
              const selected = opt.code === language;
              return (
                <li key={opt.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setLanguage(opt.code);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 text-cz-1 hover:bg-cz-subtle ${
                      selected ? "font-semibold" : ""
                    }`}
                  >
                    <LanguageSwitcherFlag code={opt.flag} />
                    <span>{t(opt.labelKey)}</span>
                    {opt.beta && (
                      <span className="rounded-cz border border-cz-border px-1 text-[10px] font-medium uppercase tracking-wide text-cz-2">
                        {t("language.betaBadge")}
                      </span>
                    )}
                    {selected && (
                      <CheckIcon className="ms-auto w-3.5 h-3.5 text-cz-accent" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
            {HAS_BETA_OPTION && (
              <li role="presentation" className="mt-1 border-t border-cz-border px-3 pt-1.5 pb-1 text-xs text-cz-2">
                {t("language.betaNote")}
              </li>
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
