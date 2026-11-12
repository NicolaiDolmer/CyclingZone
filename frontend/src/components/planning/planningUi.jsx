// #7535 · Smaa faelles dele til planlaegningssiden: etape-stribe, klar-maerke og datoformat.
// Alle farver og ikoner kommer fra spillets egne komponenter (TerrainTypeGlyph, statusBadgeClass).
import { useTranslation } from "react-i18next";
import TerrainTypeGlyph from "../race/TerrainTypeGlyph.jsx";
import { statusBadgeClass } from "../ui/badgeStyles.js";

const READINESS_TONE = { ready: "won", missing: "closing", locked: "info", withdrawn: "info" };

/** Kort dato ("Mon 2 Nov") ud fra en Europe/Copenhagen-dato (YYYY-MM-DD). */
export function formatShortDate(date, language, withWeekday = true) {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(language, {
      ...(withWeekday ? { weekday: "short" } : {}),
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

/** Et loebs rutetyper som en raekke af spillets terraen-ikoner (et ikon for et endagsloeb). */
export function StageStrip({ types, max = 8, size = 13, className = "" }) {
  if (!types?.length) return null;
  const shown = types.slice(0, max);
  const extra = types.length - shown.length;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} data-testid="stage-strip">
      {shown.map((type, i) => (
        <TerrainTypeGlyph key={`${i}-${type}`} profileType={type} size={size} />
      ))}
      {extra > 0 && <span className="ms-0.5 font-data text-3xs tabular-nums text-cz-3">+{extra}</span>}
    </span>
  );
}

/** Klar / N mangler / Laast / Afmeldt, med spillets egen status-anatomi. */
export function ReadinessBadge({ readiness }) {
  const { t } = useTranslation("planning");
  const label =
    readiness.state === "missing"
      ? t("status.missing", { count: readiness.missing })
      : t(`status.${readiness.state}`);
  return (
    <span className={`${statusBadgeClass(READINESS_TONE[readiness.state], { emphasis: true })} shrink-0`}>
      {label}
    </span>
  );
}

/** Lille firkantet status-markoer (grøn = klar, rav = trup mangler). Ingen venstre-bjælke (TASTE §3). */
export function ReadinessMark({ state }) {
  const tone = state === "ready" ? "bg-cz-success" : state === "missing" ? "bg-cz-warning" : "bg-cz-3";
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 ${tone}`} />;
}
