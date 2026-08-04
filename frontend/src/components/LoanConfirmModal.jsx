// #2815 — high-debt loan confirmation. Shown when a candidate loan would push
// the team's total debt to ≥50% of its division's cap (computeLoanRiskSummary,
// lib/loanRisk.js). Purely informational + one extra click — never blocks a
// loan the server would accept, no amount is reduced, no player pays more.
// Applies identically to a brand-new team and a five-season veteran; the
// trigger is the resulting debt ratio, not account age, so this never singles
// out new players and never penalises a strong/established one either.
// Spejler StartPriceTypoGuardModal/BidConfirmModal: overlay + cz-card-panel +
// useModalA11y, ingen slop.
import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { AlertTriangleIcon } from "./ui";
import { useModalA11y } from "../hooks/useModalA11y.js";

export function LoanConfirmModal({
  show,
  principal,
  fee,
  newTotalDebt,
  ceilingPct,
  debtCeiling,
  nextSeasonInterest,
  projectedDebtAfterInterest,
  exceedsCeilingNextSeason,
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["finance", "common"]);
  const dialogRef = useModalA11y(busy ? null : onCancel, show);
  if (!show) return null;

  const strong = <span className="font-mono font-bold text-cz-1" />;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "loanConfirmScaleIn 0.2s ease-out" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-confirm-title"
      >
        <div className="mb-3 flex justify-center" aria-hidden="true">
          <AlertTriangleIcon size={32} className="text-cz-warning" />
        </div>
        <h2 id="loan-confirm-title" className="text-cz-1 font-bold text-lg mb-2">
          {t("finance:loans.confirmModal.title")}
        </h2>
        <p className="text-cz-2 text-sm mb-3 text-start">
          <Trans
            i18nKey="loans.confirmModal.body"
            ns="finance"
            values={{
              principal: formatNumber(principal ?? 0),
              fee: formatNumber(fee ?? 0),
              newTotalDebt: formatNumber(newTotalDebt ?? 0),
              pct: Math.round((ceilingPct ?? 0) * 100),
              ceiling: formatNumber(debtCeiling ?? 0),
            }}
            components={{ strong }}
          />
        </p>
        <p className="text-cz-2 text-sm mb-3 text-start">
          <Trans
            i18nKey="loans.confirmModal.interestForecast"
            ns="finance"
            values={{
              interest: formatNumber(nextSeasonInterest ?? 0),
              projected: formatNumber(projectedDebtAfterInterest ?? 0),
            }}
            components={{ strong }}
          />
        </p>
        {exceedsCeilingNextSeason && (
          <p className="text-cz-danger text-xs mb-4 text-start leading-snug bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-2">
            {t("finance:loans.confirmModal.ceilingWarning")}
          </p>
        )}
        <p className="text-cz-2 text-sm mb-5">{t("finance:loans.confirmModal.question")}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all disabled:opacity-60"
          >
            {busy ? t("finance:loans.take.processing") : t("finance:loans.confirmModal.confirm")}
          </button>
        </div>
        <style>{`
          @keyframes loanConfirmScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
