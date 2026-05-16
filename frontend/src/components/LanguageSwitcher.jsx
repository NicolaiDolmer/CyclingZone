// LanguageSwitcher — Refs #410.
//
// 🇩🇰/🇬🇧 dropdown. Bruger flag-icons (gb/dk). Klik → live-skift via
// useLanguage().setLanguage; ingen reload. Tilgængelighed:
//   • aria-label på button og menupunkter
//   • Escape lukker
//   • aria-haspopup + aria-expanded
//
// Locale-koder: vi mapper 'en' → flag 'gb' (Storbritannien) per UX-konvention.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../lib/language";

const OPTIONS = [
  { code: "da", flag: "dk", labelKey: "language.danish" },
  { code: "en", flag: "gb", labelKey: "language.english" },
];

export default function LanguageSwitcher({ className = "" }) {
  const { t } = useTranslation("common");
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
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
    <div ref={wrapRef} className={`relative inline-block ${className}`}>
      <button
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
      {open && (
        <ul
          role="listbox"
          aria-label={t("language.label")}
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-md border border-cz-border bg-cz-card shadow-lg py-1"
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
        </ul>
      )}
    </div>
  );
}
