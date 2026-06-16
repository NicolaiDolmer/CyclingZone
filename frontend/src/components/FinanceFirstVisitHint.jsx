// Onboarding v2 Slice 3 — explainer-kort på /finance for managers ved første besøg.
// Forklarer sponsor-indkomst (board-modifier-link), salary, gældsloft pr. division, og lån.
// Forsvinder permanent når brugeren klikker luk-knappen eller "Vis mig rundt" (localStorage cz-finance-hint-shown).
//
// Tour-targets (data-tour) matcher tourSteps i FinancePage. Knappen "Vis mig rundt"
// starter tour og dismisser kortet i samme handling.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, CoinIcon, ArrowUpIcon, ArrowDownIcon, AlertTriangleIcon, XIcon } from "./ui";

export default function FinanceFirstVisitHint({ onDismiss, onStartTour }) {
  const { t } = useTranslation("finance");
  return (
    // Accent-bordet highlight-flade — beholdes bespoke (Card hardkoder neutral
    // border-cz-border); kun radius migreret til rounded-cz (#986/#671).
    <div className="mb-5 px-5 py-5 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start gap-3 mb-4">
        <CoinIcon size={20} aria-hidden="true" className="text-cz-accent-t flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-base font-semibold">{t("hint.title")}</p>
          <p className="text-cz-2 text-xs mt-1">{t("hint.subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label={t("hint.dismissAria")}
          className="flex-shrink-0"
        >
          <XIcon size={16} aria-hidden="true" />
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpIcon size={14} aria-hidden="true" className="text-cz-success" />
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
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownIcon size={14} aria-hidden="true" className="text-cz-danger" />
            <p className="text-cz-1 text-sm font-semibold">{t("hint.salary.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.salary.body")}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangleIcon size={14} aria-hidden="true" className="text-cz-warning" />
            <p className="text-cz-1 text-sm font-semibold">{t("hint.debt.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.debt.body")}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3">
          <div className="flex items-center gap-2 mb-1">
            <CoinIcon size={14} aria-hidden="true" className="text-cz-info" />
            <p className="text-cz-1 text-sm font-semibold">{t("hint.loans.title")}</p>
          </div>
          <p className="text-cz-3 text-xs">{t("hint.loans.body")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onStartTour}>
          {t("hint.showTour")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t("hint.skip")}
        </Button>
      </div>
    </div>
  );
}
