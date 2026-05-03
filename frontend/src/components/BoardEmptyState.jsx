// Onboarding v2 Slice 2 — explainer-kort på /board for managers uden bestyrelsesplan.
// Vises når board_plan_set === false. Forklarer bestyrelsens rolle, 1yr/3yr/5yr-strukturen
// og KPI-kategorierne, og giver CTA til at åbne wizard for første plan (5yr).
//
// Tour-targets (data-tour) matcher BOARD_TOUR_STEPS i BoardPage, så "Vis mig hvordan"-
// knappen fra OnboardingProgressCard kan pege på sektionerne herunder.
// Slice 4 (v2.19): sekundær "Vis mig rundt"-knap starter tour direkte for managers
// der lander her uden at gå via Dashboard.

export default function BoardEmptyState({ onOpenWizard, onStartTour }) {
  return (
    <div className="mb-5 px-5 py-5 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-cz-accent-t text-xl flex-shrink-0">◧</span>
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-base font-semibold">Mød din bestyrelse</p>
          <p className="text-cz-2 text-xs mt-1">
            Du har endnu ingen bestyrelsesplaner. Bestyrelsen sætter mål, vurderer din sæson
            og bestemmer hvor meget sponsor-indkomst dit hold får udbetalt.
          </p>
        </div>
      </div>

      <div data-tour="board-plans" className="grid sm:grid-cols-3 gap-2 mb-4">
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30 flex items-center justify-center text-[11px] font-bold text-cz-accent-t">1</span>
            <p className="text-cz-1 text-sm font-semibold">1-årsplan</p>
          </div>
          <p className="text-cz-3 text-xs">Strenge mål, hurtige resultater. Fuld straf ved fejl.</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30 flex items-center justify-center text-[11px] font-bold text-cz-accent-t">3</span>
            <p className="text-cz-1 text-sm font-semibold">3-årsplan</p>
          </div>
          <p className="text-cz-3 text-xs">Moderate mål, plads til vækst. 20% reduceret straf.</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30 flex items-center justify-center text-[11px] font-bold text-cz-accent-t">5</span>
            <p className="text-cz-1 text-sm font-semibold">5-årsplan</p>
          </div>
          <p className="text-cz-3 text-xs">Langsigtede ambitioner. 40% reduceret straf.</p>
        </div>
      </div>
      <p className="text-cz-3 text-xs mb-4 -mt-2">
        Alle tre planer kører parallelt — du forhandler én ad gangen, og hver har sine egne mål og tidshorisont.
      </p>

      <div data-tour="board-satisfaction" className="bg-cz-subtle border border-cz-border rounded-lg p-3 mb-4">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">Tilfredshed → sponsor-modifier</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span><span className="text-cz-success font-mono">70–100%</span> <span className="text-cz-2">→ sponsor × &gt; 1.0</span></span>
          <span><span className="text-cz-accent-t font-mono">40–69%</span> <span className="text-cz-2">→ sponsor × 1.0</span></span>
          <span><span className="text-cz-danger font-mono">0–39%</span> <span className="text-cz-2">→ sponsor × &lt; 1.0</span></span>
        </div>
        <p className="text-cz-3 text-xs mt-2">
          Hver opfyldt mål øger tilfredsheden — utilfredse bestyrelser skærper kravene ved næste planforhandling.
        </p>
      </div>

      <div data-tour="board-kpis" className="mb-4">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-2">Hvad de vurderer på</p>
        <ul className="text-cz-2 text-xs space-y-1">
          <li>• <span className="text-cz-1 font-medium">Resultater</span> — etapesejre, top-N-finish, samlede sejre</li>
          <li>• <span className="text-cz-1 font-medium">Økonomi</span> — udestående gæld, sponsor-vækst over planen</li>
          <li>• <span className="text-cz-1 font-medium">Identitet</span> — U25-andel, national kerne, profilryttere</li>
          <li>• <span className="text-cz-1 font-medium">Rangering</span> — division-placering ved sæsonafslutning</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onOpenWizard}
          className="w-full sm:w-auto bg-cz-accent text-cz-on-accent px-4 py-2.5 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
        >
          Forhandl din første plan med bestyrelsen →
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
