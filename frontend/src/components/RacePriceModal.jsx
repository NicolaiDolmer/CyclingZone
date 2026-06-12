import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";

// #194 race-confirm-modal: vises når server returnerer 409 price_changed —
// dvs. prisen er steget mellem manager's fetch og POST. Manager kan annullere
// eller bekræfte et nyt bud på det opdaterede min-niveau.
export function RacePriceModal({ show, newPrice, newMinBid, onCancel, onConfirm }) {
  const { t } = useTranslation("auctions");
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 bg-cz-card border border-cz-border rounded-2xl p-6
          text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "raceScaleIn 0.25s ease-out" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-cz-1 font-bold text-lg mb-2">{t("priceChanged.title")}</h2>
        <p className="text-cz-2 text-sm mb-1">
          <Trans
            i18nKey="priceChanged.newPrice"
            ns="auctions"
            values={{ amount: formatNumber(newPrice) }}
            components={{ strong: <span className="font-mono font-bold text-cz-1" /> }}
          />
        </p>
        <p className="text-cz-2 text-sm mb-5">
          <Trans
            i18nKey="priceChanged.newMinBid"
            ns="auctions"
            values={{ amount: formatNumber(newMinBid) }}
            components={{ strong: <span className="font-mono font-bold text-cz-1" /> }}
          />
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all"
          >
            {t("priceChanged.bidCta", { amount: formatNumber(newMinBid) })}
          </button>
        </div>
        <style>{`
          @keyframes raceScaleIn {
            from { transform: scale(0.85); opacity: 0; }
            to   { transform: scale(1);    opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
