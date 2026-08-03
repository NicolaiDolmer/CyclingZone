// StaffScoutHistoryTab — historik-flade pr. spejder (#3203, Discord-løfte
// 27/7 til @cybersimon): "hvilke ryttere har denne spejder tidligere scoutet".
// Vises KUN for staff.role === 'scouting' i StaffProfilePage's History-fane
// (andre roller beholder den generiske kontrakt-historik-placeholder).
//
// Datalag: GET /api/club/staff/:id/scouting-history — kun 'target'-opgaver
// (individuel rytter-efterretning, niveau 1→3), IKKE mission-shortlists (dem
// viser Scouting-central allerede holds-bredt, ShortlistFeed). Rytternavne
// hentes lazily via den delte useRiderNames-hook (samme batch-opslag som
// Scouting-central bruger for kø/shortlist).
//
// Grid-tabel spejler RiderHistoryTab (rytterprofilens Historik-fane) 1:1:
// samme kort-ramme, loading-spinner, tomt/fejl-state-mønster.
import { useTranslation } from "react-i18next";
import { useScoutHistory } from "../../../lib/useScoutHistory.js";
import { useRiderNames } from "../../../lib/useRiderNames.js";
import RiderLink from "../../RiderLink.jsx";
import { formatDate } from "../../../lib/intl.js";

const GRID = "grid grid-cols-[70px_minmax(0,1fr)_64px] sm:grid-cols-[96px_minmax(0,1fr)_84px] gap-2.5 px-4 items-center";

export default function StaffScoutHistoryTab({ staffId }) {
  const { t } = useTranslation("staff");
  const { history, maxLevel, error } = useScoutHistory(staffId);
  const riderIds = (history ?? []).map((row) => row.rider_id).filter(Boolean);
  const riderNames = useRiderNames(riderIds);

  // null = fetch undervejs (samme loading-gate som RiderHistoryTab).
  if (history == null && !error) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 flex items-center justify-center py-10">
        <div role="status" className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" aria-label={t("history.scouting.loading")} />
      </div>
    );
  }

  // Fetch-fejl må ikke ligne "ingen scoutede ryttere endnu" (#1338-princippet).
  if (error) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("history.scouting.loadFailed")}</p>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("history.scouting.empty")}</p>
      </div>
    );
  }

  const th = "font-mono text-3xs font-semibold uppercase tracking-[0.05em] text-cz-3";
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className={`${GRID} py-2 border-b border-cz-border`}>
        <span className={th}>{t("history.scouting.table.date")}</span>
        <span className={th}>{t("history.scouting.table.rider")}</span>
        <span className={`${th} text-right`}>{t("history.scouting.table.level")}</span>
      </div>
      {history.map((row, i) => (
        <div key={row.id} className={`${GRID} py-2.5 ${i > 0 ? "border-t border-cz-border" : ""}`}>
          <span className="font-mono tabular-nums text-2xs text-cz-3 whitespace-nowrap">
            {formatDate(row.completed_at, null, { day: "2-digit", month: "2-digit", year: "2-digit" })}
          </span>
          <span className="text-[12.5px] leading-snug min-w-0 truncate">
            {row.rider_id ? (
              // #3203: tab="scouting" hopper direkte til rapporten (rytterens
              // Scouting-fane) — genbruger #3046-mønstret (rytterlink), men
              // med et konkret mål frem for profilens Overblik-standardfane.
              <RiderLink id={row.rider_id} tab="scouting" className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                {riderNames[row.rider_id] ?? t("history.scouting.loadingRider")}
              </RiderLink>
            ) : (
              <span className="text-cz-3">{t("history.scouting.riderUnavailable")}</span>
            )}
          </span>
          <span className="font-mono tabular-nums text-2xs text-cz-2 text-right whitespace-nowrap">
            {t("history.scouting.levelValue", { level: row.target_level, max: maxLevel })}
          </span>
        </div>
      ))}
    </div>
  );
}
