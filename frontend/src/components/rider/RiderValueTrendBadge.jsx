// #2499 — værdi-bevægelse skal kunne SES: kompakt delta-indikator (pil + beløb)
// til steder hvor market_value allerede vises (rytterprofil-hero, holdliste).
//
// Ren præsentations-komponent — `windowData` kommer allerede beregnet fra
// backend (GET/POST /api/riders/.../value-trend, valgt via pickBestValueTrendWindow).
// Fog-gate (#2499 accept): viser KUN total-deltaet, aldrig modellens komponenter.
// Editorial/anti-AI-slop: tekst + tynd pil, ingen glow/badge-baggrund/emoji.
import { useTranslation } from "react-i18next";
import { formatNumber, formatDate } from "../../lib/intl.js";
import { valueTrendDirection } from "../../lib/riderValueTrend.js";
import { ArrowUpIcon, ArrowDownIcon } from "../ui";

export default function RiderValueTrendBadge({ window: windowData, size = "sm", className = "" }) {
  const { t } = useTranslation("rider");
  const direction = valueTrendDirection(windowData);
  // #2499: intet vindue ELLER et afrundet 0-delta → ingen pil-støj, bare skjul.
  if (!windowData || direction === "flat") return null;

  const Icon = direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  const tone = direction === "up" ? "text-cz-success" : "text-cz-danger";
  const iconSize = size === "xs" ? 10 : 12;
  const textSize = size === "xs" ? "text-[10px]" : "text-[11px]";
  const value = formatNumber(windowData.delta, { signDisplay: "exceptZero" });
  const label = t("profile.hero.valueTrend", { value, days: windowData.actualDaysAgo });
  const title = t("profile.hero.valueTrendTitle", { date: formatDate(windowData.snapshotDate) });

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono font-semibold tabular-nums ${textSize} ${tone} ${className}`}
      title={title}
      data-testid="rider-value-trend"
    >
      <Icon size={iconSize} aria-hidden="true" />
      {label}
    </span>
  );
}
