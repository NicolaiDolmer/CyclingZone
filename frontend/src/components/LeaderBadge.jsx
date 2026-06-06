import { useTranslation } from "react-i18next";

/**
 * Maillot jaune signal — "gold = the leader" (#481 PF2, variant B).
 * A small gold jersey chip placed next to the rank-1 team in any competition
 * standings. Gold is a FILL with dark text, so it's WCAG-safe on both canvases
 * (unlike gold-as-foreground). Co-exists with the green/red promotion/relegation
 * zone bars — it never overrides them.
 */
export default function LeaderBadge({ className = "" }) {
  const { t } = useTranslation("common");
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide
        px-1.5 py-0.5 rounded-full ${className}`}
      style={{ backgroundColor: "#e8c547", color: "#1a1f38" }}
      title={t("leaderBadge")}
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
        <path d="M8 3 4 6l1.6 2.4L7 7.4V21h10V7.4l1.4 1L20 6l-4-3-1.2.9a2.8 2.8 0 0 1-5.6 0L8 3z" />
      </svg>
      {t("leaderBadge")}
    </span>
  );
}
