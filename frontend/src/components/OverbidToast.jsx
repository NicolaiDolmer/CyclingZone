// #196: Minimal toast-stack for "Du er overbudt på X". Ingen ekstern library —
// bare fixed-positioned div'er der auto-disappearer efter 4s. Position:
//   desktop → bottom-right (over sidebar/feed)
//   mobile  → top under header (over MobileQuickNav som lever ved bottom-0)
// i18n: Fase 3b — Refs #412.

import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { AlertTriangleIcon } from "./ui";

export default function OverbidToast({ toasts, onDismiss }) {
  const { t } = useTranslation(["auctions", "common"]);
  if (!toasts.length) return null;
  return (
    <div
      data-testid="overbid-toast-stack"
      className="fixed z-50 flex flex-col gap-2 pointer-events-none
        top-16 right-4 left-4 md:left-auto md:top-auto md:bottom-4 md:right-4 md:max-w-sm"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          role="status"
          className="cz-toast-item pointer-events-auto bg-cz-card border border-cz-danger/40 shadow-lg
            rounded-cz px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangleIcon size={18} className="text-cz-danger flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-cz-1 text-sm font-medium leading-snug">
              {t("auctions:toast.overbidMessage", { riderName: toast.riderName })}
            </p>
            {toast.amount != null && (
              <p className="text-cz-3 text-xs mt-0.5 font-mono">
                {t("auctions:toast.overbidNewPrice", { amount: formatNumber(toast.amount) })}
              </p>
            )}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-cz-3 hover:text-cz-1 text-base leading-none min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0 -me-2"
            aria-label={t("common:actions.close")}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
