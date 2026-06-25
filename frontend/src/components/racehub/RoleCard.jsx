// Race Hub S5 (Lag 3) — klikbart rolle-kort, afløser rolle-dropdownen i RaceColumn.
// Viser rolle-titel + profil-bevidst hint (hvorfor rollen passer terrænet) og — for
// jæger-rollen — et udbruds-styrke-chip farvet via fit-temaet (navy/guld). Editorial,
// ingen rounded-2xl/glow/emoji/gradient. Hint-nøgler kommer fra roleHint (ren helper).
import { useTranslation } from "react-i18next";
import { roleHint, hunterBreakawayStrength } from "../../lib/roleHint.js";

// Udbruds-styrke → fit-temaets farver (samme palette som FitBar TIER_FILL): høj = guld
// accent, middel = cz-2, lav = cz-3, ingen = dæmpet kant. Holder signalet konsistent
// med suitability-baren spilleren allerede kender.
const STRENGTH_CLASS = {
  high: "bg-cz-accent/15 text-cz-accent-t border-cz-accent/40",
  medium: "bg-cz-subtle text-cz-2 border-cz-border",
  low: "bg-cz-subtle text-cz-3 border-cz-border",
  none: "bg-transparent text-cz-3 border-cz-border/60",
};

export default function RoleCard({ role, active, onClick, terrainBucket, disabled = false, profileType = null, finaleType = null }) {
  const { t } = useTranslation("races");
  const hint = roleHint(role, terrainBucket);
  if (!hint) return null;

  const strength = role === "hunter" ? hunterBreakawayStrength(profileType, finaleType) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-left rounded-cz border px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-cz-accent bg-cz-accent/10"
          : "border-cz-border bg-cz-card hover:border-cz-accent/50 hover:bg-cz-subtle"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>
          {t(hint.titleKey)}
        </span>
        {strength != null && (
          <span
            className={`text-[9px] uppercase tracking-wide px-1.5 py-px rounded border ${STRENGTH_CLASS[strength]}`}
            title={t("racehub.breakawayStrength.tooltip")}
          >
            {t("racehub.breakawayStrength.label")}: {t(`racehub.breakawayStrength.${strength}`)}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-cz-3 mt-0.5">{t(hint.descKey)}</p>
    </button>
  );
}
