import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function StaffSwitcherBar({ current, roster, onNavigate }) {
  const { t } = useTranslation("staff");
  const idx = roster.findIndex((r) => r.id === current);
  const prev = idx > 0 ? roster[idx - 1] : null;
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && prev) onNavigate(prev.id);
      if (e.key === "ArrowRight" && next) onNavigate(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onNavigate]);

  if (roster.length <= 1) return null;
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between py-2 text-[12px] text-cz-2">
      <button type="button" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}
        className={`${prev ? "text-cz-1" : "opacity-30"}`}>
        ‹ {prev ? t(`roles.${prev.role}`) : ""}
      </button>
      <span className="uppercase tracking-wide text-cz-3">{t("switcher.count", { index: idx + 1, total: roster.length })}</span>
      <button type="button" disabled={!next} onClick={() => next && onNavigate(next.id)}
        className={`${next ? "text-cz-1" : "opacity-30"}`}>
        {next ? t(`roles.${next.role}`) : ""} ›
      </button>
    </div>
  );
}
