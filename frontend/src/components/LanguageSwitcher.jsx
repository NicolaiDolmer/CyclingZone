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

const OPTIONS = [
  { code: "da", flag: "dk", labelKey: "language.danish" },
  { code: "en", flag: "gb", labelKey: "language.english" },
];

// Estimeret menuhøjde (2 valg) til at vælge op/ned før menuen er målt.
const MENU_EST_HEIGHT = 88;
const GAP = 4;

export default function LanguageSwitcher({ className = "" }) {
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
    const openUp = spaceBelow < MENU_EST_HEIGHT && r.top > spaceBelow;
    setCoords({
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

  const active = OPTIONS.find((o) => o.code === language) ?? OPTIONS[1];

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
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-cz-2 hover:bg-cz-hover focus:outline-none focus:ring-2 focus:ring-cz-accent"
      >
        <span className={`fi fi-${active.flag}`} role="img" aria-hidden="true" />
        <span className="hidden sm:inline uppercase text-xs font-medium">{active.code}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true" className="opacity-60">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
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
              maxHeight: `calc(100vh - ${GAP * 2}px)`,
            }}
            className="z-50 min-w-[140px] overflow-y-auto rounded-md border border-cz-border bg-cz-card shadow-lg py-1"
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
                    className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 text-cz-1 hover:bg-cz-hover ${
                      selected ? "font-semibold" : ""
                    }`}
                  >
                    <span className={`fi fi-${opt.flag}`} role="img" aria-hidden="true" />
                    <span>{t(opt.labelKey)}</span>
                    {selected && (
                      <span className="ms-auto text-cz-accent" aria-hidden="true">✓</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}
