// Onboarding v2 Slice 1b — empty-state øverst på RidersPage for managers med 0 ryttere.
// Forklarer filter-panelet, viser budget vs. division-minimum og giver CTA der filtrerer
// listen til ryttere ≤ balance. Slice 4 (v2.19): sekundær "Vis mig rundt"-knap starter
// tour direkte for managers der lander her uden at gå via Dashboard.
// i18n: bruger `riders` namespace (Refs #487).

import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { BikeIcon } from "./ui";

export default function RidersEmptyState({ balance, onFilterByBudget, onStartTour }) {
  const { t } = useTranslation("riders");
  const balanceLabel = formatNumber(balance ?? 0);

  return (
    <div className="mb-4 px-4 py-4 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start gap-2 mb-3">
        <BikeIcon size={16} className="text-cz-accent-t flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-sm font-semibold">{t("emptyState.title")}</p>
          <p className="text-cz-2 text-xs mt-0.5">
            {t("emptyState.intro")}
          </p>
        </div>
      </div>

      <div className="mb-3">
        <div className="bg-cz-subtle rounded-cz px-3 py-2 border border-cz-border">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("emptyState.balance")}</p>
          <p className="text-cz-accent-t font-mono font-bold text-sm mt-0.5">{balanceLabel} CZ$</p>
        </div>
      </div>

      <ul className="text-cz-2 text-xs space-y-1 mb-3">
        <li>
          •{" "}
          <Trans
            i18nKey="emptyState.tipValue"
            ns="riders"
            components={{ strong: <span className="text-cz-1 font-medium" /> }}
          />
        </li>
        <li>
          •{" "}
          <Trans
            i18nKey="emptyState.tipStats"
            ns="riders"
            components={{ strong: <span className="text-cz-1 font-medium" /> }}
          />
        </li>
        <li>
          •{" "}
          <Trans
            i18nKey="emptyState.tipBudget"
            ns="riders"
            components={{ strong: <span className="text-cz-1 font-medium" /> }}
          />
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onFilterByBudget}
          className="w-full sm:w-auto bg-cz-accent text-cz-on-accent px-4 py-2 rounded-cz text-xs font-bold hover:brightness-110 transition-all"
        >
          {t("emptyState.ctaFindFirst", { balance: balanceLabel })}
        </button>
        {onStartTour && (
          <button
            onClick={onStartTour}
            className="text-cz-accent-t text-xs hover:underline font-medium px-2 py-1"
          >
            {t("emptyState.ctaTour")}
          </button>
        )}
      </div>
    </div>
  );
}
