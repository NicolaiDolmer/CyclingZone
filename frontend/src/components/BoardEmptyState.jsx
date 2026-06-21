// Onboarding v2 Slice 2 — explainer-kort på /board for managers uden bestyrelsesplan.
// Vises når board_plan_set === false. Forklarer bestyrelsens rolle, 1yr/3yr/5yr-strukturen
// og KPI-kategorierne, og giver CTA til at åbne wizard for første plan (5yr).
//
// Tour-targets (data-tour) matcher buildBoardTourSteps i BoardPage, så "Vis mig hvordan"-
// knappen fra OnboardingProgressCard kan pege på sektionerne herunder.
// Slice 4 (v2.19): sekundær "Vis mig rundt"-knap starter tour direkte for managers
// der lander her uden at gå via Dashboard.

import { useTranslation } from "react-i18next";
import { ClipboardIcon } from "./ui/icons";

const EMPTY_STATE_PLANS = [
  { id: "oneYear",   badge: "1" },
  { id: "threeYear", badge: "3" },
  { id: "fiveYear",  badge: "5" },
];

const EMPTY_STATE_KPIS = ["results", "finance", "identity", "rank"];

export default function BoardEmptyState({ onOpenWizard, onStartTour }) {
  const { t } = useTranslation("board");
  return (
    <div className="mb-5 px-5 py-5 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start gap-3 mb-4">
        <ClipboardIcon size={20} className="text-cz-accent-t flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-base font-semibold">{t("emptyState.headline")}</p>
          <p className="text-cz-2 text-xs mt-1">{t("emptyState.intro")}</p>
        </div>
      </div>

      <div data-tour="board-plans" className="grid sm:grid-cols-3 gap-2 mb-4">
        {EMPTY_STATE_PLANS.map(plan => (
          <div key={plan.id} className="bg-cz-subtle border border-cz-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30 flex items-center justify-center text-[11px] font-bold text-cz-accent-t">{plan.badge}</span>
              <p className="text-cz-1 text-sm font-semibold">{t(`emptyState.plans.${plan.id}.label`)}</p>
            </div>
            <p className="text-cz-3 text-xs">{t(`emptyState.plans.${plan.id}.description`)}</p>
          </div>
        ))}
      </div>
      <p className="text-cz-3 text-xs mb-4 -mt-2">{t("emptyState.plansFooter")}</p>

      <div data-tour="board-satisfaction" className="bg-cz-subtle border border-cz-border rounded-lg p-3 mb-4">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("emptyState.satisfactionLabel")}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span><span className="text-cz-success font-mono">70–100%</span> <span className="text-cz-2">→ sponsor × &gt; 1.0</span></span>
          <span><span className="text-cz-accent-t font-mono">40–69%</span> <span className="text-cz-2">→ sponsor × 1.0</span></span>
          <span><span className="text-cz-danger font-mono">0–39%</span> <span className="text-cz-2">→ sponsor × &lt; 1.0</span></span>
        </div>
        <p className="text-cz-3 text-xs mt-2">{t("emptyState.satisfactionFooter")}</p>
      </div>

      <div data-tour="board-kpis" className="mb-4">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-2">{t("emptyState.kpis.heading")}</p>
        <ul className="text-cz-2 text-xs space-y-1">
          {EMPTY_STATE_KPIS.map(kpi => (
            <li key={kpi}>• <span className="text-cz-1 font-medium">{t(`emptyState.kpis.${kpi}.label`)}</span>, {t(`emptyState.kpis.${kpi}.text`)}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onOpenWizard}
          className="w-full sm:w-auto bg-cz-accent text-cz-on-accent px-4 py-2.5 rounded-lg text-sm font-bold hover:brightness-110 transition-all"
        >
          {t("emptyState.ctaNegotiate")}
        </button>
        {onStartTour && (
          <button
            onClick={onStartTour}
            className="text-cz-accent-t text-xs hover:underline font-medium px-2 py-1"
          >
            {t("emptyState.ctaShowTour")}
          </button>
        )}
      </div>
    </div>
  );
}
