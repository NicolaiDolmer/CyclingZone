import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Tabs, TabList, Tab, ChevronLeftIcon } from "../components/ui";
import RaceHubBoard from "../components/racehub/RaceHubBoard.jsx";
import SeasonView from "../components/racehub/SeasonView.jsx";
import SeasonDayToggle from "../components/racehub/SeasonDayToggle.jsx";
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
      // `?view=` er ALTID fane-scopet indre tilstand (form: squad|season,
      // selection: season, #1146) — ryd den ved ETHVERT faneskift, så en fanes
      // view aldrig lækker ind i en andens (selection&view=season ville ellers
      // åbne formplanen i dens egen season-visning). Fanen sætter selv sin
      // view-param EFTER ankomst; deep-links røres ikke (changeTab kører kun
      // ved klik).
      params.delete("view");
      // #1146: sæson-browse-parametret hører til Season-visningen alene.
      params.delete("season");
      // #4323 spillertest-punkt 4: samme grund som view/season ovenfor —
      // retur-stien til matrixen hører kun til Holdudtagelse-fanens dags-board.
      params.delete("returnView");
      return params;
    }, { replace: true });
  }

  // Z1 v0 (#1146): Season/Day-visning på Holdudtagelses-fanen. URL'en er
  // tilstanden (samme princip som fanerne) — `?view=season` viser sæson-aksen,
  // alt andet viser det urørte dags-board.
  const selectionView = tab === "selection" && searchParams.get("view") === "season" ? "season" : "day";
  function changeSelectionView(next) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "season") { params.set("view", "season"); params.delete("day"); }
      else params.delete("view");
      params.delete("season");
      params.delete("returnView");
      return params;
    }, { replace: true });
  }

  // #4323 spillertest-punkt 4 (Discord 29/8): klik på et løb i sæsonmatrixen
  // navigerede til dags-boardet uden vej tilbage. `returnView=season` sættes
  // af SeasonView.openDay (bevares SEPARAT fra `view`, som ville vise
  // sæson-visningen i stedet for dags-boardet) — findes den, viser dags-
  // boardet en "Tilbage til sæsonmatrix"-knap der genindsætter `view=season`.
  const returnView = tab === "selection" && searchParams.get("returnView") === "season" ? "season" : null;
  function backToSeasonView() {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set("view", "season");
      params.delete("day");
      params.delete("returnView");
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

      {tab === "selection" && (
        selectionView === "season" ? (
          <SeasonView onSwitchView={changeSelectionView} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <SeasonDayToggle view="day" onChange={changeSelectionView} />
              {/* #4323 spillertest-punkt 4: retur-sti til sæsonmatrixen, kun
                  synlig når dags-boardet reelt blev åbnet DERFRA. */}
              {returnView === "season" && (
                <button
                  type="button"
                  onClick={backToSeasonView}
                  className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide px-2.5 py-1 rounded-full border border-cz-border text-cz-2 hover:bg-cz-subtle"
                >
                  <ChevronLeftIcon size={12} aria-hidden="true" />
                  {t("matrix.backToMatrix")}
                </button>
              )}
            </div>
            <RaceHubBoard />
          </>
        )
      )}
      {tab === "form" && <I18nReadyGate ns="planner"><SeasonPlannerPage /></I18nReadyGate>}
      {tab === "strategy" && <StrategyPage />}
      {tab === "calendar" && <I18nReadyGate ns="calendar"><CalendarPage /></I18nReadyGate>}
    </div>
  );
}
