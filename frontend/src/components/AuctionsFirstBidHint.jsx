// Onboarding v2 Slice 1b — engangs-banner på AuctionsPage for managers der endnu
// ikke har afgivet et bud. Forsvinder permanent når brugeren klikker × (localStorage
// cz-first-bid-shown).
// Slice 4 (v2.19): "Vis mig rundt"-knap starter tour direkte og dismisser hintet.
// #3007 (v7.9x): copy skrevet om fra "forklar knappen" (min-bud, auto-forlængelse)
// til "forklar beslutningen" (hvad et vundet bud faktisk betyder for holdet) —
// samme stil som onboarding-turens trin 2/3-copy (#3003). Ny primær CTA
// ("Se en rytter jeg har råd til") peger på ét konkret, overkommeligt bud i
// stedet for at kræve at manageren selv finder en i en tabel med 20+ auktioner —
// færre skridt, ikke endnu en tooltip.
// i18n: Fase 3b — Refs #412, #3007.

import { useTranslation } from "react-i18next";
import { InfoIcon, XIcon } from "./ui";

export default function AuctionsFirstBidHint({ onDismiss, onStartTour, onJumpToRecommendation }) {
  const { t } = useTranslation(["auctions", "common"]);
  return (
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start gap-3">
        <InfoIcon size={18} className="text-cz-accent-t flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-sm font-semibold mb-1">{t("auctions:hint.title")}</p>
          <p className="text-cz-2 text-xs mb-2 leading-relaxed">{t("auctions:hint.body")}</p>
          <ul className="text-cz-2 text-xs space-y-1">
            <li>
              <span className="text-cz-1 font-medium">{t("auctions:hint.minBidLabel")}</span>{" "}
              {t("auctions:hint.minBidBody")}
            </li>
            <li>
              <span className="text-cz-1 font-medium">{t("auctions:hint.autoExtendLabel")}</span>{" "}
              {t("auctions:hint.autoExtendBody")}
            </li>
          </ul>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -me-2"
          aria-label={t("common:actions.hide")}
        >
          <XIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 pl-7 flex flex-wrap items-center gap-x-4 gap-y-1">
        {onJumpToRecommendation && (
          <button
            onClick={onJumpToRecommendation}
            className="text-cz-accent-t text-xs hover:underline font-bold"
          >
            {t("auctions:hint.jumpToRecommendation")}
          </button>
        )}
        {onStartTour && (
          <button
            onClick={onStartTour}
            className="text-cz-accent-t text-xs hover:underline font-medium"
          >
            {t("auctions:hint.startTour")}
          </button>
        )}
      </div>
    </div>
  );
}
