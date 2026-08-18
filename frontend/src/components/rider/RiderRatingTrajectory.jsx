// vk-movement-signals — trajektorie-sparkline til rytter-heroen:
// rating-udvikling denne sæson + kvalitativ label ("Rising/Steady/Declining
// this season"). Ren SVG-polyline (ingen chart-lib), samme minimale editorial-
// sprog som RiderValueTrendBadge (tynd linje/pil, ingen glow/baggrund/emoji).
//
// Ren præsentations-komponent — `trajectory` (array af { date, rating },
// kronologisk) og `trend` ("rising"|"declining"|"steady"|null) kommer allerede
// beregnet fra RiderStatsPage via lib/riderRatingTrajectory.js.
import { useTranslation } from "react-i18next";
import { formatDate } from "../../lib/intl.js";
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "../ui";

const TREND_ICON = { rising: ArrowUpIcon, declining: ArrowDownIcon, steady: MinusIcon };
const TREND_TONE = { rising: "text-cz-success", declining: "text-cz-danger", steady: "text-cz-3" };
// Sparkline-streg-farven følger samme tone som teksten via currentColor.

function Sparkline({ trajectory }) {
  const ratings = trajectory.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const w = 64;
  const h = 20;
  const pad = 2;
  // Flad linje (min===max) → vandret streg midt i boksen i stedet for div/0.
  const range = max - min || 1;
  const points = trajectory.map((p, i) => {
    const x = trajectory.length === 1 ? w / 2 : pad + (i / (trajectory.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.rating - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="flex-shrink-0" aria-hidden="true">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RiderRatingTrajectory({ trajectory, trend, className = "" }) {
  const { t } = useTranslation("rider");
  // < 2 punkter (intet trend) eller intet trajektorie → skjul helt, samme
  // "ingen data = ingen visning"-konvention som RiderValueTrendBadge.
  if (!trend || !trajectory?.length) return null;

  const Icon = TREND_ICON[trend];
  const tone = TREND_TONE[trend];
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  const delta = last.rating - first.rating;
  const deltaLabel = delta > 0 ? `+${delta}` : String(delta);
  const title = t("profile.hero.ratingTrendTitle", { value: deltaLabel, date: formatDate(first.date) });

  return (
    <span className={`inline-flex items-center gap-1.5 ${tone} ${className}`} title={title} data-testid="rider-rating-trajectory">
      <Sparkline trajectory={trajectory} />
      <span className="inline-flex items-center gap-0.5 font-mono font-semibold tabular-nums text-2xs">
        <Icon size={11} aria-hidden="true" />
        {t(`profile.hero.ratingTrend${trend[0].toUpperCase()}${trend.slice(1)}`)}
      </span>
    </span>
  );
}
