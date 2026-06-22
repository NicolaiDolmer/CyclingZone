// Bekræftelses-dialog ved at signere en fri ungdomsryttter til akademiet for penge
// (#1744). Spejler BidConfirmModals visuelle sprog (overlay + cz-card-panel + scale-in
// + cancel/confirm), men viser PRIS + SALDO-EFFEKT (før/efter) så man ikke ved et uheld
// bruger penge. Genbruger useModalA11y for focus-trap/Escape/scroll-lock (#1073).
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useModalA11y } from "../hooks/useModalA11y.js";
import { CoinIcon } from "./ui/icons";

export function AcademySignConfirmModal({
  show,
  riderName,
  price,
  balance,
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["academy", "common"]);
  // Hook'en skal kaldes ubetinget — den no-op'er selv når active=false.
  const dialogRef = useModalA11y(busy ? null : onCancel, show);
  if (!show) return null;

  const priceNum = Number(price) || 0;
  const balanceNum = Number.isFinite(Number(balance)) ? Number(balance) : null;
  const after = balanceNum != null ? balanceNum - priceNum : null;
  const cannotAfford = balanceNum != null && priceNum > balanceNum;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "academySignScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-sign-title"
      >
        <CoinIcon size={32} className="mx-auto mb-3 text-cz-accent-t" aria-hidden="true" />
        <h2 id="academy-sign-title" className="text-cz-1 font-bold text-lg mb-2">
          {t("academy:signModal.title")}
        </h2>
        <p className="text-cz-2 text-sm mb-4">
          {t("academy:signModal.question")}{" "}
          {riderName ? <span className="font-bold text-cz-1">{riderName}</span> : null}?
        </p>

        {/* Pris + saldo-effekt. Editorial mono-tal, ingen pynt. */}
        <dl className="text-sm border border-cz-border rounded-lg divide-y divide-cz-border mb-5 text-left">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">{t("academy:signModal.priceLabel")}</dt>
            <dd className="font-mono font-bold text-cz-1">{formatNumber(priceNum)} CZ$</dd>
          </div>
          {balanceNum != null && (
            <>
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t("academy:signModal.balanceLabel")}</dt>
                <dd className="font-mono text-cz-2">{formatNumber(balanceNum)} CZ$</dd>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t("academy:signModal.afterLabel")}</dt>
                <dd className={`font-mono font-bold ${cannotAfford ? "text-cz-danger" : "text-cz-1"}`}>
                  {formatNumber(after)} CZ$
                </dd>
              </div>
            </>
          )}
        </dl>

        {cannotAfford && (
          <p className="text-cz-danger text-xs mb-4">{t("academy:signModal.cannotAfford")}</p>
        )}

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
            disabled={busy || cannotAfford}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? t("common:actions.loadingShort") : t("academy:signModal.confirm")}
          </button>
        </div>
        <style>{`
          @keyframes academySignScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
