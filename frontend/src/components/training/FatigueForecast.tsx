// FatigueForecast — "Fatigue tonight: approx. X" / "Træthed i aften: ca. X"
// (#5933, ejer-beslutning 7, 29/9; mockup afsnit 4).
//
// ET tal pr. rytter, ikke pr. felt. Tallet og farvebaandet kommer fra serveren
// (GET /api/training/programs/forecast), som regner med aftenopgoerelsens egne
// funktioner (invariant I5). Fladen viser ingen formel og ingen graense-tal:
// baandet siger "frisk", "traet" eller "over skadegraensen".
//
// TASTE: hairline, ingen skygge, tabular figures, tekst + farve (aldrig kun
// farve), ingen ikoner.

import { useTranslation } from "react-i18next";
import { forecastTone, type ForecastEntry } from "./FatigueForecastData.ts";

const TONE_TEXT = { ok: "text-cz-success", warn: "text-cz-warning", risk: "text-cz-danger" } as const;
const TONE_FILL = { ok: "bg-cz-success", warn: "bg-cz-warning", risk: "bg-cz-danger" } as const;

export default function FatigueForecast({
  entry,
  settled = false,
  className = "",
}: {
  entry: ForecastEntry | null | undefined;
  settled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("training");
  if (!entry || !Number.isFinite(entry.fatigue)) return null;
  const tone = forecastTone(entry);
  const value = Math.round(entry.fatigue);
  const bandText = t(`forecast.band_${tone}`);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      data-testid="fatigue-forecast"
      data-band={tone}
      aria-label={t(settled ? "forecast.ariaSettled" : "forecast.aria", { value, band: bandText })}
      role="status"
    >
      <span className="font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">{t("forecast.label")}</span>
      <span className="font-data text-[13px] font-semibold tabular-nums text-cz-1" aria-hidden="true">
        {settled ? value : t("forecast.value", { value })}
      </span>
      <span className="relative h-1.5 w-12 flex-none overflow-hidden rounded-cz-pill bg-cz-subtle" aria-hidden="true">
        <span className={`absolute inset-y-0 start-0 rounded-cz-pill ${TONE_FILL[tone]}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`text-xs font-medium ${TONE_TEXT[tone]}`} aria-hidden="true">{bandText}</span>
    </div>
  );
}
