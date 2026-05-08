// Onboarding v2 Slice 1b — engangs-banner på AuctionsPage for managers der endnu
// ikke har afgivet et bud. Forklarer min-bud-regel og 10-min auto-forlængelse.
// Forsvinder permanent når brugeren klikker × (localStorage cz-first-bid-shown).
// Slice 4 (v2.19): "Vis mig rundt"-knap starter tour direkte og dismisser hintet.

export default function AuctionsFirstBidHint({ onDismiss, onStartTour }) {
  return (
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start gap-3">
        <span className="text-cz-accent-t text-base flex-shrink-0">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-sm font-semibold mb-1">Sådan virker auktioner</p>
          <ul className="text-cz-2 text-xs space-y-1">
            <li>
              <span className="text-cz-1 font-medium">Min-bud:</span> Et nyt bud skal mindst være
              1 CZ$ over det aktuelle bud. Min-bud er forudfyldt i input-feltet.
            </li>
            <li>
              <span className="text-cz-1 font-medium">10-min auto-forlængelse:</span> Bud i de sidste
              10 minutter forlænger auktionen — så du kan altid svare igen, hvis nogen overbyder dig
              på falderebet.
            </li>
          </ul>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2"
          aria-label="Skjul"
        >
          ×
        </button>
      </div>
      {onStartTour && (
        <div className="mt-2 pl-7">
          <button
            onClick={onStartTour}
            className="text-cz-accent-t text-xs hover:underline font-medium"
          >
            💡 Vis mig rundt
          </button>
        </div>
      )}
    </div>
  );
}
