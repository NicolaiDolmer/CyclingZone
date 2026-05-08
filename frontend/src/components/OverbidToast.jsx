// #196: Minimal toast-stack for "Du er overbudt på X". Ingen ekstern library —
// bare fixed-positioned div'er der auto-disappearer efter 4s. Position:
//   desktop → bottom-right (over sidebar/feed)
//   mobile  → top under header (over MobileQuickNav som lever ved bottom-0)

export default function OverbidToast({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      data-testid="overbid-toast-stack"
      className="fixed z-50 flex flex-col gap-2 pointer-events-none
        top-16 right-4 left-4 md:left-auto md:top-auto md:bottom-4 md:right-4 md:max-w-sm"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto bg-cz-card border border-cz-danger/40 shadow-lg
            rounded-xl px-4 py-3 flex items-start gap-3"
        >
          <span className="text-cz-danger text-lg leading-none mt-0.5">⚠</span>
          <div className="min-w-0 flex-1">
            <p className="text-cz-1 text-sm font-medium leading-snug">
              Du er overbudt på {t.riderName}
            </p>
            {t.amount != null && (
              <p className="text-cz-3 text-xs mt-0.5 font-mono">
                Ny pris: {t.amount.toLocaleString("da-DK")} CZ$
              </p>
            )}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-cz-3 hover:text-cz-1 text-xs leading-none px-1"
            aria-label="Luk"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
