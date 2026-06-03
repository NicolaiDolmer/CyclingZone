import { DASHBOARD_MODULES } from "../lib/useDashboardLayout";

// Inline dropdown-panel til at vise/skjule dashboard-moduler (#1005).
// Mønster genbrugt 1:1 fra RiderRankingsPage kolonne-toggle: knap +
// klik-udenfor-overlay + absolut-positioneret checkbox-liste.
export default function DashboardCustomizeMenu({ open, onToggleOpen, isVisible, toggleModule, resetToDefault, t }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-all border bg-cz-card border-cz-border text-cz-2 hover:text-cz-1">
        {t("dashboard:customize.button")}
      </button>
      {open && (
        <>
          {/* Klik-udenfor-overlay */}
          <div className="fixed inset-0 z-30" onClick={onToggleOpen} />
          <div className="absolute right-0 mt-2 z-40 w-60 bg-cz-card border border-cz-border rounded-lg shadow-lg p-3">
            <p className="text-xs font-medium text-cz-3 mb-2">{t("dashboard:customize.heading")}</p>
            <div className="flex flex-col gap-1.5">
              {DASHBOARD_MODULES.map(m => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-cz-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isVisible(m.id)}
                    onChange={() => toggleModule(m.id)}
                    className="accent-cz-accent"
                  />
                  <span>{t(`dashboard:customize.modules.${m.id}`)}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={resetToDefault}
              className="mt-3 w-full text-xs text-cz-accent-t hover:underline text-center">
              {t("dashboard:customize.reset")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
