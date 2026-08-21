// Z1 v0 (#1146) — Season/Day-segmented-toggle på planlægnings-boardet.
// Ren URL-flip (ejeren af `?view=` er PlanningHubPage); ingen egen tilstand.
// Aktiv side = navy (samme flade som sæsonens GT-bænde), inaktiv = kort-flade.
import { useTranslation } from "react-i18next";

export default function SeasonDayToggle({ view, onChange }) {
  const { t } = useTranslation("races");
  const seg = (value, label) => {
    const active = view === value;
    return (
      <button
        type="button"
        onClick={() => { if (!active) onChange(value); }}
        aria-pressed={active}
        className={`px-3.5 py-1 text-xs transition-colors ${
          active
            ? "bg-cz-sidebar font-semibold text-cz-sidebar-1"
            : "bg-cz-card text-cz-2 hover:text-cz-1"
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex overflow-hidden rounded-cz border border-cz-border" role="group" aria-label={t("hub.tabSelection")}>
      {seg("season", t("seasonView.toggleSeason"))}
      {seg("day", t("seasonView.toggleDay"))}
    </div>
  );
}
