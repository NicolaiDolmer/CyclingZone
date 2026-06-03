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
        aria-label={t("dashboard:customize.button")}
        title={t("dashboard:customize.button")}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all border bg-cz-card border-cz-border text-cz-2 hover:text-cz-1">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="hidden sm:inline">{t("dashboard:customize.button")}</span>
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
