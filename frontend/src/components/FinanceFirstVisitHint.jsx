// Onboarding v2 Slice 3 — explainer-kort på /finance for managers ved første besøg.
// Forklarer sponsor-indkomst (board-modifier-link), salary, gældsloft pr. division, og lån.
// Forsvinder permanent når brugeren klikker × eller "Vis mig rundt" (localStorage cz-finance-hint-shown).
//
// Tour-targets (data-tour) matcher FINANCE_TOUR_STEPS i FinancePage. Knappen "Vis mig rundt"
// starter tour og dismisser kortet i samme handling.

import { Link } from "react-router-dom";

export default function FinanceFirstVisitHint({ onDismiss, onStartTour }) {
  return (
    <div className="mb-5 px-5 py-5 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-cz-accent-t text-xl flex-shrink-0">💰</span>
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-base font-semibold">Sådan fungerer din økonomi</p>
          <p className="text-cz-2 text-xs mt-1">
            Fire indtægts- og udgiftsstrømme styrer din balance. Forstå dem,
            og du kan prioritere mellem sportsligt fokus, vækst og gæld.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label="Skjul"
        >
          ×
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-success text-sm">📈</span>
            <p className="text-cz-1 text-sm font-semibold">Sponsor-indkomst</p>
          </div>
          <p className="text-cz-3 text-xs">
            Base 260.000 CZ$ pr. sæson × din{" "}
            <Link to="/board" className="text-cz-accent-t hover:underline font-medium">
              bestyrelses-modifier
            </Link>
            . Udbetales månedligt over sæsonen.
          </p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-danger text-sm">📉</span>
            <p className="text-cz-1 text-sm font-semibold">Løn til ryttere</p>
          </div>
          <p className="text-cz-3 text-xs">
            10% af rytterværdien pr. sæson (uci_points × 4000). Trækkes løbende —
            stjerneryttere er dyre at holde på.
          </p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-warning text-sm">⚠️</span>
            <p className="text-cz-1 text-sm font-semibold">Gældsloft pr. division</p>
          </div>
          <p className="text-cz-3 text-xs">
            <span className="font-mono">D1 1.200K · D2 900K · D3 600K</span>. Brydes loftet,
            spærres nye lån — og bestyrelsen straffer overforbrug.
          </p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-info text-sm">🏦</span>
            <p className="text-cz-1 text-sm font-semibold">Lån — kort vs. langt</p>
          </div>
          <p className="text-cz-3 text-xs">
            Kort lån: lavt gebyr, hurtig tilbagebetaling. Langt lån: større beløb
            over flere sæsoner. Brug dem til transferspidser, ikke driftshuller.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onStartTour}
          className="bg-cz-accent text-cz-on-accent px-4 py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
        >
          💡 Vis mig rundt
        </button>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-xs px-2 py-1 transition-colors"
        >
          Spring over
        </button>
      </div>
    </div>
  );
}
