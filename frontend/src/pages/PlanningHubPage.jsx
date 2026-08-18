import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Tabs, TabList, Tab } from "../components/ui";
import RaceHubBoard from "../components/racehub/RaceHubBoard.jsx";
import OnboardingTour from "../components/OnboardingTour.jsx";
import SeasonPlannerPage from "./SeasonPlannerPage.jsx";
import StrategyPage from "./StrategyPage.jsx";
import CalendarPage from "./CalendarPage.jsx";
import I18nReadyGate from "../components/I18nReadyGate.jsx"; // #3697

// #3102 etape 3 (PR 1) — Planlægnings-hubben: Holdudtagelse (11.254 sessions/30
// dage på /races), Formplan (planneren) og Strategi samlet under ét nav-punkt
// med faner, samme ?tab=-mønster som Resultat-hubben (#3102 etape 2) og
// Ranglister-hubben (#3104 etape C). Fladerne ejer stadig deres egen
// data-hentning og alle indre tilstande — hubben ejer kun sidehovedet og
// fanerne. Boardets interaktion er urørt (muskelhukommelses-guard fra
// kontrakten); de gamle ruter (/races?tab=calendar, /planner, /races/strategy,
// /calendar) redirecter hertil.
// PR 3: kalenderen absorberet som fjerde fane (én kalender-sandhed — sidste
// selvstændige kalender-indgang nedlagt). Sidst i rækken så de tre oprindelige
// faners rækkefølge (og muskelhukommelse) står urørt.
const VALID_TABS = ["selection", "form", "strategy", "calendar"];

// #2819 — guidet tour for onboarding-trin 3 (first_squad_selected). Flyttet med
// fra RacesPage: ankrene bor i Race Hub-brættet (Holdudtagelse-fanen), og
// pageKey "races" er bevaret så allerede-gennemførte tours ikke genstarter.
function getRacesTourSteps(t) {
  return [
    {
      target: "[data-tour='races-column']",
      title: t("tour.pickRace.title"),
      body: t("tour.pickRace.body"),
    },
    {
      target: "[data-tour='races-pool']",
      title: t("tour.pickRiders.title"),
      body: t("tour.pickRiders.body"),
    },
    {
      target: "[data-tour='races-strategy']",
      title: t("tour.tactics.title"),
      body: t("tour.tactics.body"),
    },
  ];
}

export default function PlanningHubPage() {
  const { t } = useTranslation("races");
  const [searchParams, setSearchParams] = useSearchParams();
  const racesTourSteps = useMemo(() => getRacesTourSteps(t), [t]);

  // URL'en ER fane-tilstanden (#3102 etape 2-læringen) — ingen useState-kopi,
  // så browserens tilbage/frem flytter fanen med.
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "selection";

  function changeTab(next) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "selection") params.delete("tab");
      else params.set("tab", next);
      // Formplanens indre visning (?view=squad|season) hører til form-fanen —
      // ryd den ved faneskift, så et senere klik tilbage lander på default.
      if (next !== "form") params.delete("view");
      return params;
    }, { replace: true });
  }

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Touren mountes uanset fane (OnboardingTour's egen "target ikke
          fundet"-fallback giver en escape hvis manageren står på en anden
          fane) — samme afvejning som da den boede på RacesPage. */}
      <OnboardingTour pageKey="races" steps={racesTourSteps} />
      <PageHeader title={t("hub.title")} />

      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("hub.title")}>
          <Tab value="selection">{t("hub.tabSelection")}</Tab>
          <Tab value="form">{t("hub.tabForm")}</Tab>
          <Tab value="strategy">{t("hub.tabStrategy")}</Tab>
          <Tab value="calendar">{t("hub.tabCalendar")}</Tab>
        </TabList>
      </Tabs>

      {tab === "selection" && <RaceHubBoard />}
      {tab === "form" && <I18nReadyGate ns="planner"><SeasonPlannerPage /></I18nReadyGate>}
      {tab === "strategy" && <StrategyPage />}
      {tab === "calendar" && <I18nReadyGate ns="calendar"><CalendarPage /></I18nReadyGate>}
    </div>
  );
}
