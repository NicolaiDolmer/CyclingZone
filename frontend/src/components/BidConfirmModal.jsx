// Generisk bekræftelses-dialog for bud — bruges på auktioner (normalt bud + autobud-loft) og transfers.
// Mode styrer ordvalg + ikonet.
export function BidConfirmModal({ show, mode = "bid", riderName, amount, onCancel, onConfirm, busy = false }) {
  if (!show) return null;

  const labels = {
    bid:      { icon: "🏷️", title: "Bekræft bud",        verb: "byde", action: "Byd" },
    proxy:    { icon: "🤖", title: "Bekræft autobud",    verb: "sætte autobud-loft til", action: "Gem autobud" },
    transfer: { icon: "💼", title: "Bekræft transferbud", verb: "sende et transferbud på", action: "Send bud" },
  };
  const l = labels[mode] || labels.bid;
  const amountText = (amount ?? 0).toLocaleString("da-DK");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 bg-cz-card border border-cz-border rounded-2xl p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "bidConfirmScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bid-confirm-title"
      >
        <div className="text-4xl mb-3" aria-hidden="true">{l.icon}</div>
        <h2 id="bid-confirm-title" className="text-cz-1 font-bold text-lg mb-2">{l.title}</h2>
        <p className="text-cz-2 text-sm mb-5">
          Er du sikker på at du vil {l.verb}{" "}
          <span className="font-mono font-bold text-cz-1">{amountText} CZ$</span>
          {riderName ? <> på <span className="font-bold text-cz-1">{riderName}</span></> : null}?
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            Annullér
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-accent text-cz-on-accent hover:brightness-110 transition-all disabled:opacity-60"
          >
            {busy ? "..." : l.action}
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
