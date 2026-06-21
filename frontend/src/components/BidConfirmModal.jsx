// Generisk bekræftelses-dialog for bud — bruges på auktioner (normalt bud + autobud-loft) og transfers.
// Mode styrer ordvalg + ikonet. i18n: Fase 3b — Refs #412.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { GavelIcon, AlertTriangleIcon, BriefcaseIcon } from "./ui/icons";

// Ikonet er ikke oversættelig tekst — det vælges af mode, ikke i18n.
const MODE_ICON = { bid: GavelIcon, proxy: AlertTriangleIcon, transfer: BriefcaseIcon };

export function BidConfirmModal({ show, mode = "bid", riderName, amount, onCancel, onConfirm, busy = false }) {
  const { t } = useTranslation(["auctions", "common"]);
  if (!show) return null;

  const modeKey = ["bid", "proxy", "transfer"].includes(mode) ? mode : "bid";
  const Icon = MODE_ICON[modeKey];
  const l = {
    title:  t(`auctions:modal.${modeKey}Title`),
    verb:   t(`auctions:modal.${modeKey}Verb`),
    action: t(`auctions:modal.${modeKey}Action`),
  };
  const amountText = formatNumber(amount ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "bidConfirmScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bid-confirm-title"
      >
        <Icon size={32} className="mx-auto mb-3 text-cz-accent-t" aria-hidden="true" />
        <h2 id="bid-confirm-title" className="text-cz-1 font-bold text-lg mb-2">{l.title}</h2>
        <p className="text-cz-2 text-sm mb-5">
          {t("auctions:modal.questionPrefix")} {l.verb}{" "}
          <span className="font-mono font-bold text-cz-1">{amountText} CZ$</span>
          {riderName ? (
            <> {t("auctions:modal.onLabel")} <span className="font-bold text-cz-1">{riderName}</span></>
          ) : null}?
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all disabled:opacity-60"
          >
            {busy ? t("common:actions.loadingShort") : l.action}
          </button>
        </div>
        <style>{`
          @keyframes bidConfirmScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
