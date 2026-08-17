// Generisk bekræftelses-dialog for bud — bruges på auktioner (normalt bud + autobud-loft) og transfers.
// Mode styrer ordvalg + ikonet. i18n: Fase 3b — Refs #412.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { GavelIcon, AlertTriangleIcon, BriefcaseIcon } from "./ui/icons";
import { RETIREMENT_WINDOW_START_AGE, RETIREMENT_GUARANTEED_AGE } from "../lib/riderAge";

// Ikonet er ikke oversættelig tekst — det vælges af mode, ikke i18n.
const MODE_ICON = { bid: GavelIcon, proxy: AlertTriangleIcon, transfer: BriefcaseIcon };

// #2700: pensions-advarsel i selve bekræftelses-modalen, ikke kun som badge på
// kortet (ejer-accept 22/7: "i bekræftelses-modalen, ikke kun som badge").
// retirementTier kommer fra riderAge.js' retirementBidWarningTier (SSOT for
// tærskler er backend/lib/riderProgression.js PROGRESSION_CONFIG.retirement).
export function BidConfirmModal({ show, mode = "bid", riderName, amount, retirementTier = null, onCancel, onConfirm, busy = false }) {
  const { t } = useTranslation(["auctions", "common"]);
  if (!show) return null;

  const retirementText = retirementTier
    ? t(`auctions:modal.retirementWarning.${retirementTier}`, {
        windowStart: RETIREMENT_WINDOW_START_AGE,
        guaranteedAge: RETIREMENT_GUARANTEED_AGE,
      })
    : null;

  const modeKey = ["bid", "proxy", "transfer"].includes(mode) ? mode : "bid";
  const Icon = MODE_ICON[modeKey];
  const l = {
    title:  t(`auctions:modal.${modeKey}Title`),
    verb:   t(`auctions:modal.${modeKey}Verb`),
    action: t(`auctions:modal.${modeKey}Action`),
  };
  const amountText = formatNumber(amount ?? 0);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={onCancel}>
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
        {retirementText && (
          <div
            role="alert"
            className="mb-4 -mt-2 flex items-start gap-2 rounded-cz border border-cz-warning/30 bg-cz-warning-bg/40 px-3 py-2 text-left text-xs text-cz-warning"
          >
            <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{retirementText}</span>
          </div>
        )}
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
