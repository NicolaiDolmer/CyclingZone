// Onboarding v2 Slice 3 — explainer-kort på /finance for managers ved første besøg.
// Forklarer sponsor-indkomst (board-modifier-link), salary, gældsloft pr. division, og lån.
// Forsvinder permanent når brugeren klikker × eller "Vis mig rundt" (localStorage cz-finance-hint-shown).
//
// Tour-targets (data-tour) matcher tourSteps i FinancePage. Knappen "Vis mig rundt"
// starter tour og dismisser kortet i samme handling.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function FinanceFirstVisitHint({ onDismiss, onStartTour }) {
  const { t } = useTranslation("finance");
  return (
    <div className="mb-5 px-5 py-5 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-cz-accent-t text-xl flex-shrink-0">💰</span>
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-base font-semibold">{t("hint.title")}</p>
          <p className="text-cz-2 text-xs mt-1">{t("hint.subtitle")}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label={t("hint.dismissAria")}
        >
          ×
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-success text-sm">📈</span>
            <p className="text-cz-1 text-sm font-semibold">{t("hint.sponsor.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">
            {t("hint.sponsor.before")}
            <Link to="/board" className="text-cz-accent-t hover:underline font-medium">
              {t("hint.sponsor.linkText")}
            </Link>
            {t("hint.sponsor.after")}
          </p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-danger text-sm">📉</span>
            <p className="text-cz-1 text-sm font-semibold">{t("hint.salary.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.salary.body")}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-warning text-sm">⚠️</span>
            <p className="text-cz-1 text-sm font-semibold">{t("hint.debt.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.debt.body")}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cz-info text-sm">🏦</span>
            <p className="text-cz-1 text-sm font-semibold">{t("hint.loans.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.loans.body")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onStartTour}
          className="bg-cz-accent text-cz-on-accent px-4 py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
        >
          {t("hint.showTour")}
        </button>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-xs px-2 py-1 transition-colors"
        >
          {t("hint.skip")}
        </button>
      </div>
    </div>
  );
}
