// #3184 fair-play/I: tastefejl-værn på auktions-startpris. Vises non-blocking
// FØR submit når detectStartPriceTypo (lib/marketValues.js) finder et
// ciffer-drop-mønster mellem den indtastede startpris og rytterens
// markedsværdi. Sælgeren kan altid vælge at fortsætte — bevidst lave
// startpriser er en legitim strategi (#3136) — dialogen er ren oplysning.
// Spejler AcademyTransferConfirmModal/RacePriceModal: overlay + cz-card-panel
// + useModalA11y + Trans til indlejret fed tekst. Ingen slop (ingen glow/
// gradient/emoji-ikon, kun stroke-ikonet AlertTriangleIcon).
import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { AlertTriangleIcon } from "./ui";
import { useModalA11y } from "../hooks/useModalA11y.js";

export function StartPriceTypoGuardModal({
  show,
  riderName,
  price,
  marketValue,
  onDismiss,
  onFix,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["auctions", "common"]);
  const dialogRef = useModalA11y(busy ? null : onDismiss, show);
  if (!show) return null;

  const priceText = formatNumber(price ?? 0);
  const valueText = formatNumber(marketValue ?? 0);
  const strong = <span className="font-mono font-bold text-cz-1" />;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={busy ? undefined : onDismiss}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "typoGuardScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="typo-guard-title"
      >
        <div className="mb-3 flex justify-center" aria-hidden="true">
          <AlertTriangleIcon size={32} className="text-cz-warning" />
        </div>
        <h2 id="typo-guard-title" className="text-cz-1 font-bold text-lg mb-2">
          {t("auctions:modal.typoGuard.title")}
        </h2>
        <p className="text-cz-2 text-sm mb-1">
          <Trans
            i18nKey="modal.typoGuard.body"
            ns="auctions"
            values={{ riderName: riderName || t("auctions:fallback.rider"), price: priceText }}
            components={{ strong }}
          />
        </p>
        <p className="text-cz-2 text-sm mb-5">
          <Trans
            i18nKey="modal.typoGuard.question"
            ns="auctions"
            values={{ marketValue: valueText }}
            components={{ strong }}
          />
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("auctions:modal.typoGuard.confirmButton")}
          </button>
          <button
            type="button"
            onClick={onFix}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all disabled:opacity-60"
          >
            {t("auctions:modal.typoGuard.fixButton")}
          </button>
        </div>
        <style>{`
          @keyframes typoGuardScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
