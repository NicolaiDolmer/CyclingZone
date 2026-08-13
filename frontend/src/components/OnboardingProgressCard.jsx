import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { startTour, TOUR_PAGE_BY_STEP } from "../lib/onboardingTour";

// #2288 Slice A: 4 ægte spiller-handlinger (se backend/routes/api.js's
// /me/onboarding-progress-kommentar for hvorfor de gamle team_named/
// first_rider_owned-trin blev droppet — de var altid completed fra start).
//
// #3681: first_squad_selected pegede på "/races" indtil 14/8. Den rute blev
// opløst i #3102 etape 3 — RacesLegacyRedirect i App.jsx sender nu et rent
// /races (uden ?tab=) videre til /resultater, så onboarding-trin 3 landede en
// ny spiller i Resultat-hubben, mens tourens anker [data-tour='races-column']
// bor på Planlægnings-hubben. Tourens pageKey er stadig "races" (bevidst
// bevaret i onboardingTour.js, så gennemførte tours ikke genstarter) — det er
// RUTEN der skulle følge med. onboardingStepTargets-vagten i
// backend/lib/handheldCopyGuards.test.js pinner nu tabellen mod ruterne i
// frontend/tests/e2e/onboarding-tour-coverage.spec.js.
const STEP_TARGETS = {
  first_bid_placed: "/auctions",
  first_training_run: "/training",
  first_squad_selected: "/planning",
  board_plan_set: "/board",
};

export default function OnboardingProgressCard({ progress, onDismiss }) {
  const navigate = useNavigate();
  const { t } = useTranslation("dashboard");
  if (!progress) return null;
  const { steps, completed_count, total_count } = progress;
  const pct = Math.round((completed_count / Math.max(total_count, 1)) * 100);
  const nextStep = steps.find(s => !s.done);
  const tourPage = nextStep ? TOUR_PAGE_BY_STEP[nextStep.key] : null;
  const tourTarget = nextStep ? STEP_TARGETS[nextStep.key] : null;

  function handleStartTour() {
    if (!tourPage || !tourTarget) return;
    startTour(tourPage);
    navigate(tourTarget);
  }

  return (
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {/* #1569: editorial accent-markør i stedet for emoji-eyebrow (anti-AI-slop) */}
            <span className="w-1 h-4 bg-cz-accent rounded-full flex-shrink-0" aria-hidden="true" />
            <p className="text-cz-1 text-sm font-semibold">
              {t("onboardingProgress.header", { completed: completed_count, total: total_count })}
            </p>
          </div>
          <div className="bg-cz-subtle rounded-full h-1.5 mb-3">
            <div
              className="h-1.5 bg-cz-accent rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {steps.map(step => {
              const target = STEP_TARGETS[step.key];
              if (!target) return null;
              const isNext = !step.done && step === nextStep;
              return (
                <li key={step.key} className="flex items-center gap-2 text-xs">
                  <span className={
                    step.done ? "text-cz-success" : isNext ? "text-cz-accent-t" : "text-cz-3"
                  }>
                    {step.done ? "✓" : isNext ? "▸" : "○"}
                  </span>
                  <span className={
                    step.done
                      ? "text-cz-3 line-through"
                      : isNext
                        ? "text-cz-1 font-medium"
                        : "text-cz-2"
                  }>
                    {t(`onboardingProgress.steps.${step.key}`, { defaultValue: step.key })}
                  </span>
                  {isNext && (
                    <Link
                      to={target}
                      className="ms-auto text-cz-accent-t text-xs hover:underline font-medium"
                    >
                      {t(`onboardingProgress.ctas.${step.key}`, { defaultValue: "→" })}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {tourPage && (
            <div className="mt-3 pt-2 border-t border-cz-border">
              <button
                onClick={handleStartTour}
                className="text-cz-accent-t text-xs hover:underline font-medium"
              >
                {t("onboardingProgress.tour")}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label={t("onboardingProgress.dismissAria")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
