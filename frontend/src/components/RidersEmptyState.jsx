// Onboarding v2 Slice 1b — empty-state øverst på RidersPage for managers med 0 ryttere.
// Forklarer filter-panelet, viser budget vs. division-minimum og giver CTA der filtrerer
// listen til ryttere ≤ balance. Slice 4 (v2.19): sekundær "Vis mig rundt"-knap starter
// tour direkte for managers der lander her uden at gå via Dashboard.

const SQUAD_MIN_BY_DIVISION = { 1: 20, 2: 14, 3: 8 };

export default function RidersEmptyState({ balance, division, onFilterByBudget, onStartTour }) {
  const squadMin = SQUAD_MIN_BY_DIVISION[division] || SQUAD_MIN_BY_DIVISION[3];
  const balanceLabel = (balance ?? 0).toLocaleString("da-DK");

  return (
    <div className="mb-4 px-4 py-4 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-cz-accent-t text-base">🚴</span>
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-sm font-semibold">Byg dit første hold</p>
          <p className="text-cz-2 text-xs mt-0.5">
            Du har endnu ingen ryttere. Brug filtrene nedenfor til at finde rytterne der passer
            til din strategi og dit budget.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <div className="bg-cz-subtle rounded-lg px-3 py-2 border border-cz-border">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Din balance</p>
          <p className="text-cz-accent-t font-mono font-bold text-sm mt-0.5">{balanceLabel} CZ$</p>
        </div>
        <div className="bg-cz-subtle rounded-lg px-3 py-2 border border-cz-border">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">
            Squad-minimum (Division {division || 3})
          </p>
          <p className="text-cz-1 font-mono font-bold text-sm mt-0.5">{squadMin} ryttere</p>
        </div>
      </div>

      <ul className="text-cz-2 text-xs space-y-1 mb-3">
        <li>• <span className="text-cz-1 font-medium">Værdi-filtre</span> = pris-loft i CZ$ — sæt max under din balance for at se kun overkommelige ryttere.</li>
        <li>• <span className="text-cz-1 font-medium">Stat-filtre</span> = sportsegenskaber (BJ, SP, TT…); start bredt og indsnævr senere.</li>
        <li>• <span className="text-cz-1 font-medium">U25 / Fri agent</span> = budget-venlige veje — yngre potentiale eller ryttere uden kontrakt.</li>
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onFilterByBudget}
          className="w-full sm:w-auto bg-cz-accent text-cz-on-accent px-4 py-2 rounded-lg text-xs font-bold hover:brightness-110 transition-all"
        >
          Find din første rytter (≤ {balanceLabel} CZ$)
        </button>
        {onStartTour && (
          <button
            onClick={onStartTour}
            className="text-cz-accent-t text-xs hover:underline font-medium px-2 py-1"
          >
            💡 Vis mig rundt
          </button>
        )}
      </div>
    </div>
  );
}
