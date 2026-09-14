import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { startTour, TOUR_PAGE_BY_STEP } from "../lib/onboardingTour";
import { useTraining } from "../lib/useTraining";
import { logEvent } from "../lib/logEvent";
import { CheckIcon, ChevronRightIcon, XIcon, Button } from "./ui";

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
  // #5241: trin 2 ("Kør din første træningsdag") som ét klik — genbruger det
  // eksisterende bulk-fokus-endpoint (session="smart", SMART_DEFAULT_FOCUS_KEYS
  // i backend/lib/training.js) + "Kør træning"-stien fra TrainingPage.jsx.
  // useTraining() kaldes ubetinget (Rules of Hooks) — den henter kun ekstra
  // data mens onboarding-kortet overhovedet er synligt (DashboardPage gater på
  // onboardingIncomplete), så prisen er én ekstra GET for netop de spillere
  // dette trin er bygget til.
  const training = useTraining();
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekResult, setWeekResult] = useState(null); // null | { count } | { alreadyRan: true }
  const [weekError, setWeekError] = useState(false);

  if (!progress) return null;
  const { steps, completed_count, total_count } = progress;

  const rawTrainingStep = steps.find(s => s.key === "first_training_run");
  // Idempotens (#5241): dagens træning kan allerede være kørt (fx via
  // Træning-siden i et andet faneblad) selvom onboarding-progress-proppen
  // (hentet ved dashboard-load) endnu ikke har fanget det. training.todayRun
  // kommer fra useTraining()'s EGEN, friske GET /api/training/me.
  const alreadyRanToday = !training.loading && Boolean(training.todayRun);
  const trainingCompletedLocally =
    Boolean(weekResult && (weekResult.count != null || weekResult.alreadyRan)) || alreadyRanToday;
  // Kun tilbyd ét-klik-flowet når dagligt-træning-flaget rent faktisk er tændt
  // for denne spiller OG useTraining() er færdig med sit første load — ellers
  // beholdes den gamle simple CTA-lænke uændret (ingen dead-end-knap).
  const useOneClick = training.enabled && !training.loading;

  // Effektive trin: krydser trin 2 af LOKALT så snart ugens træning er kørt i
  // denne session, uden at vente på at DashboardPage refetcher onboarding-
  // progress (den prop ejer denne komponent ikke — #5241-ejerskabet er kun
  // denne fil). Alle andre trin er uændrede referencer.
  const effectiveSteps = steps.map(s =>
    s.key === "first_training_run" && trainingCompletedLocally ? { ...s, done: true } : s
  );
  const effectiveCompletedCount =
    completed_count + (trainingCompletedLocally && rawTrainingStep && !rawTrainingStep.done ? 1 : 0);
  const pct = Math.round((effectiveCompletedCount / Math.max(total_count, 1)) * 100);
  const nextStep = effectiveSteps.find(s => !s.done);
  const tourPage = nextStep ? TOUR_PAGE_BY_STEP[nextStep.key] : null;
  const tourTarget = nextStep ? STEP_TARGETS[nextStep.key] : null;
  // #5241: "var det den aktive næste-trin da vi startede" ELLER "vi har lige
  // gjort det færdigt i denne session". Uden det sidste ben forsvinder hele
  // blokken (knapperne OG resultatlinjen) i samme øjeblik trin 2 krydses af,
  // fordi nextStep straks flytter videre til trin 3 — og resultatlinjen kan
  // aldrig nå at blive vist.
  const trainingIsNext = nextStep?.key === "first_training_run" || trainingCompletedLocally;

  function handleStartTour() {
    if (!tourPage || !tourTarget) return;
    startTour(tourPage);
    navigate(tourTarget);
  }

  // #5241: sætter assistentens anbefalede fokus for hele truppen (samme
  // server-side smart-mode som "Accept"-knappen i træningens assistent-panel,
  // TrainingPage.jsx's applyAssistantSuggestions — springer ryttere med en
  // eksisterende plan over, INGEN ny model), og kører derefter dagens træning
  // som "Kør træning"-knappen på træningssiden gør (useTraining().runToday).
  async function handleRunWeek() {
    if (weekBusy || alreadyRanToday) return;
    setWeekBusy(true);
    setWeekError(false);
    try {
      const riderIds = Object.keys(training.smartDefaultFocus || {});
      if (riderIds.length > 0) {
        await training.setPlanBulk(riderIds, "training", "smart");
      }
      const result = await training.runToday();
      if (result === null) {
        // 409 — mest sandsynligt dagen blev kørt i mellemtiden (anden fane).
        setWeekResult({ alreadyRan: true });
      } else if (result && result.ok !== false) {
        const count = result.report?.riders?.length ?? 0;
        setWeekResult({ count });
        logEvent("onboarding_step2_one_click", { ridersTrained: count });
      } else {
        setWeekError(true);
      }
    } catch {
      setWeekError(true);
    } finally {
      setWeekBusy(false);
    }
  }

  return (
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-cz">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* #4625 (slice 3 af #4622, TASTE §3) — den tidligere venstre-accent-
              markør (#1569) er selv et femte prioritetssignal; kortet står
              allerede med en accent-hairline (border-cz-accent/30). */}
          <p className="text-cz-1 text-sm font-semibold mb-2">
            {t("onboardingProgress.header", { completed: effectiveCompletedCount, total: total_count })}
          </p>
          <div className="bg-cz-subtle rounded-full h-1.5 mb-3">
            <div
              className="h-1.5 bg-cz-accent rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {effectiveSteps.map(step => {
              const target = STEP_TARGETS[step.key];
              if (!target) return null;
              const isNext = !step.done && step === nextStep;
              // #5241: trin 2 får sit eget ét-klik-blok UNDER listen i stedet
              // for den korte chevron-lænke — undgår to konkurrerende CTA'er
              // for samme trin (P9, "kort på fladen").
              const showInlineCta = isNext && !(step.key === "first_training_run" && useOneClick);
              return (
                <li key={step.key} className="flex items-center gap-2 text-xs">
                  {/* #4625 — stroke-ikon/dot i stedet for tekst-glyfferne ✓/▸/○
                      (TASTE forbudsliste: "tekst-glyffer som ikoner"). */}
                  {step.done ? (
                    <CheckIcon size={13} className="text-cz-success flex-shrink-0" aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isNext ? "bg-cz-accent-t" : "border border-cz-3"}`}
                    />
                  )}
                  <span className={
                    step.done
                      ? "text-cz-3 line-through"
                      : isNext
                        ? "text-cz-1 font-medium"
                        : "text-cz-2"
                  }>
                    {/* #5103 · Trin 4 kan stå åbent MENS bestyrelsen allerede har
                        sat en plan (auto-accept efter fristen — se backend
                        /me/onboarding-progress). Samme trin, anden opfordring:
                        ikke "gå i gang", men "se hvad bestyrelsen valgte". */}
                    {t(
                      step.key === "board_plan_set" && step.auto_set
                        ? "onboardingProgress.steps.board_plan_set_auto"
                        : `onboardingProgress.steps.${step.key}`,
                      { defaultValue: step.key }
                    )}
                  </span>
                  {showInlineCta && (
                    <Link
                      to={target}
                      className="ms-auto inline-flex items-center gap-0.5 text-cz-accent-t text-xs hover:underline font-medium"
                    >
                      {t(`onboardingProgress.ctas.${step.key}`, { defaultValue: step.key })}
                      <ChevronRightIcon size={13} aria-hidden="true" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {rawTrainingStep && !rawTrainingStep.done && trainingIsNext && useOneClick && (
            <div className="mt-3 pt-3 border-t border-cz-border">
              {trainingCompletedLocally ? (
                alreadyRanToday || weekResult?.alreadyRan ? (
                  <p className="text-xs text-cz-2">{t("onboardingProgress.oneClick.alreadyRun")}</p>
                ) : (
                  <p className="text-xs text-cz-2">
                    {t("onboardingProgress.oneClick.resultLine", { count: weekResult?.count ?? 0 })}{" "}
                    <Link to="/training" className="text-cz-accent-t hover:underline font-medium">
                      {t("onboardingProgress.oneClick.resultLink")}
                    </Link>
                  </p>
                )
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {/* Ingen gold her med vilje: dashboardets gold-CTA-slot styres
                      dynamisk af lib/dashboardGoldCta.js (fx TeamSelectionCtaCard's
                      "Vælg trup"-knap kan blive gold SAMTIDIG med at dette trin er
                      åbent) — denne fil ejer ikke den beslutning, så knappen her
                      er altid secondary. Noteret i PR-body under "EJER SKAL
                      GODKENDE". */}
                  <Button type="button" variant="secondary" size="sm" loading={weekBusy} onClick={handleRunWeek}>
                    {t("onboardingProgress.oneClick.primaryCta")}
                  </Button>
                  <Link to="/training" className="text-cz-3 text-xs hover:underline">
                    {t("onboardingProgress.oneClick.secondaryCta")}
                  </Link>
                  {weekError && (
                    <p className="w-full text-xs text-cz-danger">{t("onboardingProgress.oneClick.error")}</p>
                  )}
                </div>
              )}
            </div>
          )}
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
          className="text-cz-3 hover:text-cz-1 p-1 flex-shrink-0"
          aria-label={t("onboardingProgress.dismissAria")}
        >
          <XIcon size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
