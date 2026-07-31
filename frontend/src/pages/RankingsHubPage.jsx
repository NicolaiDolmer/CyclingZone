import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, Tabs, TabList, Tab } from "../components/ui";
import StandingsPage from "./StandingsPage.jsx";
import RiderRankingsPage from "./RiderRankingsPage.jsx";
import GlobalRankPage from "./GlobalRankPage.jsx";

// #3104 etape C — Ranglister-hubben: Liga & rangliste (2.233 sessions/30 dage),
// Rytterrangliste (478) og Global Rank (<245) samlet under ét nav-punkt med
// faner, samme ?tab=-mønster som /resultater (#3102 etape 2). /standings
// beholdes som URL (størst muskelhukommelse af de tre); /rider-rankings og
// /global-rank redirecter hertil. De tre sider ejer stadig deres egen data-
// hentning og alle indre tilstande — hubben ejer kun sidehovedet og fanerne.
const VALID_TABS = ["league", "riders", "global"];

export default function RankingsHubPage() {
  const { t } = useTranslation("standings");
  const [searchParams, setSearchParams] = useSearchParams();

  // URL'en ER fane-tilstanden (#3102 etape 2-læringen) — ingen useState-kopi,
  // så browserens tilbage/frem flytter fanen med.
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "league";

  function changeTab(next) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "league") params.delete("tab");
      else params.set("tab", next);
      return params;
    }, { replace: true });
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("hub.title")} />

      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("hub.title")}>
          <Tab value="league">{t("hub.tabLeague")}</Tab>
          <Tab value="riders">{t("hub.tabRiders")}</Tab>
          <Tab value="global">{t("hub.tabGlobal")}</Tab>
        </TabList>
      </Tabs>

      {tab === "league" && <StandingsPage />}
      {tab === "riders" && <RiderRankingsPage />}
      {tab === "global" && <GlobalRankPage />}
    </div>
  );
}
