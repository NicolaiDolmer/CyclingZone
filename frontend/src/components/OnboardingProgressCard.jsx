import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { startTour, TOUR_PAGE_BY_STEP } from "../lib/onboardingTour";

const STEP_TARGETS = {
  team_named: "/profile",
  first_rider_owned: "/riders",
  first_bid_placed: "/auctions",
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
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-cz-accent-t text-base">🚴</span>
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
                      className="ml-auto text-cz-accent-t text-xs hover:underline font-medium"
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
